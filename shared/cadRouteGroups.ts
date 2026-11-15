import { z } from 'zod';

const uuid = z.string().uuid();
const cleanText = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), 'Control characters are not allowed.');
export const cadRouteTagSchema = cleanText(200).transform(value => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,199}$/).refine(value => value !== 'SECONDARY', 'SECONDARY is reserved.'));
export const cadRouteColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toUpperCase());
export const cadRouteRevisionSchema = z.number().int().positive().max(2147483646);
const cadRouteGroupFieldsSchema = z.object({
  name: cleanText(200), tag: cadRouteTagSchema.optional(), color: cadRouteColorSchema,
  purpose: cleanText(500),
  instanceIds: z.array(uuid).min(1).max(200).refine(values => new Set(values).size === values.length, 'A component can only appear once.'),
}).strict();
const validateRouteName = (value: { name: string; tag?: string }, context: z.RefinementCtx) => {
  if (value.tag === undefined && !cadRouteTagSchema.safeParse(value.name).success)
    context.addIssue({ code: 'custom', path: ['name'], message: 'Use a route identifier with letters, digits, dots, underscores or hyphens. SECONDARY is reserved.' });
};
const canonicalRouteIdentity = <T extends { name: string; tag?: string }>(value: T) => {
  // Explicit tags retain the historical client contract. Existing descriptive
  // names are never silently migrated when reading or recoloring saved groups.
  if (value.tag !== undefined) return { ...value, tag: value.tag };
  const name = cadRouteTagSchema.parse(value.name);
  return { ...value, name, tag: name };
};
export const cadRouteGroupInputSchema = cadRouteGroupFieldsSchema.superRefine(validateRouteName).transform(canonicalRouteIdentity);
export const cadRouteGroupUpdateSchema = cadRouteGroupFieldsSchema.extend({ expectedRevision: cadRouteRevisionSchema })
  .superRefine(validateRouteName).transform(canonicalRouteIdentity);
export const cadRouteGroupDeleteSchema = z.object({ expectedRevision: cadRouteRevisionSchema }).strict();
export type CadRouteGroupWriteInput = z.input<typeof cadRouteGroupInputSchema>;
export type CadRouteGroupInput = z.output<typeof cadRouteGroupInputSchema>;
export type CadRouteGroup = {
  id: string; name: string; tag: string; color: string; purpose: string; revision: number;
  status: 'draft' | 'published'; instanceIds: string[]; projectTrayId: string | null;
};
