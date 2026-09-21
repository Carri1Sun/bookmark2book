import { z } from 'zod';
import type { Book } from './types';
import { medalTiers } from './featured-medals';

export const editorialActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('submit'),
      reason: z.string().trim().max(2000),
      introduction: z.string().trim().max(1000),
    })
    .strict(),
  z.object({ action: z.literal('cancel') }).strict(),
  z.object({ action: z.literal('approve') }).strict(),
]);
export const bookFlagsSchema = z
  .object({
    pinned: z.boolean().optional(),
    featuredMedal: z.enum(medalTiers).optional(),
    editorial: editorialActionSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.pinned !== undefined ||
      value.editorial !== undefined ||
      value.featuredMedal !== undefined,
  );
export type BookFlags = z.infer<typeof bookFlagsSchema>;

export function applyBookFlags(book: Book, input: BookFlags): Book {
  const flags = bookFlagsSchema.parse(input);
  const updated = { ...book };
  if (flags.pinned !== undefined) updated.pinned = flags.pinned;
  if (flags.featuredMedal !== undefined) {
    if (!book.featured || flags.editorial) throw new Error('当前文集无法佩戴精选勋章。');
    updated.featuredMedal = flags.featuredMedal;
  }
  const action = flags.editorial;
  if (!action) return updated;
  if (action.action === 'submit') {
    if (book.featured || book.editorial?.status === 'pending')
      throw new Error('当前文集已精选或正在审核，请先取消。');
    updated.featured = false;
    updated.editorial = {
      status: 'pending',
      reason: action.reason,
      introduction: action.introduction,
      submittedAt: new Date().toISOString(),
    };
  } else if (action.action === 'approve') {
    if (book.editorial?.status !== 'pending') throw new Error('当前文集没有待审核的申请。');
    updated.featured = true;
    updated.editorial = { ...book.editorial, status: 'approved' };
  } else {
    updated.featured = false;
    delete updated.editorial;
    delete updated.featuredMedal;
  }
  return updated;
}
