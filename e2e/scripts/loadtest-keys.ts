// Create (or show) the load-test signing keys. Prints the pieces the target
// server needs as secrets; the private half stays in e2e/.loadtest/keys.json.
//
//   pnpm exec tsx scripts/loadtest-keys.ts            # human-readable
//   pnpm exec tsx scripts/loadtest-keys.ts --jwks     # raw JWKS JSON (for fly secrets)
//   pnpm exec tsx scripts/loadtest-keys.ts --issuer   # raw issuer

import { loadOrCreateKeys } from '../src/load/keys.js'

const path = new URL('../.loadtest/keys.json', import.meta.url).pathname
const keys = await loadOrCreateKeys(path)

if (process.argv.includes('--jwks')) {
  process.stdout.write(keys.jwksJson)
} else if (process.argv.includes('--issuer')) {
  process.stdout.write(keys.issuer)
} else {
  console.log(`keys file: ${path}`)
  console.log(`issuer:    ${keys.issuer}`)
  console.log(`jwks:      ${keys.jwksJson}`)
}
