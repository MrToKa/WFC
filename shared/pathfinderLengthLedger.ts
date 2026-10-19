import { z } from 'zod';
import { policyRevisionSchema } from './pathfinderPurposePolicy.js';

/** Exact fixed-point text utilities. These do not calculate a cable design. */
export function canonicalDecimalString(value: string): string {
  if (typeof value !== 'string' || value.length > 128 || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) throw new Error('INVALID_FIXED_DECIMAL');
  const negative = value.startsWith('-'), unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.'), tail = fraction.replace(/0+$/, '');
  const normalized = whole + (tail ? '.' + tail : '');
  return negative && normalized !== '0' ? '-' + normalized : normalized;
}

/** A comparison delta, never a reconstruction of historical engineering inputs. */
export function decimalDifference(after: string, before: string): string {
  const a = canonicalDecimalString(after), b = canonicalDecimalString(before);
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const integer = (value: string) => {
    const negative = value.startsWith('-'), [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const result = BigInt(whole + fraction.padEnd(scale, '0'));
    return negative ? -result : result;
  };
  const difference = integer(a) - integer(b), negative = difference < 0n;
  const digits = (negative ? -difference : difference).toString().padStart(scale + 1, '0');
  const result = (negative ? '-' : '') + (scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits);
  return canonicalDecimalString(result);
}

const fixed = (signed: boolean) => z.string().max(128).refine(value => {
  try { return (signed || !value.startsWith('-')) && canonicalDecimalString(value) === value; } catch { return false; }
}, 'Use canonical fixed decimal text.');
export const canonicalAmountSchema = fixed(false);
export const signedCanonicalAmountSchema = fixed(true);
export const LENGTH_LEDGER_MAX_BYTES = 8192;
const raw = z.number().finite().nonnegative();
const endpoint = z.object({ requiresSecondary: z.boolean(), removedApproachMeters: canonicalAmountSchema }).strict();
export const lengthLedgerSchema = z.object({
  schemaVersion: z.literal('wfc.pf.length-components.v1'),
  formulaVersion: z.literal('pathfinder-45c24bf5'),
  settingsRevision: policyRevisionSchema,
  raw: z.object({ lengthMeters: raw, fromDistanceMeters: raw, toDistanceMeters: raw }).strict(),
  rawLengthDecimalMeters: canonicalAmountSchema,
  from: endpoint, to: endpoint,
  settings: z.object({ secondaryTrayLengthMeters: canonicalAmountSchema.nullable(), endConnectionLengthMeters: canonicalAmountSchema, additionalBendingPercent: canonicalAmountSchema }).strict(),
  secondaryEnds: z.number().int().min(0).max(2), replacementMeters: canonicalAmountSchema,
  beforeClampMeters: signedCanonicalAmountSchema, clampAdjustmentMeters: canonicalAmountSchema, afterClampMeters: canonicalAmountSchema,
  beforePercentageMeters: canonicalAmountSchema, bendingIncrementMeters: canonicalAmountSchema,
  unroundedMeters: canonicalAmountSchema, ceilingIncrementMeters: canonicalAmountSchema, designLengthMeters: canonicalAmountSchema,
  gapAccounting: z.literal('already-in-raw-geometry'),
}).strict().superRefine((value, context) => {
  // The contract is a fixed object; there are no arrays or duplicated path points.
  if (new TextEncoder().encode(JSON.stringify(value)).length > LENGTH_LEDGER_MAX_BYTES) context.addIssue({ code: 'custom', message: 'Length components exceed their byte budget.' });
  if (value.secondaryEnds !== Number(value.from.requiresSecondary) + Number(value.to.requiresSecondary)) context.addIssue({ code: 'custom', message: 'SECONDARY flags and count differ.' });
  if (!value.from.requiresSecondary && value.from.removedApproachMeters !== '0' || !value.to.requiresSecondary && value.to.removedApproachMeters !== '0') context.addIssue({ code: 'custom', message: 'Unused approaches must not be removed.' });
  if (value.secondaryEnds === 0 && value.replacementMeters !== '0' || value.secondaryEnds > 0 && value.settings.secondaryTrayLengthMeters === null) context.addIssue({ code: 'custom', message: 'SECONDARY replacement settings are inconsistent.' });
});
export type LengthLedger = z.infer<typeof lengthLedgerSchema>;
