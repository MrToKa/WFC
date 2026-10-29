import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { TABLES, validateSourceProjection, sourceProjectionHashes, compareSourceProjections, buildReadProgram } from './source-lib.mjs';
import { ROOT, ownWork, openWork, writePrivate, readPrivate, bindOriginal, bindTarget, runFixedHelper, requireTransport, readSourceObject, filePlan, stageTargetObject, reconcileTargetObject, finishFileManifest, collectStorageInventory } from './guard-io.mjs';
import { auditTables, buildPreservationProgram, comparePreservation, compareStoragePreservation } from './preservation-lib.mjs';
import { validatePlanInputs, validateFileIntent } from './operator-lib.mjs';

const seedRef = Object.freeze({ path: 'pathfinder-engine/.scratch/copied-project-seed-20261018-1710/plan.private.json', bytes: 794861, sha256: '3ac537e097ce4eec007bc2604c0c9338a9bfb0ecad81f3af70a71100b18d0b0d' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (ok, code) => { if (!ok) throw Object.assign(Error(code), { code }); };
const relative = value => path.relative(ROOT, value).split(path.sep).join('/');
const fullRef = (work, ref) => ({ ...ref, path: work.relative + '/' + ref.path });
const parse = bytes => JSON.parse(bytes.toString('utf8'));
const tables = auditTables(TABLES.map(t => ({ name: t.table, keyColumns: t.keyColumns })));
const safeError = error => /^[A-Z][A-Z0-9_]{0,95}$/.test(error?.code ?? '') ? error.code : 'CATALOG_OPERATOR_FAILED';
function targetConfig(binding, fixed) { return { ...fixed, serverAddress: binding.serverAddress }; }
async function descriptor(work, file, sha256) {
  need(typeof file === 'string' && /^[a-f0-9]{64}$/.test(sha256 ?? ''), 'CATALOG_DESCRIPTOR_ARGUMENTS');
  const resolved = path.resolve(ROOT, file);
  need(path.dirname(resolved) === work.directory && /^[a-z][a-z0-9-]{0,95}\.private\.json$/.test(path.basename(resolved)), 'CATALOG_DESCRIPTOR_PATH');
  const stat = await fs.lstat(resolved); need(!stat.isSymbolicLink() && stat.isFile() && stat.size <= 90 * 1024 ** 2, 'CATALOG_DESCRIPTOR_FILE');
  const ref = { path: path.basename(resolved), bytes: stat.size, sha256 };
  return { ref, value: parse(await readPrivate(work, ref)) };
}
async function privateResult(work, binding, program, input, label, mutating = false) {
  const capture = await runFixedHelper({ work, binding, program, input, label, mutating });
  requireTransport(capture); return { capture, value: parse(capture.raw) };
}
async function audit(work, binding, target, label, rows = [], projectDrawing) {
  const expectations = rows.map(r => ({ table: r.table, sourceRowText: r.sourceRowText, overrides: r.overrides, action: r.action }));
  if (projectDrawing) expectations.push({ table: 'projects', kind: 'project-drawing', sourceRowText: projectDrawing.sourceRowText, baselineRowText: projectDrawing.targetExpectedRowText, overrides: {}, action: 'enrich' });
  const result = await privateResult(work, binding, buildPreservationProgram(), { target, tables, expectations }, label);
  need(result.value.status === 'PASS', result.value.error ?? 'CATALOG_PRESERVATION_FAILED'); return result;
}
async function seed() {
  const bytes = await fs.readFile(path.join(ROOT, seedRef.path)); need(bytes.length === seedRef.bytes && hash(bytes) === seedRef.sha256, 'CATALOG_RETAINED_SEED_HASH'); return parse(bytes);
}
const codeFiles = ['catalog.mjs', 'source-lib.mjs', 'transfer-lib.mjs', 'guard-io.mjs', 'preservation-lib.mjs', 'operator-lib.mjs'];
async function sourceHashes() {
  return Promise.all(codeFiles.map(async name => ({ path: 'scripts/pathfinder-tray-catalog/' + name, sha256: hash(await fs.readFile(path.join(ROOT, 'scripts/pathfinder-tray-catalog', name))) })));
}

/** Explicit operator phases; no automatic write retry after an uncertain outcome. */
export async function main(argv = process.argv.slice(2)) {
  let work, receipt = { schemaVersion: 'wfc.pf.catalog-operator-receipt.v1', status: 'FAIL', recordedAt: new Date().toISOString() };
  const deadline = Date.now() + 10 * 60 * 1000;
  const checkpoint = () => need(Date.now() < deadline, 'CATALOG_OPERATOR_DEADLINE');
  try {
    const { positionals, values } = parseArgs({ args: argv, strict: true, allowPositionals: true, options: { work: { type: 'string' }, input: { type: 'string' }, sha256: { type: 'string' }, 'actor-id': { type: 'string' }, 'plan-sha256': { type: 'string' } } });
    const mode = positionals[0]; need(positionals.length === 1 && ['capture', 'prepare', 'resume-prepare', 'recover-prepared', 'apply', 'verify'].includes(mode), 'CATALOG_OPERATOR_MODE');
    need(mode === 'recover-prepared' || values['plan-sha256'] === undefined, 'CATALOG_UNEXPECTED_PLAN_HASH');
    receipt.mode = mode; receipt.sourceFiles = await sourceHashes();
    const { TRANSFER_TARGET, buildTransferProgram, createTransferPlan, validateTransferPlan, validateTargetBaseline } = await import('./transfer-lib.mjs');
    work = mode === 'capture' ? await ownWork() : await openWork(values.work);
    receipt.work = work.relative; receipt.owner = work.owner;
    if (mode === 'capture') {
      need(!values.work && !values.input && !values.sha256 && !values['actor-id'], 'CATALOG_CAPTURE_ARGUMENTS');
      const original = await bindOriginal({ work }); checkpoint();
      const before = await privateResult(work, original, buildReadProgram(original.sourceBinding, 'before'), {}, 'source-before');
      validateSourceProjection(before.value, 'before'); checkpoint();
      const copy = await privateResult(work, original, buildReadProgram(original.sourceBinding, 'copy'), {}, 'source-copy');
      validateSourceProjection(copy.value, 'copy');
      const comparison = compareSourceProjections(before.value, copy.value); checkpoint();
      const binding = await bindTarget({ work }), target = targetConfig(binding, TRANSFER_TARGET);
      const baseline = await audit(work, binding, target, 'preservation-capture');
      const storage = await collectStorageInventory({ work, binding, label: 'storage-capture' });
      const saved = await writePrivate(work, 'capture', { schemaVersion: 'wfc.pf.catalog-capture.v1', owner: work.owner, target, sourceBefore: before.capture.rawRef, sourceCopy: copy.capture.rawRef, preservation: baseline.capture.rawRef, storage: storage.rawRef });
      receipt.status = 'PASS'; receipt.operation = 'read-only-captured'; receipt.input = fullRef(work, saved); receipt.source = comparison;
      receipt.auditTables = Object.keys(baseline.value.groups).length;
    } else if (mode === 'prepare' || mode === 'resume-prepare') {
      let captured, captureRef, observed, actorId, plannedFiles, fileIntent;
      if (mode === 'prepare') {
        const input = await descriptor(work, values.input, values.sha256); captured = input.value; captureRef = input.ref; actorId = values['actor-id'];
      } else {
        need(!values['actor-id'], 'CATALOG_RESUME_ARGUMENTS');
        const { value: intent } = await descriptor(work, values.input, values.sha256);
        need(intent.schemaVersion === 'wfc.pf.catalog-prepare-intent.v1' && intent.owner === work.owner, 'CATALOG_RESUME_INTENT');
        captureRef = intent.capture; captured = parse(await readPrivate(work, captureRef)); actorId = intent.actorId;
        observed = { value: parse(await readPrivate(work, intent.baseline)), capture: { rawRef: intent.baseline } };
        validateTargetBaseline(observed.value); fileIntent = intent.filePlan; plannedFiles = parse(await readPrivate(work, fileIntent));
        // A written plan is immutable. Resume only interrupted staging; reconcile
        // an already written database plan through its original descriptor.
        try { await fs.lstat(path.join(work.directory, 'transfer-plan.private.json')); need(false, 'CATALOG_EXISTING_PLAN_REQUIRES_RECONCILIATION'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      need(captured.schemaVersion === 'wfc.pf.catalog-capture.v1' && captured.owner === work.owner && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(actorId ?? ''), 'CATALOG_PREPARE_ARGUMENTS');
      const source = validateSourceProjection(parse(await readPrivate(work, captured.sourceCopy)));
      const binding = await bindTarget({ work }), target = targetConfig(binding, TRANSFER_TARGET); checkpoint();
      const freshBaseline = await privateResult(work, binding, buildTransferProgram(), { mode: 'baseline', target, actorId }, 'target-baseline-' + randomUUID());
      validateTargetBaseline(freshBaseline.value);
      if (observed) need(JSON.stringify(observed.value.groups) === JSON.stringify(freshBaseline.value.groups) && observed.value.projectRowText === freshBaseline.value.projectRowText && JSON.stringify(observed.value.modelSelection) === JSON.stringify(freshBaseline.value.modelSelection), 'CATALOG_RESUME_TARGET_CHANGED');
      else observed = freshBaseline;
      const preservation = await audit(work, binding, target, 'preservation-prepare-' + randomUUID());
      const unchanged = comparePreservation(parse(await readPrivate(work, captured.preservation)), preservation.value); need(unchanged.status === 'PASS', 'CATALOG_TARGET_CHANGED_BEFORE_PREPARE');
      const original = await bindOriginal({ work }), files = [];
      const sourceFresh = await privateResult(work, original, buildReadProgram(original.sourceBinding, 'after'), {}, 'prepare-source-fresh-' + randomUUID());
      receipt.sourcePreflight = compareSourceProjections(parse(await readPrivate(work, captured.sourceBefore)), source, validateSourceProjection(sourceFresh.value, 'after'));
      if (!plannedFiles) {
        for (let i = 0; i < source.files.length; i++) { checkpoint(); files.push(await readSourceObject({ work, binding: original, snapshotRef: captured.sourceCopy, file: source.files[i], label: 'file-source-' + i })); }
        plannedFiles = filePlan(work, files, files.map(() => randomUUID()));
        fileIntent = await writePrivate(work, 'file-plan', plannedFiles);
      }
      const resume = await writePrivate(work, 'prepare-intent-' + randomUUID(), { schemaVersion: 'wfc.pf.catalog-prepare-intent.v1', owner: work.owner, actorId, capture: captureRef, baseline: observed.capture.rawRef, filePlan: fileIntent });
      receipt.resume = fullRef(work, resume);
      const staged = [];
      receipt.fileIntent = fullRef(work, fileIntent);
      for (let i = 0; i < plannedFiles.entries.length; i++) { checkpoint(); staged.push(await stageTargetObject({ work, binding, entry: plannedFiles.entries[i], label: 'file-stage-' + i + '-' + randomUUID() })); }
      const manifest = await finishFileManifest({ work, plan: plannedFiles, entries: staged, label: 'files-staged-' + randomUUID() });
      const storageAfter = await collectStorageInventory({ work, binding, label: 'storage-staged-' + randomUUID() });
      receipt.storagePreservation = compareStoragePreservation(parse(await readPrivate(work, captured.storage)), storageAfter.value, manifest.entries);
      need(receipt.storagePreservation.status === 'PASS', 'CATALOG_STORAGE_CHANGED');
      const plan = createTransferPlan({ sourceProjection: source, seedPlan: await seed(), targetBaseline: observed.value, filePlan: manifest, actorId, sourceRef: fullRef(work, captured.sourceCopy), seedRef });
      validateTransferPlan(plan); checkpoint();
      const saved = await writePrivate(work, 'transfer-plan', plan);
      receipt.plan = fullRef(work, saved);
      const prepared = await writePrivate(work, 'prepared', { schemaVersion: 'wfc.pf.catalog-prepared.v1', owner: work.owner, capture: captureRef, plan: saved, fileIntent });
      receipt.status = 'PASS'; receipt.operation = 'files-staged-plan-ready'; receipt.input = fullRef(work, prepared); receipt.plan = fullRef(work, saved);
      receipt.rows = Object.fromEntries(TABLES.map(t => [t.table, Object.fromEntries(['insert', 'enrich', 'reuse'].map(action => [action, plan.rows.filter(r => r.table === t.table && r.action === action).length]))]));
      receipt.files = { count: manifest.entries.length, bytes: manifest.entries.reduce((total, entry) => total + entry.bytes, 0), manifestSha256: manifest.manifestSha256, receiptSha256: manifest.receiptSha256 };
    } else if (mode === 'recover-prepared') {
      need(!values['actor-id'], 'CATALOG_RECOVERY_ARGUMENTS');
      const { value: intent } = await descriptor(work, values.input, values.sha256);
      need(intent.schemaVersion === 'wfc.pf.catalog-prepare-intent.v1' && intent.owner === work.owner, 'CATALOG_RECOVERY_INTENT');
      const existingPlan = await descriptor(work, work.relative + '/transfer-plan.private.json', values['plan-sha256']);
      const plan = validateTransferPlan(existingPlan.value), captured = parse(await readPrivate(work, intent.capture));
      need(captured.schemaVersion === 'wfc.pf.catalog-capture.v1' && captured.owner === work.owner && plan.id === work.owner && plan.actorId === intent.actorId, 'CATALOG_RECOVERY_BINDING');
      need(JSON.stringify(parse(await readPrivate(work, intent.baseline))) === JSON.stringify(plan.baseline), 'CATALOG_RECOVERY_BASELINE_REF');
      const source = validateSourceProjection(parse(await readPrivate(work, captured.sourceCopy)));
      validatePlanInputs(plan, source, fullRef(work, captured.sourceCopy), await seed(), seedRef);
      const files = validateFileIntent(parse(await readPrivate(work, intent.filePlan)), plan.filePlan, work.owner);
      const binding = await bindTarget({ work }), target = targetConfig(binding, TRANSFER_TARGET);
      need(JSON.stringify(plan.target) === JSON.stringify(target), 'CATALOG_RECOVERY_TARGET');
      const baseline = await privateResult(work, binding, buildTransferProgram(), { mode: 'baseline', target, actorId: plan.actorId }, 'recover-baseline-' + randomUUID());
      validateTargetBaseline(baseline.value);
      need(JSON.stringify(baseline.value.groups) === JSON.stringify(plan.baseline.groups) && baseline.value.projectRowText === plan.baseline.projectRowText && JSON.stringify(baseline.value.modelSelection) === JSON.stringify(plan.baseline.modelSelection), 'CATALOG_RECOVERY_REQUIRES_INITIAL_STATE');
      const original = await bindOriginal({ work }), sourcePre = await privateResult(work, original, buildReadProgram(original.sourceBinding, 'after'), {}, 'recover-source-' + randomUUID());
      receipt.sourcePreflight = compareSourceProjections(parse(await readPrivate(work, captured.sourceBefore)), source, validateSourceProjection(sourcePre.value, 'after'));
      for (let i = 0; i < files.entries.length; i++) { checkpoint(); need((await reconcileTargetObject({ work, binding, entry: files.entries[i], label: 'recover-file-' + i + '-' + randomUUID() })).status === 'PASS', 'CATALOG_RECOVERY_FILE_MISSING'); }
      const prepared = { schemaVersion: 'wfc.pf.catalog-prepared.v1', owner: work.owner, capture: intent.capture, plan: existingPlan.ref, fileIntent: intent.filePlan };
      let preparedRef;
      try {
        // Expected bytes are known from the immutable references. Validate path,
        // hard links and hash before consuming any existing descriptor bytes.
        const bytes = Buffer.from(JSON.stringify(prepared, null, 2) + '\n'), ref = { path: 'prepared.private.json', bytes: bytes.length, sha256: hash(bytes) };
        need(JSON.stringify(parse(await readPrivate(work, ref))) === JSON.stringify(prepared), 'CATALOG_RECOVERY_DESCRIPTOR_CONFLICT'); preparedRef = ref;
      } catch (error) { if (error.code !== 'ENOENT') throw error; preparedRef = await writePrivate(work, 'prepared', prepared); }
      receipt.status = 'PASS'; receipt.operation = 'same-plan-prepared-descriptor-recovered'; receipt.input = fullRef(work, preparedRef); receipt.plan = fullRef(work, existingPlan.ref);
    } else {
      need(!values['actor-id'], 'CATALOG_APPLY_ARGUMENTS');
      const { value: prepared } = await descriptor(work, values.input, values.sha256);
      need(prepared.schemaVersion === 'wfc.pf.catalog-prepared.v1' && prepared.owner === work.owner, 'CATALOG_PREPARED_DESCRIPTOR');
      const plan = validateTransferPlan(parse(await readPrivate(work, prepared.plan)));
      const captured = parse(await readPrivate(work, prepared.capture));
      need(captured.schemaVersion === 'wfc.pf.catalog-capture.v1' && captured.owner === work.owner, 'CATALOG_CAPTURE_DESCRIPTOR');
      const source = validateSourceProjection(parse(await readPrivate(work, captured.sourceCopy)));
      validatePlanInputs(plan, source, fullRef(work, captured.sourceCopy), await seed(), seedRef);
      need(plan.id === work.owner && plan.source.projectionSha256 === sourceProjectionHashes(source).sha256 && plan.seed.ref.sha256 === seedRef.sha256, 'CATALOG_PLAN_SOURCE_BINDING');
      const binding = await bindTarget({ work }), target = targetConfig(binding, TRANSFER_TARGET);
      need(JSON.stringify(plan.target) === JSON.stringify(target), 'CATALOG_PLAN_TARGET_CHANGED');
      const intent = validateFileIntent(parse(await readPrivate(work, prepared.fileIntent)), plan.filePlan, work.owner);
      for (let i = 0; i < intent.entries.length; i++) { checkpoint(); need((await reconcileTargetObject({ work, binding, entry: intent.entries[i], label: mode + '-file-' + i + '-' + randomUUID() })).status === 'PASS', 'CATALOG_STAGED_FILE_MISSING'); }
      const originalPre = await bindOriginal({ work });
      const sourcePre = await privateResult(work, originalPre, buildReadProgram(originalPre.sourceBinding, 'after'), {}, mode + '-source-pre-' + randomUUID());
      receipt.sourcePreflight = compareSourceProjections(parse(await readPrivate(work, captured.sourceBefore)), source, validateSourceProjection(sourcePre.value, 'after'));
      // Type-check the independent complete expected projection before the
      // writer can commit, then repeat it against actual final rows.
      const before = await audit(work, binding, target, mode + '-before-' + randomUUID(), plan.rows, plan.projectDrawing); checkpoint();
      const run = await runFixedHelper({ work, binding, program: buildTransferProgram(), input: { mode, target, actorId: plan.actorId, plan }, label: mode + '-database-' + randomUUID(), mutating: mode === 'apply' });
      receipt.databaseTransport = fullRef(work, run.transportRef); receipt.databaseRaw = fullRef(work, run.rawRef);
      receipt.outcome = run.transport.outcome;
      let result; try { result = parse(run.raw); receipt.database = { status: result.status, operation: result.operation, commitAttempted: result.commitAttempted, commitConfirmed: result.commitConfirmed, outcome: result.outcome, counts: result.counts }; } catch { /* Raw and transport evidence already durable. */ }
      requireTransport(run); need(result?.status === 'PASS', result?.error ?? 'CATALOG_DATABASE_REFUSED'); checkpoint();
      const afterBinding = await bindTarget({ work }), after = await audit(work, afterBinding, target, mode + '-after-' + randomUUID(), plan.rows, plan.projectDrawing);
      const preservation = comparePreservation(before.value, after.value); need(preservation.status === 'PASS', 'CATALOG_PRESERVATION_CHANGED');
      await writePrivate(work, mode + '-preservation-' + randomUUID(), preservation);
      const original = await bindOriginal({ work });
      const sourceAfter = await privateResult(work, original, buildReadProgram(original.sourceBinding, 'after'), {}, mode + '-source-after-' + randomUUID());
      const sourcePreservation = compareSourceProjections(parse(await readPrivate(work, captured.sourceBefore)), source, validateSourceProjection(sourceAfter.value, 'after'));
      const storageFinal = await collectStorageInventory({ work, binding: afterBinding, label: mode + '-storage-' + randomUUID() });
      receipt.storagePreservation = compareStoragePreservation(parse(await readPrivate(work, captured.storage)), storageFinal.value, plan.filePlan.entries);
      need(receipt.storagePreservation.status === 'PASS', 'CATALOG_STORAGE_CHANGED');
      receipt.status = 'PASS'; receipt.operation = result.operation ?? result.outcome ?? mode; receipt.plan = fullRef(work, prepared.plan);
      receipt.preservation = preservation; receipt.sourcePreservation = sourcePreservation;
    }
    need(JSON.stringify(receipt.sourceFiles) === JSON.stringify(await sourceHashes()), 'CATALOG_OPERATOR_CODE_CHANGED');
  } catch (error) {
    receipt.status = 'FAIL'; receipt.error = safeError(error);
    if (error.outcome === 'UNCERTAIN' || error.code === 'CATALOG_IO_UNCERTAIN') receipt.outcome = 'UNCERTAIN';
    if (work && error.rawRef) receipt.failureRaw = fullRef(work, error.rawRef);
    if (work && error.transportRef) receipt.failureTransport = fullRef(work, error.transportRef);
  }
  receipt.finishedAt = new Date().toISOString();
  const directory = path.join(ROOT, 'docs/pathfinder/evidence/tray-catalog'); await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'operator-' + Date.now() + '-' + randomUUID().slice(0, 8) + '.json');
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n'), file = await fs.open(filename, 'wx'); try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  const summary = { status: receipt.status, mode: receipt.mode, work: receipt.work, input: receipt.input, plan: receipt.plan, receipt: relative(filename), error: receipt.error };
  console.log(JSON.stringify(summary)); return { ...summary, receiptValue: receipt };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await main(); process.exitCode = result.status === 'PASS' ? 0 : 1;
}
