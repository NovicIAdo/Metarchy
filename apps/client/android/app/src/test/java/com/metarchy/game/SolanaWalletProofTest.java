package com.metarchy.game;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertThrows;

import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.AuthorizationResult.SignInResult;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.SignMessagesResult;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.SignMessagesResult.SignedMessage;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class SolanaWalletProofTest {
    private final byte[] publicKey = new byte[32];
    private final byte[] signature = new byte[64];
    private final byte[] message = "A bound SIWS challenge".getBytes(StandardCharsets.UTF_8);

    @Test
    public void acceptsAuthorizedEd25519SignInProof() {
        SolanaWalletProof proof = SolanaWalletProof.fromSignIn(
            new SignInResult(publicKey, message, signature, "ed25519"), new byte[][] { publicKey }, message);
        assertArrayEquals(publicKey, proof.publicKey);
        assertArrayEquals(message, proof.message);
    }

    @Test
    public void rejectsSignInFromAnotherAccount() {
        byte[] other = publicKey.clone();
        other[0] = 1;
        assertThrows(IllegalArgumentException.class, () -> SolanaWalletProof.fromSignIn(
            new SignInResult(other, message, signature, "ed25519"), new byte[][] { publicKey }, message));
    }

    @Test
    public void rejectsWalletModifiedMessage() {
        assertThrows(IllegalArgumentException.class, () -> SolanaWalletProof.fromSignIn(
            new SignInResult(publicKey, new byte[] { 1 }, signature, "ed25519"), new byte[][] { publicKey }, message));
    }

    @Test
    public void rejectsWrongSignatureTypeAndLength() {
        assertThrows(IllegalArgumentException.class, () -> SolanaWalletProof.fromSignIn(
            new SignInResult(publicKey, message, signature, "secp256k1"), new byte[][] { publicKey }, message));
        assertThrows(IllegalArgumentException.class, () -> SolanaWalletProof.fromSignIn(
            new SignInResult(publicKey, message, new byte[63], "ed25519"), new byte[][] { publicKey }, message));
        assertThrows(IllegalArgumentException.class, () -> SolanaWalletProof.fromSignIn(
            new SignInResult(new byte[31], message, signature, "ed25519"), new byte[][] { new byte[31] }, message));
    }

    @Test
    public void extractsSingleAccountDetachedSignature() {
        SolanaWalletProof proof = SolanaWalletProof.fromMessages(new SignMessagesResult(new SignedMessage[] {
            new SignedMessage(message, new byte[][] { signature }, new byte[][] { publicKey }),
        }), publicKey, message);
        assertArrayEquals(signature, proof.signature);
    }

    @Test
    public void rejectsAmbiguousAndChangedDetachedProofs() {
        assertThrows(IllegalArgumentException.class, () -> SolanaWalletProof.fromMessages(
            new SignMessagesResult(new SignedMessage[0]), publicKey, message));
        assertThrows(IllegalArgumentException.class, () -> SolanaWalletProof.fromMessages(
            new SignMessagesResult(new SignedMessage[] {
                new SignedMessage(message, new byte[][] { signature, signature }, new byte[][] { publicKey, publicKey }),
            }), publicKey, message));
        assertThrows(IllegalArgumentException.class, () -> SolanaWalletProof.fromMessages(
            new SignMessagesResult(new SignedMessage[] {
                new SignedMessage(new byte[] { 1 }, new byte[][] { signature }, new byte[][] { publicKey }),
            }), publicKey, message));
    }
}
