import { useState, type FormEvent, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ApiError, useAuth } from '../../lib/auth';
import {
  useInviteStaff,
  useStaff,
  useToggleUserActive,
  type InviteInput,
  type InviteResult,
  type StaffUser,
} from '../../lib/staff';
import {
  useCreatePairingCode,
  useRevokeDevice,
  useUserDevices,
  type PairingCodeIssued,
  type UserDevice,
} from '../../lib/devices';

/**
 * Admin → Staff page.
 *
 * Two jobs:
 *   1. Show the current roster so the owner can see who has access.
 *   2. Let the owner invite new teammates. In v1 we have no email worker,
 *      so the invite POST returns the raw token and we render an accept-
 *      invite URL the owner copies and shares via WhatsApp. When the
 *      email pipeline ships, the copy-link box disappears and the POST
 *      only returns a confirmation.
 *
 * Only admins can invite (manager can view the roster). We gate the button
 * on role client-side AND rely on the server's role check — the UI gate
 * is only for ergonomics, not a security boundary.
 */
export function AdminStaff() {
  const { user } = useAuth();
  const { data, isLoading, error } = useStaff();
  const [inviting, setInviting] = useState(false);
  const [lastInvite, setLastInvite] = useState<{
    email: string;
    result: InviteResult;
  } | null>(null);
  const [devicesFor, setDevicesFor] = useState<StaffUser | null>(null);

  const canInvite = user?.role === 'admin';
  // Same set as the server-side role gate on /users/:id/pairing-codes.
  const canManageDevices =
    user?.isTenantOwner === true ||
    user?.role === 'admin' ||
    user?.role === 'manager';

  return (
    <div>
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Staff</h2>
        {canInvite && (
          <button
            onClick={() => setInviting(true)}
            className="btn-primary"
          >
            Invite teammate
          </button>
        )}
      </header>

      {lastInvite && (
        <InviteSuccessCard
          email={lastInvite.email}
          result={lastInvite.result}
          onDismiss={() => setLastInvite(null)}
        />
      )}

      {isLoading && <div className="text-warm-500">Loading…</div>}
      {error && (
        <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
          {(error as Error).message}
        </div>
      )}

      {data && (
        <StaffTable
          rows={data}
          currentUserId={user?.id ?? null}
          isAdmin={canInvite}
          onManageDevices={canManageDevices ? setDevicesFor : null}
        />
      )}

      {devicesFor && (
        <DevicesModal
          user={devicesFor}
          onClose={() => setDevicesFor(null)}
        />
      )}

      {inviting && user && (
        <InviteModal
          outletId={user.outletId}
          onClose={() => setInviting(false)}
          onSuccess={(email, result) => {
            setLastInvite({ email, result });
            setInviting(false);
          }}
        />
      )}
    </div>
  );
}

