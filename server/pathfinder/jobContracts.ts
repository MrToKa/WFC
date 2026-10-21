import { z } from 'zod';
import { revision, uuid, snapshotSchema } from './contracts.js';
import type { RoutingScope } from './routingScope.js';
import type { EndpointCalculationPoint, EndpointCalculationPreparation, CurrentEndpointCalculationPoint, ScopedEndpointResolution } from './endpointCalculationProvenance.js';
import type { ComparisonCalculationScope } from './comparisonCalculationProvenance.js';
import type { EngineIdentity, BarrierEngineIdentity } from '../../shared/pathfinderEngineIdentity.js';
import { barrierAdmissionIntentSchema, type BarrierAdmissionIntent } from '../../shared/pathfinderBarrierAdmission.js';
import { barrierExecutionSchema, type BarrierRuntimeContext } from '../../shared/pathfinderBarrierRuntime.js';
import { lengthLedgerSchema, legacyLengthLedgerSchema } from '../../shared/pathfinderLengthLedger.js';
import { directSecondaryDecisionSchema, directSecondaryRouteIssue } from '../../shared/pathfinderDirectSecondary.js';

export const optionsSchema = z.object({
  connectionToleranceMeters:z.number().finite().positive().max(100),sampleSpacingMeters:z.number().finite().positive().max(100),
  secondaryDistanceMeters:z.number().finite().min(0).max(1_000_000),preferVerticalApproach:z.boolean(),
  maxGraphNodes:z.number().int().min(2).max(1_000_000),maxGraphConnections:z.number().int().min(1).max(4_000_000),
  barrierRouting:barrierAdmissionIntentSchema.optional(),
}).strict();
export const defaultOptions = Object.freeze({connectionToleranceMeters:0.25,sampleSpacingMeters:0.125,secondaryDistanceMeters:2,preferVerticalApproach:true,maxGraphNodes:200_000,maxGraphConnections:1_000_000});
/** Metadata comes only from retained engine inputs; unknown historical values cannot authorize Apply. */
export function proposalRoutingPreferences(options:unknown):{secondaryDistanceMeters:number;preferVerticalApproach:boolean;barrierRouting?:BarrierAdmissionIntent}|null {
  if (!options || typeof options!=='object') return null;
  const {secondaryDistanceMeters,preferVerticalApproach,barrierRouting}=options as Record<string,unknown>;
  const barrier = barrierRouting === undefined ? undefined : barrierAdmissionIntentSchema.safeParse(barrierRouting);
  if (barrier && !barrier.success) return null;
  return typeof secondaryDistanceMeters==='number' && Number.isFinite(secondaryDistanceMeters) && secondaryDistanceMeters>=0 && secondaryDistanceMeters<=1_000_000 && typeof preferVerticalApproach==='boolean'
    ? {secondaryDistanceMeters,preferVerticalApproach,...(barrier?.success ? {barrierRouting:barrier.data} : {})} : null;
}
export const createJobSchema = z.object({cableIds:z.array(uuid).min(1).max(10_000).optional(),expectedRegistryRevision:revision,
  options:optionsSchema.optional(),timeoutMilliseconds:z.number().int().min(100).max(120_000).optional(),force:z.boolean().optional()}).strict();
