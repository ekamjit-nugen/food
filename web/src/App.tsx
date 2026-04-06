import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, type Role } from './lib/auth';
import type { ReactNode } from 'react';
import { LoginPage } from './pages/login';
import { SignupPage } from './pages/signup';
import { AcceptInvitePage } from './pages/accept-invite';
import { PosHome } from './pages/pos';
import { KdsHome } from './pages/kds';
import { AdminHome } from './pages/admin';
import { PlatformLoginPage } from './pages/platform/login';
import { PlatformTenantsPage } from './pages/platform/tenants';
import { PlatformTenantDetailPage } from './pages/platform/tenant-detail';
import { readPlatformToken } from './lib/platform';

/**
 * Root router.
 *
 * Role landing pages (where a user goes after login if they hit "/"):
 *   - kitchen          → /kds
 *   - staff            → /pos
 *   - admin / manager  → /admin
 *
 * All three surfaces live in the same bundle; the only difference is which
 * routes each role is allowed to open. A staff user who types /admin in the
 * URL bar is bounced back to /pos, not shown a 403 page — the goal is to
 * make the product feel like "your app" to each role, not to build a portal.
 */

function landingFor(role: Role): string {
  switch (role) {
    case 'kitchen':
      return '/kds';
    case 'staff':
      return '/pos';
    case 'admin':
    case 'manager':
      return '/admin';
  }
}

function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreen>Loading…</FullScreen>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={landingFor(user.role)} replace />;
  }
  return <>{children}</>;
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-warm-500">
      {children}
    </div>
  );
}

/**
 * Platform admin gate. Completely separate from the tenant RequireAuth above
 * — it only checks the platform token pool. We redirect straight to
 * /platform/login on miss; platform admins never share a page shell with
 * tenant users, so there's no cross-navigation to worry about.
 */
function RequirePlatformAuth({ children }: { children: ReactNode }) {
  if (!readPlatformToken()) return <Navigate to="/platform/login" replace />;
  return <>{children}</>;
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreen>Loading…</FullScreen>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={landingFor(user.role)} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/t/:slug/login" element={<LoginPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route
        path="/pos/*"
        element={
          <RequireAuth roles={['admin', 'manager', 'staff']}>
            <PosHome />
          </RequireAuth>
        }
      />
      <Route
        path="/kds/*"
        element={
          <RequireAuth roles={['admin', 'manager', 'kitchen']}>
            <KdsHome />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/*"
        element={
          <RequireAuth roles={['admin', 'manager']}>
            <AdminHome />
          </RequireAuth>
        }
      />
      <Route path="/platform/login" element={<PlatformLoginPage />} />
      <Route
        path="/platform/tenants"
        element={
          <RequirePlatformAuth>
            <PlatformTenantsPage />
          </RequirePlatformAuth>
        }
      />
      <Route
        path="/platform/tenants/:id"
        element={
          <RequirePlatformAuth>
            <PlatformTenantDetailPage />
          </RequirePlatformAuth>
        }
      />
      <Route path="/platform" element={<Navigate to="/platform/tenants" replace />} />
      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
