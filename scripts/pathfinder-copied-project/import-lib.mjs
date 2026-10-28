import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const IMPORT_LIMITS = Object.freeze({ jsonBytes: 4 * 1024 ** 2, responseBytes: 2 * 1024 ** 2, sqlRows: 5, polls: 1800, pollMilliseconds: 500, uploadMilliseconds: 900000, totalMilliseconds: 1800000, requestMilliseconds: 30000, processMilliseconds: 35000, journalEvents: 4096, journalBytes: 128 * 1024 ** 2 });
export const IMPORT_PINS = Object.freeze({ sourceSnapshotSha256: '0a84d1327950d4bd1d8420661f526cf1c97fdec5dbaaca71c429bf3e0c3bd897', sourceReceiptSha256: 'a1c9e90a2c48e9da4d619cc3a4d5a90c1a9c2ae2c4b91fc99c9d396f5aba2c02', sourceProjectId: '0c0007c9-d73f-4d13-bc87-601c544727b7', fingerprint: 'b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34', archiveBytes: 439112840, archiveSha256: 'e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922', owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46', project: 'wfc-pathfinder-local-0cba87606e9b', port: 5191, apiImage: 'sha256:dce12a1f5ab6311bbaf04defb7277ff0d50fee36e29e49d47234e5bf4ea405fe', webImage: 'sha256:561d51c3dd5ecb88459c17013890f9cd30089bb0760ccb9c5ff0ec3ade39f285' });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/, ID = /^[a-f0-9]{64}$/;
const description = 'Isolated engineering review copy. Original cable routes and lengths were not copied. Calculated proposals require manual review.';
export const digest = value => createHash('sha256').update(value instanceof Uint8Array || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const refuse = code => { throw Object.assign(new Error(code), { code }); };
const need = (value, code) => { if (!value) refuse(code); };
const decimal = value => { need(typeof value === 'string' && value.length <= 128 && /^\d+(?:\.\d+)?$/.test(value), 'IMPORT_DETAILS_INVALID'); const [integer, fraction = ''] = value.split('.'); return (integer.replace(/^0+(?=\d)/, '') || '0') + (fraction.replace(/0+$/, '') ? '.' + fraction.replace(/0+$/, '') : ''); };
const sameDecimal = (a, b) => a === null || b === null ? a === b : decimal(a) === decimal(b);
const relativePrivate = value => typeof value === 'string' && /^pathfinder-engine\/\.scratch\/[A-Za-z0-9_.\/-]+$/.test(value) && !value.split('/').includes('..') && !value.includes('//');
const integer = (v, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const textInteger = value => typeof value === 'string' && /^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value));
const parse = bytes => { need(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= IMPORT_LIMITS.jsonBytes, 'IMPORT_INPUT_BYTES'); try { return JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { refuse('IMPORT_INPUT_JSON'); } };
const pinned = (bytes, sha) => { need(HASH.test(sha ?? '') && digest(bytes) === sha, 'IMPORT_INPUT_PIN'); return parse(bytes); };

/** Accepts private bytes, returns only the immutable import authority/provenance projection. */
export function validateImportInputs({ planBytes, planSha256, receiptBytes, receiptSha256, sourceBytes, sourceReceiptBytes, archiveReport, actorId }, { pins = IMPORT_PINS } = {}) {
  const plan = pinned(planBytes, planSha256), receipt = pinned(receiptBytes, receiptSha256), source = pinned(sourceBytes, pins.sourceSnapshotSha256), sourceReceipt = pinned(sourceReceiptBytes, pins.sourceReceiptSha256);
  need(plan.schemaVersion === 'pathfinder.copied-project.seed-plan.v1' && UUID.test(plan.id ?? '') && plan.target && plan.source && plan.newProject, 'IMPORT_PLAN_SCHEMA');
  need(receipt.schemaVersion === 'pathfinder.copied-project.seed-receipt.v1' && receipt.status === 'PASS' && receipt.syntheticMarker === false && ['created', 'already_seeded'].includes(receipt.operation), 'IMPORT_SEED_NOT_VERIFIED');
  need(receipt.plan?.sha256 === planSha256 && receipt.plan.bytes === planBytes.length && relativePrivate(receipt.plan.path) && receipt.projectId === plan.newProject.id && isDeepStrictEqual(receipt.counts, { projects: 1, types: 50, cables: 2140, selections: 1, pathfinderStates: 1 }), 'IMPORT_SEED_PLAN_LINK');
  need(receipt.source?.snapshotSha256 === pins.sourceSnapshotSha256 && receipt.source.receiptSha256 === pins.sourceReceiptSha256, 'IMPORT_SEED_SOURCE_LINK');
  need(plan.target.owner === pins.owner && plan.target.project === pins.project && plan.target.port === pins.port && plan.target.apiImage === pins.apiImage && plan.target.webImage === pins.webImage && relativePrivate(plan.target.runtime), 'IMPORT_TARGET_REFUSED');
  need(receipt.target?.owner === plan.target.owner && receipt.target.project === plan.target.project && receipt.target.port === 5191 && receipt.target.apiImage === plan.target.apiImage && receipt.target.webImage === plan.target.webImage, 'IMPORT_RECEIPT_TARGET');
  need(plan.source.snapshot?.sha256 === pins.sourceSnapshotSha256 && plan.source.snapshot.bytes === sourceBytes.length && plan.source.receipt?.sha256 === pins.sourceReceiptSha256 && plan.source.projectId === pins.sourceProjectId && plan.source.contentFingerprint === pins.fingerprint, 'IMPORT_PLAN_SOURCE_LINK');
  need(source.schemaVersion === 'pathfinder.current-inputs.snapshot.v1' && source.project?.id === plan.source.projectId && source.model?.id === plan.source.modelVersionId && source.model.contentFingerprint === pins.fingerprint && sourceReceipt.status === 'PASS' && sourceReceipt.checkedModelFingerprint === pins.fingerprint && sourceReceipt.privateSnapshot?.sha256 === pins.sourceSnapshotSha256 && sourceReceipt.preservation?.status === 'PASS', 'IMPORT_SOURCE_RECEIPT_LINK');
  need(UUID.test(actorId ?? '') && UUID.test(plan.newProject.id ?? '') && plan.newProject.id === plan.id && plan.newProject.id !== plan.source.projectId && plan.newProject.description === description && plan.newProject.projectNumber === 'PF-COPY-' + plan.id.replaceAll('-', '').slice(0, 12) && plan.newProject.name === source.project.name + ' — copied engineering inputs', 'IMPORT_PROJECT_MARKER');
  for (const key of ['secondaryTrayLength', 'endConnectionLength', 'additionalBendingPercent']) need(sameDecimal(plan.newProject[key], source.project[key]), 'IMPORT_PROJECT_DETAILS_LINK');
  need(plan.newProject.endConnectionLength !== null && plan.newProject.additionalBendingPercent !== null && decimal(plan.newProject.connectionGap) === '1', 'IMPORT_PROJECT_DETAILS_LINK');
  need(Array.isArray(plan.types) && plan.types.length === 50 && Array.isArray(plan.cables) && plan.cables.length === 2140, 'IMPORT_PLAN_COUNTS');
  need(archiveReport?.status === 'PASS' && archiveReport.operation === 'verify' && archiveReport.package?.bytes === pins.archiveBytes && archiveReport.package.sha256 === pins.archiveSha256 && archiveReport.contentFingerprint === pins.fingerprint, 'IMPORT_ARCHIVE_PIN');
  const manifest = archiveReport.manifest;
  need(manifest?.contentFingerprint === pins.fingerprint && UUID.test(manifest.packageId ?? '') && manifest.supportProfile === 'svf-local-7.130.0-v1' && manifest.sdkVersion === '7.130.0' && manifest.entrypoint === 'resources/output/0/0.svf' && Array.isArray(manifest.resources) && manifest.resources.length === archiveReport.resourceCount && integer(archiveReport.resourceCount, 100000) && archiveReport.resourceCount > 0 && integer(archiveReport.totalRawBytes, 8 * 1024 ** 3), 'IMPORT_ARCHIVE_MANIFEST');
  need(Array.isArray(source.model.propertyResources) && source.model.propertyResources.length === 5 && source.model.propertyResources.every(pin => manifest.resources.some(resource => isDeepStrictEqual(resource, pin))), 'IMPORT_ARCHIVE_RESOURCE_LINK');
  need(manifest.resources.every(r => typeof r.path === 'string' && r.path.length <= 1024 && integer(r.bytes, 2 * 1024 ** 3) && HASH.test(r.sha256 ?? '')) && new Set(manifest.resources.map(r => r.path)).size === manifest.resources.length && manifest.resources.reduce((n, r) => n + r.bytes, 0) === archiveReport.totalRawBytes, 'IMPORT_ARCHIVE_RESOURCE_LINK');
  return { schemaVersion: 'pathfinder.copied-project.import-context.v1', planSha256, receiptSha256, planId: plan.id, target: structuredClone(plan.target), project: structuredClone(plan.newProject), actorId, sourceProjectId: plan.source.projectId, sourceModelVersionId: plan.source.modelVersionId, archive: { bytes: pins.archiveBytes, sha256: pins.archiveSha256, fingerprint: pins.fingerprint, packageId: manifest.packageId, source: structuredClone(manifest.source), resources: structuredClone(manifest.resources), resourceCount: archiveReport.resourceCount, totalBytes: String(archiveReport.totalRawBytes) } };
}

export function assertTargetBinding(context, binding, expected) {
  need(binding?.owner === context.target.owner && binding.project === context.target.project && binding.port === 5191 && binding.runtime === context.target.runtime && binding.apiImage === context.target.apiImage && binding.webImage === context.target.webImage && ['apiId', 'pgId', 'webId'].every(k => ID.test(binding[k] ?? '')) && typeof binding.serverAddress === 'string' && binding.serverAddress.length <= 45, 'IMPORT_TARGET_BINDING');
  if (expected) need(isDeepStrictEqual(binding, expected), 'IMPORT_TARGET_CHANGED');
  return binding;
}
export function assertProjectProjection(context, value) {
  need(value?.identity?.database === 'wfc_pathfinder_local' && value.identity.port === 5432 && value.identity.readOnly === true && value.identity.address === value.expectedServerAddress, 'IMPORT_DATABASE_BINDING');
  const project = value.project;
  need(project && ['id', 'projectNumber', 'name', 'description'].every(k => project[k] === context.project[k]), 'IMPORT_PROJECT_CHANGED');
  for (const key of ['secondaryTrayLength', 'endConnectionLength', 'additionalBendingPercent', 'connectionGap']) need(sameDecimal(project[key], context.project[key]), 'IMPORT_PROJECT_CHANGED');
  need(value.counts?.types === 50 && value.counts.cables === 2140 && value.counts.syntheticMarkers === 0, 'IMPORT_PROJECT_SCOPE');
  need(value.selection?.projectId === context.project.id && textInteger(value.selection.selectionRevision) && (value.selection.activeModelVersionId === null || UUID.test(value.selection.activeModelVersionId ?? '')), 'IMPORT_SELECTION_INVALID');
  for (const name of ['jobs', 'versions', 'ownership', 'reservations', 'aliases', 'validations']) need(Array.isArray(value[name]) && value[name].length < IMPORT_LIMITS.sqlRows, 'IMPORT_REGISTRY_ROW_BUDGET');
  return value;
}
export function assertImportJob(context, job, key, importId) {
  need(job && UUID.test(job.id ?? '') && (!importId || job.id === importId) && job.projectId === context.project.id && job.requestedBy === context.actorId && job.idempotencyKey === key && job.archiveSha256 === context.archive.sha256 && job.expectedBytes === String(context.archive.bytes) && textInteger(job.receivedBytes) && Number(job.receivedBytes) <= context.archive.bytes && ['receiving', 'staging', 'validating', 'publishing', 'complete', 'failed'].includes(job.state), 'IMPORT_JOB_BINDING');
  need(job.modelVersionId === null || UUID.test(job.modelVersionId ?? ''), 'IMPORT_JOB_BINDING');
  if (job.state === 'complete') need(job.modelVersionId !== null && job.receivedBytes === String(context.archive.bytes) && job.failureCode === null && job.duplicate === false, 'IMPORT_JOB_COMPLETE_INVALID');
  return job;
}
const resourceMap = resources => [...resources].sort((a, b) => a.path.localeCompare(b.path));
export function assertReadyImport(context, projection, job) {
  assertProjectProjection(context, projection);
  need(job.state === 'complete' && projection.jobs.length === 1 && projection.versions.length === 1 && projection.ownership.length === 1 && projection.reservations.length === 0 && projection.aliases.length === 1 && projection.validations.length === 1, 'IMPORT_READY_COUNTS');
  const model = projection.versions[0], ownership = projection.ownership[0], alias = projection.aliases[0], validation = projection.validations[0];
  const prefix = 'projects/' + context.project.id + '/versions/' + job.modelVersionId + '/';
  need(model.id === job.modelVersionId && model.id !== context.sourceModelVersionId && model.projectId === context.project.id && model.ownerImportId === job.id && model.importedBy === context.actorId && model.packageId === context.archive.packageId && model.contentFingerprint === context.archive.fingerprint && model.state === 'ready' && model.health === 'healthy' && model.supportProfile === 'svf-local-7.130.0-v1' && model.sdkVersion === '7.130.0' && model.entrypoint === 'resources/output/0/0.svf' && model.storagePrefix === prefix && model.resourceCount === context.archive.resourceCount && model.totalBytes === context.archive.totalBytes && isDeepStrictEqual(model.source, context.archive.source) && Array.isArray(model.resources) && isDeepStrictEqual(resourceMap(model.resources), resourceMap(context.archive.resources)), 'IMPORT_READY_MODEL');
  need(ownership.importId === job.id && ownership.projectId === context.project.id && ownership.modelVersionId === model.id && ownership.storagePrefix === prefix && ownership.published === true && ownership.cleanedAt === null, 'IMPORT_STORAGE_OWNERSHIP');
  need(alias.projectId === context.project.id && alias.modelVersionId === model.id && alias.packageId === model.packageId, 'IMPORT_ALIAS_OWNERSHIP');
  need(UUID.test(model.validationReportId ?? '') && validation.id === model.validationReportId && validation.status === 'PASS' && validation.contentFingerprint === context.archive.fingerprint && validation.archiveSha256 === context.archive.sha256 && String(validation.archiveBytes) === String(context.archive.bytes) && validation.resourceCount === context.archive.resourceCount && String(validation.totalRawBytes) === context.archive.totalBytes && validation.storageReadback?.status === 'PASS' && validation.storageReadback.algorithm === 'SHA-256' && validation.storageReadback.resourceCount === context.archive.resourceCount && String(validation.storageReadback.totalBytes) === context.archive.totalBytes, 'IMPORT_READBACK_PROOF');
  const report = validation.report;
  need(report?.reportSchemaVersion === 1 && report.operation === 'verify' && report.status === 'PASS' && ['portableManifest', 'safeArchive', 'rawInventory', 'fingerprint', 'supportedProfile', 'nestedReferences'].every(key => report.checks?.[key] === 'PASS') && report.contentFingerprint === context.archive.fingerprint && report.package?.sha256 === context.archive.sha256 && report.package.bytes === context.archive.bytes && report.manifest?.packageId === context.archive.packageId && report.manifest.contentFingerprint === context.archive.fingerprint && isDeepStrictEqual(report.manifest.source, context.archive.source) && Array.isArray(report.manifest.resources) && isDeepStrictEqual(resourceMap(report.manifest.resources), resourceMap(context.archive.resources)) && Array.isArray(report.resources) && report.resources.length === context.archive.resourceCount && report.resources.every(resource => resource.verifiedSha256 === resource.sha256) && isDeepStrictEqual(resourceMap(report.resources.map(({ verifiedSha256: _verified, ...resource }) => resource)), resourceMap(context.archive.resources)), 'IMPORT_FULL_VALIDATION_REPORT');
  return model;
}
export function selectionDisposition(context, selection, modelId) {
  need(selection?.projectId === context.project.id && textInteger(selection.selectionRevision), 'IMPORT_SELECTION_INVALID');
  if (selection.activeModelVersionId === modelId && selection.selectionRevision === '1') return 'already_selected';
  need(selection.activeModelVersionId === null && selection.selectionRevision === '0', 'IMPORT_SELECTION_CONFLICT');
  return 'select';
}

/** All mutations are injected; callers must persist append() before it resolves. No hidden upload/selection retry. */
export async function executeNormalImport({ context, intent, history = [], io }) {
  need(intent?.schemaVersion === 'pathfinder.copied-project.import-intent.v1' && UUID.test(intent.idempotencyKey ?? '') && intent.planSha256 === context.planSha256 && intent.receiptSha256 === context.receiptSha256 && intent.projectId === context.project.id && intent.actorId === context.actorId && intent.archiveSha256 === context.archive.sha256, 'IMPORT_INTENT_CONFLICT');
  need(Array.isArray(history) && history.length <= IMPORT_LIMITS.journalEvents, 'IMPORT_JOURNAL_LIMIT');
  const startedAt = io.now(), active = () => { if (io.signal?.aborted) refuse('IMPORT_INTERRUPTED'); need(io.now() - startedAt < IMPORT_LIMITS.totalMilliseconds, 'IMPORT_TOTAL_TIMEOUT'); };
  const append = async (type, value) => { await io.append(type, value); };
  const guard = async () => { active(); const binding = await io.guard(); assertTargetBinding(context, binding, intent.target); return binding; };
  const observe = async phase => { await guard(); const value = await io.observe({ projectId: context.project.id, idempotencyKey: intent.idempotencyKey }); await append('projection_' + phase, value); active(); need(value?.identity?.address === intent.target.serverAddress, 'IMPORT_DATABASE_BINDING'); assertProjectProjection(context, value); return value; };
  const key = intent.idempotencyKey; let projection = await observe('initial');
  need(projection.jobs.length <= 1, 'IMPORT_FOREIGN_JOB');
  let job = projection.jobs[0] ? assertImportJob(context, projection.jobs[0], key) : null;
  const alreadySent = history.some(event => event.type === 'upload_will_start');
  if (!job) {
    need(!alreadySent, 'IMPORT_UNCERTAIN_ACCEPTANCE');
    need(projection.versions.length === 0 && projection.ownership.length === 0 && projection.reservations.length === 0 && projection.aliases.length === 0 && projection.validations.length === 0 && projection.selection.activeModelVersionId === null && projection.selection.selectionRevision === '0', 'IMPORT_FRESH_PROJECT_REQUIRED');
  }
  if (job?.state === 'failed') refuse('IMPORT_JOB_FAILED');
  await guard(); const login = await io.login(); await append('login_observation', { status: login.status, actorId: login.user?.id ?? null, isAdmin: login.user?.isAdmin === true });
  need(login.status === 200 && login.user?.id === context.actorId && login.user.isAdmin === true && typeof login.token === 'string' && login.token.length >= 16 && login.token.length <= 32768, 'IMPORT_LOGIN_REFUSED');
  const token = login.token;
  if (!job) {
    await append('upload_will_start', { idempotencyKey: key, projectId: context.project.id, archiveSha256: context.archive.sha256, bytes: context.archive.bytes });
    projection = await observe('before_upload'); need(projection.jobs.length === 0 && projection.versions.length === 0 && projection.ownership.length === 0 && projection.selection.activeModelVersionId === null && projection.selection.selectionRevision === '0', 'IMPORT_BEFORE_UPLOAD_CONFLICT');
    let reply;
    try { await guard(); active(); reply = await io.upload({ token, projectId: context.project.id, idempotencyKey: key }); await append('upload_http', reply); }
    catch (error) { await append('upload_transport_failure', { code: ['IMPORT_INTERRUPTED', 'IMPORT_HTTP_TIMEOUT', 'IMPORT_HTTP_LIMIT'].includes(error?.code) ? error.code : 'IMPORT_HTTP_TRANSPORT' }); }
    projection = await observe('after_upload');
    need(projection.jobs.length === 1, 'IMPORT_UNCERTAIN_ACCEPTANCE'); job = assertImportJob(context, projection.jobs[0], key);
    if (reply) need([200, 202].includes(reply.status) && reply.value?.importId === job.id && reply.value.job?.id === job.id && reply.value.job.projectId === context.project.id, 'IMPORT_UPLOAD_RESPONSE');
  }
  let polls = 0;
  while (job.state !== 'complete') {
    active(); if (job.state === 'failed') refuse('IMPORT_JOB_FAILED'); need(++polls <= IMPORT_LIMITS.polls, 'IMPORT_POLL_LIMIT');
    const reply = await io.poll({ token, projectId: context.project.id, importId: job.id }); await append('poll_http', reply); active();
    need(reply.status === 200 && reply.value?.job?.id === job.id && reply.value.job.projectId === context.project.id && reply.value.job.requestedBy === context.actorId, 'IMPORT_POLL_RESPONSE');
    projection = await observe('poll'); job = assertImportJob(context, projection.jobs[0], key, job.id);
    if (job.state !== 'complete') await io.sleep(IMPORT_LIMITS.pollMilliseconds);
  }
  projection = await observe('ready'); job = assertImportJob(context, projection.jobs[0], key, job.id); const model = assertReadyImport(context, projection, job);
  const listed = await io.listVersions({ token, projectId: context.project.id }); await append('list_versions_http', listed);
  need(listed.status === 200 && Array.isArray(listed.value?.versions) && listed.value.versions.length === 1 && listed.value.versions[0].id === model.id && listed.value.versions[0].projectId === context.project.id && listed.value.versions[0].contentFingerprint === context.archive.fingerprint && listed.value.versions[0].resourceCount === context.archive.resourceCount && listed.value.versions[0].state === 'ready' && listed.value.versions[0].health === 'healthy', 'IMPORT_LIST_VERSION');
  let disposition = selectionDisposition(context, projection.selection, model.id);
  if (disposition === 'select') {
    need(!history.some(event => event.type === 'selection_will_start'), 'IMPORT_SELECTION_UNCERTAIN');
    await append('selection_will_start', { projectId: context.project.id, modelVersionId: model.id, expectedSelectionRevision: 0 });
    projection = await observe('before_selection'); need(selectionDisposition(context, projection.selection, model.id) === 'select', 'IMPORT_BEFORE_SELECTION_CONFLICT');
    let reply;
    try { await guard(); active(); reply = await io.select({ token, projectId: context.project.id, modelVersionId: model.id, expectedSelectionRevision: 0 }); await append('selection_http', reply); }
    catch (error) { await append('selection_transport_failure', { code: ['IMPORT_INTERRUPTED', 'IMPORT_HTTP_TIMEOUT', 'IMPORT_HTTP_LIMIT'].includes(error?.code) ? error.code : 'IMPORT_HTTP_TRANSPORT' }); }
    projection = await observe('after_selection');
    need(selectionDisposition(context, projection.selection, model.id) === 'already_selected', 'IMPORT_SELECTION_UNCERTAIN');
    if (reply) need(reply.status === 200 || reply.status === 409, 'IMPORT_SELECTION_RESPONSE');
    disposition = reply?.status === 200 ? 'selected' : 'reconciled_selected';
  }
  assertReadyImport(context, projection, assertImportJob(context, projection.jobs[0], key, job.id)); await guard();
  const result = { status: 'PASS', projectId: context.project.id, importId: job.id, modelVersionId: model.id, contentFingerprint: context.archive.fingerprint, resourceCount: model.resourceCount, totalBytes: model.totalBytes, storagePrefix: model.storagePrefix, selectionRevision: projection.selection.selectionRevision, selectionDisposition: disposition, uploadDisposition: alreadySent ? 'reconciled_persisted_request' : 'single_upload_or_existing_request', syntheticMarker: false, engineeringAccepted: false };
  await append('completed', result); return result;
}
