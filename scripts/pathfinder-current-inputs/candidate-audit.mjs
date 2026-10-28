import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { safePath, runAudit } from '../pathfinder-coverage/audit.mjs';
import { retainedManifest } from '../pathfinder-coverage/retained.mjs';
import { parseOutput, sha256, SHA } from '../pathfinder-capacity/lib.mjs';
import { LIMITS, requireThat, validateCurrentInput, validateSourceReceipt, packageIdentityObservation, endpointKeys, propertyDecoder, addObjectCandidates, summarizeCandidates, makeBudget } from './candidate-lib.mjs';

const PROJECT_ID = '0c0007c9-d73f-4d13-bc87-601c544727b7';
const PROJECT_NAME = 'HPU Aalborg 2023';
const PROJECT_NUMBER = 'P230039 / H.7500062';
const CONTENT = 'b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34';
const PROPERTY_ROOT = 'pathfinder-engine/.scratch/pf2-converted/package/';
const PROPERTY_FILES = Object.freeze({
  ids: { bytes: 1155258, sha256: 'c0e00414833748b518ef32092affe3ccd380aa712859846a6b8f894305c1c5bb' },
  attrs: { bytes: 997, sha256: 'ee4df15128a2ad51a42603ba7a0bbfb52b1bfbf2cee07139af1fac2545fdac57' },
  offs: { bytes: 1137003, sha256: '9be8c2f8a07b056b2ba713e7896ce8d71dc0b28c5ecd99d0246023267a216de8' },
  avs: { bytes: 4650361, sha256: '7932608146d33fc615ee6c434f9d737ce7cdd492c1a7dd8f7b2eb151a97797b4' },
  vals: { bytes: 2443733, sha256: 'ef38e808230ffc76a7669b50f3dd7ab990cf2c5026aa37900c78ae2fb949a733' },
});

export async function exclusive(filename, raw, maximum) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); requireThat(bytes.length <= maximum, 'CANDIDATE_OUTPUT_LIMIT');
  const handle = await fs.open(filename, 'wx', 0o600); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  const observed = await fs.readFile(filename); requireThat(observed.length === bytes.length && sha256(observed) === sha256(bytes), 'CANDIDATE_OUTPUT_READBACK');
  return { bytes: bytes.length, sha256: sha256(bytes) };
}
async function checked(root, relative, expected, maximum, trace) {
  const filename = await safePath(root, relative), stat = await fs.stat(filename); requireThat(stat.size > 0 && stat.size <= maximum, 'CANDIDATE_INPUT_SIZE');
  const bytes = await fs.readFile(filename); requireThat(bytes.length === stat.size && sha256(bytes) === expected, 'CANDIDATE_INPUT_HASH');
  trace.push({ path: relative, bytes: bytes.length, sha256: expected }); return bytes;
}
export async function productionMatching(root, trace = []) {
  const m = retainedManifest.productionMatching;
  const bytes = await checked(root, m.path, m.sha256, 128 * 1024, trace);
  await checked(root, m.errorsPath, m.errorsSha256, 64 * 1024, trace);
  requireThat([...bytes.toString().matchAll(/^import\s+.*?from\s+['"]([^'"]+)['"];?$/gm)].map(x => x[1]).join() === './errors.js', 'CANDIDATE_MATCHER_IMPORTS');
  const module = await import(pathToFileURL(await safePath(root, m.path)).href);
  requireThat(Object.keys(module).sort().join() === ['matchLocation', 'normalizeLocation', 'objectMatchNames', 'validateSnapshotStructure'].sort().join(), 'CANDIDATE_MATCHER_EXPORTS'); return module;
}
async function readProperties(root, model, trace, budget) {
  const tables = {}; let decodedTotal = 0;
  for (const [key, pin] of Object.entries(PROPERTY_FILES)) {
    budget(1024); const relative = `resources/output/0/objects_${key}.json.gz`, declared = model.propertyResources.filter(row => row.path === relative);
    requireThat(declared.length === 1 && declared[0].sha256 === pin.sha256 && declared[0].bytes === pin.bytes, 'CANDIDATE_PROPERTY_CONTENT_BINDING');
    const compressed = await checked(root, PROPERTY_ROOT + relative, pin.sha256, LIMITS.compressedBytes, trace); requireThat(compressed.length === pin.bytes, 'CANDIDATE_PROPERTY_BYTES');
    const decoded = gunzipSync(compressed, { maxOutputLength: LIMITS.decodedBytes }); decodedTotal += decoded.length; requireThat(decodedTotal <= LIMITS.totalDecodedBytes, 'CANDIDATE_DECODED_BUDGET');
    // Pinned tables contain flat primitives or fixed attribute arrays, no JSON objects.
    // Structural/type validation follows immediately in propertyDecoder.
    tables[key] = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded)); trace.at(-1).decodedBytes = decoded.length;
  }
  return tables;
}

