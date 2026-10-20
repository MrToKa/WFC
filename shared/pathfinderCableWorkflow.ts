import { z } from 'zod';
import { calculationAvailabilitySchema, type CalculationAvailability } from './pathfinderCalculationAvailability.js';
import { policyHashSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';
import { revisionCableSnapshotSchema } from './pathfinderRevisionResults.js';
import { recalculationReasonSchema } from './pathfinderRecalculation.js';
import { sealedCableItemApplicabilitySchema } from './pathfinderItemApplicability.js';

export const CABLE_WORKFLOW_LIMITS = Object.freeze({ pageSize: 100, maxScan: 200, cursorCharacters: 512, reasonCodes: 64 });
export const cableWorkflowStatusSchema = z.enum(['needs-routing', 'calculating', 'ready-for-review', 'up-to-date', 'excluded', 'blocked']);
export type CableWorkflowStatus = z.infer<typeof cableWorkflowStatusSchema>;
export type CableWorkflowDecision = { status: CableWorkflowStatus; reasonCodes: string[] };
export type CableInitialFillInput = { mto: unknown; routing: unknown; designLength: unknown };
export type CableInitialFillDecision = { mode: 'initial-fill-candidate' | 'manual-review' | 'excluded' | 'blocked'; reasonCodes: string[] };
export type CableCategoryDecision = { status: 'eligible' | 'excluded' | 'blocked'; routingCategory: 'LV' | 'Control' | null; reasonCodes: string[] };

/** Display classification only; Instrumentation uses Control without changing the stored cable category. */
export function classifyCableCategory(mto: unknown): CableCategoryDecision {
  if (mto === 'MV') return { status: 'excluded', routingCategory: null, reasonCodes: ['MV_EXCLUDED'] };
  if (mto === 'LV') return { status: 'eligible', routingCategory: 'LV', reasonCodes: [] };
  if (mto === 'Control' || mto === 'Instrumentation') return { status: 'eligible', routingCategory: 'Control', reasonCodes: [] };
  return { status: 'blocked', routingCategory: null, reasonCodes: ['CABLE_CATEGORY_REQUIRED'] };
}

/**
 * A candidate is never write authorization. The server must retain a separate
 * initial-fill mandate from the current administrator login and atomically
 * recheck BOTH blank fields, cableWriteRevision, model and every dependency.
 * This helper grants neither Review/Apply nor a calculation-only grant writes.
 */
export function classifyCableInitialFill(input: CableInitialFillInput): CableInitialFillDecision {
  const category = classifyCableCategory(input.mto);
  if (category.status !== 'eligible') return { mode: category.status, reasonCodes: category.reasonCodes };
  if (input.routing !== null && typeof input.routing !== 'string')
    return { mode: 'blocked', reasonCodes: ['CURRENT_ROUTING_INVALID'] };
  if (input.designLength === undefined || input.designLength !== null && typeof input.designLength !== 'string' && typeof input.designLength !== 'number'
    || typeof input.designLength === 'number' && !Number.isFinite(input.designLength))
    return { mode: 'blocked', reasonCodes: ['CURRENT_DESIGN_LENGTH_INVALID'] };
  const routeBlank = input.routing === null || input.routing.trim().length === 0;
  if (routeBlank && input.designLength === null) return { mode: 'initial-fill-candidate', reasonCodes: [] };
  // In particular 0 and even a legacy empty string are defined lengths, not NULL.
  return { mode: 'manual-review', reasonCodes: [
    ...(!routeBlank ? ['EXISTING_ROUTING_REQUIRES_REVIEW'] : []),
    ...(input.designLength !== null ? ['EXISTING_DESIGN_LENGTH_REQUIRES_REVIEW'] : []),
  ] };
}

export type CableEndpointDecision = {
  status: 'ready' | 'needs-resolution' | 'not-evaluated' | 'blocked';
  evidence: CalculationAvailability | null;
  reasonCodes: string[];
};
/** Missing means actual evaluated evidence, never an absent or malformed response. */
export function classifyCableEndpoint(value: unknown): CableEndpointDecision {
  const parsed = calculationAvailabilitySchema.safeParse(value);
  if (!parsed.success) return { status: 'not-evaluated', evidence: null, reasonCodes: ['AVAILABILITY_NOT_EVALUATED'] };
  const evidence = parsed.data;
  if (evidence.pointAvailable) return { status: 'ready', evidence, reasonCodes: [] };
  const reasonCodes = [evidence.reasonCode!];
  if (evidence.status === 'not-evaluated') return { status: 'not-evaluated', evidence, reasonCodes };
  if (evidence.status === 'preparation-required') return { status: 'blocked', evidence, reasonCodes };
  return { status: 'needs-resolution', evidence, reasonCodes };
}

/** Job progress and outcome remain separate from endpoint availability and human approval. */
export const cableWorkflowCalculationSchema = z.object({
  jobId: policyUuidSchema.nullable(),
  jobStatus: z.enum(['queued', 'running', 'complete', 'cancelled', 'failed']).nullable(),
  itemState: z.enum(['waiting', 'running', 'complete', 'blocked']).nullable(),
  outcome: z.enum(['not-evaluated', 'calculated', 'no-path', 'locations-required', 'settings-required', 'category-required', 'model-required', 'stale', 'failed', 'resource-limit', 'deadline-exceeded']),
  reasonCodes: z.array(recalculationReasonSchema).max(CABLE_WORKFLOW_LIMITS.reasonCodes).refine(values => new Set(values).size === values.length),
  errorCode: recalculationReasonSchema.nullable(),
  currentness: z.enum(['current', 'changed', 'unavailable', 'not-evaluated']),
  proposalId: policyUuidSchema.nullable(),
  proposalHash: policyHashSchema.nullable(),
  reviewable: z.boolean(),
  acceptedMatchesCurrent: z.boolean(),
  itemApplicability:sealedCableItemApplicabilitySchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if ((value.jobId === null) !== (value.jobStatus === null)
    || (value.proposalId === null) !== (value.proposalHash === null)
    || value.proposalId !== null && value.jobId === null
    || value.itemState !== null && value.jobId === null)
    context.addIssue({ code: 'custom', message: 'Job and proposal references must retain their exact identities.' });
  if (value.jobStatus === 'complete' && (value.itemState === 'waiting' || value.itemState === 'running'))
    context.addIssue({ code: 'custom', message: 'A complete job cannot contain a pending or running item.' });
  if ((value.itemState === 'waiting' || value.itemState === 'running') && value.outcome !== 'not-evaluated')
    context.addIssue({ code: 'custom', message: 'An active cable item cannot already carry a completed or blocked outcome.' });
  if (value.outcome === 'calculated' && value.itemState !== 'complete')
    context.addIssue({ code: 'custom', message: 'A calculated outcome belongs to a completed cable item.' });
  if (value.reviewable && ((value.jobStatus !== 'complete' && !(value.itemApplicability && ['queued','running'].includes(value.jobStatus??''))) || value.itemState !== 'complete' || value.outcome !== 'calculated'
    || value.currentness !== 'current' || value.proposalId === null))
    context.addIssue({ code: 'custom', message: 'Reviewable display evidence needs a completed current proposal.' });
  if(value.itemApplicability && (value.itemApplicability.jobId!==value.jobId||value.itemApplicability.proposalId!==value.proposalId))
    context.addIssue({code:'custom',message:'Sealed item evidence belongs to the exact job and proposal.'});
  if (value.acceptedMatchesCurrent && value.currentness !== 'current')
    context.addIssue({ code: 'custom', message: 'An up-to-date display requires current accepted-result evidence.' });
});
export const cableWorkflowRowSchema = z.object({
  projectId: policyUuidSchema,
  cable: revisionCableSnapshotSchema,
  mto: z.string().max(96).nullable(),
  from: calculationAvailabilitySchema,
  to: calculationAvailabilitySchema,
  calculation: cableWorkflowCalculationSchema,
}).strict().superRefine((value, context) => {
  if(value.calculation.itemApplicability && (value.calculation.itemApplicability.projectId!==value.projectId||value.calculation.itemApplicability.cableId!==value.cable.id))
    context.addIssue({code:'custom',message:'Sealed item evidence belongs to the exact project and cable.'});
  if ((value.calculation.reviewable || value.calculation.acceptedMatchesCurrent) && (!value.from.pointAvailable || !value.to.pointAvailable))
    context.addIssue({ code: 'custom', message: 'Current results require evaluated available endpoint evidence.' });
  if (value.calculation.acceptedMatchesCurrent && (!value.cable.routing?.trim() || value.cable.designLength === null))
    context.addIssue({ code: 'custom', message: 'Up-to-date evidence requires both current cable values to be present.' });
});
/**
 * A bounded filtered scan may return zero matches with a continuation cursor.
 * The server binds that opaque cursor to project/query/context and enforces
 * strict scan advancement. A client has reached the end only at nextCursor=null.
 * Stop at the 100th match; advancing beyond it would consume omitted matches.
 */
export const cableWorkflowPageSchema = z.object({
  schemaVersion: z.literal('wfc.pf.cable-workflow-page.v1'),
  projectId: policyUuidSchema,
  querySha256: policyHashSchema,
  contextSha256: policyHashSchema,
  scannedCount: z.number().int().min(0).max(CABLE_WORKFLOW_LIMITS.maxScan),
  scannedThroughCableId: policyUuidSchema.nullable(),
  rows: z.array(cableWorkflowRowSchema).max(CABLE_WORKFLOW_LIMITS.pageSize),
  nextCursor: z.string().min(1).max(CABLE_WORKFLOW_LIMITS.cursorCharacters).regex(/^[A-Za-z0-9_-]+$(?![\s\S])/).nullable(),
}).strict().superRefine((value, context) => {
  if (value.rows.length > value.scannedCount
    || value.rows.some((row, index) => row.projectId !== value.projectId
      || index > 0 && value.rows[index - 1].cable.id >= row.cable.id
      || value.scannedThroughCableId === null || row.cable.id > value.scannedThroughCableId))
    context.addIssue({ code: 'custom', message: 'A page contains only ordered unique owned matches within its bounded scan.' });
  if (value.scannedCount === 0 ? value.scannedThroughCableId !== null || value.rows.length !== 0 || value.nextCursor !== null
    : value.scannedThroughCableId === null)
    context.addIssue({ code: 'custom', message: 'A nonempty scan retains its boundary; zero scans cannot claim continuation or matches.' });
  if (value.rows.length === CABLE_WORKFLOW_LIMITS.pageSize && value.scannedThroughCableId !== value.rows.at(-1)?.cable.id)
    context.addIssue({ code: 'custom', message: 'A full matching page stops at its 100th match without consuming later matches.' });
});
export type CableWorkflowCalculation = z.infer<typeof cableWorkflowCalculationSchema>;
export type CableWorkflowRow = z.infer<typeof cableWorkflowRowSchema>;
export type CableWorkflowPage = z.infer<typeof cableWorkflowPageSchema>;

/** Display only: no status, including ready-for-review/up-to-date, permits a write. */
export function classifyCableWorkflow(input: unknown): CableWorkflowDecision {
  const parsed = cableWorkflowRowSchema.safeParse(input);
  if (!parsed.success) return { status: 'blocked', reasonCodes: ['WORKFLOW_EVIDENCE_UNAVAILABLE'] };
  const row = parsed.data, category = classifyCableCategory(row.mto);
  if (category.status !== 'eligible') return { status: category.status, reasonCodes: category.reasonCodes };
  const calculation = row.calculation;
  const reasons = (...codes: string[]) => [...new Set([...calculation.reasonCodes, ...(calculation.errorCode ? [calculation.errorCode] : []), ...codes])];
  if (calculation.jobStatus === 'cancelled' || calculation.jobStatus === 'failed')
    return { status: 'blocked', reasonCodes: reasons(calculation.jobStatus === 'cancelled' ? 'CALCULATION_CANCELLED' : 'CALCULATION_FAILED') };
  const activeJob = calculation.jobStatus === 'queued' || calculation.jobStatus === 'running';
  if (activeJob && (calculation.itemState === 'waiting' || calculation.itemState === 'running'))
    return { status: 'calculating', reasonCodes: reasons(calculation.jobStatus === 'queued' || calculation.itemState === 'waiting' ? 'CALCULATION_QUEUED' : 'CALCULATION_RUNNING') };
  const blockedOutcomes: Partial<Record<CableWorkflowCalculation['outcome'], string>> = {
    'settings-required': 'SETTINGS_REQUIRED', 'category-required': 'CABLE_CATEGORY_REQUIRED',
    'model-required': 'MODEL_REQUIRED', 'resource-limit': 'CALCULATION_RESOURCE_LIMIT',
    'deadline-exceeded': 'CALCULATION_DEADLINE_EXCEEDED', failed: 'CALCULATION_FAILED',
  };
  const blockedOutcome = blockedOutcomes[calculation.outcome];
  if (blockedOutcome) return { status: 'blocked', reasonCodes: reasons(blockedOutcome) };
  if (calculation.acceptedMatchesCurrent) return { status: 'up-to-date', reasonCodes: reasons() };
  if (calculation.reviewable) return { status: 'ready-for-review', reasonCodes: reasons() };
  const endpoints = [classifyCableEndpoint(row.from), classifyCableEndpoint(row.to)];
  if (endpoints.some(endpoint => endpoint.status === 'not-evaluated' || endpoint.status === 'blocked'))
    return { status: 'blocked', reasonCodes: reasons(...endpoints.flatMap(endpoint => endpoint.reasonCodes)) };
  if (endpoints.some(endpoint => endpoint.status === 'needs-resolution'))
    return { status: 'needs-routing', reasonCodes: reasons(...endpoints.flatMap(endpoint => endpoint.reasonCodes)) };
  if (calculation.currentness === 'unavailable') return { status: 'blocked', reasonCodes: reasons('CALCULATION_CURRENTNESS_UNAVAILABLE') };
  if (calculation.currentness === 'changed' || calculation.outcome === 'stale')
    return { status: 'needs-routing', reasonCodes: reasons('CALCULATION_STALE') };
  // U0 retains the existing whole-job Review gate, even if this item finished.
  if (activeJob && calculation.itemState === 'complete' && calculation.outcome === 'calculated')
    return { status: 'blocked', reasonCodes: reasons('CALCULATED_AWAITING_JOB_COMPLETION') };
  if (calculation.outcome === 'no-path') return { status: 'needs-routing', reasonCodes: reasons('NO_PATH') };
  if (calculation.outcome === 'locations-required') return { status: 'needs-routing', reasonCodes: reasons('LOCATIONS_REQUIRED') };
  if (calculation.jobId === null && calculation.outcome === 'not-evaluated')
    return { status: 'needs-routing', reasonCodes: reasons('CALCULATION_NOT_REQUESTED') };
  return { status: 'blocked', reasonCodes: reasons(calculation.outcome === 'calculated' ? 'PROPOSAL_NOT_REVIEWABLE'
    : calculation.itemState === null ? 'CALCULATION_ITEM_NOT_EVALUATED' : 'CALCULATION_NOT_READY') };
}
