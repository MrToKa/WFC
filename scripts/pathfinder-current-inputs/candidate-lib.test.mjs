import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, propertyDecoder, validateCurrentInput, validateSourceReceipt, packageIdentityObservation, endpointKeys, addObjectCandidates, summarizeCandidates, makeBudget } from './candidate-lib.mjs';
import { productionMatching, runCandidateAudit } from './candidate-audit.mjs';
import { sha256 } from '../pathfinder-capacity/lib.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url)), production = await productionMatching(root);
const projectId = '0c0007c9-d73f-4d13-bc87-601c544727b7', modelId = '11111111-1111-4111-8111-111111111111', typeId = '22222222-2222-4222-8222-222222222222';
const uid = n => `${String(n).padStart(8, '0')}-3333-4333-8333-333333333333`;
const definition = (name, category, type = 20, displayName = name, flags = 0) => [name, category, type, null, null, displayName, flags, 0, 0];
const attrs = [0, definition('name', '__name__'), definition('source:name', 'Item', 20, 'Name'), definition('source:tag', 'Equipment', 20, 'Tag'), definition('instanceof_objid', '__instanceof__', 11, null, 1), definition('secret_location', 'Item', 20, 'Location', 1), definition('another:name', 'Other', 20, 'Name'), definition('lower_name', 'Other', 20, 'name'), definition('inline', 'Item', 11, 'Tag', 4)];
function pdb(objects, customAttrs = attrs) {
  const offs = [0], avs = [], vals = [0], ids = [0];
  for (const pairs of objects) { offs.push(avs.length / 2); ids.push('external-' + ids.length); for (const [id, value] of pairs) { if (customAttrs[id][6] & 4 && customAttrs[id][2] === 11) avs.push(id, value); else { vals.push(value); avs.push(id, vals.length - 1); } } }
  return { attrs: structuredClone(customAttrs), offs, avs, vals, ids };
}
function input(overrides = {}) {
  return { schemaVersion: 'pathfinder.current-inputs.snapshot.v1', project: { id: projectId, projectNumber: '1', name: 'HPU Aalborg', secondaryTrayLength: null, endConnectionLength: '5.00', additionalBendingPercent: '10' },
    selection: { activeModelVersionId: modelId, selectionRevision: '1' }, model: { id: modelId, projectId, contentFingerprint: 'a'.repeat(64), packageId: uid(9), supportProfile: 'svf-local-7.130.0-v1', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', state: 'ready', health: 'healthy', propertyResources: ['attrs', 'offs', 'avs', 'vals', 'ids'].map(n => ({ path: n, bytes: 10, sha256: 'a'.repeat(64) })) },
    cables: [{ id: uid(1), projectId, cableId: 1, tag: 'C1', fromLocation: '=A01', toLocation: '=A01', mto: 'Instrumentation', cableTypeId: typeId, revision: null, updatedAt: '2026-10-18T00:00:00.000Z', typeName: 'MV does not decide category', typeProjectId: projectId }], ...overrides };
}
const expectCode = (fn, code) => assert.throws(fn, error => error.code === code);
test('uses the actual reviewed production matcher and preserves punctuation, zeroes and NFC', () => {
  assert.equal(production.normalizeLocation(' =a01 '), '=A01'); assert.notEqual(production.normalizeLocation('=A01'), production.normalizeLocation('A01'));
  assert.equal(production.normalizeLocation('e\u0301'), production.normalizeLocation('é')); assert.notEqual(production.normalizeLocation('=A01'), production.normalizeLocation('=A1'));
});
test('JSON offsets append the SDK terminal slot and retain last mapped object properties', () => {
  const d = propertyDecoder(pdb([[[2, 'FIRST']], [[3, 'LAST']]])); assert.equal(d.mappedObjectCount, 2); assert.equal(d.properties(2)[0].value, 'LAST');
});
test('structural name is not a property alias and tree name remains the separately supplied object name', () => {
  const d = propertyDecoder(pdb([[[1, 'RAW NAME'], [2, 'DISPLAY NAME']]])); assert.deepEqual(d.properties(1).map(p => p.value), ['DISPLAY NAME']);
});
test('inherits eligible instance aliases and retains origin object identity', () => {
  const d = propertyDecoder(pdb([[[3, '=P01']], [[4, 1]]])); assert.equal(d.properties(2)[0].value, '=P01'); assert.equal(d.properties(2)[0].originDbId, 1);
});
test('local display name shadows prototype property even when categories/attribute names differ', () => {
  const d = propertyDecoder(pdb([[[2, '=P01']], [[4, 1], [6, '=LOCAL']]])); assert.deepEqual(d.properties(2).map(p => p.value), ['=LOCAL']);
});
test('display name shadowing is exact case before production normalization', () => {
  const d = propertyDecoder(pdb([[[2, '=P01']], [[4, 1], [7, '=LOCAL']]])); assert.deepEqual(d.properties(2).map(p => p.value), ['=LOCAL', '=P01']);
});
test('own hidden properties are included but inherited hidden properties are omitted', () => {
  const d = propertyDecoder(pdb([[[5, '=SECRET']], [[4, 1]]])); assert.equal(d.properties(1)[0].value, '=SECRET'); assert.equal(d.properties(2).length, 0);
});
test('last instance source wins exactly as the pinned worker, without combining prototypes', () => {
  const d = propertyDecoder(pdb([[[2, '=FIRST']], [[3, '=SECOND']], [[4, 1], [4, 2]]])); assert.deepEqual(d.properties(3).map(p => p.value), ['=SECOND']);
});
test('duplicate prototype display names survive when no local display name shadows them', () => {
  const d = propertyDecoder(pdb([[[2, '=FIRST'], [6, '=SECOND']], [[4, 1]]])); assert.deepEqual(d.properties(2).map(p => p.value), ['=FIRST', '=SECOND']);
});
test('inline dbkey values follow flags and type, not the value table', () => {
  const d = propertyDecoder(pdb([[[8, 987654321]]])); assert.equal(d.properties(1)[0].value, '987654321');
});
test('nested inheritance applies shadowing at each level', () => {
  const d = propertyDecoder(pdb([[[2, '=P'], [3, '=TAG']], [[4, 1], [6, '=MIDDLE']], [[4, 2]]])); assert.deepEqual(d.properties(3).map(p => p.value), ['=MIDDLE', '=TAG']);
});
for (const [name, objects, code] of [
  ['self instance cycle', [[[4, 1]]], 'PDB_INSTANCE_CYCLE'],
  ['mutual instance cycle', [[[4, 2]], [[4, 1]]], 'PDB_INSTANCE_CYCLE'],
  ['invalid instance target', [[[4, 99]]], 'PDB_INSTANCE_REFERENCE'],
]) test('fails closed on ' + name, () => { const d = propertyDecoder(pdb(objects)); expectCode(() => d.properties(1), code); });
test('enforces depth without depending on the JavaScript stack limit', () => {
  const objects = Array.from({ length: LIMITS.depth + 2 }, (_, i) => i ? [[4, i]] : [[2, 'ROOT']]); const d = propertyDecoder(pdb(objects)); expectCode(() => d.properties(objects.length), 'PDB_INSTANCE_DEPTH');
});
for (const [name, mutate, code] of [
  ['different version', p => { p.attrs[0] = 'pdb version 2'; }, 'PDB_JSON_V1_REQUIRED'],
  ['nonmonotonic offsets', p => { p.offs[0] = 2; }, 'PDB_ARRAY_COUNTS'],
  ['out of range offsets', p => { p.offs[1] = 999; }, 'PDB_OFFSET_RANGE'],
  ['unknown attribute', p => { p.avs[0] = 999; }, 'PDB_ATTRIBUTE_REFERENCE'],
  ['out of range value', p => { p.avs[1] = 999; }, 'PDB_AV_REFERENCE'],
  ['duplicate external IDs', p => { p.ids[2] = p.ids[1]; }, 'PDB_EXTERNAL_ID'],
  ['nonfinite values', p => { p.vals[1] = Infinity; }, 'PDB_VALUE_SCHEMA'],
]) test('rejects ' + name, () => { const p = pdb([[[2, 'A']], [[3, 'B']]]); mutate(p); expectCode(() => propertyDecoder(p), code); });
test('work budget fails before unbounded traversal', () => { const budget = makeBudget({ ...LIMITS, work: 1 }); expectCode(() => propertyDecoder(pdb([[[2, 'A']]]), budget), 'CANDIDATE_WORK_LIMIT'); });
test('valid input preserves nulls, exact decimal strings and raw category', () => { const v = input(); assert.equal(validateCurrentInput(v, production.normalizeLocation), v); assert.equal(v.project.secondaryTrayLength, null); assert.equal(v.project.endConnectionLength, '5.00'); assert.equal(v.cables[0].mto, 'Instrumentation'); });
test('legitimate absent cable type is preserved as exactly three nulls and never supplies a category', () => { const v = input(); Object.assign(v.cables[0], { cableTypeId: null, typeProjectId: null, typeName: null, mto: null }); assert.equal(validateCurrentInput(v, production.normalizeLocation), v); assert.equal(endpointKeys(v, production).effectiveCategoryCounts.requiresResolution, 1); });
for (const [name, mutate, code] of [
  ['foreign model project', v => { v.model.projectId = uid(3); }, 'CURRENT_SELECTED_MODEL'],
  ['foreign cable project', v => { v.cables[0].projectId = uid(3); }, 'CURRENT_CABLE_SCHEMA'],
  ['foreign type owner', v => { v.cables[0].typeProjectId = uid(3); }, 'CURRENT_CABLE_SCHEMA'],
  ['mixed missing type identity', v => { v.cables[0].cableTypeId = null; }, 'CURRENT_CABLE_SCHEMA'],
  ['mixed missing type owner', v => { v.cables[0].typeProjectId = null; }, 'CURRENT_CABLE_SCHEMA'],
  ['mixed missing type name', v => { v.cables[0].typeName = null; }, 'CURRENT_CABLE_SCHEMA'],
  ['selected model mismatch', v => { v.selection.activeModelVersionId = uid(3); }, 'CURRENT_SELECTED_MODEL'],
  ['unhealthy model', v => { v.model.health = 'unavailable'; }, 'CURRENT_SELECTED_MODEL'],
  ['duplicate cable ID', v => { v.cables.push(structuredClone(v.cables[0])); }, 'CURRENT_CABLE_SCHEMA'],
  ['numeric invented project allowance', v => { v.project.endConnectionLength = 5; }, 'CURRENT_PROJECT_SCHEMA'],
]) test('input refuses ' + name, () => { const v = input(); mutate(v); expectCode(() => validateCurrentInput(v, production.normalizeLocation), code); });
test('project name and converted fingerprint gates are explicit', () => { expectCode(() => validateCurrentInput(input(), production.normalizeLocation, { projectName: 'Other' }), 'CURRENT_PROJECT_IDENTITY'); expectCode(() => validateCurrentInput(input(), production.normalizeLocation, { contentFingerprint: 'b'.repeat(64) }), 'CURRENT_CONTENT_BINDING'); });
test('exact current project identity requires the full observed name and matching project number', () => {
  const v = input(), expected = { projectId, projectName: 'HPU Aalborg 2023', projectNumber: 'P230039 / H.7500062' }; Object.assign(v.project, { name: expected.projectName, projectNumber: expected.projectNumber });
  assert.equal(validateCurrentInput(v, production.normalizeLocation, expected), v);
  for (const change of [{ name: 'HPU Aalborg' }, { name: 'hpu aalborg 2023' }, { name: 'HPU Aalborg 2023 ' }, { projectNumber: 'P230039' }, { projectNumber: 'P230039 / H.7500062 ' }, { id: uid(55) }]) {
    const copy = structuredClone(v); Object.assign(copy.project, change); expectCode(() => validateCurrentInput(copy, production.normalizeLocation, expected), 'CURRENT_PROJECT_IDENTITY');
  }
});
test('same converted content may have a different portable package UUID without being a wrong model', () => { const model = input().model, observed = packageIdentityObservation(model, { packageId: uid(10), contentFingerprint: model.contentFingerprint }); assert.equal(observed.packageIdsEqual, false); expectCode(() => packageIdentityObservation(model, { packageId: uid(10), contentFingerprint: 'f'.repeat(64) }), 'CANDIDATE_INVENTORY_CONTENT_BINDING'); });
test('missing unique ambiguous and cross-end reuse use distinct keys and usages consistently', () => {
  const v = input(); v.cables.push({ ...v.cables[0], id: uid(2), cableId: 2, fromLocation: '=B', toLocation: '=MISSING' }); v.cables.push({ ...v.cables[0], id: uid(3), cableId: 3, fromLocation: null, toLocation: '  ' });
  const index = endpointKeys(v, production); for (const obj of [{ dbId: 1, name: '=A01' }, { dbId: 2, name: '=B' }, { dbId: 3, name: '=B' }]) addObjectCandidates(index, { ...obj, externalId: 'ext' + obj.dbId, properties: [] }, production);
  const r = summarizeCandidates(v, index); assert.deepEqual(r.publicSummary.distinctKeys, { missing: 1, unique: 1, ambiguous: 1 }); assert.deepEqual(r.publicSummary.usages, { missing: 3, unique: 2, ambiguous: 1 }); assert.equal(r.publicSummary.reusedKeys, 1); assert.equal(r.privateResult.keys[0].confirmedBinding, false); assert.equal(r.privateResult.emptyEndpoints.length, 2);
});
test('same object matching tree plus properties is one candidate; separate objects remain ambiguous', () => {
  const v = input(), index = endpointKeys(v, production), object = { dbId: 1, name: '=A01', externalId: 'ext1', properties: [{ category: 'Item', name: 'Tag', value: '=A01', originDbId: 1, attributeId: 3 }] };
  addObjectCandidates(index, object, production); assert.equal(index.keys.get('=A01').candidates.size, 1); addObjectCandidates(index, { ...object, dbId: 2, externalId: 'ext2' }, production); assert.equal(index.keys.get('=A01').candidates.size, 2);
});
test('unlisted Description does not become an equipment alias', () => { const index = endpointKeys(input(), production); addObjectCandidates(index, { dbId: 1, name: 'other', properties: [{ name: 'Description', value: '=A01' }] }, production); assert.equal(index.keys.get('=A01').candidates.size, 0); });
test('mapping-only matches stay separate and cannot turn a missing reachable-tree match into unique', () => {
  const index = endpointKeys(input(), production); addObjectCandidates(index, { dbId: 388764, name: '=A01', externalId: 'mapping-only', properties: [] }, production, undefined, { treeReachable: false });
  const r = summarizeCandidates(input(), index); assert.equal(r.publicSummary.distinctKeys.missing, 1); assert.equal(r.publicSummary.mappingOnlyMatchedKeys, 1); assert.equal(r.privateResult.keys[0].mappingOnlyCandidates[0].treeReachable, false); assert.equal(r.privateResult.keys[0].candidates.length, 0); assert.equal(r.privateResult.keys[0].mappingOnlyReviewRequired, true);
});
test('existing requested capture comparison reports 257 distinct names and long raw keys without claiming a capture', () => {
  const v = input(); v.cables = Array.from({ length: 129 }, (_, i) => ({ ...v.cables[0], id: uid(i + 1), cableId: i + 1, fromLocation: 'FROM-' + i, toLocation: i ? 'TO-' + i : 'L'.repeat(257) }));
  const r = summarizeCandidates(v, endpointKeys(v, production)); assert.equal(r.publicSummary.distinctNonemptyKeys, 258); assert.equal(r.publicSummary.maxRawEndpointNameLength, 257); assert.equal(r.publicSummary.existingRequestedCaptureLimits.normalizedDistinctKeysExceedNamesLimit, true); assert.equal(r.publicSummary.existingRequestedCaptureLimits.maxRawNameExceedsCharactersLimit, true);
});
test('raw trimmed case-sensitive names can exceed256 while normalized candidate keys remain one', () => {
  const v = input(); v.cables = Array.from({ length: 257 }, (_, i) => ({ ...v.cables[0], id: uid(i + 1), cableId: i + 1, fromLocation: ' ' + [...'abcdefghi'].map((letter, bit) => i & 1 << bit ? letter.toUpperCase() : letter).join('') + ' ', toLocation: null }));
  const index = endpointKeys(v, production), r = summarizeCandidates(v, index).publicSummary; assert.equal(index.keys.size, 1); assert.equal(r.rawTrimmedDistinctEndpointCount, 257); assert.equal(r.existingRequestedCaptureLimits.normalizedDistinctKeysExceedNamesLimit, false); assert.equal(r.existingRequestedCaptureLimits.rawTrimmedDistinctExceeds256, true); assert.equal(r.existingRequestedCaptureLimits.allCableEndpointNamesFitCurrentUiNameAndLengthLimits, false);
});
test('trimmed length matches current UI validation while preserving untrimmed raw length separately', () => {
  const v = input(); v.cables[0].fromLocation = ' '.repeat(200) + 'X' + ' '.repeat(200); v.cables[0].toLocation = 'X';
  const r = summarizeCandidates(v, endpointKeys(v, production)).publicSummary; assert.equal(r.maxRawEndpointNameLength, 401); assert.equal(r.maxRawTrimmedEndpointNameLength, 1); assert.equal(r.rawTrimmedDistinctEndpointCount, 1); assert.equal(r.existingRequestedCaptureLimits.maxRawNameExceedsCharactersLimit, true); assert.equal(r.existingRequestedCaptureLimits.maxRawTrimmedNameExceedsCharactersLimit, false); assert.equal(r.existingRequestedCaptureLimits.allCableEndpointNamesFitCurrentUiNameAndLengthLimits, true);
});
test('PDB structural name follows last instance name fallback for mapping-only diagnostics', () => { const d = propertyDecoder(pdb([[[1, '=PROTO']], [[4, 1]]])); assert.equal(d.pdbName(2), '=PROTO'); });
test('alias values match the unmodified pinned SDK getObjectProperties method on synthetic direct/inherited cases', async () => {
  const raw = await fs.readFile(path.join(root, 'viewer-runtime/sdk/7.130.0/lmvworker.min.js')); assert.equal(sha256(raw), '9637ed11308c549b6dbd290d6270e53587122ebb5ffd7f87987ea9a8f897f46a');
  const source = raw.toString('utf8'), start = source.indexOf('getObjectProperties(t,e,r,n,s){'), end = source.indexOf('getExternalIdMapping(t){', start); assert.ok(start > 0 && end > start);
  const Reference = Function('return class PinnedReference {' + source.slice(start, end) + '}')();
  const cases = [
    [[[1, 'Name'], [2, '=DIRECT']]],
    [[[3, '=P']], [[4, 1]]],
    [[[2, '=P']], [[4, 1], [6, '=LOCAL']]],
    [[[2, '=P']], [[4, 1], [7, '=LOCAL']]],
    [[[5, '=HIDDEN']], [[4, 1]]],
    [[[2, '=FIRST']], [[3, '=SECOND']], [[4, 1], [4, 2]]],
    [[[2, '=A'], [6, '=B']], [[4, 1]]],
    [[[2, '=P'], [3, '=TAG']], [[4, 1], [6, '=MIDDLE']], [[4, 2]]],
    [[[8, 987654321]]],
  ];
  let compared = 0;
  for (const objects of cases) {
    const tables = pdb(objects), decoder = propertyDecoder(tables), sdk = new Reference(), offsets = [...tables.offs, tables.avs.length / 2]; Object.assign(sdk, { _attrs: tables.attrs, _instanceOfAttrId: 4, _nameAttrId: 1, _nameSuffixAttrId: undefined, _fileType: null });
    sdk.externalIdsLoaded = () => false;
    sdk.enumObjectProperties = (id, callback) => { for (let i = offsets[id] * 2; i < offsets[id + 1] * 2; i += 2) callback(tables.avs[i], tables.avs[i + 1]); };
    sdk.getAttrValue = (id, valueId) => tables.attrs[id][6] & 4 && tables.attrs[id][2] === 11 ? valueId : tables.vals[valueId];
    sdk.attributeHidden = id => Boolean(tables.attrs[id][6] & 1) || ['__parent__', '__child__', '__viewable_in__', '__externalref__'].includes(tables.attrs[id][1]);
    sdk._getObjectProperty = (id, valueId) => ({ displayName: tables.attrs[id][5] || tables.attrs[id][0], displayCategory: tables.attrs[id][1], displayValue: sdk.getAttrValue(id, valueId) });
    for (let id = 1; id <= objects.length; id++) { const expected = sdk.getObjectProperties(id, undefined, false).properties.map(p => ({ category: p.displayCategory, name: p.displayName, value: String(p.displayValue) })), observed = decoder.properties(id).map(({ category, name, value }) => ({ category, name, value })); assert.deepEqual(observed, expected); compared++; }
  }
  assert.equal(compared, 18);
});
test('unknown raw categories are not inferred from type names or normalized', () => {
  const v = input(); v.cables[0].mto = 'lv'; v.cables.push({ ...v.cables[0], id: uid(2), cableId: 2, mto: null }); const r = endpointKeys(v, production); assert.equal(r.categoryCounts.unknown, 1); assert.equal(r.categoryCounts.null, 1); assert.deepEqual(r.effectiveCategoryCounts, { MV: 0, LV: 0, Control: 0, requiresResolution: 2 });
});
test('public summary contains no business endpoint keys, tag, or unknown MTO values', () => { const v = input(); v.cables[0].mto = 'PRIVATE-MTO'; const r = summarizeCandidates(v, endpointKeys(v, production)); assert.doesNotMatch(JSON.stringify(r.publicSummary), /=A01|PRIVATE-MTO|C1/); });
test('source receipt requires PASS preservation and exact raw bytes/hash/model binding', () => {
  const expected = { path: 'pathfinder-engine/.scratch/test/private.json', bytes: 7, sha256: 'a'.repeat(64), contentFingerprint: 'b'.repeat(64) }, receipt = { schemaVersion: 'pathfinder.current-inputs.source-receipt.v1', status: 'PASS', preservation: { status: 'PASS' }, checkedModelFingerprint: expected.contentFingerprint, privateSnapshot: { path: expected.path, bytes: expected.bytes, sha256: expected.sha256 } };
  assert.equal(validateSourceReceipt(receipt, expected), receipt); for (const mutate of [r => { r.status = 'FAIL'; }, r => { r.privateSnapshot.bytes++; }, r => { r.privateSnapshot.sha256 = 'c'.repeat(64); }, r => { r.preservation.status = 'FAIL'; }]) { const copy = structuredClone(receipt); mutate(copy); expectCode(() => validateSourceReceipt(copy, expected), 'SOURCE_RECEIPT_BINDING'); }
});
test('durably retains a sanitized failure before any verifier or PDB audit when source input binding is invalid', async () => {
  const work = await fs.mkdtemp(path.join(root, 'pathfinder-engine/.scratch/candidate-controls-')), relative = path.relative(root, work).replaceAll('\\', '/'), inputPath = relative + '/input.private.json', output = relative + '/failure.json';
  await fs.writeFile(path.join(work, 'owner.json'), JSON.stringify({ scope: 'synthetic candidate controls; retained, no cleanup' }), { flag: 'wx' }); const fixture = input(); Object.assign(fixture.project, { name: 'HPU Aalborg 2023', projectNumber: 'P230039 / H.7500062' }); const raw = Buffer.from(JSON.stringify(fixture)); await fs.writeFile(path.resolve(root, inputPath), raw, { flag: 'wx' });
  const r = await runCandidateAudit({ root, input: inputPath, inputSha256: sha256(raw), sourceReceipt: relative + '/absent.json', sourceReceiptSha256: 'a'.repeat(64), output });
  assert.equal(r.status, 'FAIL'); assert.equal(r.failure.code, 'CURRENT_CONTENT_BINDING'); assert.equal((await fs.readFile(path.resolve(root, inputPath))).equals(raw), true); const saved = JSON.parse(await fs.readFile(path.resolve(root, output))); assert.equal(saved.status, 'FAIL'); assert.doesNotMatch(JSON.stringify(saved), /=A01|MV does not decide/);
});
