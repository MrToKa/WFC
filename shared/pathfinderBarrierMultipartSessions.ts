import { z } from 'zod';
import { policyHashSchema, policyRevisionSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';
import {
  BARRIER_MULTIPART_PROFILE, barrierMultipartCanonicalBytes, barrierMultipartPageSchema,
  barrierMultipartProfileSchema, barrierMultipartScopeSchema, barrierMultipartSealSchema,
} from './pathfinderBarrierMultipart.js';

/** Staging refusal bounds only. These do not qualify storage capacity, source
 * coverage, geometry, publication, routing, an empty registry or a cable write. */
export const BARRIER_MULTIPART_SESSION_LIMITS = Object.freeze({
  controlBytes: 65_536, pageBytes: 262_144, partBytes: 33_554_432,
  totalBytes: 8_589_934_592, totalFiles: 50_000,
  leaseMilliseconds: 180_000, jobMilliseconds: 3_600_000,
  listPageSize: 20, receiptPageSize: 100, qualification: 'NOT_MEASURED',
} as const);
const L = BARRIER_MULTIPART_SESSION_LIMITS;
const uuid = policyUuidSchema, hash = policyHashSchema, revision = policyRevisionSchema;
const count = (maximum = Number.MAX_SAFE_INTEGER) => z.number().int().min(0).max(maximum)
  .refine(value => !Object.is(value, -0), 'Control integers cannot be signed zero.');
const positive = (maximum = Number.MAX_SAFE_INTEGER) => count(maximum).refine(value => value > 0);
const timestamp = z.string().datetime();
const text = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    && [...value].every(character => character.length !== 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff));
const pageKind = z.enum(['nodes', 'fragments', 'geometry-ranges', 'plan']);
const unqualified = {
  qualification: z.literal('NOT_MEASURED'), geometryValidation: z.literal('NOT_VALIDATED'), authority: z.literal('none'),
};
function bounded(value: unknown, maximum: number, context: z.RefinementCtx): void {
  try {
    if (barrierMultipartCanonicalBytes(value).byteLength > maximum)
      context.addIssue({ code: 'custom', message: 'The staging control exceeds its encoded byte bound.' });
  } catch { context.addIssue({ code: 'custom', message: 'The staging control must be bounded canonical JSON.' }); }
}
const reservationRequest = z.object({ bytes: positive(L.totalBytes), files: positive(L.totalFiles) }).strict();
const labelSchema = z.object({ selectionId: uuid, name: text(512) }).strict();

/** Public input never selects an actor, login, filesystem path or server blob ID.
 * Labels are display metadata. Only the B13a scope carries parent identity. */
export const barrierMultipartAdmitCommandSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-admit.v2'), idempotencyKey: uuid,
  scope: barrierMultipartScopeSchema, profile: barrierMultipartProfileSchema,
  expectedRegistryRevision: revision,
  selectedParentLabels: z.array(labelSchema).min(1).max(BARRIER_MULTIPART_PROFILE.limits.selectedParents),
  reservation: reservationRequest,
}).strict().superRefine((value, context) => {
  if (value.selectedParentLabels.length !== value.scope.selectedParents.length
    || value.selectedParentLabels.some((label, index) => label.selectionId !== value.scope.selectedParents[index]?.selectionId))
    context.addIssue({ code: 'custom', message: 'Display labels must follow the exact selected-parent identities and order.' });
  bounded(value, L.controlBytes, context);
});

const stageBase = z.object({
  intentId: uuid, expectedSessionRevision: revision, idempotencyKey: uuid, scopeSha256: hash, profileSha256: hash,
}).strict();
export const barrierMultipartStagePageCommandSchema = stageBase.extend({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-stage-page.v2'), page: barrierMultipartPageSchema,
}).strict().superRefine((value, context) => {
  if (value.page.scopeSha256 !== value.scopeSha256 || value.page.profileSha256 !== value.profileSha256)
    context.addIssue({ code: 'custom', message: 'A staged page must retain the admitted scope and profile roots.' });
  // The file contains only the canonical page. Its bounded command wrapper is separate.
  bounded(value, L.pageBytes + L.controlBytes, context);
});
export const barrierMultipartStageSealCommandSchema = stageBase.extend({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-stage-seal.v2'), seal: barrierMultipartSealSchema,
}).strict().superRefine((value, context) => {
  if (value.seal.scopeSha256 !== value.scopeSha256 || value.seal.profileSha256 !== value.profileSha256)
    context.addIssue({ code: 'custom', message: 'A staged seal must retain the admitted scope and profile roots.' });
  bounded(value, L.controlBytes, context);
});
export const barrierMultipartStagePartCommandSchema = stageBase.extend({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-stage-part.v2'),
  partIndex: count(BARRIER_MULTIPART_PROFILE.limits.parts - 1), planSealSha256: hash,
  payload: z.object({ sha256: hash, bytes: positive(L.partBytes) }).strict(),
}).strict().superRefine((value, context) => bounded(value, L.controlBytes, context));
export const barrierMultipartCancelCommandSchema = stageBase.extend({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-cancel.v2'), reason: text(512),
}).strict().superRefine((value, context) => bounded(value, L.controlBytes, context));
export const barrierMultipartStageCommandSchema = z.union([
  barrierMultipartStagePageCommandSchema, barrierMultipartStageSealCommandSchema, barrierMultipartStagePartCommandSchema,
]);
export const barrierMultipartMutationCommandSchema = z.union([
  barrierMultipartAdmitCommandSchema, barrierMultipartStagePageCommandSchema,
  barrierMultipartStageSealCommandSchema, barrierMultipartStagePartCommandSchema, barrierMultipartCancelCommandSchema,
]);

