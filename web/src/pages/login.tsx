import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, useAuth } from '../lib/auth';
import { AuthLayout, AuthCard } from './auth-layout';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, Users, UtensilsCrossed, ChefHat } from 'lucide-react';

const TEST_ACCOUNTS = [
  { email: 'admin@tajkitchen.com', role: 'Admin (Owner)', icon: ShieldCheck, color: 'text-brand' },
  { email: 'manager@tajkitchen.com', role: 'Manager', icon: Users, color: 'text-status-blue' },
  { email: 'staff@tajkitchen.com', role: 'Staff (POS)', icon: UtensilsCrossed, color: 'text-status-green' },
  { email: 'kitchen@tajkitchen.com', role: 'Kitchen (KDS)', icon: ChefHat, color: 'text-status-amber' },
] as const;

const TEST_PASSWORD = 'TestPass123!';
const TEST_SLUG = 'taj-kitchen';

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ slug?: string }>();
  const slugFromUrl = params.slug ?? '';
  const [tenantSlug, setTenantSlug] = useState(slugFromUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    navigate('/', { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(tenantSlug.trim().toLowerCase(), email, password);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('login failed');
    } finally {
      setBusy(false);
    }
  }

  function fillCredentials(testEmail: string) {
    setTenantSlug(TEST_SLUG);
    setEmail(testEmail);
    setPassword(TEST_PASSWORD);
  }

  return (
    <AuthLayout>
      <AuthCard
        title="Welcome back"
        subtitle={slugFromUrl ? `Signing in to ${slugFromUrl}` : 'Sign in to your workspace'}
      >
        {slugFromUrl && (
          <span className="badge-warm">{slugFromUrl}</span>
        )}

        <form onSubmit={onSubmit} className="space-y-5">
          {!slugFromUrl && (
            <label className="block">
              <span className="text-sm font-medium text-warm-700 mb-1.5 block">Workspace</span>
              <div className="flex items-center rounded-sm border-[1.5px] border-warm-300 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-ring">
                <span className="px-3 text-sm text-warm-500 select-none bg-warm-100 h-11 flex items-center rounded-l-sm">/t/</span>
                <input
                  type="text"
                  autoComplete="organization"
                  required
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  placeholder="your-restaurant"
                  className="flex-1 h-11 px-3 bg-transparent text-warm-900 placeholder:text-warm-500 focus:outline-none"
                />
              </div>
            </label>
          )}

          <label className="block">
            <span className="text-sm font-medium text-warm-700 mb-1.5 block">Email</span>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-base pl-10"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-warm-700 mb-1.5 block">Password</span>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-base pl-10 pr-10"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-warm-400 hover:text-warm-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>

          {error && (
            <div className="rounded-sm bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
              {error}
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full h-12 text-base">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-warm-500">
          New here?{' '}
          <a href="/signup" className="font-medium text-brand hover:underline">
            Create a workspace
          </a>
        </p>
      </AuthCard>

      {/* Dev test credentials */}
      <div className="mt-4 rounded-lg border border-warm-200 bg-surface-white p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400 mb-3">
          Quick login (dev)
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {TEST_ACCOUNTS.map((acc) => (
            <button
              key={acc.email}
              type="button"
              onClick={() => fillCredentials(acc.email)}
              className="flex items-center gap-2.5 rounded-sm border border-warm-200 bg-surface-card px-3 py-2.5 text-left hover:border-warm-400 hover:shadow-sm transition-all active:scale-[0.98]"
            >
              <acc.icon className={`w-4 h-4 shrink-0 ${acc.color}`} />
              <div className="min-w-0">
                <div className="text-sm font-medium text-warm-900 truncate">{acc.role}</div>
                <div className="text-[11px] text-warm-500 truncate">{acc.email}</div>
              </div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-warm-400 text-center">
          Password: <span className="font-mono">{TEST_PASSWORD}</span>
        </p>
      </div>
    </AuthLayout>
  );
}
