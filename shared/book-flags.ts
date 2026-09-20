import { z } from 'zod';

export const bookFlagsSchema = z
  .object({ pinned: z.boolean().optional(), featured: z.boolean().optional() })
  .strict()
  .refine((value) => value.pinned !== undefined || value.featured !== undefined);
export type BookFlags = z.infer<typeof bookFlagsSchema>;
