import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.buyinblitz.app',
  appName: 'Buy In Blitz',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
};

export default config;
