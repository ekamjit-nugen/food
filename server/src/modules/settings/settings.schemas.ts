import { z } from 'zod';

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
] as const;

export const UpdateBusinessSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  addressLine1: z.string().max(200).optional().nullable(),
  addressLine2: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().optional().nullable(),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'PIN code must be 6 digits').optional().nullable(),
  phone: z.string().max(15).optional().nullable(),
  email: z.string().email().optional().nullable(),
});

export const UpdateTaxSchema = z.object({
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/, 'Invalid GSTIN format')
    .optional()
    .nullable(),
  fssaiLicense: z
    .string()
    .regex(/^[0-9]{14}$/, 'FSSAI license must be 14 digits')
    .optional()
    .nullable(),
  defaultTaxRateBps: z.number().int().min(0).max(2800).optional(),
});

export const UpdateBillingSchema = z.object({
  billNumberPrefix: z
    .string()
    .max(10)
    .regex(/^[a-zA-Z0-9]*$/, 'Alphanumeric only')
    .optional()
    .nullable(),
  receiptFooterText: z.string().max(200).optional().nullable(),
  maxDiscountBps: z.number().int().min(0).max(10000).optional().nullable(),
});

export const UpdateOperationsSchema = z
  .object({
    kotWarningMinutes: z.number().int().min(1).max(60).optional(),
    kotUrgentMinutes: z.number().int().min(1).max(60).optional(),
    autoRestock: z.boolean().optional(),
    autoRestockTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format')
      .optional(),
  })
  .refine(
    (data) => {
      if (data.kotWarningMinutes != null && data.kotUrgentMinutes != null) {
        return data.kotUrgentMinutes > data.kotWarningMinutes;
      }
      return true;
    },
    { message: 'Urgent time must be greater than warning time', path: ['kotUrgentMinutes'] },
  );

export type UpdateBusinessInput = z.infer<typeof UpdateBusinessSchema>;
export type UpdateTaxInput = z.infer<typeof UpdateTaxSchema>;
export type UpdateBillingInput = z.infer<typeof UpdateBillingSchema>;
export type UpdateOperationsInput = z.infer<typeof UpdateOperationsSchema>;

export { INDIAN_STATES };
