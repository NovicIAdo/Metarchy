package com.metarchy.game;

import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.AuthorizationResult.SignInResult;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.SignMessagesResult;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.SignMessagesResult.SignedMessage;
import java.util.Arrays;

/** Checks the SDK's account/message binding; the shared TypeScript verifier verifies Ed25519. */
final class SolanaWalletProof {
    final byte[] publicKey;
    final byte[] message;
    final byte[] signature;

    private SolanaWalletProof(byte[] publicKey, byte[] message, byte[] signature, byte[] expectedMessage) {
        if (publicKey == null || publicKey.length != 32 || signature == null || signature.length != 64 ||
            message == null || message.length == 0 || message.length > 16_384 || !Arrays.equals(message, expectedMessage)) {
            throw new IllegalArgumentException("Invalid wallet proof");
        }
        this.publicKey = publicKey.clone();
        this.message = message.clone();
        this.signature = signature.clone();
    }

    static SolanaWalletProof fromSignIn(SignInResult result, byte[][] authorizedAccounts, byte[] expectedMessage) {
        if (result == null || !"ed25519".equals(result.signatureType) || authorizedAccounts == null ||
            Arrays.stream(authorizedAccounts).noneMatch(account -> Arrays.equals(account, result.publicKey))) {
            throw new IllegalArgumentException("Sign-in account was not authorized");
        }
        return new SolanaWalletProof(result.publicKey, result.signedMessage, result.signature, expectedMessage);
    }

    static SolanaWalletProof fromMessages(SignMessagesResult result, byte[] account, byte[] expectedMessage) {
        if (result == null || result.messages == null || result.messages.length != 1 || result.messages[0] == null) {
            throw new IllegalArgumentException("Expected one signed message");
        }
        SignedMessage signed = result.messages[0];
        if (signed.addresses == null || signed.addresses.length != 1 || !Arrays.equals(signed.addresses[0], account) ||
            signed.signatures == null || signed.signatures.length != 1) {
            throw new IllegalArgumentException("Expected the authorized signing account");
        }
        return new SolanaWalletProof(account, signed.message, signed.signatures[0], expectedMessage);
    }
}
