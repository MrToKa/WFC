import { z } from 'zod';
import { canonicalPurposeJson, policyHashSchema as hash, policyRevisionSchema as revision, policyUuidSchema as uuid } from './pathfinderPurposePolicy.js';

export const AUTOMATIC_PAIR_LIMITS = Object.freeze({ cables: 10000, recordBytes: 65536, receiptBytes: 262144,
  proofBytes: 32 * 1024 * 1024, lineage: 512, authorityMilliseconds: 1800000, attempts: 3, leaseMilliseconds: 60000 });
const timestamp = z.string().datetime().refine(value => value.endsWith('Z'));
export const automaticPairPolicySchema = z.object({ schemaVersion: z.literal('wfc.pf.automatic-pair-policy.v1'),
  mode: z.literal('when-both-empty-or-unchanged-automatic') }).strict();
export type AutomaticPairPolicy = z.infer<typeof automaticPairPolicySchema>;
/** Explicit output permission from one new finite current-login enable command. */
export const automaticGenerationAuthorizationSchema = z.object({
  schemaVersion: z.literal('wfc.pf.automatic-generation-output-authority.v1'), projectId: uuid,
  actorId: uuid, actorAdminRevision: revision, loginId: uuid, loginExpiresAt: timestamp, installationEpoch: uuid,
  commandKey: uuid, commandSha256: hash, controlRevision: revision, authorityEpoch: revision,
  createdAt: timestamp, authorityExpiresAt: timestamp, policy: automaticPairPolicySchema,
}).strict().refine(v => Date.parse(v.createdAt) < Date.parse(v.authorityExpiresAt)
  && Date.parse(v.authorityExpiresAt) <= Date.parse(v.loginExpiresAt)
  && Date.parse(v.authorityExpiresAt) - Date.parse(v.createdAt) <= AUTOMATIC_PAIR_LIMITS.authorityMilliseconds);
export type AutomaticGenerationAuthorization = z.infer<typeof automaticGenerationAuthorizationSchema>;
export const AUTOMATIC_PAIR_POLICY: Readonly<AutomaticPairPolicy> = Object.freeze({ schemaVersion: 'wfc.pf.automatic-pair-policy.v1',
  mode: 'when-both-empty-or-unchanged-automatic' });
export const automaticPairHistorySchema = z.object({ id: uuid, version: revision }).strict();
export type AutomaticPairHistory = z.infer<typeof automaticPairHistorySchema>;
export const automaticPairOwnershipSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }).strict(),
  z.object({ kind: z.literal('automatic'), originReceiptId: uuid, previousReceiptId: uuid, previousReceiptSha256: hash,
    afterCableWriteRevision: revision, history: automaticPairHistorySchema }).strict(),
]);
export type AutomaticPairOwnership = z.infer<typeof automaticPairOwnershipSchema>;
export const automaticPairSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('explicit-job') }).strict(),
  z.object({ kind: z.literal('location-impact'), impactId: uuid, createdAt: timestamp, authorityExpiresAt: timestamp }).strict(),
  z.object({ kind: z.literal('automatic-generation'), generation: revision, controlRevision: revision, authorityEpoch: revision,
    authorization: automaticGenerationAuthorizationSchema }).strict(),
]);
export type AutomaticPairSource = z.infer<typeof automaticPairSourceSchema>;
export const automaticPairMandateSchema = z.object({ schemaVersion: z.literal('wfc.pf.automatic-pair-mandate.v1'),
  id: uuid, projectId: uuid, jobId: uuid, cableId: uuid, actorId: uuid, actorAdminRevision: revision, loginId: uuid,
  loginExpiresAt: timestamp, authorityExpiresAt: timestamp, installationEpoch: uuid, createdAt: timestamp,
  policy: automaticPairPolicySchema, source: automaticPairSourceSchema, requestSha256: hash,
  dependencyHash: hash, cableWriteRevision: revision, baselineSha256: hash, ownership: automaticPairOwnershipSchema, contentSha256: hash,
}).strict().superRefine((value, ctx) => {
  const created = Date.parse(value.createdAt), expiry = Date.parse(value.authorityExpiresAt);
  if (expiry <= created || expiry > Date.parse(value.loginExpiresAt) || expiry - created > AUTOMATIC_PAIR_LIMITS.authorityMilliseconds
    || value.source.kind === 'location-impact' && (expiry > Date.parse(value.source.authorityExpiresAt) || created < Date.parse(value.source.createdAt))
    || value.source.kind === 'automatic-generation' && (expiry > Date.parse(value.source.authorization.authorityExpiresAt)
      || created < Date.parse(value.source.authorization.createdAt) || value.source.authorization.projectId !== value.projectId
      || value.source.authorization.actorId !== value.actorId || value.source.authorization.loginId !== value.loginId
      || value.source.authorization.loginExpiresAt !== value.loginExpiresAt || value.source.authorization.actorAdminRevision !== value.actorAdminRevision
      || value.source.authorization.installationEpoch !== value.installationEpoch
      || canonicalPurposeJson(value.source.authorization.policy) !== canonicalPurposeJson(value.policy))
    || value.ownership.kind === 'automatic' && value.ownership.afterCableWriteRevision !== value.cableWriteRevision)
    ctx.addIssue({ code: 'custom', message: 'Automatic pair authority is finite, exact and cannot renew an earlier location Save.' });
});
export type AutomaticPairMandate = z.infer<typeof automaticPairMandateSchema>;
export function automaticPairMandateHashInput(value: AutomaticPairMandate) { const { contentSha256: _hash, ...body } = value; return body; }
export const automaticPairWriteRequestSchema = z.object({ schemaVersion: z.literal('wfc.pf.automatic-pair-write.v1'),
  mandateId: uuid, mandateSha256: hash, projectId: uuid, jobId: uuid, cableId: uuid, proposalId: uuid,
  proposalHash: hash, expectedCableWriteRevision: revision, idempotencyKey: uuid }).strict();
