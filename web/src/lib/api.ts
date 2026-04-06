/**
 * Tiny typed fetch wrapper. Responsibilities:
 *   - Prefix every request with /api/v1
 *   - Attach the JWT bearer token (read lazily so rotations take effect)
 *   - Parse JSON and surface backend error envelopes as thrown ApiError
 *   - Provide generic get/post/patch/del helpers with a typed response
 *
 * Errors from the backend come in the shape
 *   { error: { code: string, message: string, details?: unknown } }
 * so we normalize to ApiError(code, message, status, details).
 */

const BASE = '/api/v1';

let tokenProvider: (path: string) => string | null = () => null;

/**
 * The token provider receives the request path so a single wrapper can serve
 * two mutually-exclusive auth pools (tenant vs platform super-admin). Callers
 * that only care about tenant auth can ignore the argument.
 */
export function setTokenProvider(fn: (path: string) => string | null): void {
  tokenProvider = fn;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOpts {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

async function request<T>(opts: RequestOpts): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenProvider(opts.path);
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let url = BASE + opts.path;
  if (opts.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += '?' + qs;
  }

  // Build init conditionally so exactOptionalPropertyTypes doesn't widen body
  // to `BodyInit | null | undefined`, which fetch's type refuses.
  const init: RequestInit = { method: opts.method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(url, init);

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;

    // Auto-refresh on TOKEN_EXPIRED (401) — retry once with a fresh token
    if (res.status === 401 && err?.code === 'TOKEN_EXPIRED' && !opts.path.includes('/auth/refresh')) {
      const refreshed = await attemptTokenRefresh();
      if (refreshed) {
        // Retry the original request with the new token
        return request<T>(opts);
      }
    }

    throw new ApiError(
      err?.code ?? 'unknown_error',
      err?.message ?? `request failed (${res.status})`,
      res.status,
      err?.details,
    );
  }

  return payload as T;
}

/**
 * Attempt to refresh the access token using the stored refresh token.
 * Returns true on success, false on failure (caller should redirect to login).
 */
let refreshPromise: Promise<boolean> | null = null;

async function attemptTokenRefresh(): Promise<boolean> {
  // Deduplicate concurrent refresh attempts
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem('food.refreshToken');
      if (!refreshToken) return false;

      const res = await fetch(BASE + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) return false;

      const data = (await res.json()) as {
        token: string;
        refreshToken: string;
      };
      localStorage.setItem('food.token', data.token);
      localStorage.setItem('food.refreshToken', data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export const api = {
  get: <T>(path: string, query?: RequestOpts['query']) =>
    request<T>(query ? { method: 'GET', path, query } : { method: 'GET', path }),
  post: <T>(path: string, body?: unknown) => request<T>({ method: 'POST', path, body }),
  patch: <T>(path: string, body?: unknown) => request<T>({ method: 'PATCH', path, body }),
  del: <T>(path: string) => request<T>({ method: 'DELETE', path }),
};
