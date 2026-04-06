// Dynamic Expo config. Merges static app.json with environment-driven
// overrides so the same codebase builds dev / preview / production bundles
// against different API origins without hand-editing the manifest.
//
// The one value that MUST change across builds is `extra.apiBaseUrl` — the
// mobile app uses this to reach the backend. `localhost` only works in the
// iOS simulator; for a physical device on the LAN, set FOOD_API_BASE_URL to
// your laptop's IP, and for production builds set it to the HTTPS origin
// configured in eas.json.

const base = require('./app.json').expo;

const apiBaseUrl =
  process.env.FOOD_API_BASE_URL || base.extra?.apiBaseUrl || 'http://localhost:4000';

/** @type {import('@expo/config').ExpoConfig} */
module.exports = {
  ...base,
  extra: {
    ...(base.extra ?? {}),
    apiBaseUrl,
    // EAS injects this automatically after `eas init`. Left here as a
    // self-documenting reminder — if you see "missing projectId" during
    // `eas build`, run `eas init` in mobile/ and commit the result.
    eas: base.extra?.eas,
  },
};