/** Server response only. A parsed reference is not evidence that storage I/O or
 * directory durability was actually completed. Repository/storage must prove it. */
export const barrierMultipartStoredBlobSchema = z.object({
  blobId: uuid, sha256: hash, bytes: positive(L.partBytes), durability: z.literal('file-and-directory-fsynced'),
}).strict();
export const barrierMultipartRootsSchema = z.object({
  nodes: hash.nullable(), fragments: hash.nullable(), 'geometry-ranges': hash.nullable(), plan: hash.nullable(),
}).strict();
export const barrierMultipartSessionSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-session.v2'), id: uuid, projectId: uuid,
  state: z.enum(['admitted', 'staging', 'cancelled']), sessionRevision: revision,
  principal: z.object({ kind: z.literal('current-login-admin'), actorId: uuid, loginId: uuid }).strict(),
  command: barrierMultipartAdmitCommandSchema, requestSha256: hash, scopeSha256: hash, profileSha256: hash,
  createdAt: timestamp, updatedAt: timestamp, jobDeadline: timestamp, leaseDeadline: timestamp.nullable(),
  reservation: reservationRequest.extend({ chargedBytes: count(L.totalBytes), chargedFiles: count(L.totalFiles) }).strict(),
  counts: z.object({ pages: count(L.totalFiles), seals: count(4), parts: count(L.totalFiles) }).strict(),
  roots: barrierMultipartRootsSchema, ...unqualified,
}).strict().superRefine((value, context) => {
  const created = Date.parse(value.createdAt), updated = Date.parse(value.updatedAt), deadline = Date.parse(value.jobDeadline);
  if (value.projectId !== value.command.scope.modelScope.projectId || updated < created || deadline <= created
    || deadline - created > L.jobMilliseconds || value.leaseDeadline !== null
      && (Date.parse(value.leaseDeadline) <= created || Date.parse(value.leaseDeadline) > deadline))
    context.addIssue({ code: 'custom', message: 'A server session must retain its exact project and finite admitted deadlines.' });
  if (value.reservation.bytes !== value.command.reservation.bytes || value.reservation.files !== value.command.reservation.files
    || value.reservation.chargedBytes > value.reservation.bytes || value.reservation.chargedFiles > value.reservation.files
    || 2 * (value.counts.pages + value.counts.seals + value.counts.parts) > value.reservation.chargedFiles)
    context.addIssue({ code: 'custom', message: 'Staged receipts must remain within permanently charged temp/final capacity.' });
  if (Object.values(value.roots).filter(root => root !== null).length !== value.counts.seals)
    context.addIssue({ code: 'custom', message: 'A seal root is bound once for each receipted stream seal.' });
  // No freshness decision depends on Date.now() here: expired retained sessions remain readable.
});
export const barrierMultipartAdmitReceiptSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-admit-receipt.v2'), session: barrierMultipartSessionSchema, duplicate: z.boolean(),
}).strict();
const receiptBase = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-stage-receipt.v2'), intentId: uuid, sessionRevision: revision,
  commandSha256: hash, scopeSha256: hash, profileSha256: hash, stored: barrierMultipartStoredBlobSchema,
  duplicate: z.boolean(), ...unqualified,
}).strict();
export const barrierMultipartPageReceiptSchema = receiptBase.extend({
  kind: z.literal('page'), pageKind, index: count(BARRIER_MULTIPART_PROFILE.limits.pages - 1),
  firstOrdinal: count(BARRIER_MULTIPART_PROFILE.limits.ranges - 1),
  recordCount: positive(BARRIER_MULTIPART_PROFILE.limits.pageRecords), previousPageSha256: hash.nullable(), pageSha256: hash,
}).strict().superRefine((value, context) => {
  if (value.stored.bytes > L.pageBytes || (value.index === 0
    ? value.firstOrdinal !== 0 || value.previousPageSha256 !== null : value.firstOrdinal === 0 || value.previousPageSha256 === null))
    context.addIssue({ code: 'custom', message: 'A page receipt needs bounded canonical bytes and its exact stream predecessor.' });
});
export const barrierMultipartSealReceiptSchema = receiptBase.extend({
  kind: z.literal('seal'), sealKind: pageKind, sealSha256: hash,
  pageCount: positive(BARRIER_MULTIPART_PROFILE.limits.pages), recordCount: positive(BARRIER_MULTIPART_PROFILE.limits.ranges),
  tailPageSha256: hash,
}).strict().superRefine((value, context) => {
  if (value.stored.bytes > L.pageBytes || value.pageCount > value.recordCount
    || value.recordCount > value.pageCount * BARRIER_MULTIPART_PROFILE.limits.pageRecords)
    context.addIssue({ code: 'custom', message: 'A stream seal receipt must retain bounded nonempty page accounting.' });
});
export const barrierMultipartPartReceiptSchema = receiptBase.extend({
  kind: z.literal('part'), partIndex: count(BARRIER_MULTIPART_PROFILE.limits.parts - 1), planSealSha256: hash,
}).strict();
export const barrierMultipartStageReceiptSchema = z.union([
  barrierMultipartPageReceiptSchema, barrierMultipartSealReceiptSchema, barrierMultipartPartReceiptSchema,
]);
export const barrierMultipartCancelReceiptSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-cancel-receipt.v2'), session: barrierMultipartSessionSchema,
  commandSha256: hash, duplicate: z.boolean(),
}).strict().refine(value => value.session.state === 'cancelled', 'A cancellation receipt retains the cancelled session and its charges.');