export type EngineOptions = z.infer<typeof optionsSchema>;
export type ProjectSettings = {revision:string;connectionGap:string;secondaryTrayLength:string|null;endConnectionLength:string;additionalBendingPercent:string};
export type HistoricalDependencySnapshot = {
  schemaVersion:'pathfinder.dependencies.v2';projectId:string;cableId:string;cableWriteRevision:string;
  routing:RoutingScope;
  cableInputs:{fromLocation:string|null;toLocation:string|null;mto:string|null;cableTypeId:string};
  registryRevision:string;model:{id:string;selectionRevision:string;contentFingerprint:string};
  artifact:{id:string;sha256:string};settings:ProjectSettings;options:EngineOptions;
  from:{locationId:string;bindingRevision:string;point:[number,number,number]};to:{locationId:string;bindingRevision:string;point:[number,number,number]};
  engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1';
};
export type EndpointDependencySnapshot = Omit<HistoricalDependencySnapshot, 'schemaVersion' | 'from' | 'to'> & {
  schemaVersion: 'pathfinder.dependencies.v3'; preparation: EndpointCalculationPreparation;
  from: EndpointCalculationPoint; to: EndpointCalculationPoint;
};
export type ComparisonDependencySnapshot = Omit<EndpointDependencySnapshot, 'schemaVersion'> & {
  schemaVersion: 'pathfinder.dependencies.v4'; comparison: ComparisonCalculationScope;
};
export type CurrentDependencySnapshot = Omit<ComparisonDependencySnapshot, 'schemaVersion'> & {
  schemaVersion: 'pathfinder.dependencies.v5'; engineIdentity: EngineIdentity;
};
export type AutomaticDependencySnapshot = Omit<CurrentDependencySnapshot, 'schemaVersion' | 'from' | 'to'> & {
  schemaVersion: 'pathfinder.dependencies.v6'; from: CurrentEndpointCalculationPoint; to: CurrentEndpointCalculationPoint;
};
/** Registry observations remain admission/audit data, outside this exact mathematical body. */
export type ScopedDependencySnapshot = Omit<CurrentDependencySnapshot, 'schemaVersion' | 'registryRevision' | 'from' | 'to'> & {
  schemaVersion: 'pathfinder.dependencies.v7'; from: CurrentEndpointCalculationPoint; to: CurrentEndpointCalculationPoint;
  endpointResolution: ScopedEndpointResolution;
};
export type BarrierDependencySnapshot = Omit<ScopedDependencySnapshot,'schemaVersion'|'engineIdentity'> & {
  schemaVersion:'pathfinder.dependencies.v8'; engineIdentity:BarrierEngineIdentity; barriers:BarrierRuntimeContext;
};
export type CurrentCalculationDependencySnapshot = CurrentDependencySnapshot | AutomaticDependencySnapshot | ScopedDependencySnapshot | BarrierDependencySnapshot;
/** v2/v3/v4 remain historical; current dispatch/Review/Apply require actual implementation provenance. */
export type DependencySnapshot = HistoricalDependencySnapshot | EndpointDependencySnapshot | ComparisonDependencySnapshot | CurrentCalculationDependencySnapshot;
const enginePoint = z.object({x:z.number().finite(),y:z.number().finite(),z:z.number().finite()}).strict();
export const routeSchema = z.object({success:z.boolean(),message:z.string().max(32768),routeText:z.string().max(1_000_000),
  routeCodes:z.array(z.string().max(2048)).max(200_000),segmentIds:z.array(z.string().max(256)).max(200_000),
  pathPoints:z.array(enginePoint).max(200_000),lengthMeters:z.number().finite().nonnegative(),fromDistanceMeters:z.number().finite().nonnegative(),
  toDistanceMeters:z.number().finite().nonnegative(),fromRequiresSecondary:z.boolean(),toRequiresSecondary:z.boolean(),
  connectionGapCount:z.number().int().nonnegative(),connectionGapLengthMeters:z.number().finite().nonnegative(),
}).strict();
const decimal = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/).max(100);
export const designSchema = z.object({lengthBeforePercentageMeters:decimal,unroundedLengthMeters:decimal,designLengthMeters:decimal}).strict();
const engineResponseObjectSchema = z.object({schemaVersion:z.literal('pathfinder.model.response.v1'),requestId:uuid,
  status:z.enum(['prepared','calculated','lookup_planned','no_path','settings_required','category_required','model_needs_review','invalid_request','deadline_exceeded','resource_limit']),
  message:z.string().max(32768),engineeringAccepted:z.literal(false),model:z.unknown().optional(),prepared:z.unknown().optional(),
  effectiveCategory:z.string().nullable().optional(),route:routeSchema.optional(),design:designSchema.nullable().optional(),lengthLedger:lengthLedgerSchema.optional(),projectSettings:z.unknown().optional(),
  routeCodes:z.array(z.string().max(256).regex(/^\/[A-Z0-9][A-Z0-9_.-]*$/)).min(1).max(100).optional(),usedConnectionGapMeters:z.number().finite().positive().max(100).nullable().optional(),
  lookupScope:z.object({requestedCodeCount:z.number().int().nonnegative(),uniqueCodeCount:z.number().int().nonnegative(),discoveredObjectCount:z.number().int().nonnegative(),resolvedOwnerCount:z.number().int().nonnegative(),resolvedLeafCount:z.number().int().nonnegative(),warnings:z.array(z.string().max(32768)).max(2048)}).strict().nullable().optional(),
}).strict();
const legacyEngineResponseSchema = engineResponseObjectSchema.extend({ lengthLedger: legacyLengthLedgerSchema.optional() }).strict();
const directEngineResponseSchema = engineResponseObjectSchema.extend({ schemaVersion: z.literal('pathfinder.model.response.v2'),
  status: z.enum(['calculated', 'no_path']), directSecondary: directSecondaryDecisionSchema, lengthLedger: lengthLedgerSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!['LV', 'Control', 'Instrumentation'].includes(value.effectiveCategory ?? '')) context.addIssue({ code: 'custom', message: 'Direct strategy requires an eligible effective cable category.' });
  if (value.directSecondary.mode === 'direct-secondary') {
    if (value.status === 'no_path') context.addIssue({ code: 'custom', message: 'A direct successful strategy cannot carry a no-path outcome.' });
    if (value.lengthLedger && (value.lengthLedger.schemaVersion !== 'wfc.pf.length-components.v2'
      || JSON.stringify(value.lengthLedger.directSecondary) !== JSON.stringify(value.directSecondary)))
      context.addIssue({ code: 'custom', message: 'Direct components must retain the exact direct decision.' });
    if (value.route) {
      const issue = directSecondaryRouteIssue(value.directSecondary, { ...value.route, points: value.route.pathPoints.map(point => [point.x, point.y, point.z]) });
      if (issue) context.addIssue({ code: 'custom', message: issue });
    }
  } else if (value.lengthLedger?.schemaVersion === 'wfc.pf.length-components.v2') context.addIssue({ code: 'custom', message: 'Tray-network fallback retains its legacy formula.' });
});
const barrierEngineResponseSchema = engineResponseObjectSchema.extend({ schemaVersion: z.literal('pathfinder.model.response.v3'),
  status: z.enum(['calculated','no_path','settings_required','category_required','model_needs_review','invalid_request','deadline_exceeded','resource_limit']),
  barriers: barrierExecutionSchema,
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (value.status === 'calculated' && (!value.route?.success || !['clear','bypassed','no-barriers-declared'].includes(value.barriers.diagnostics.status)))
    issue('Calculated protected routes require successful geometry and exact final barrier evidence.');
  if (value.route?.success && value.status !== 'calculated' && value.status !== 'settings_required')
    issue('A successful route cannot acquire a different protected outcome.');
  if (value.barriers.directSecondary?.mode === 'direct-secondary') {
    if (value.lengthLedger && (value.lengthLedger.schemaVersion !== 'wfc.pf.length-components.v2'
      || JSON.stringify(value.lengthLedger.directSecondary) !== JSON.stringify(value.barriers.directSecondary.distanceDecision)))
      issue('The actual constrained direct strategy retains its exact original direct ledger.');
  } else if (value.lengthLedger?.schemaVersion === 'wfc.pf.length-components.v2') issue('An actual tray fallback retains the tray length formula.');
});
export const engineResponseSchema = z.union([legacyEngineResponseSchema, directEngineResponseSchema, barrierEngineResponseSchema]);
export type EngineResponse = z.infer<typeof engineResponseSchema>;
export type EngineRoute = z.infer<typeof routeSchema>;
export type EngineDesign = z.infer<typeof designSchema>;
export type JobPrincipal = {userId:string;loginId:string;loginExpiresAt:number};
export const reviewSchema = z.object({expectedProposalHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const applySchema = z.object({idempotencyKey:uuid,reviewId:uuid,expectedCableWriteRevision:revision}).strict();
const lookupText=z.string().min(1).max(8000).refine(value=>routeCompatibilityIssue(value)===null,'The route is outside existing Viewer identifier limits.');
export const lookupPlanSchema=z.object({routeText:lookupText,expectedSelectionRevision:revision}).strict();
export const lookupSchema=z.union([
  z.object({routeText:lookupText,reverse:z.boolean(),expectedSelectionRevision:revision,artifactId:uuid,options:optionsSchema.optional()}).strict(),
  z.object({routeText:lookupText,reverse:z.boolean(),expectedSelectionRevision:revision,snapshot:snapshotSchema}).strict(),
]);
/** Match the exact existing cable-write bound before inviting Review/Apply. */
export function designLengthCompatibilityIssue(value:unknown):string|null {
  const message='The design length must be a canonical whole number from 0 to 1,000,000 metres for WFC Apply.';
  if (typeof value!=='string' || value.length>7) return message;
  const canonical=/^(?:0|[1-9][0-9]*)$/.exec(value);
  if (!canonical || canonical[0]!==value || BigInt(value)>1_000_000n) return message;
  return null;
}
/** Existing Routings viewer compatibility; exact computed results themselves remain untruncated. */
export function routeCompatibilityIssue(value:string):string|null {
  if (!value || value.length > 8000) return 'The route exceeds the existing cable routing limit of 8,000 characters.';
  let segments = 0;
  for (const part of value.split('/')) {
    const token = part.trim(); if (!token) continue;
    const key = token.normalize('NFKC').trim().toUpperCase();
    if (!key || /[\/\u0000-\u001f\u007f]/u.test(key)) return 'The route contains an identifier unsupported by the existing Routings viewer.';
    if (key !== 'SECONDARY' && ++segments > 100) return 'The route exceeds the existing Routings viewer limit of 100 segments.';
  }
  return null;
}
