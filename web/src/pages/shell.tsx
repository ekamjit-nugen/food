import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { LayoutDashboard, LogOut, Grid3X3, ChefHat } from 'lucide-react';
import { useLocation } from 'react-router-dom';

/**
 * Shared chrome for POS surfaces. Provides a top bar with navigation
 * between POS sections, a link back to admin, and user info.
 * KDS has its own full-dark layout and does NOT use this shell.
 */
export function Shell({ title, children }: { title: string; children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const canAccessAdmin =
    user?.role === 'admin' || user?.role === 'manager' || user?.isTenantOwner;
  const canAccessKds =
    user?.role === 'admin' || user?.role === 'manager' || user?.role === 'kitchen';

  const isOnTables = location.pathname === '/pos';

  return (
    <div className="min-h-screen flex flex-col bg-surface-page">
      <header className="border-b border-warm-200 bg-surface-white">
        <div className="px-6 py-2.5 flex items-center justify-between">
          {/* Left: nav links */}
          <div className="flex items-center gap-1">
            <a
              href="/pos"
              className={
                'flex items-center gap-1.5 rounded-sm px-3 py-2 text-sm font-medium transition-colors ' +
                (isOnTables
                  ? 'bg-brand-light text-brand'
                  : 'text-warm-600 hover:bg-warm-100 hover:text-warm-900')
              }
            >
              <Grid3X3 className="w-4 h-4" />
              Tables
            </a>
            {canAccessKds && (
              <a
                href="/kds"
                className="flex items-center gap-1.5 rounded-sm px-3 py-2 text-sm font-medium text-warm-600 hover:bg-warm-100 hover:text-warm-900 transition-colors"
              >
                <ChefHat className="w-4 h-4" />
                Kitchen
              </a>
            )}
            {canAccessAdmin && (
              <a
                href="/admin"
                className="flex items-center gap-1.5 rounded-sm px-3 py-2 text-sm font-medium text-warm-600 hover:bg-warm-100 hover:text-warm-900 transition-colors"
              >
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </a>
            )}
          </div>

          {/* Center: page title (only when not on tables) */}
          {!isOnTables && (
            <h1 className="text-base font-semibold text-warm-900 absolute left-1/2 -translate-x-1/2">
              {title}
            </h1>
          )}

          {/* Right: user + sign out */}
          <div className="flex items-center gap-3 text-sm">
            {user && (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-brand-light text-brand flex items-center justify-center text-xs font-semibold">
                  {user.fullName.charAt(0).toUpperCase()}
                </div>
                <span className="text-warm-600 hidden sm:inline">
                  {user.fullName}
                </span>
                <span className="badge-warm hidden sm:inline">{user.role}</span>
              </div>
            )}
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm text-warm-500 hover:text-status-red hover:bg-status-red-light transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full px-6 py-6">{children}</main>
    </div>
  );
}
