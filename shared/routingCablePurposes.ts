import { z } from 'zod';

export const normalizeCablePurpose = (value: string): string => value.normalize('NFC').trim();
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
export const cablePurposeSchema = z.string().min(1).max(500).refine(value =>
  normalizeCablePurpose(value) === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  && [...value].every(character => character.length !== 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff),
'Use a normalized cable purpose.');
/** Purpose authoring shares the routing key contract; an unset purpose stays allowed. */
export const cablePurposeInputSchema = z.string().transform(normalizeCablePurpose)
  .pipe(z.union([z.literal(''),cablePurposeSchema])).nullable();
export const cablePurposesSchema = z.array(cablePurposeSchema).max(4096).refine(values =>
  values.every((value, index) => index === 0 || compare(values[index - 1], value) < 0),
'Cable purposes must be unique and sorted.');
const legacy = ['MV', 'LV', 'Control'];
/** Historical policy records retain their exact original category ordering. */
export const policyCablePurposesSchema = z.array(cablePurposeSchema).max(4096).refine(values =>
  values.every((value, index) => index === 0 || compare(values[index - 1], value) < 0)
  || values.every((value, index) => legacy.includes(value) && (index === 0 || legacy.indexOf(values[index - 1]) < legacy.indexOf(value))),
'Cable purposes must be unique and sorted.');

export function projectCablePurposes(values: readonly (string | null)[]): string[] {
  return projectCablePurposeCatalog(values).cablePurposes;
}

/** Legacy bad values are diagnosed individually and never disable valid project purposes. */
export function projectCablePurposeCatalog(values: readonly (string | null)[]): {cablePurposes:string[];invalidCablePurposeCount:number} {
  const purposes=new Set<string>(),invalidPurposes=new Set<string>();
  for(const raw of values){
    if(raw===null)continue;const purpose=normalizeCablePurpose(raw);if(!purpose)continue;
    if(cablePurposeSchema.safeParse(purpose).success)purposes.add(purpose);else invalidPurposes.add(raw);
  }
  return {cablePurposes:cablePurposesSchema.parse([...purposes].sort(compare)),invalidCablePurposeCount:invalidPurposes.size};
}

export const cablePurposeRoutingSchema = z.object({ purpose: cablePurposeSchema,
  allowedRouteCodes: z.array(z.string().max(256).regex(/^\/[A-Z0-9][A-Z0-9_.-]*$/).refine(value => value !== '/SECONDARY')).max(100000)
    .refine(values => values.every((value, index) => index === 0 || compare(values[index - 1], value) < 0)),
}).strict();
export type CablePurposeRouting = z.infer<typeof cablePurposeRoutingSchema>;

/** Native strategy proofs separately qualify generated SECONDARY approaches. */
export function isPermittedCablePurposeRoute(routeCodes: readonly string[], allowedRouteCodes: readonly string[]): boolean {
  const allowed=new Set(allowedRouteCodes);
  return routeCodes.every(code=>code==='/SECONDARY'||allowed.has(code));
}
