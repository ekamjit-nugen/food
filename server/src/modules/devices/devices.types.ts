/**
 * Domain types for device pairing. A "device" is one installed copy of the
 * mobile app, bound to exactly one staff user and one outlet. Pairing is how
 * that binding happens: admin generates a short-lived code shown as a QR,
 * staff scans it, app redeems code for a long-lived device token.
 */
export interface PairingCodeIssued {
  /** Raw 8-char alphanumeric code. Returned to the admin's browser ONCE so
   *  it can be rendered into the QR; never stored server-side in plaintext. */
  code: string;
  /** Payload the mobile app's QR scanner parses. JSON-encoded. */
  qrPayload: string;
  expiresAt: Date;
}

export interface UserDevice {
  id: string;
  tenantId: string;
  userId: string;
  outletId: string;
  label: string;
  platform: string | null;
  lastSeenAt: Date | null;
  lastIp: string | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  createdAt: Date;
}

/** What the mobile app stores after a successful pair. Opaque to it. */
export interface DeviceTokenBundle {
  /** Format: `<deviceId>.<secret>` — the only place the raw token exists. */
  deviceToken: string;
  device: UserDevice;
}
