package com.metarchy.game;

import java.net.URI;
import java.time.Instant;
import java.util.Locale;

/** Untrusted Capacitor input validated before any external wallet is opened. */
final class SolanaWalletRequest {
    final String identityUri;
    final String identityName;
    final String identityIcon;
    final String chain;
    final String domain;
    final String statement;
    final String nonce;
    final String issuedAt;
    final String expirationTime;
    final String requestId;
    final String chainId;

    SolanaWalletRequest(String identityUri, String identityName, String identityIcon, String chain, String statement,
                        String nonce, String issuedAt, String expirationTime, String requestId, String chainId) {
        this.identityUri = required(identityUri, 2048);
        URI uri = URI.create(identityUri);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawFragment() != null) {
            throw new IllegalArgumentException("A public HTTPS identity is required");
        }
        this.domain = uri.getHost().toLowerCase(Locale.ROOT) +
            (uri.getPort() == -1 || uri.getPort() == 443 ? "" : ":" + uri.getPort());
        this.identityName = required(identityName, 100);
        this.identityIcon = required(identityIcon, 2048);
        URI icon = URI.create(identityIcon);
        if (icon.isAbsolute() || icon.getRawAuthority() != null || icon.getRawFragment() != null) {
            throw new IllegalArgumentException("Wallet icon must be relative to the HTTPS identity");
        }
        if (!"solana:devnet".equals(chain) && !"solana:mainnet".equals(chain) && !"solana:testnet".equals(chain)) {
            throw new IllegalArgumentException("Unsupported Solana association chain");
        }
        this.chain = chain;
        this.statement = required(statement, 512);
        this.nonce = required(nonce, 128);
        if (!nonce.matches("[a-zA-Z0-9]{8,128}")) throw new IllegalArgumentException("Invalid sign-in nonce");
        this.issuedAt = required(issuedAt, 64);
        this.expirationTime = required(expirationTime, 64);
        Instant issued = Instant.parse(issuedAt);
        Instant expires = Instant.parse(expirationTime);
        Instant now = Instant.now();
        if (!expires.isAfter(now) || !expires.isAfter(issued) || issued.isAfter(now.plusSeconds(60)) ||
            expires.isAfter(issued.plusSeconds(300))) {
            throw new IllegalArgumentException("Invalid or expired sign-in challenge");
        }
        this.requestId = requestId == null ? null : required(requestId, 256);
        this.chainId = chainId == null ? null : required(chainId, 256);
    }

    private static String required(String value, int maxLength) {
        if (value == null || value.isEmpty() || value.length() > maxLength || value.chars().anyMatch(c -> c < 32 || c == 127)) {
            throw new IllegalArgumentException("Invalid sign-in field");
        }
        return value;
    }
}
