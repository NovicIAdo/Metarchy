package com.metarchy.game;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.solana.mobilewalletadapter.clientlib.protocol.JsonRpc20Client.JsonRpc20RemoteException;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.AuthorizationResult;
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationIntentCreator;
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationScenario;
import com.solana.mobilewalletadapter.common.ProtocolContract;
import com.solana.mobilewalletadapter.common.protocol.SessionProperties;
import com.solana.mobilewalletadapter.common.signin.SignInWithSolana;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;

/** A local, encrypted MWA association. No wallet private keys or transaction requests enter the app. */
@CapacitorPlugin(name = "SolanaWallet")
public class SolanaWalletPlugin extends Plugin {
    private static final int RPC_TIMEOUT_MS = 45_000;
    private static final long REQUEST_TIMEOUT_MS = 90_000;
    private final Object lock = new Object();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Operation active;
    // Only accessed on the main thread. Kept until Android returns this activity's result.
    private Operation walletActivity;
    // In memory only; process termination cannot restore an old wallet authorization.
    private Authorization authorization;
    private boolean destroyed;

    @PluginMethod
    public void signIn(PluginCall call) {
        final SolanaWalletRequest request;
        try {
            request = new SolanaWalletRequest(call.getString("identityUri"), call.getString("identityName"),
                call.getString("identityIcon"), call.getString("chain"), call.getString("statement"),
                call.getString("nonce"), call.getString("issuedAt"), call.getString("expirationTime"),
                call.getString("requestId"), call.getString("chainId"));
        } catch (RuntimeException e) {
            call.reject("Invalid wallet sign-in request.", "WALLET_INVALID_REQUEST");
            return;
        }
        mainHandler.post(() -> begin(call, request, null));
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        mainHandler.post(() -> {
            Operation pending;
            Authorization previous;
            synchronized (lock) {
                pending = active;
                previous = authorization;
                authorization = null;
            }
            if (pending != null) finish(pending, null, "Wallet request cancelled.", "WALLET_CANCELLED");
            if (previous == null) {
                call.resolve();
                return;
            }
            begin(call, null, previous);
        });
    }

    private void begin(PluginCall call, SolanaWalletRequest request, Authorization revoke) {
        final Operation operation;
        synchronized (lock) {
            if (destroyed) {
                call.reject("Wallet request cancelled.", "WALLET_CANCELLED");
                return;
            }
            if (active != null) {
                call.reject("A wallet request is already in progress.", "WALLET_BUSY");
                return;
            }
            operation = new Operation(call, request, revoke);
            active = operation;
        }
        mainHandler.postDelayed(operation.timeout, REQUEST_TIMEOUT_MS);
        launchWhenResumed(operation);
    }

    private void launchWhenResumed(Operation operation) {
        if (operation.finished.get()) return;
        if (getActivity().isFinishing()) {
            finish(operation, null, "Wallet request cancelled.", "WALLET_CANCELLED");
            return;
        }
        // A completed association may still have a wallet activity result pending. Do not let
        // that old result cancel a new sign-in/revocation; Android delivers it before RESUMED.
        if (walletActivity != null || !getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
            mainHandler.postDelayed(() -> launchWhenResumed(operation), 250);
            return;
        }
        if (!LocalAssociationIntentCreator.isWalletEndpointAvailable(getContext().getPackageManager())) {
            finish(operation, null, "No compatible Solana wallet is installed.", "WALLET_NOT_FOUND");
            return;
        }
        try {
            operation.scenario = new LocalAssociationScenario(RPC_TIMEOUT_MS);
            Uri endpoint = operation.revoke == null ? null : operation.revoke.walletUri;
            Intent intent = LocalAssociationIntentCreator.createAssociationIntent(endpoint,
                operation.scenario.getPort(), operation.scenario.getSession());
            // A new sign-in always lets the user choose an installed wallet, even if Android
            // has remembered a default. Revocation targets the authorizing wallet's HTTPS URI.
            if (operation.request != null) intent = Intent.createChooser(intent, null);
            walletActivity = operation;
            startActivityForResult(operation.call, intent, "walletReturned");
            operation.task = worker.submit(() -> execute(operation));
        } catch (ActivityNotFoundException e) {
            walletActivity = null;
            finish(operation, null, "No compatible Solana wallet is installed.", "WALLET_NOT_FOUND");
        } catch (RuntimeException e) {
            walletActivity = null;
            finish(operation, null, "Could not open the Solana wallet.", "WALLET_ERROR");
        }
    }

