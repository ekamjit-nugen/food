import * as SecureStore from 'expo-secure-store';

/**
 * Thin wrapper around expo-secure-store. On iOS this is Keychain; on Android
 * it's the EncryptedSharedPreferences-backed store. We only ever put the
 * device token here — the short-lived tenant JWT stays in memory.
 */

const DEVICE_TOKEN_KEY = 'food.deviceToken';

export async function getDeviceToken(): Promise<string | null> {
  return SecureStore.getItemAsync(DEVICE_TOKEN_KEY);
}

export async function setDeviceToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token);
}

export async function clearDeviceToken(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY);
}
