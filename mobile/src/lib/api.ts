import { config } from './config';

/**
 * Tiny fetch wrapper for the mobile app. Mirrors web/src/lib/api.ts so the
 * modules feel identical on both sides, but prefixes requests with the full
 * origin (web uses a relative /api/v1, mobile cannot).
 *
 * Errors from the backend come in the shape
 *   { error: { code: string, message: string, details?: unknown } }
 * and are surfaced as thrown ApiError(code, message, status, details).
 */

const BASE = '/api/v1';

let tokenProvider: () => string | null = () => null;

export function setTokenProvider(fn: () => string | null): void {
  tokenProvider = fn;
}

/** Returns the current bearer token, if any. Used by binary fetchers (PDF
 *  download) that bypass the JSON request() helper. */
export function getAuthToken(): string | null {
  return tokenProvider();
}

/** Absolute URL for a /api/v1 path. Exposed so native downloaders can feed
 *  it directly into FileSystem.downloadAsync without re-implementing the
 *  prefix logic. */
export function apiUrl(path: string): string {
  return config.apiBaseUrl + BASE + path;
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
  auth?: boolean; // default true; set false for anonymous endpoints (pair, device-login)
}

async function request<T>(opts: RequestOpts): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) {
    const token = tokenProvider();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let url = config.apiBaseUrl + BASE + opts.path;
  if (opts.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += '?' + qs;
  }

  const init: RequestInit = { method: opts.method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const res = await fetch(url, init);

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      err?.code ?? 'unknown_error',
      err?.message ?? `request failed (${res.status})`,
      res.status,
      err?.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOpts['query']) =>
    request<T>(query ? { method: 'GET', path, query } : { method: 'GET', path }),
  post: <T>(path: string, body?: unknown, opts?: { auth?: boolean }) =>
    request<T>({ method: 'POST', path, body, ...(opts?.auth === false ? { auth: false } : {}) }),
  patch: <T>(path: string, body?: unknown) => request<T>({ method: 'PATCH', path, body }),
  del: <T>(path: string) => request<T>({ method: 'DELETE', path }),
};
