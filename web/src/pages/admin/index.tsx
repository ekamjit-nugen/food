import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import {
  UtensilsCrossed,
  FolderOpen,
  LayoutGrid,
  Users,
  BarChart3,
  Settings,
  Store,
  SquareArrowOutUpRight,
  LogOut,
  Package,
  type LucideIcon,
} from 'lucide-react';
import { AdminAddons } from './addons';
import { AdminCategories } from './categories';
import { AdminItems } from './items';
import { AdminReports } from './reports';
import { AdminStaff } from './staff';
import { AdminSettings } from './settings';
import { AdminOutlets } from './outlets';
import { AdminTables } from './tables';
import { AdminWelcome, useNeedsOnboarding } from './welcome';
import { useAuth } from '../../lib/auth';

export function AdminHome() {
  return (
    <Routes>
      <Route path="welcome" element={<AdminWelcome />} />
      <Route element={<OnboardingGate />}>
        <Route element={<AdminLayout />}>
          <Route index element={<AdminItems />} />
          <Route path="categories" element={<AdminCategories />} />
          <Route path="addons" element={<AdminAddons />} />
          <Route path="tables" element={<AdminTables />} />
          <Route path="staff" element={<AdminStaff />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="outlets" element={<AdminOutlets />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
      </Route>
    </Routes>
  );
}

function OnboardingGate() {
  const needs = useNeedsOnboarding();
  const location = useLocation();
  if (needs === null) return null;
  if (needs && location.pathname !== '/admin/welcome') {
    return <Navigate to="/admin/welcome" replace />;
  }
  return <Outlet />;
}

function AdminLayout() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.isTenantOwner;

  return (
    <div className="min-h-screen flex bg-surface-page">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-warm-200 bg-surface-white flex flex-col">
        {/* User info */}
        <div className="px-5 py-4 border-b border-warm-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-light text-brand flex items-center justify-center text-sm font-semibold shrink-0">
              {(user?.fullName ?? 'A').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-warm-900 truncate">
                {user?.fullName ?? 'Admin'}
              </div>
              <div className="text-xs text-warm-500 capitalize">{user?.role}</div>
            </div>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <NavGroup label="Menu">
            <SidebarLink to="/admin" icon={UtensilsCrossed} label="Items" end />
            <SidebarLink to="/admin/categories" icon={FolderOpen} label="Categories" />
            <SidebarLink to="/admin/addons" icon={Package} label="Addons" />
          </NavGroup>

          <NavGroup label="Operations">
            <SidebarLink to="/admin/tables" icon={LayoutGrid} label="Tables" />
            <SidebarLink to="/admin/staff" icon={Users} label="Staff" />
          </NavGroup>

          <NavGroup label="Insights">
            <SidebarLink to="/admin/reports" icon={BarChart3} label="Reports" />
          </NavGroup>

          {isAdmin && (
            <NavGroup label="Settings">
              <SidebarLink to="/admin/outlets" icon={Store} label="Outlets" />
              <SidebarLink to="/admin/settings" icon={Settings} label="Settings" />
            </NavGroup>
          )}
        </nav>

        {/* POS link + sign out */}
        <div className="px-3 py-3 border-t border-warm-200 space-y-1">
          <a
            href="/pos"
            className="flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm font-medium text-brand hover:bg-brand-light transition-colors"
          >
            <SquareArrowOutUpRight className="w-4 h-4" />
            Open POS
          </a>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 text-left rounded-sm px-3 py-2 text-sm text-status-red hover:bg-status-red-light transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Content area */}
      <main className="flex-1 px-8 py-6 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-warm-400">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SidebarLink({
  to,
  icon: Icon,
  label,
  end,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end ?? false}
      className={({ isActive }) =>
        'flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm font-medium transition-colors ' +
        (isActive
          ? 'bg-brand-light text-brand border-l-[3px] border-l-brand -ml-px'
          : 'text-warm-600 hover:bg-warm-100 hover:text-warm-900')
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </NavLink>
  );
}