function StaffTable({
  rows,
  currentUserId,
  isAdmin,
  onManageDevices,
}: {
  rows: StaffUser[];
  currentUserId: string | null;
  isAdmin: boolean;
  onManageDevices: ((u: StaffUser) => void) | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-warm-300 bg-white p-6 text-center text-warm-500">
        Just you so far.
      </div>
    );
  }
  const sorted = [...rows].sort((a, b) => {
    // Owners first, then by role priority, then by name.
    if (a.isTenantOwner !== b.isTenantOwner) return a.isTenantOwner ? -1 : 1;
    const order: Record<StaffUser['role'], number> = {
      admin: 0,
      manager: 1,
      staff: 2,
      kitchen: 3,
    };
    if (order[a.role] !== order[b.role]) return order[a.role] - order[b.role];
    return a.fullName.localeCompare(b.fullName);
  });
  return (
    <div className="rounded-lg border border-warm-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-warm-50 text-warm-600">
          <tr>
            <th className="text-left font-medium px-4 py-2">Name</th>
            <th className="text-left font-medium px-4 py-2">Email</th>
            <th className="text-left font-medium px-4 py-2">Role</th>
            <th className="text-center font-medium px-4 py-2">Active</th>
            <th className="text-left font-medium px-4 py-2">Last login</th>
            {onManageDevices && (
              <th className="text-right font-medium px-4 py-2">Devices</th>
            )}
            {isAdmin && <th className="text-right font-medium px-4 py-2">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((u) => (
            <tr key={u.id} className="border-t border-warm-100">
              <td className="px-4 py-3 font-medium text-warm-900">
                {u.fullName}
                {u.isTenantOwner && (
                  <span className="ml-2 rounded-full bg-status-amber-light px-2 py-0.5 text-xs font-medium text-status-amber">
                    owner
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-warm-600">{u.email}</td>
              <td className="px-4 py-3 text-warm-600 capitalize">{u.role}</td>
              <td className="px-4 py-3 text-center">
                {u.isActive ? (
                  <span className="text-status-green">yes</span>
                ) : (
                  <span className="text-warm-400">no</span>
                )}
              </td>
              <td className="px-4 py-3 text-warm-500">
                {u.lastLoginAt
                  ? new Date(u.lastLoginAt).toLocaleString()
                  : <span className="text-warm-400">never</span>}
              </td>
              {onManageDevices && (
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onManageDevices(u)}
                    className="btn-secondary"
                  >
                    Manage
                  </button>
                </td>
              )}
              {isAdmin && (
                <td className="px-4 py-3 text-right">
                  <ToggleActiveButton user={u} currentUserId={currentUserId} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ToggleActiveButton({ user, currentUserId }: { user: StaffUser; currentUserId: string | null }) {
  const toggle = useToggleUserActive();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Can't deactivate yourself or the tenant owner
  if (user.id === currentUserId || user.isTenantOwner) return null;

  if (user.isActive) {
    return (
      <>
        <button
          onClick={() => setConfirming(true)}
          className="text-xs text-status-red hover:text-status-red"
        >
          Deactivate
        </button>
        {error && <div className="text-xs text-status-red">{error}</div>}
        {confirming && (
          <div className="fixed inset-0 z-50 bg-warm-950/50 flex items-center justify-center p-4" onClick={() => setConfirming(false)}>
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg bg-white shadow-lg border border-warm-200 p-5 space-y-3">
              <h3 className="text-base font-semibold">Deactivate {user.fullName}?</h3>
              <p className="text-sm text-warm-600">
                They will be immediately signed out and all their devices will be unpaired.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirming(false)} className="flex-1 btn-secondary">Cancel</button>
                <button
                  onClick={async () => {
                    setError(null);
                    try {
                      await toggle.mutateAsync({ userId: user.id, isActive: false });
                      setConfirming(false);
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : 'Failed');
                    }
                  }}
                  disabled={toggle.isPending}
                  className="flex-1 btn-danger disabled:opacity-60"
                >
                  {toggle.isPending ? 'Deactivating...' : 'Deactivate'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <button
      onClick={async () => {
        setError(null);
        try {
          await toggle.mutateAsync({ userId: user.id, isActive: true });
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Failed');
        }
      }}
      disabled={toggle.isPending}
      className="text-xs text-status-green hover:text-status-green"
    >
      {toggle.isPending ? 'Reactivating...' : 'Reactivate'}
    </button>
  );
}

function InviteModal({
  outletId,
  onClose,
  onSuccess,
}: {
  outletId: string;
  onClose: () => void;
  onSuccess: (email: string, result: InviteResult) => void;
}) {
  const invite = useInviteStaff();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<InviteInput['role']>('staff');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload: InviteInput = {
        email: email.trim().toLowerCase(),
        role,
        outletIds: [outletId],
      };
      const trimmedName = fullName.trim();
      if (trimmedName) payload.fullName = trimmedName;
      const result = await invite.mutateAsync(payload);
      onSuccess(payload.email, result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'invite failed');
    }
  }

  return (
    <ModalShell title="Invite teammate" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Email">
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full input-base text-sm"
          />
        </Field>
        <Field label="Full name (optional)">
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="They can set this themselves"
            className="w-full input-base text-sm"
          />
        </Field>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as InviteInput['role'])}
            className="w-full input-base text-sm"
          >
            <option value="staff">Staff (POS, order taking)</option>
            <option value="kitchen">Kitchen (KDS only)</option>
            <option value="manager">Manager (staff + reports, no role edits)</option>
          </select>
          <p className="mt-1 text-xs text-warm-500">
            Only owners can promote another user to admin; use the database CLI.
          </p>
        </Field>
        {error && (
          <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={invite.isPending}
            className="btn-primary disabled:opacity-60"
          >
            {invite.isPending ? 'Creating invite…' : 'Create invite'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function InviteSuccessCard({
  email,
  result,
  onDismiss,
}: {
  email: string;
  result: InviteResult;
  onDismiss: () => void;
}) {
  const link = result.token
    ? `${window.location.origin}/accept-invite?token=${encodeURIComponent(result.token)}`
    : null;
  const expiresOn = new Date(result.expiresAt).toLocaleString();

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // clipboard API refused — the input is still selectable
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-status-green/20 bg-status-green-light p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-status-green">
            Invite created for {email}
          </h3>
          <p className="mt-1 text-xs text-status-green">
            Expires {expiresOn}. Single use.
          </p>
          {link ? (
            <>
              <p className="mt-2 text-xs text-status-green">
                Share this link with them (WhatsApp, in person). They'll set a password
                and join your team.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  readOnly
                  value={link}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 rounded-md border border-status-green/30 bg-white px-2 py-1.5 font-mono text-xs text-warm-800"
                />
                <button
                  type="button"
                  onClick={copy}
                  className="rounded-md bg-status-green px-3 py-1.5 text-xs font-medium text-white hover:bg-status-green/90"
                >
                  Copy
                </button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-xs text-status-green">
              An invitation email will be sent to {email}.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-medium text-status-green hover:text-status-green"
          aria-label="dismiss"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-warm-200 px-4 py-3">
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function DevicesModal({
  user,
  onClose,
}: {
  user: StaffUser;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useUserDevices(user.id);
  const createCode = useCreatePairingCode(user.id);
  const revoke = useRevokeDevice(user.id);
  // The raw pairing code is kept in component state ONLY. It never touches
  // localStorage, never goes back to the server for logging, and disappears
  // when the modal closes — matching the server contract that the code
  // leaves the API exactly once.
  const [issued, setIssued] = useState<PairingCodeIssued | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  async function onPair() {
    setRevokeError(null);
    try {
      const res = await createCode.mutateAsync();
      setIssued(res);
    } catch (err) {
      setRevokeError(err instanceof ApiError ? err.message : 'failed to issue pairing code');
    }
  }

  async function onRevoke(deviceId: string) {
    setRevokeError(null);
    // Confirm in-line — revocation is destructive from the device's POV
    // (it immediately loses access and has to re-pair). Cheap guard.
    if (!window.confirm('Revoke this device? The app on that phone will be signed out immediately.')) {
      return;
    }
    try {
      await revoke.mutateAsync(deviceId);
    } catch (err) {
      setRevokeError(err instanceof ApiError ? err.message : 'revoke failed');
    }
  }

  const active = (data ?? []).filter((d) => d.revokedAt === null);
  const revoked = (data ?? []).filter((d) => d.revokedAt !== null);

  return (
    <ModalShell title={`Devices for ${user.fullName}`} onClose={onClose}>
      <div className="space-y-4">
        {issued ? (
          <PairingCodeCard issued={issued} onDone={() => setIssued(null)} />
        ) : (
          <button
            type="button"
            onClick={onPair}
            disabled={createCode.isPending}
            className="w-full btn-primary disabled:opacity-60"
          >
            {createCode.isPending ? 'Generating…' : 'Pair a new device'}
          </button>
        )}

        {revokeError && (
          <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-xs text-status-red">
            {revokeError}
          </div>
        )}

        {isLoading && <div className="text-xs text-warm-500">Loading devices…</div>}
        {error && (
          <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-xs text-status-red">
            {(error as Error).message}
          </div>
        )}

        {data && data.length === 0 && !issued && (
          <p className="text-xs text-warm-500">
            No devices paired yet. Click the button above to create a QR code
            for this staff member to scan with the mobile app.
          </p>
        )}

        {active.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-warm-600">
              Active ({active.length})
            </div>
            <ul className="divide-y divide-warm-100 rounded-md border border-warm-200">
              {active.map((d) => (
                <DeviceRow
                  key={d.id}
                  device={d}
                  onRevoke={() => onRevoke(d.id)}
                  disabled={revoke.isPending}
                />
              ))}
            </ul>
          </div>
        )}

        {revoked.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-warm-500">
              Revoked ({revoked.length})
            </div>
            <ul className="divide-y divide-warm-100 rounded-md border border-warm-200 bg-warm-50">
              {revoked.map((d) => (
                <DeviceRow key={d.id} device={d} onRevoke={null} disabled={false} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function PairingCodeCard({
  issued,
  onDone,
}: {
  issued: PairingCodeIssued;
  onDone: () => void;
}) {
  const expiresAt = new Date(issued.expiresAt);
  return (
    <div className="rounded-lg border border-status-green/20 bg-status-green-light p-4">
      <h4 className="text-sm font-semibold text-status-green">
        Pairing code ready — have them scan within 10 minutes
      </h4>
      <p className="mt-1 text-xs text-status-green">
        Expires {expiresAt.toLocaleTimeString()}. Single use. This is the only
        time this code is shown.
      </p>
      <div className="mt-3 flex items-start gap-4">
        <div className="rounded-md bg-white p-2 shadow-sm">
          <QRCodeSVG value={issued.qrPayload} size={168} level="M" />
        </div>
        <div className="flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-status-green">
            Or enter manually
          </div>
          <div className="mt-1 select-all rounded-md border border-status-green/30 bg-white px-3 py-2 text-center font-mono text-xl tracking-widest text-warm-900">
            {issued.code}
          </div>
          <button
            type="button"
            onClick={onDone}
            className="mt-3 w-full rounded-md border border-status-green/30 bg-white px-3 py-1.5 text-xs font-medium text-status-green hover:bg-status-green-light"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function DeviceRow({
  device,
  onRevoke,
  disabled,
}: {
  device: UserDevice;
  onRevoke: (() => void) | null;
  disabled: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-warm-900">{device.label}</div>
        <div className="text-xs text-warm-500">
          {device.platform ? `${device.platform} • ` : ''}
          {device.lastSeenAt
            ? `last seen ${new Date(device.lastSeenAt).toLocaleString()}`
            : 'never connected'}
          {device.revokedAt && ` • revoked ${new Date(device.revokedAt).toLocaleDateString()}`}
        </div>
      </div>
      {onRevoke && (
        <button
          type="button"
          onClick={onRevoke}
          disabled={disabled}
          className="rounded-md border border-status-red/30 bg-white px-2.5 py-1 text-xs font-medium text-status-red hover:bg-status-red-light disabled:opacity-60"
        >
          Revoke
        </button>
      )}
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-warm-600">
        {label}
      </div>
      {children}
    </label>
  );
}
