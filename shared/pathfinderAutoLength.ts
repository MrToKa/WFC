import { z } from 'zod';

/** A derived display value, never a Cable list write or engineering approval. */
export const AUTO_LENGTH_STATUSES = ['not-calculated', 'calculated', 'pending', 'blocked', 'failed', 'cancelled', 'stale', 'unavailable', 'last-successful'] as const;
export const autoLengthBarrierStatusSchema = z.enum(['clear', 'bypassed', 'no-barriers-declared']);
const timestamp = z.string().datetime({ offset: false }).refine(value => value.endsWith('Z'));
export const autoLengthViewSchema = z.object({
  autoCalculatedLength: z.number().int().min(0).max(1_000_000).nullable(),
  autoLengthStatus: z.enum(AUTO_LENGTH_STATUSES),
  autoLengthCalculatedAt: timestamp.nullable(),
  autoLengthBarrierStatus: autoLengthBarrierStatusSchema.nullable(),
  autoLengthMatchesLatestRequest: z.boolean(),
}).strict().superRefine((value, context) => {
  const hasLength = value.autoCalculatedLength !== null;
  if (hasLength !== (value.autoLengthCalculatedAt !== null) || hasLength !== (value.autoLengthBarrierStatus !== null))
    context.addIssue({ code: 'custom', message: 'A displayed length retains its exact successful source metadata.' });
  if (value.autoLengthMatchesLatestRequest && !hasLength)
    context.addIssue({ code: 'custom', message: 'Only a recorded success can match the latest request.' });
  if (value.autoLengthStatus === 'calculated' && (!hasLength || !value.autoLengthMatchesLatestRequest))
    context.addIssue({ code: 'custom', message: 'Calculated identifies the latest completed cable item.' });
  if (value.autoLengthStatus === 'last-successful' && !hasLength)
    context.addIssue({ code: 'custom', message: 'Last successful retains an actual checked value.' });
  if (value.autoLengthStatus === 'not-calculated' && (hasLength || value.autoLengthMatchesLatestRequest))
    context.addIssue({ code: 'custom', message: 'Not calculated has no invented length or source.' });
});
export type AutoLengthView = z.infer<typeof autoLengthViewSchema>;
export function emptyAutoLengthView(): AutoLengthView {
  return { autoCalculatedLength: null, autoLengthStatus: 'not-calculated', autoLengthCalculatedAt: null,
    autoLengthBarrierStatus: null, autoLengthMatchesLatestRequest: false };
}
