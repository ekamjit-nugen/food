import { z } from 'zod';

/**
 * Zod schemas for the device pairing endpoints. All inputs are validated at
 * the HTTP boundary; no controller or service reads req.body directly.
 */

/** Admin POSTs this to create a pairing code. No body needed — the target
 *  user comes from the URL param (:id) and the issuer from req.auth. */
export const CreatePairingCodeSchema = z.object({}).strict();

/** Mobile app POSTs this to redeem a code. Anonymous (no auth header). */
export const ConsumePairingSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{8}$/, 'code must be 8 alphanumeric characters'),
    label: z.string().trim().min(1).max(80),
    platform: z.enum(['ios', 'android']).optional(),
  })
  .strict();

/** Mobile app POSTs this on app start to turn a stored device token into a
 *  short-lived tenant JWT. The raw token format is validated loosely — we
 *  reject obvious garbage without leaking the structure. */
export const DeviceLoginSchema = z
  .object({
    deviceToken: z
      .string()
      .min(40)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'malformed device token'),
  })
  .strict();

export type CreatePairingCodeInput = z.infer<typeof CreatePairingCodeSchema>;
export type ConsumePairingInput = z.infer<typeof ConsumePairingSchema>;
export type DeviceLoginInput = z.infer<typeof DeviceLoginSchema>;
