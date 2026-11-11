import { z } from 'zod';

const uuid = z.string().uuid();
const cleanText = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), 'Control characters are not allowed.');
export const cadRouteTagSchema = cleanText(200).transform(value => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,199}$/).refine(value => value !== 'SECONDARY', 'SECONDARY is reserved.'));
export const cadRouteColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toUpperCase());
export const cadRouteRevisionSchema = z.number().int().positive().max(2147483646);
export const cadRouteGroupInputSchema = z.object({
  name: cleanText(200), tag: cadRouteTagSchema, color: cadRouteColorSchema,
  purpose: cleanText(500),
  instanceIds: z.array(uuid).min(1).max(200).refine(values => new Set(values).size === values.length, 'A component can only appear once.'),
}).strict();
export const cadRouteGroupUpdateSchema = cadRouteGroupInputSchema.extend({ expectedRevision: cadRouteRevisionSchema });
export const cadRouteGroupDeleteSchema = z.object({ expectedRevision: cadRouteRevisionSchema }).strict();
export type CadRouteGroupInput = z.infer<typeof cadRouteGroupInputSchema>;
export type CadRouteGroup = {
  id: string; name: string; tag: string; color: string; purpose: string; revision: number;
  status: 'draft' | 'published'; instanceIds: string[]; projectTrayId: string | null;
};
