import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { platformLogin, readPlatformToken } from '../../lib/platform';

/**
 * Platform super-admin login. Completely separate from the tenant login
 * page — different token pool, different landing page. There is no signup
 * link here because platform admins are provisioned via the CLI bootstrap
 * script, never via a public form.
 */
export function PlatformLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already logged in? Jump straight to the console.
  if (readPlatformToken()) {
    navigate('/platform/tenants', { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await platformLogin(email.trim().toLowerCase(), password);
      navigate('/platform/tenants', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-950">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-800 p-6 space-y-4 text-slate-100"
      >
        <div>
          <h1 className="text-xl font-semibold">Platform console</h1>
          <p className="text-sm text-slate-400">Super-admin sign in</p>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-300">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-300">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </label>

        {error && (
          <div className="rounded-md bg-red-950 border border-red-900 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-slate-100 text-slate-900 py-2 font-medium hover:bg-white disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