export async function runCandidateAudit({ root, input, inputSha256, sourceReceipt, sourceReceiptSha256, output }) {
  const started = performance.now(), receipt = { schemaVersion: 'pathfinder.current-inputs.candidate-receipt.v1', recordedAt: new Date().toISOString(), status: 'FAIL', limits: LIMITS, inputs: [], checks: [], engineeringAcceptance: 'PENDING_USER_REVIEW', geometryReadiness: 'NOT_ESTABLISHED', nativeVisibility: 'UNKNOWN', confirmedBindingsCreated: 0, databaseWrites: 0, runtimeActions: 0 };
  let outputPath, privateRoot; const budget = makeBudget();
  try {
    requireThat(path.isAbsolute(root) && SHA.test(inputSha256 ?? '') && SHA.test(sourceReceiptSha256 ?? ''), 'CANDIDATE_ARGUMENTS');
    requireThat(typeof output === 'string' && (output.startsWith('docs/pathfinder/evidence/current-inputs/') || output.startsWith('pathfinder-engine/.scratch/')), 'CANDIDATE_OUTPUT_SCOPE'); outputPath = await safePath(root, output, { output: true });
    requireThat(input.startsWith('pathfinder-engine/.scratch/'), 'CANDIDATE_PRIVATE_INPUT_REQUIRED');
    const privateRelative = `pathfinder-engine/.scratch/current-candidates-${randomUUID()}`;
    privateRoot = await safePath(root, privateRelative, { output: true }); await fs.mkdir(privateRoot);
    receipt.privateDirectory = privateRelative; await exclusive(path.join(privateRoot, 'owner.json'), JSON.stringify({ schemaVersion: 'pathfinder.current-inputs.candidate-owner.v1', id: path.basename(privateRoot), input, inputSha256, recordedAt: receipt.recordedAt }), 8192);
    receipt.currentPhase = 'source-and-input-binding';
    receipt.source = {};
    for (const relative of ['scripts/pathfinder-current-inputs/candidate-audit.mjs', 'scripts/pathfinder-current-inputs/candidate-lib.mjs', 'scripts/pathfinder-coverage/audit.mjs', 'scripts/pathfinder-coverage/retained.mjs', 'viewer-runtime/sdk/7.130.0/lmvworker.min.js']) receipt.source[relative] = sha256(await fs.readFile(path.resolve(root, relative)));
    requireThat(receipt.source['viewer-runtime/sdk/7.130.0/lmvworker.min.js'] === '9637ed11308c549b6dbd290d6270e53587122ebb5ffd7f87987ea9a8f897f46a', 'CANDIDATE_SDK_SOURCE_CHANGED');
    const production = await productionMatching(root, receipt.inputs);
    const raw = await checked(root, input, inputSha256, LIMITS.inputBytes, receipt.inputs), snapshot = parseOutput(raw, LIMITS.inputBytes);
    validateCurrentInput(snapshot, production.normalizeLocation, { projectId: PROJECT_ID, projectName: PROJECT_NAME, projectNumber: PROJECT_NUMBER, contentFingerprint: CONTENT });
    const sourceRaw = await checked(root, sourceReceipt, sourceReceiptSha256, 1024 * 1024, receipt.inputs), source = parseOutput(sourceRaw, 1024 * 1024);
    validateSourceReceipt(source, { path: input, bytes: raw.length, sha256: inputSha256, contentFingerprint: CONTENT });
    receipt.checks.push({ name: 'actual-source-project-selection-content-and-raw-binding', status: 'PASS' });
    receipt.sourceInput = { projectId: snapshot.project.id, modelVersionId: snapshot.model.id, selectionRevision: snapshot.selection.selectionRevision, contentFingerprint: CONTENT, sourceReceiptSha256, privateSnapshotSha256: inputSha256 };
    receipt.currentPhase = 'full-retained-inventory-verifier';
    const verifierRelative = privateRelative + '/historical-inventory-verifier.private.json';
    const verification = await runAudit({ root, output: verifierRelative });
    receipt.inventoryVerification = { path: verifierRelative, sha256: sha256(await fs.readFile(path.resolve(root, verifierRelative))), status: verification.status, scope: 'Frozen verifier full inventory/parts/hierarchy/fragments plus its historical selected QA fixtures. Historical QA endpoint coverage is not current business coverage.' };
    requireThat(verification.status === 'PASS_WITH_GAPS' && verification.technicalIntegrity === 'PASS' && verification.inventory?.partsChecked === 214, 'CANDIDATE_INVENTORY_VERIFIER');
    const inventoryRaw = await checked(root, retainedManifest.inventory.path, retainedManifest.inventory.sha256, 1024 * 1024, receipt.inputs), inventory = parseOutput(inventoryRaw, 1024 * 1024);
    receipt.packageIdentity = packageIdentityObservation(snapshot.model, inventory.package);
    receipt.checks.push({ name: 'full214-part-pinned-integrity-hierarchy-fragments', status: 'PASS' });
    receipt.currentPhase = 'pinned-property-decoder';
    const tables = await readProperties(root, snapshot.model, receipt.inputs, budget), decoder = propertyDecoder(tables, budget), index = endpointKeys(snapshot, production);
    requireThat(decoder.mappedObjectCount === inventory.externalIdentityObjectCount, 'CANDIDATE_MAPPING_COUNT');
    const treeIds = new Set(); let parts = 0, treeObjects = 0;
    receipt.currentPhase = 'tree-and-full-property-candidate-join';
    for (const part of inventory.parts) {
      budget(1024); const relative = path.posix.dirname(retainedManifest.inventory.path) + '/' + part.name;
      const rawPart = await checked(root, relative, part.sha256, 2 * 1024 ** 2, receipt.inputs), value = parseOutput(rawPart, 2 * 1024 ** 2); requireThat(rawPart.length === part.bytes, 'CANDIDATE_PART_BYTES');
      for (const row of value.objects) {
        budget(); requireThat(!treeIds.has(row.dbId) && row.externalIds.length === 1 && decoder.externalId(row.dbId) === row.externalIds[0], 'CANDIDATE_PDB_TREE_IDENTITY'); treeIds.add(row.dbId);
        addObjectCandidates(index, { dbId: row.dbId, name: row.name, externalId: row.externalIds[0], properties: decoder.properties(row.dbId) }, production, budget); treeObjects++;
      }
      parts++;
    }
    requireThat(treeObjects === inventory.objectCount, 'CANDIDATE_TREE_COUNT');
    const mappingOnly = []; for (let id = 1; id <= decoder.mappedObjectCount; id++) { budget(); if (!treeIds.has(id)) { mappingOnly.push(id); addObjectCandidates(index, { dbId: id, name: decoder.pdbName(id), externalId: decoder.externalId(id), properties: decoder.properties(id) }, production, budget, { treeReachable: false }); } }
    receipt.identity = { parts, treeObjects, mappedPropertyObjects: decoder.mappedObjectCount, mappingOnlyDbIds: mappingOnly, mappingOnlyCandidatePolicy: 'Decoded separately, treeReachable=false; excluded from ordinary tree candidate counts, matches retained for review. No omission-cause or geometry/visibility inference.' };
    receipt.properties = { status: 'PASS_AT_PINNED_JSON_V1_SEMANTICS', scope: 'Reachable tree names plus direct and SDK-style inherited eligible property aliases; exact display-name shadowing and inherited-hidden filtering. Not a live SDK replay.', ...decoder.stats() };
    receipt.checks.push({ name: 'all-tree-identities-and-bounded-pinned-inherited-alias-decoding', status: 'PASS' });
    receipt.currentPhase = 'private-candidate-output';
    const results = summarizeCandidates(snapshot, index), privateResult = privateRelative + '/candidates.private.json';
    receipt.privateResult = { path: privateResult, ...await exclusive(path.resolve(root, privateResult), JSON.stringify(results.privateResult), LIMITS.privateOutputBytes) };
    receipt.summary = results.publicSummary; receipt.status = 'PASS_WITH_GAPS';
    receipt.gaps = ['Metadata candidates are not confirmed shared bindings, equipment roles, bottom-centre points, native visibility, category eligibility or engineering acceptance.', 'The retained computational capture is still52objects/26routing leaves; this audit creates no new geometry, graph, location, proposal or job.', 'Business source snapshot is immutable copied input, not a claim that the source database stayed current after its recorded transaction.'];
    receipt.checks.push({ name: 'private-full-key-result-durable-before-public-summary', status: 'PASS' }); delete receipt.currentPhase;
  } catch (error) {
    receipt.failure = { code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'CANDIDATE_AUDIT_FAILED', phase: receipt.currentPhase ?? 'arguments-output', rawErrorValuesOmitted: true }; receipt.status = 'FAIL';
  }
  receipt.finishedAt = new Date().toISOString(); receipt.elapsedMilliseconds = performance.now() - started;
  receipt.semanticSource = { sdkWorkerSha256: '9637ed11308c549b6dbd290d6270e53587122ebb5ffd7f87987ea9a8f897f46a', utf16CodeUnitOffsets: { integerArrayParserExtraSlot: 11601, attributeSchemaAndJsonOffsets: 132579, getAttrValue: 134753, getObjectProperties: 135097, enumObjectPropertiesV1: 141114, hiddenDefinition: 144312 }, note: 'Offsets describe inspected pinned source. No native source parity or live SDK replay claimed.' };
  if (!outputPath) outputPath = await safePath(root, output, { output: true });
  const text = JSON.stringify(receipt, null, 2) + '\n';
  await exclusive(outputPath, text, LIMITS.publicOutputBytes); return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ strict: true, options: { root: { type: 'string' }, input: { type: 'string' }, sha256: { type: 'string' }, 'source-receipt': { type: 'string' }, 'source-receipt-sha256': { type: 'string' }, output: { type: 'string' } } });
    const result = await runCandidateAudit({ root: values.root, input: values.input, inputSha256: values.sha256, sourceReceipt: values['source-receipt'], sourceReceiptSha256: values['source-receipt-sha256'], output: values.output });
    console.log(JSON.stringify({ status: result.status, output: values.output, summary: result.summary ?? null, failure: result.failure ?? null })); process.exitCode = result.status === 'FAIL' ? 2 : 0;
  } catch (error) { console.error(JSON.stringify({ status: 'FAIL', code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'CANDIDATE_CLI_FAILED', noInputMutation: true })); process.exitCode = 2; }
}
