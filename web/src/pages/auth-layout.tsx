import type { ReactNode } from 'react';

/**
 * Split auth layout — form left, brand gradient right.
 * Right panel hidden on mobile (below lg breakpoint).
 */
export function AuthLayout({
  children,
  tagline = 'Your restaurant, your way.',
}: {
  children: ReactNode;
  tagline?: string;
}) {
  return (
    <div className="min-h-screen flex bg-surface-page">
      {/* Form side */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">{children}</div>
      </div>

      {/* Brand side — hidden on mobile */}
      <div className="hidden lg:flex lg:w-[45%] bg-gradient-to-br from-brand to-brand-hover items-center justify-center p-12 relative overflow-hidden">
        {/* Subtle dot pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div className="relative text-center text-white max-w-sm">
          <h2 className="text-2xl font-semibold leading-snug">{tagline}</h2>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {['Menu setup in minutes', 'Real-time KDS', 'Works on any device'].map((f) => (
              <span
                key={f}
                className="rounded-full bg-white/20 backdrop-blur-sm px-3 py-1 text-xs font-medium"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-surface-white shadow-lg border border-warm-200 p-8 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-warm-900">{title}</h1>
        {subtitle && <p className="text-sm text-warm-500 mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