/** Only the repository's current principal supplies ownership. Cursor input
 * cannot choose another actor/login or change the retained scope. */
export const barrierMultipartReadSessionQuerySchema = z.object({ intentId: uuid }).strict();
export const barrierMultipartListQuerySchema = z.object({ cursor: count(L.totalFiles), limit: positive(L.listPageSize) }).strict();
export const barrierMultipartReceiptQuerySchema = z.object({ intentId: uuid, cursor: count(L.totalFiles), limit: positive(L.receiptPageSize) }).strict();
export const barrierMultipartReconcileCommandSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-reconcile.v2'), intentId: uuid, idempotencyKey: uuid, commandSha256: hash,
}).strict();
export const barrierMultipartSessionListSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-session-list.v2'), sessions: z.array(barrierMultipartSessionSchema).max(L.listPageSize),
  nextCursor: count(L.totalFiles).nullable(),
}).strict();
export const barrierMultipartReceiptPageSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-receipt-page.v2'), intentId: uuid,
  receipts: z.array(barrierMultipartStageReceiptSchema).max(L.receiptPageSize), nextCursor: count(L.totalFiles).nullable(),
}).strict().superRefine((value, context) => {
  if (value.receipts.some(receipt => receipt.intentId !== value.intentId))
    context.addIssue({ code: 'custom', message: 'Receipt pages cannot contain a different session.' });
  bounded(value, L.pageBytes, context);
});

/** Pure canonical command identity only; no SQL/storage/currentness authority. */
export function barrierMultipartSessionCommandHashInput(value: unknown): unknown {
  return { domain: 'wfc.pf.barrier-multipart-session.v2/command', value: barrierMultipartMutationCommandSchema.parse(value) };
}

export type BarrierMultipartAdmitCommand = z.infer<typeof barrierMultipartAdmitCommandSchema>;
export type BarrierMultipartStagePageCommand = z.infer<typeof barrierMultipartStagePageCommandSchema>;
export type BarrierMultipartStageSealCommand = z.infer<typeof barrierMultipartStageSealCommandSchema>;
export type BarrierMultipartStagePartCommand = z.infer<typeof barrierMultipartStagePartCommandSchema>;
export type BarrierMultipartStageCommand = z.infer<typeof barrierMultipartStageCommandSchema>;
export type BarrierMultipartCancelCommand = z.infer<typeof barrierMultipartCancelCommandSchema>;
export type BarrierMultipartStoredBlob = z.infer<typeof barrierMultipartStoredBlobSchema>;
export type BarrierMultipartSession = z.infer<typeof barrierMultipartSessionSchema>;
export type BarrierMultipartAdmitReceipt = z.infer<typeof barrierMultipartAdmitReceiptSchema>;
export type BarrierMultipartStageReceipt = z.infer<typeof barrierMultipartStageReceiptSchema>;
export type BarrierMultipartCancelReceipt = z.infer<typeof barrierMultipartCancelReceiptSchema>;
export type BarrierMultipartSessionList = z.infer<typeof barrierMultipartSessionListSchema>;
export type BarrierMultipartReceiptPage = z.infer<typeof barrierMultipartReceiptPageSchema>;
