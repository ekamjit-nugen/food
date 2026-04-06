import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ApiError, useAuth, type User } from '../lib/auth';
import { validatePassword, PASSWORD_HINT } from '../lib/password';
import { AuthLayout, AuthCard } from './auth-layout';

interface SignupResponse {
  token: string;
  refreshToken: string;
  user: User;
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function SignupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [restaurantName, setRestaurantName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [firstOutletName, setFirstOutletName] = useState('');
  const [ownerFullName, setOwnerFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    navigate('/', { replace: true });
  }

  const effectiveSlug = slugTouched ? slug : slugify(restaurantName);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const finalSlug = slugify(slugTouched ? slug : restaurantName);
    if (finalSlug.length < 2) {
      setError('workspace URL must be at least 2 characters');
      return;
    }
    const pw = validatePassword(password);
    if (!pw.valid) {
      setError(pw.error!);
      return;
    }

    setBusy(true);
    try {
      const result = await api.post<SignupResponse>('/auth/signup', {
        restaurantName: restaurantName.trim(),
        slug: finalSlug,
        firstOutletName: firstOutletName.trim() || restaurantName.trim(),
        ownerFullName: ownerFullName.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
      try {
        localStorage.setItem('food.token', result.token);
        if (result.refreshToken) localStorage.setItem('food.refreshToken', result.refreshToken);
      } catch {
        // private mode
      }
      window.location.assign('/admin');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'signup failed');
      setBusy(false);
    }
  }

  return (
    <AuthLayout tagline="Set up your restaurant in 2 minutes.">
      <AuthCard title="Create your workspace" subtitle="Sets up your restaurant and signs you in as the owner.">
        <form onSubmit={onSubmit} className="space-y-5">
          <Field label="Restaurant name">
            <input
              type="text"
              required
              autoFocus
              value={restaurantName}
              onChange={(e) => setRestaurantName(e.target.value)}
              placeholder="Dosa Point"
              className="input-base"
            />
          </Field>

          <Field label="Workspace URL">
            <div className="flex items-center rounded-sm border-[1.5px] border-warm-300 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-ring">
              <span className="px-3 text-sm text-warm-500 select-none bg-warm-100 h-11 flex items-center rounded-l-sm">/t/</span>
              <input
                type="text"
                required
                value={effectiveSlug}
                onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }}
                placeholder="dosa-point"
                className="flex-1 h-11 px-3 bg-transparent text-warm-900 placeholder:text-warm-500 focus:outline-none"
              />
            </div>
            <p className="mt-1 text-xs text-warm-500">This is how your staff sign in.</p>
          </Field>

          <Field label="First outlet">
            <input
              type="text"
              required
              value={firstOutletName}
              onChange={(e) => setFirstOutletName(e.target.value)}
              placeholder={restaurantName || 'Main branch'}
              className="input-base"
            />
          </Field>

          <Field label="Your name">
            <input
              type="text"
              required
              autoComplete="name"
              value={ownerFullName}
              onChange={(e) => setOwnerFullName(e.target.value)}
              className="input-base"
            />
          </Field>

          <Field label="Email">
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-base"
            />
          </Field>

          <Field label="Password">
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
            <p className="mt-1 text-xs text-warm-500">{PASSWORD_HINT}</p>
          </Field>

          {error && (
            <div className="rounded-sm bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
              {error}
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full h-12 text-base">
            {busy ? 'Creating workspace…' : 'Create workspace'}
          </button>
        </form>

        <p className="text-center text-sm text-warm-500">
          Already have an account?{' '}
          <a href="/login" className="font-medium text-brand hover:underline">Sign in</a>
        </p>
      </AuthCard>
    </AuthLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-warm-700 mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