export type AutomaticPairWriteRequest = z.infer<typeof automaticPairWriteRequestSchema>;
export const automaticPairProvenanceSchema = z.object({ schemaVersion: z.literal('pathfinder.automatic-pair.v1'),
  validationMethod: z.literal('automatic-owned-pair'), engineeringAccepted: z.literal(false), nativeParity: z.literal('not-performed'),
  request: automaticPairWriteRequestSchema, mandate: automaticPairMandateSchema, dependencies: z.unknown(), barrierEvidence: z.unknown(),
  revisionResult: z.object({ admissionId: uuid, revisionResultSha256: hash, baselineHash: hash, engineResultSha256: hash,
    ledgerHash: hash, dependencyHash: hash }).strict(), history: automaticPairHistorySchema,
  authorizedAt: timestamp }).strict().superRefine((value, ctx) => {
  const r = value.request, m = value.mandate;
  if (r.mandateId !== m.id || r.mandateSha256 !== m.contentSha256 || r.projectId !== m.projectId || r.jobId !== m.jobId
    || r.cableId !== m.cableId || r.expectedCableWriteRevision !== m.cableWriteRevision
    || Date.parse(value.authorizedAt) < Date.parse(m.createdAt) || Date.parse(value.authorizedAt) >= Date.parse(m.authorityExpiresAt)
    || value.revisionResult.dependencyHash !== m.dependencyHash)
    ctx.addIssue({ code: 'custom', message: 'The automatic write retains its exact original mandate and result.' });
});
export type AutomaticPairProvenance = z.infer<typeof automaticPairProvenanceSchema>;
/** A failed capacity-constrained search can withdraw only a previously automatic
 * pair. It never claims a successful geometry check or a length ledger. */
export const automaticPairCapacityClearProvenanceSchema = z.object({
  schemaVersion: z.literal('pathfinder.automatic-pair-capacity-clear.v1'),
  validationMethod: z.literal('automatic-owned-capacity-clear'), engineeringAccepted: z.literal(false), nativeParity: z.literal('not-performed'),
  request: automaticPairWriteRequestSchema, mandate: automaticPairMandateSchema, dependencies: z.unknown(), capacityEvidence: z.unknown(),
  revisionResult: z.object({ admissionId: uuid, revisionResultSha256: hash, baselineHash: hash, engineResultSha256: hash,
    ledgerHash: z.null(), dependencyHash: hash }).strict(), history: automaticPairHistorySchema, authorizedAt: timestamp,
}).strict().superRefine((value, ctx) => {
  const r = value.request, m = value.mandate;
  if (m.ownership.kind !== 'automatic' || r.mandateId !== m.id || r.mandateSha256 !== m.contentSha256 || r.projectId !== m.projectId
    || r.jobId !== m.jobId || r.cableId !== m.cableId || r.expectedCableWriteRevision !== m.cableWriteRevision
    || Date.parse(value.authorizedAt) < Date.parse(m.createdAt) || Date.parse(value.authorizedAt) >= Date.parse(m.authorityExpiresAt)
    || value.revisionResult.dependencyHash !== m.dependencyHash)
    ctx.addIssue({ code: 'custom', message: 'Capacity clearing requires the exact current automatic pair mandate and failed search.' });
});
export const automaticPairStatuses = ['pending', 'running', 'written', 'already-written', 'review-required', 'stale', 'authority-expired', 'refused', 'unknown'] as const;
export type AutomaticPairStatus = typeof automaticPairStatuses[number];
export type AutomaticPairOutcome = { status: AutomaticPairStatus; receiptId: string | null; code?: string };
export const sameAutomaticPairValue = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