    @ActivityCallback
    private void walletReturned(PluginCall ignoredCall, ActivityResult result) {
        Operation operation = walletActivity;
        walletActivity = null;
        if (operation == null || operation.finished.get()) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            finish(operation, null, "Wallet request cancelled.", "WALLET_CANCELLED");
        } else {
            // Allow an already received final RPC response to finish before considering an
            // early wallet activity exit a cancellation.
            mainHandler.postDelayed(() -> finish(operation, null, "Wallet request cancelled.", "WALLET_CANCELLED"), 2_000);
        }
    }

    private void execute(Operation operation) {
        operation.thread = Thread.currentThread();
        if (operation.finished.get()) return;
        try {
            MobileWalletAdapterClient client = operation.scenario.start().get(35, TimeUnit.SECONDS);
            if (operation.finished.get()) return;
            if (operation.revoke != null) {
                client.deauthorize(operation.revoke.token).get(RPC_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                finish(operation, new JSObject(), null, null);
                return;
            }
            SolanaWalletRequest request = operation.request;
            Uri identity = Uri.parse(request.identityUri);
            Uri icon = Uri.parse(request.identityIcon);
            SignInWithSolana.Payload payload = new SignInWithSolana.Payload(request.domain, (byte[]) null,
                request.statement, identity, "1", request.chainId, request.nonce, request.issuedAt,
                request.expirationTime, null, request.requestId, null);
            AuthorizationResult result;
            if (operation.scenario.getSession().getSessionProperties().protocolVersion == SessionProperties.ProtocolVersion.V1) {
                // Do not reuse a token from a different wallet selected in the OS chooser.
                result = client.authorize(identity, icon, request.identityName, request.chain,
                    null, null, null, payload).get(RPC_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            } else {
                String cluster = request.chain.substring("solana:".length());
                if ("mainnet".equals(cluster)) cluster = "mainnet-beta";
                result = client.authorize(identity, icon, request.identityName, cluster).get(RPC_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            }
            synchronized (lock) {
                if (operation.finished.get() || active != operation) return;
                authorization = new Authorization(result.authToken, result.walletUriBase);
            }
            byte[][] accounts = Arrays.stream(result.accounts).map(account -> account.publicKey).toArray(byte[][]::new);
            final SolanaWalletProof proof;
            if (result.signInResult != null) {
                byte[] expected = payload.prepareMessage(result.signInResult.publicKey).getBytes(StandardCharsets.UTF_8);
                proof = SolanaWalletProof.fromSignIn(result.signInResult, accounts, expected);
            } else {
                if (accounts.length == 0 || accounts[0] == null || accounts[0].length != 32) {
                    throw new IllegalArgumentException("Missing authorized signing account");
                }
                byte[] account = accounts[0];
                byte[] message = payload.prepareMessage(account).getBytes(StandardCharsets.UTF_8);
                proof = SolanaWalletProof.fromMessages(client.signMessagesDetached(new byte[][] { message },
                    new byte[][] { account }).get(RPC_TIMEOUT_MS, TimeUnit.MILLISECONDS), account, message);
            }
            JSObject response = new JSObject();
            response.put("publicKeyBase64", Base64.encodeToString(proof.publicKey, Base64.NO_WRAP));
            response.put("signedMessageBase64", Base64.encodeToString(proof.message, Base64.NO_WRAP));
            response.put("signatureBase64", Base64.encodeToString(proof.signature, Base64.NO_WRAP));
            finish(operation, response, null, null);
        } catch (Exception error) {
            Throwable cause = error instanceof ExecutionException && error.getCause() != null ? error.getCause() : error;
            if (cause instanceof TimeoutException) {
                finish(operation, null, "Wallet request timed out. Please try again.", "WALLET_TIMEOUT");
            } else if (cause instanceof InterruptedException || cause instanceof CancellationException) {
                finish(operation, null, "Wallet request cancelled.", "WALLET_CANCELLED");
            } else if (cause instanceof JsonRpc20RemoteException &&
                (((JsonRpc20RemoteException) cause).code == ProtocolContract.ERROR_AUTHORIZATION_FAILED ||
                 ((JsonRpc20RemoteException) cause).code == ProtocolContract.ERROR_NOT_SIGNED)) {
                finish(operation, null, "Wallet approval was declined. Please try again.", "WALLET_CANCELLED");
            } else if (cause instanceof IllegalArgumentException) {
                finish(operation, null, "The wallet returned an invalid sign-in proof.", "WALLET_INVALID_PROOF");
            } else if (cause instanceof JsonRpc20RemoteException &&
                (((JsonRpc20RemoteException) cause).code == -32601 ||
                 ((JsonRpc20RemoteException) cause).code == ProtocolContract.ERROR_CLUSTER_NOT_SUPPORTED)) {
                finish(operation, null, "This wallet does not support the requested Solana sign-in.", "WALLET_UNSUPPORTED");
            } else {
                finish(operation, null, "Wallet request failed. Please try again.", "WALLET_ERROR");
            }
        }
    }

    private void finish(Operation operation, JSObject response, String message, String code) {
        synchronized (lock) {
            if (!operation.finished.compareAndSet(false, true)) return;
            if (active == operation) active = null;
        }
        mainHandler.removeCallbacks(operation.timeout);
        if (operation.scenario != null) operation.scenario.close();
        if (operation.task != null && operation.thread != Thread.currentThread()) operation.task.cancel(true);
        if (response == null) operation.call.reject(message, code);
        else operation.call.resolve(response);
    }

    @Override
    protected void handleOnDestroy() {
        Operation pending;
        synchronized (lock) {
            destroyed = true;
            pending = active;
            authorization = null;
        }
        if (pending != null) finish(pending, null, "Wallet request cancelled.", "WALLET_CANCELLED");
        mainHandler.removeCallbacksAndMessages(null);
        worker.shutdownNow();
    }

    private static final class Authorization {
        final String token;
        final Uri walletUri;

        Authorization(String token, Uri walletUri) {
            this.token = token;
            this.walletUri = walletUri;
        }
    }

    private final class Operation {
        final PluginCall call;
        final SolanaWalletRequest request;
        final Authorization revoke;
        final AtomicBoolean finished = new AtomicBoolean();
        final Runnable timeout = () -> finish(this, null, "Wallet request timed out. Please try again.", "WALLET_TIMEOUT");
        volatile LocalAssociationScenario scenario;
        volatile Future<?> task;
        volatile Thread thread;

        Operation(PluginCall call, SolanaWalletRequest request, Authorization revoke) {
            this.call = call;
            this.request = request;
            this.revoke = revoke;
        }
    }
}
