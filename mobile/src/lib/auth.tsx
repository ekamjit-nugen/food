import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, setTokenProvider } from './api';
import {
  consumePairing,
  deviceLogin,
  type ConsumePairingResult,
  type PublicUser,
} from './devices';
import { clearDeviceToken, getDeviceToken, setDeviceToken } from './storage';

/**
 * Auth state machine for the mobile app.
 *
 *   loading → (no device token)    → unpaired
 *           → (has token, login ok)→ authenticated
 *           → (has token, 401)     → unpaired (token cleared)
 *
 * The device token lives in SecureStore (Keychain / EncryptedSharedPreferences).
 * The short-lived tenant JWT lives only in a ref, reachable via the
 * tokenProvider hook installed into api.ts. We deliberately never persist
 * the JWT — a stolen device file dump should not yield API access without
 * a fresh device-login call.
 */

type AuthState =
  | { status: 'loading' }
  | { status: 'unpaired' }
  | { status: 'authenticated'; user: PublicUser };

interface AuthContextValue {
  state: AuthState;
  /** Redeem a pairing code, store the device token, then device-login. */
  pair: (input: { code: string; label: string; platform?: 'ios' | 'android' }) => Promise<void>;
  /** Revoke locally: clear device token + JWT and drop to unpaired. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const jwtRef = useRef<string | null>(null);

  // Install the token provider once. request() in api.ts calls this lazily
  // per-request so rotations (refresh, re-login) take effect immediately.
  useEffect(() => {
    setTokenProvider(() => jwtRef.current);
  }, []);

  const applyLogin = useCallback((jwt: string, user: PublicUser) => {
    jwtRef.current = jwt;
    setState({ status: 'authenticated', user });
  }, []);

  const dropToUnpaired = useCallback(async () => {
    jwtRef.current = null;
    await clearDeviceToken();
    setState({ status: 'unpaired' });
  }, []);

  // Cold start: try to auto-login with the stored device token.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const deviceToken = await getDeviceToken();
      if (!deviceToken) {
        if (!cancelled) setState({ status: 'unpaired' });
        return;
      }
      try {
        const result = await deviceLogin(deviceToken);
        if (!cancelled) applyLogin(result.token, result.user);
      } catch (err) {
        // 401 means the device was revoked or the token is garbage — wipe it
        // and send the user back to the pair screen. Anything else (network
        // down, server 500) should NOT wipe the token — we just stay on the
        // loading screen and let the user retry.
        if (err instanceof ApiError && err.status === 401) {
          if (!cancelled) await dropToUnpaired();
        } else if (!cancelled) {
          // Keep token; surface as unpaired so user sees the pair screen and
          // can retry. A better UX would be a dedicated "offline" screen;
          // deferred until Phase F.
          setState({ status: 'unpaired' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyLogin, dropToUnpaired]);

  const pair = useCallback<AuthContextValue['pair']>(
    async (input) => {
      const paired: ConsumePairingResult = await consumePairing(input);
      await setDeviceToken(paired.deviceToken);
      const login = await deviceLogin(paired.deviceToken);
      applyLogin(login.token, login.user);
    },
    [applyLogin],
  );

  const signOut = useCallback(async () => {
    await dropToUnpaired();
  }, [dropToUnpaired]);

  const value = useMemo<AuthContextValue>(() => ({ state, pair, signOut }), [state, pair, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
