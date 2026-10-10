import { defineConfig } from 'vitest/config'

// Embedded-Postgres (PGlite) contract tests boot a fresh database per test;
// under a full parallel suite that can stretch past the 5s default.
export default defineConfig({ test: { testTimeout: 20_000 } })
