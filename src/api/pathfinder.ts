import { z } from 'zod';
import { getApiBaseUrl } from './http';
import type { CanonicalPoint } from '../../viewer-runtime/protocol.mjs';
import { validateModelCaptureInputScope, type ModelCaptureInputScope } from '../../viewer-runtime/capture-input.mjs';
import { engineIdentitySchema } from '../../shared/pathfinderEngineIdentity';
import { policyHashSchema, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy';

const uuid = z.string().uuid(), revision = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const point = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const captureProvenance = z.object({ inputScope: z.custom<ModelCaptureInputScope>(value => validateModelCaptureInputScope(value)).optional() }).passthrough();
const match = z.object({ status: z.enum(['matched', 'missing', 'ambiguous', 'stale']), locationId: uuid.nullable(), candidates: z.array(z.string().max(2048)) });
const location = z.object({ id: uuid, name: z.string(), aliases: z.array(z.string()), revision,
  matching: z.object({ status: z.enum(['missing', 'ambiguous', 'unverified']), candidateObjectIds: z.array(z.string()) }).optional(),
  binding: z.object({ modelVersionId: uuid, revision, point, objectId: z.string().nullable(), externalId: z.string().nullable(), source: z.enum(['manual', 'automatic']), status: z.enum(['confirmed', 'stale']), derivation: z.enum(['manual-world-point', 'picked-surface-point', 'equipment-bottom-aabb']).optional(), coordinateFrame: z.literal('canonical-world-metres').optional() }).nullable() });
const numeric = z.union([z.string(), z.number().finite()]).nullable();
const jobSchema = z.object({ id: uuid, projectId: uuid, kind: z.enum(['calculate', 'lookup', 'preview']).optional(), status: z.enum(['queued', 'running', 'complete', 'cancelled', 'failed']), total: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), cancelRequested: z.boolean(), failure: z.string().nullable(), attempts: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string() });
const connectionGapSchema = z.string().max(64).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/).refine(value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 100);
const projectSettingsSchema = z.object({ revision, connectionGap: connectionGapSchema, secondaryTrayLength: z.string().nullable(), endConnectionLength: z.string().nullable(), additionalBendingPercent: z.string().nullable() });
const designSchema = z.object({ lengthBeforePercentageMeters: z.string(), unroundedLengthMeters: z.string(), designLengthMeters: z.string() });
const routingPreferencesSchema = z.object({ secondaryDistanceMeters: z.number().finite().min(0).max(1_000_000), preferVerticalApproach: z.boolean() });
const proposalProvenanceSchema = z.object({
  dependencyVersion: z.enum(['pathfinder.dependencies.v2', 'pathfinder.dependencies.v3', 'pathfinder.dependencies.v4', 'pathfinder.dependencies.v5']),
  dependencyHash: policyHashSchema, engineIdentity: engineIdentitySchema.nullable(),
  automatic: z.object({ generation: policyRevisionSchema, authorityEpoch: policyRevisionSchema, current: z.boolean(), reasonCode: z.string().min(1).max(96).nullable() }).strict().nullable(),
}).strict().superRefine((value, context) => {
  if ((value.dependencyVersion === 'pathfinder.dependencies.v5') !== (value.engineIdentity !== null)) context.addIssue({ code: 'custom', message: 'Engine implementation identity must agree with the dependency version.' });
});
const proposalSummarySchema = z.object({ schemaVersion: z.literal('wfc.pf.proposal.v2').optional(), provenance: proposalProvenanceSchema.optional(), id: uuid, projectId: uuid, jobId: uuid, cableId: uuid, status: z.string(), proposalHash: z.string().regex(/^[a-f0-9]{64}$/), cableWriteRevision: revision,
  stale: z.boolean(), synthetic: z.boolean(), engineeringAccepted: z.boolean(), acceptanceScope: z.string(), canApply: z.boolean(), compatibilityIssue: z.string().nullable(), message: z.string(), engineeringMessage: z.string(),
  design: designSchema.nullable(), route: z.unknown().nullable(), routingPreferences: routingPreferencesSchema.nullable(), createdAt: z.string(), calculationMode: z.enum(['calculate', 'design']).optional() });
const computedRouteSchema = z.object({ success: z.boolean(), message: z.string(), routeText: z.string(), routeCodes: z.array(z.string()), segmentIds: z.array(z.string()),
  points: z.array(point).max(200000), objectIds: z.array(z.string()).max(200000), lengthMeters: z.number().finite(), fromDistanceMeters: z.number().finite(), toDistanceMeters: z.number().finite(), fromRequiresSecondary: z.boolean(), toRequiresSecondary: z.boolean(), connectionGapCount: z.number().int().nonnegative(), connectionGapLengthMeters: z.number().finite() });
