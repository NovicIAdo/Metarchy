// Shared black-box test kit: protocol-level scripted clients and test-token
// minting. Used by apps/server integration tests and the e2e suite here.

export { makeTestAuth } from './auth.js'
export type { TestAuth } from './auth.js'
export { chooseFromView, mulberry32 } from './autoplayer.js'
export type { Random } from './autoplayer.js'
export { GameClient } from './client.js'
export type { GameOutcome } from './client.js'
export { spawnServer } from './server-process.js'
export type { SpawnedServer } from './server-process.js'
