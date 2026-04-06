import { z } from 'zod';

export const CreateOutletSchema = z.object({
  name: z.string().min(1).max(200),
});

export const UpdateOutletSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
});

export const IdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateOutletInput = z.infer<typeof CreateOutletSchema>;
export type UpdateOutletInput = z.infer<typeof UpdateOutletSchema>;