const proposalSchema = proposalSummarySchema.extend({ route: computedRouteSchema.nullable(), effectiveCategory: z.string().nullable().optional() });
const diagnosticCount = z.number().int().nonnegative().max(1_000_000).nullable();
const lookupPlanSchema = z.object({ routeCodes: z.array(z.string().min(2).max(256).regex(/^\/[A-Z0-9][A-Z0-9_.-]*$/).refine(value => value !== '/SECONDARY')).min(1).max(100), connectionGap: connectionGapSchema, selectionRevision: revision });
const lookupSchema = z.object({ id: uuid, projectId: uuid, kind: z.literal('lookup'), status: z.enum(['queued', 'running', 'complete', 'cancelled', 'failed']), total: z.literal(1), completed: z.number().int().min(0).max(1), createdAt: z.string(), updatedAt: z.string(), failure: z.string().nullable(),
  input: z.object({ routeText: z.string(), reverse: z.boolean() }), result: z.object({ status: z.string(), message: z.string(), route: computedRouteSchema.nullable(), design: z.null(), engineeringAccepted: z.literal(false), acceptanceScope: z.literal('diagnostic-lookup'), stale: z.boolean(), prepared: z.unknown(), connectionGap: connectionGapSchema,
    diagnostics: z.object({ geometryLeavesUsed: diagnosticCount, fallbackBends: diagnosticCount, fallbackStraights: diagnosticCount, fallbackClearances: diagnosticCount }) }).nullable() });
const endpointSchema = z.object({ name: z.string().max(500), point: point.optional() });
const categorySchema = z.enum(['MV', 'LV', 'Control', 'Instrumentation']);
const preferences = { secondaryDistanceMeters: z.number().finite().min(0).max(1_000_000).optional(), preferVerticalApproach: z.boolean().optional() };
const previewInputSchema = z.object({ from: endpointSchema, to: endpointSchema, category: categorySchema, reverse: z.boolean(), ...preferences,
  artifactId: uuid, expectedSelectionRevision: revision, expectedSettingsRevision: revision, expectedRegistryRevision: revision });
const resolvedEndpointSchema = z.object({ name: z.string(), point, source: z.enum(['manual-world-point', 'shared-location', 'equipment-bottom-aabb']), objectId: z.string().nullable(), locationId: uuid.nullable(), bindingRevision: revision.nullable() });
const previewSchema = z.object({ id: uuid, projectId: uuid, kind: z.literal('preview'), status: z.enum(['queued', 'running', 'complete', 'cancelled', 'failed']), total: z.literal(1), completed: z.number().int().min(0).max(1), cancelRequested: z.boolean(), createdAt: z.string(), updatedAt: z.string(), failure: z.string().nullable(),
  input: previewInputSchema, result: z.object({ status: z.string(), message: z.string(), route: computedRouteSchema.nullable(), design: designSchema.nullable(), prepared: z.unknown(), effectiveCategory: z.string().nullable(), settings: projectSettingsSchema,
    from: resolvedEndpointSchema, to: resolvedEndpointSchema, stale: z.boolean(), engineeringAccepted: z.literal(false), acceptanceScope: z.literal('standalone-preview'), canApply: z.literal(false) }).nullable() });
const cable = z.object({ id: uuid, cableId: z.number().int(), tag: z.string().nullable(), fromLocation: z.string().nullable(), toLocation: z.string().nullable(), mto: z.string().nullable(),
  routing: z.string().nullable(), designLength: numeric, installLength: numeric, cableWriteRevision: revision, fromMatch: match, toMatch: match });
const stateSchema = z.object({ schemaVersion: z.literal(1), projectId: uuid, registryRevision: revision,
  activeModel: z.object({ modelVersionId: uuid.nullable(), selectionRevision: revision, contentFingerprint: z.string().nullable() }),
  settings: projectSettingsSchema,
  cables: z.array(cable).max(100000), locations: z.array(location),
  artifacts: z.array(z.object({ id: uuid, modelVersionId: uuid, snapshotSha256: z.string(), objectCount: z.number().int(), engineeringAccepted: z.boolean(), readiness: z.string(), capture: captureProvenance, coordinates: z.record(z.unknown()), createdAt: z.string() })),
  jobs: z.array(jobSchema), proposals: z.array(proposalSummarySchema) });
