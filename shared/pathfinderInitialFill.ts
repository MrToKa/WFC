import { z } from 'zod';
import { policyHashSchema as hash, policyRevisionSchema as revision, policyUuidSchema as uuid } from './pathfinderPurposePolicy.js';
import { endpointCurrentScopeSchema } from './pathfinderEndpointBindings.js';

export const INITIAL_FILL_LIMITS = Object.freeze({ cables: 10000, recordBytes: 1024 * 1024, authorityMilliseconds: 1800000 });
/** The exact ECMAScript String.trim whitespace set; a server-owned SQL btrim parameter, never caller input. */
export const INITIAL_FILL_ROUTING_WHITESPACE = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const timestamp = z.string().datetime().refine(value => value.endsWith('Z'));
export const initialFillPolicySchema = z.object({ mode: z.literal('when-both-empty') }).strict();
export type InitialFillPolicy = z.infer<typeof initialFillPolicySchema>;
export const initialFillMandateReferenceSchema = z.object({ id: uuid, contentSha256: hash, impactId: uuid, mode: z.literal('when-both-empty') }).strict();
export type InitialFillMandateReference = z.infer<typeof initialFillMandateReferenceSchema>;
export const initialFillMandateRecordSchema = z.object({ schemaVersion: z.literal('wfc.pf.initial-fill-mandate.v1'), id: uuid, projectId: uuid,
  impactId: uuid, impactContentSha256: hash, commandSha256: hash, idempotencyKey: uuid, mode: z.literal('when-both-empty'),
  actorId: uuid, actorAdminRevision: revision, loginId: uuid, loginExpiresAt: timestamp, authorityExpiresAt: timestamp, installationEpoch: uuid,
  current: endpointCurrentScopeSchema, eligibleCableIds: z.array(uuid).max(INITIAL_FILL_LIMITS.cables)
    .refine(values => values.every((value, at) => at === 0 || values[at - 1] < value)), createdAt: timestamp, contentSha256: hash }).strict().superRefine((value, context) => {
  if (Date.parse(value.authorityExpiresAt) > Date.parse(value.loginExpiresAt) || Date.parse(value.authorityExpiresAt) - Date.parse(value.createdAt) > INITIAL_FILL_LIMITS.authorityMilliseconds)
    context.addIssue({ code: 'custom', message: 'An initial-fill mandate cannot outlive its finite original login authority.' });
});
export type InitialFillMandate = z.infer<typeof initialFillMandateRecordSchema>;
export function initialFillMandateContentHashInput(value: InitialFillMandate) { const { contentSha256: _hash, ...body } = value; return body; }
export function initialFillMandateReference(value: InitialFillMandate): InitialFillMandateReference {
  return { id: value.id, contentSha256: value.contentSha256, impactId: value.impactId, mode: value.mode };
}
export const initialFillApplyRequestSchema = z.object({ schemaVersion: z.literal('wfc.pf.initial-fill-request.v1'), idempotencyKey: uuid,
  proposalId: uuid, expectedProposalHash: hash, mandateId: uuid, expectedCableWriteRevision: revision }).strict();
export type InitialFillApplyRequest = z.infer<typeof initialFillApplyRequestSchema>;
export function initialFillRequestHashInput(value: InitialFillApplyRequest) { return initialFillApplyRequestSchema.parse(value); }
export const initialFillProvenanceSchema = z.object({ schemaVersion: z.literal('pathfinder.initial-fill.v1'), validationMethod: z.literal('automatic-initial-fill'),
  nativeParity: z.literal('not-performed'), engineeringAccepted: z.literal(false), proposalId: uuid, proposalHash: hash,
  dependencies: z.unknown().refine(value => value !== null && typeof value === 'object' && !Array.isArray(value)),
  mandate: initialFillMandateReferenceSchema, request: initialFillApplyRequestSchema,
  revisionResult: z.object({ admissionId: uuid, revisionResultSha256: hash, baselineHash: hash, engineResultSha256: hash, ledgerHash: hash, dependencyHash: hash }).strict(),
  authorized: z.object({ actorId: uuid, loginId: uuid, installationEpoch: uuid, targetGeneration: revision, authorizedAt: timestamp }).strict() }).strict().refine(value =>
  value.request.proposalId === value.proposalId && value.request.expectedProposalHash === value.proposalHash && value.request.mandateId === value.mandate.id
  && BigInt(value.authorized.targetGeneration) > 0n);
export type InitialFillProvenance = z.infer<typeof initialFillProvenanceSchema>;
export const initialFillOutcomeSchema = z.enum(['written', 'already-written', 'review-required', 'stale', 'authority-expired', 'refused', 'unknown']);
