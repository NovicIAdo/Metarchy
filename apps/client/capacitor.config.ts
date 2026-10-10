// Android/iOS shell (Stage 5). The web app is bundled as local assets; game
// traffic goes to the staging server (see .env.mobile → VITE_WS_URL).
// appId is forever once published to a store — confirm before the Play upload.

import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.metarchy.game',
  appName: 'Metarchy',
  webDir: 'dist',
  android: {
    allowMixedContent: false
  }
}

export default config
