import Constants from 'expo-constants';

/**
 * Runtime config. The API base URL is injected at build time via app.json's
 * `extra.apiBaseUrl`. For local development on a physical device, override
 * with your laptop's LAN IP (e.g. http://192.168.1.10:4000) — `localhost`
 * only works in the iOS simulator.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };

export const config = {
  apiBaseUrl: extra.apiBaseUrl ?? 'http://localhost:4000',
};
