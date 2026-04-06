import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, setTokenProvider } from './api';

/**
 * Auth provider.
 *
 * Token strategy: JWT stored in localStorage under TOKEN_KEY. On mount we try
 * to hydrate the user by calling /auth/me with whatever token we find. If the
 * call fails (expired/invalid), we clear the token and drop back to login.
 *
 * We deliberately do NOT keep the token only in memory: operators refresh the
 * tab and we don't want to force re-login every time. The tradeoff is XSS
 * reach — mitigated by strict CSP at deploy time and by never rendering user
 * HTML. Revisit if we ship an in-app embed that runs third-party code.
 */

export type Role = 'admin' | 'manager' | 'staff' | 'kitchen';

export interface User {
  id: string;
  tenantId: string;
  outletId: string;
  isTenantOwner: boolean;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (tenantSlug: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthCtx = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'food.token';
const REFRESH_TOKEN_KEY = 'food.refreshToken';

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function readRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeTokens(token: string | null, refreshToken?: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    if (refreshToken !== undefined) {
      if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      else localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  } catch {
    // private mode / quota — auth still works for the current tab
  }
}

/** @deprecated Use writeTokens instead */
function writeToken(token: string | null): void {
  writeTokens(token);
}

// Register the token provider once at module load so api.ts doesn't depend
// on React. It reads live from localStorage every request.
//
// Requests to /platform/* use the separate platform-admin token pool; every
// other path uses the tenant token. This keeps the two JWT audiences strictly
// partitioned on the wire — a tenant token is never sent to a platform route
// and vice versa, even if somebody accidentally cross-calls.
setTokenProvider((path) => {
  if (path.startsWith('/platform/')) {
    try {
      return localStorage.getItem('food.platform.token');
    } catch {
      return null;
    }
  }
  return readToken();
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const token = readToken();
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .get<User>('/auth/me')
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        writeToken(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (tenantSlug: string, email: string, password: string) => {
    const result = await api.post<{ token: string; refreshToken: string; user: User }>('/auth/login', {
      tenantSlug,
      email,
      password,
    });
    writeTokens(result.token, result.refreshToken);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    // Best-effort server-side revocation
    api.post('/auth/logout').catch(() => {});
    writeTokens(null, null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export { ApiError };
