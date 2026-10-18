import { z } from 'zod';
import { revision, uuid } from './contracts.js';

export const optionsSchema = z.object({
  connectionToleranceMeters:z.number().finite().positive().max(100),sampleSpacingMeters:z.number().finite().positive().max(100),
  secondaryDistanceMeters:z.number().finite().min(0).max(1_000_000),preferVerticalApproach:z.boolean(),
  maxGraphNodes:z.number().int().min(2).max(1_000_000),maxGraphConnections:z.number().int().min(1).max(4_000_000),
}).strict();
export const defaultOptions = Object.freeze({connectionToleranceMeters:0.25,sampleSpacingMeters:0.125,secondaryDistanceMeters:2,preferVerticalApproach:true,maxGraphNodes:200_000,maxGraphConnections:1_000_000});
export const createJobSchema = z.object({cableIds:z.array(uuid).min(1).max(10_000).optional(),expectedRegistryRevision:revision,
  options:optionsSchema.optional(),timeoutMilliseconds:z.number().int().min(100).max(120_000).optional(),force:z.boolean().optional()}).strict();
export type EngineOptions = z.infer<typeof optionsSchema>;
export type ProjectSettings = {revision:string;connectionGap:string;secondaryTrayLength:string|null;endConnectionLength:string;additionalBendingPercent:string};
export type DependencySnapshot = {
  schemaVersion:'pathfinder.dependencies.v1';projectId:string;cableId:string;cableWriteRevision:string;
  cableInputs:{fromLocation:string|null;toLocation:string|null;mto:string|null;cableTypeId:string};
  registryRevision:string;model:{id:string;selectionRevision:string;contentFingerprint:string};
  artifact:{id:string;sha256:string};settings:ProjectSettings;options:EngineOptions;
  from:{locationId:string;bindingRevision:string;point:[number,number,number]};to:{locationId:string;bindingRevision:string;point:[number,number,number]};
  engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1';
};
const enginePoint = z.object({x:z.number().finite(),y:z.number().finite(),z:z.number().finite()}).strict();
export const routeSchema = z.object({success:z.boolean(),message:z.string().max(32768),routeText:z.string().max(1_000_000),
  routeCodes:z.array(z.string().max(2048)).max(200_000),segmentIds:z.array(z.string().max(256)).max(200_000),
  pathPoints:z.array(enginePoint).max(200_000),lengthMeters:z.number().finite().nonnegative(),fromDistanceMeters:z.number().finite().nonnegative(),
  toDistanceMeters:z.number().finite().nonnegative(),fromRequiresSecondary:z.boolean(),toRequiresSecondary:z.boolean(),
  connectionGapCount:z.number().int().nonnegative(),connectionGapLengthMeters:z.number().finite().nonnegative(),
}).strict();
const decimal = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/).max(100);
export const designSchema = z.object({lengthBeforePercentageMeters:decimal,unroundedLengthMeters:decimal,designLengthMeters:decimal}).strict();
export const engineResponseSchema = z.object({schemaVersion:z.literal('pathfinder.model.response.v1'),requestId:uuid,
  status:z.enum(['prepared','calculated','no_path','settings_required','category_required','model_needs_review','invalid_request','deadline_exceeded','resource_limit']),
  message:z.string().max(32768),engineeringAccepted:z.literal(false),model:z.unknown().optional(),prepared:z.unknown().optional(),
  effectiveCategory:z.string().nullable().optional(),route:routeSchema.optional(),design:designSchema.nullable().optional(),projectSettings:z.unknown().optional(),
}).strict();
export type EngineResponse = z.infer<typeof engineResponseSchema>;
export type EngineRoute = z.infer<typeof routeSchema>;
export type EngineDesign = z.infer<typeof designSchema>;
export type JobPrincipal = {userId:string;loginId:string;loginExpiresAt:number};
export const reviewSchema = z.object({expectedProposalHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const applySchema = z.object({idempotencyKey:uuid,reviewId:uuid,expectedCableWriteRevision:revision}).strict();
export const lookupSchema = z.object({routeText:z.string().min(1).max(8000).refine(value=>routeCompatibilityIssue(value)===null,'The route is outside existing Viewer identifier limits.'),
  reverse:z.boolean(),expectedSelectionRevision:revision,artifactId:uuid,options:optionsSchema.optional()}).strict();
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
