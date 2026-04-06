import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { ApiError, type User } from '../lib/auth';
import { validatePassword, PASSWORD_HINT } from '../lib/password';
import { AuthLayout, AuthCard } from './auth-layout';

interface AcceptResponse {
  token: string;
  refreshToken: string;
  user: User;
}

function landingFor(role: User['role']): string {
  switch (role) {
    case 'kitchen': return '/kds';
    case 'staff': return '/pos';
    case 'admin':
    case 'manager': return '/admin';
  }
}

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const inviteToken = params.get('token') ?? '';

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!inviteToken) {
    return (
      <AuthLayout tagline="You've been invited!">
        <AuthCard title="Invalid invite link">
          <p className="text-sm text-warm-600">
            This link is missing the invite token. Ask the admin who invited you to resend the full link.
          </p>
        </AuthCard>
      </AuthLayout>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const pw = validatePassword(password);
    if (!pw.valid) {
      setError(pw.error!);
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<AcceptResponse>('/auth/accept-invite', {
        token: inviteToken,
        fullName: fullName.trim(),
        password,
      });
      try {
        localStorage.setItem('food.token', result.token);
        if (result.refreshToken) localStorage.setItem('food.refreshToken', result.refreshToken);
      } catch {
        // private mode
      }
      window.location.assign(landingFor(result.user.role));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'could not accept invite');
      setBusy(false);
    }
  }

  return (
    <AuthLayout tagline="You've been invited!">
      <AuthCard title="Join your team" subtitle="Set your name and password to get started.">
        <form onSubmit={onSubmit} className="space-y-5">
          <label className="block">
            <span className="text-sm font-medium text-warm-700 mb-1.5 block">Full name</span>
            <input
              type="text"
              required
              autoFocus
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input-base"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-warm-700 mb-1.5 block">Password</span>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-base pr-10"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-warm-400 hover:text-warm-600 text-xs"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <span className="mt-1 block text-xs text-warm-500">{PASSWORD_HINT}</span>
          </label>

          {error && (
            <div className="rounded-sm bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
              {error}
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full h-12 text-base">
            {busy ? 'Joining…' : 'Join team'}
          </button>
        </form>
      </AuthCard>
    </AuthLayout>
  );
}