export type PathFinderState = z.infer<typeof stateSchema>;
export type PathFinderLocation = z.infer<typeof location>;
export type PathFinderCable = z.infer<typeof cable>;
export type PathFinderProposal = z.infer<typeof proposalSchema>;
export type PathFinderJob = z.infer<typeof jobSchema> & { items?: { cableId: string; status: string; state: string; message: string | null }[] };
export type PathFinderLookup = z.infer<typeof lookupSchema>;
export type PathFinderLookupPlan = z.infer<typeof lookupPlanSchema>;
export type PathFinderPreview = z.infer<typeof previewSchema>;
export type PathFinderPreferences = { secondaryDistanceMeters: number; preferVerticalApproach: boolean };
export type PathFinderPreviewInput = Omit<z.infer<typeof previewInputSchema>, 'artifactId' | 'expectedSelectionRevision' | 'expectedSettingsRevision' | 'expectedRegistryRevision'>;
export class PathFinderApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code === 'PREVIEW_LOCATION_MISSING' ? 'A From/To name was not found. Choose a point or save a shared location, then calculate again.'
      : code === 'PREVIEW_LOCATION_AMBIGUOUS' ? 'A From/To name matches more than one object. Choose the intended point or save a shared location.'
      : code === 'PREVIEW_LOCATION_STALE' ? 'A shared From/To location needs confirmation against the active model.'
      : code === 'APPEARANCE_RESTORE_FAILED' ? 'Some viewer appearance could not be restored. Press Clear again, or reload the model.'
      : status === 401 ? 'Sign in again to use Path Finder.' : status === 403 ? 'Path Finder requires current administrator access.'
      : status === 409 ? 'The project changed. Refresh Path Finder and review the latest values before trying again.'
        : status === 413 ? 'This file or project exceeds the supported size. Use a bounded canonical snapshot.'
          : 'Path Finder could not complete the operation. Review the input and try again.');
  }
}
async function read(response: Response): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw new PathFinderApiError('INVALID_RESPONSE', 502);
  let size = 0; const chunks: Uint8Array[] = [];
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 32 * 1024 * 1024) throw new PathFinderApiError('RESPONSE_LIMIT', 413); chunks.push(chunk.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new PathFinderApiError('INVALID_RESPONSE', 502); }
}
export async function pathFinderRequest(projectId: string, token: string, path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!uuid.safeParse(projectId).success || !token || !/^\/(?:state|locations(?:\/[0-9a-f-]{36}(?:\/binding)?)?|artifacts|match|jobs(?:\/[0-9a-f-]{36})?|lookups(?:\/(?:plan|[0-9a-f-]{36}))?|previews(?:\/[0-9a-f-]{36})?|proposals(?:\/[0-9a-f-]{36}(?:\/(?:apply|review|reverse))?)?)$/.test(path)) throw new PathFinderApiError('INVALID_REQUEST', 400);
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder${path}`, { method, signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await read(response);
  if (!response.ok) throw new PathFinderApiError(value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' ? value.code : 'REQUEST_FAILED', response.status);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PathFinderApiError('INVALID_RESPONSE', 502);
  return value as Record<string, unknown>;
}
export async function fetchPathFinderState(projectId: string, token: string, signal?: AbortSignal): Promise<PathFinderState> {
  const value = stateSchema.safeParse(await pathFinderRequest(projectId, token, '/state', 'GET', undefined, signal));
  if (!value.success || value.data.projectId !== projectId) throw new PathFinderApiError('INVALID_RESPONSE', 502);
  return value.data;
}
export function parsePathFinderProposal(value: unknown): PathFinderProposal {
  const parsed = proposalSchema.safeParse(value); if (!parsed.success) throw new PathFinderApiError('INVALID_RESPONSE', 502); return parsed.data;
}
export async function fetchPathFinderProposal(projectId: string, token: string, proposalId: string, signal?: AbortSignal): Promise<PathFinderProposal> {
  const value = parsePathFinderProposal(await pathFinderRequest(projectId, token, `/proposals/${proposalId}`, 'GET', undefined, signal));
  if (value.projectId !== projectId || value.id !== proposalId) throw new PathFinderApiError('INVALID_RESPONSE', 502); return value;
}
export async function fetchPathFinderJob(projectId: string, token: string, jobId: string, signal?: AbortSignal): Promise<PathFinderJob> {
  const parsed = jobSchema.extend({ items: z.array(z.object({ cableId: uuid, status: z.string(), state: z.string(), message: z.string().nullable() })) }).safeParse(await pathFinderRequest(projectId, token, `/jobs/${jobId}`, 'GET', undefined, signal));
  if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.id !== jobId) throw new PathFinderApiError('INVALID_RESPONSE', 502); return parsed.data;
}
export async function fetchPathFinderLookup(projectId: string, token: string, jobId: string, signal?: AbortSignal): Promise<PathFinderLookup> {
  const parsed = lookupSchema.safeParse(await pathFinderRequest(projectId, token, `/lookups/${jobId}`, 'GET', undefined, signal));
  if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.id !== jobId) throw new PathFinderApiError('INVALID_RESPONSE', 502); return parsed.data;
}
export async function fetchPathFinderLookupPlan(projectId: string, token: string, routeText: string, expectedSelectionRevision: string, signal?: AbortSignal): Promise<PathFinderLookupPlan> {
  const parsed = lookupPlanSchema.safeParse(await pathFinderRequest(projectId, token, '/lookups/plan', 'POST', { routeText, expectedSelectionRevision }, signal));
  if (!parsed.success || parsed.data.selectionRevision !== expectedSelectionRevision || new Set(parsed.data.routeCodes).size !== parsed.data.routeCodes.length) throw new PathFinderApiError('INVALID_RESPONSE', 502);
  return parsed.data;
}
export async function fetchPathFinderPreview(projectId: string, token: string, jobId: string, signal?: AbortSignal): Promise<PathFinderPreview> {
  const parsed = previewSchema.safeParse(await pathFinderRequest(projectId, token, `/previews/${jobId}`, 'GET', undefined, signal));
  if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.id !== jobId) throw new PathFinderApiError('INVALID_RESPONSE', 502); return parsed.data;
}
export type PathFinderBindingInput = { modelVersionId: string; expectedSelectionRevision: string; expectedRegistryRevision: string; point: CanonicalPoint; objectId: string | null; externalId: string | null };
