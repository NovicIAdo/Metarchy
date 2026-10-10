package com.metarchy.game;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.time.Instant;
import org.junit.Test;

public class SolanaWalletRequestTest {
    private SolanaWalletRequest request(String uri, String icon, String nonce, String expiry) {
        return new SolanaWalletRequest(uri, "Metarchy", icon, "solana:devnet", "Sign in to Metarchy.", nonce,
            Instant.now().toString(), expiry, "request-42", "solana:devnet");
    }

    @Test
    public void preservesHttpsIdentityAuthorityIncludingPort() {
        SolanaWalletRequest request = request("https://metarchy.example:8443/auth/solana", "/favicon.png", "challenge1234",
            Instant.now().plusSeconds(300).toString());
        assertEquals("metarchy.example:8443", request.domain);
        assertEquals("https://metarchy.example:8443/auth/solana", request.identityUri);
        assertEquals("solana:devnet", request.chainId);
    }

    @Test
    public void matchesUrlAuthorityNormalizationForDefaultPortAndCase() {
        SolanaWalletRequest request = request("https://METARCHY.example:443/auth/solana", "/favicon.png", "challenge1234",
            Instant.now().plusSeconds(300).toString());
        assertEquals("metarchy.example", request.domain);
    }

    @Test
    public void rejectsNonHttpsAndCredentialedIdentities() {
        for (String uri : new String[] { "capacitor://localhost", "http://metarchy.example/auth", "https://user:pass@metarchy.example/auth", "https://metarchy.example/auth#fragment" }) {
            assertThrows(IllegalArgumentException.class, () -> request(uri, "/favicon.png", "challenge1234",
                Instant.now().plusSeconds(300).toString()));
        }
    }

    @Test
    public void rejectsExternalIconAndInvalidNonce() {
        assertThrows(IllegalArgumentException.class, () -> request("https://metarchy.example/auth", "https://evil.example/icon.png", "challenge1234",
            Instant.now().plusSeconds(300).toString()));
        assertThrows(IllegalArgumentException.class, () -> request("https://metarchy.example/auth", "/favicon.png", "bad",
            Instant.now().plusSeconds(300).toString()));
    }

    @Test
    public void rejectsExpiredChallenge() {
        assertThrows(IllegalArgumentException.class, () -> request("https://metarchy.example/auth", "/favicon.png", "challenge1234",
            Instant.now().minusSeconds(1).toString()));
    }
}
