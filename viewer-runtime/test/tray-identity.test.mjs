import test from 'node:test';
import assert from 'node:assert/strict';
import { readTrayObjectIdentities, resolveTrayObjectIdentities, TRAY_IDENTITY_LIMITS, validateTrayIdentityRequest, validateTrayIdentityResponse } from '../tray-identity.mjs';

const G = '7586ffbb-1d0a-5942-b687-06884123c866', H = '00000000-0000-4000-8000-000000000099';
const identity = changes => ({ externalId: null, guid: G, sourceFile: '01-50_MSR_Kabeltassen.dwg', ...changes });
const properties = (value = G, source = '01-50_MSR_Kabeltassen.dwg') => [
  { displayCategory: 'Item', displayName: 'GUID', displayValue: value },
  { displayCategory: 'Item', displayName: 'Source File', displayValue: source },
];
const childProperty = objectId => ({ displayName: 'child', displayValue: objectId, displayCategory: '__child__',
  attributeName: 'child', type: 11, units: null, hidden: 1, precision: 0 });
function fixture(entries, mapping = {}) {
  const rows = new Map(entries), ids = [0, ...rows.keys()], calls = [];
  const tree = { getRootId: () => 0, enumNodeChildren: (_root, visit) => { for (const value of ids.slice(1)) visit(value); }, getNodeName: () => '3D-Volumenkörper' };
  const model = { getObjectTree: yes => yes(tree), getExternalIdMapping: yes => yes(mapping),
    getBulkProperties: (batch, options, yes) => { calls.push([...batch]); assert.equal(options.ignoreHidden, false);
      yes(batch.map(dbId => ({ dbId, properties: rows.get(dbId) ?? [] }))); } };
  return { model, calls, rows };
}
const resolve = async (f, input = identity(), options) => (await resolveTrayObjectIdentities(f.model, [input], options))[0];

test('same GUID and source find changed database ID despite localized object names and changed external ID', async () => {
  const old = fixture([[2, properties()]], { oldExternal: 2 }), next = fixture([[71, properties()]], { newExternal: 71 });
  const [seed] = await readTrayObjectIdentities(old.model, [2]);
  assert.equal(seed.identity.externalId, 'oldExternal');
  const match = await resolve(next, seed.identity);
  assert.equal(match.status, 'unique'); assert.deepEqual(match.objectIds, [71]);
});
test('same complete SDK external identity resolves without a model-wide property scan', async () => {
  const f = fixture([[9, []]], { stableExternal: 9 });
  const match = await resolve(f, identity({ guid: null, sourceFile: null, externalId: 'stableExternal' }));
  assert.equal(match.status, 'unique'); assert.deepEqual(match.objectIds, [9]); assert.equal(f.calls.length, 0);
});
test('external identity cannot override conflicting GUID or source constraints', async () => {
  const f = fixture([[9, properties(H)], [10, properties()]], { staleExternal: 9 });
  const match = await resolve(f, identity({ externalId: 'staleExternal' }));
  assert.equal(match.status, 'unique'); assert.deepEqual(match.objectIds, [10]);
});
test('duplicate GUIDs remain ambiguous without a source and source narrows them safely', async () => {
  const f = fixture([[2, properties(G, 'A.dwg')], [3, properties(G, 'B.dwg')]]);
  const ambiguous = await resolve(f, identity({ sourceFile: null }));
  assert.equal(ambiguous.status, 'ambiguous'); assert.deepEqual(ambiguous.objectIds, [2, 3]);
  assert.deepEqual((await resolve(f, identity({ sourceFile: 'B.dwg' }))).objectIds, [3]);
});
test('duplicate GUID and source never selects the first object', async () => {
  const f = fixture([[2, properties()], [3, properties()], [4, properties()]]);
  const match = await resolve(f); assert.equal(match.status, 'ambiguous'); assert.equal(match.objectIds.length, 2);
});
test('old numeric ID or identical display name cannot create a correspondence', async () => {
  const f = fixture([[2, properties(H)]]);
  const match = await resolve(f); assert.equal(match.status, 'missing'); assert.deepEqual(match.objectIds, []);
});
test('incomplete GUID scan does not infer uniqueness or absence and is not cached', async () => {
  const f = fixture([[2, properties()], [3, []]]), original = f.model.getBulkProperties;
  let omit = true;
  f.model.getBulkProperties = (ids, options, yes) => original(ids, options, rows => yes(omit ? rows.filter(row => row.dbId !== 3) : rows));
  assert.equal((await resolve(f)).status, 'unavailable');
  assert.equal((await resolve(f, identity({ guid: H }))).status, 'unavailable');
  omit = false; assert.equal((await resolve(f)).status, 'unique');
});
test('completed GUID property index is reused across request batches', async () => {
  const f = fixture([[2, properties()]]);
  await resolve(f); const calls = f.calls.length;
  await resolve(f, identity({ guid: H })); assert.equal(f.calls.length, calls);
});
test('all model rows are read in bounded batches and hidden matching objects remain included', async () => {
  const entries = Array.from({ length: 600 }, (_, at) => [at + 1, at === 599 ? properties() : []]);
  const f = fixture(entries), match = await resolve(f);
  assert.deepEqual(match.objectIds, [600]); assert.equal(f.calls.length, 3); assert.ok(f.calls.every(batch => batch.length <= 256));
});
test('large SDK aggregation hierarchy does not consume the identity metadata quota', async () => {
  const childCount = TRAY_IDENTITY_LIMITS.propertiesPerRow + 1;
  const entries = Array.from({ length: childCount }, (_, at) => [at + 1, at === childCount - 1 ? properties() : []]);
  const f = fixture(entries);
  f.rows.set(0, entries.map(([objectId]) => childProperty(objectId)));
  const match = await resolve(f);
  assert.equal(match.status, 'unique'); assert.deepEqual(match.objectIds, [childCount]);
  assert.equal(f.calls.length, Math.ceil((childCount + 1) / TRAY_IDENTITY_LIMITS.batch));
});
test('GUID and source on a large hierarchy node remain readable, including hidden metadata', async () => {
  const props = properties().map(property => ({ ...property, hidden: 1 }));
  const links = Array.from({ length: TRAY_IDENTITY_LIMITS.propertiesPerRow + 1 }, (_, at) => childProperty(at + 3));
  const f = fixture([[2, [...links, ...props]]]);
  const [seed] = await readTrayObjectIdentities(f.model, [2]);
  assert.equal(seed.identity.guid, G); assert.equal(seed.identity.sourceFile, identity().sourceFile.toLowerCase());
  assert.deepEqual((await resolve(f)).objectIds, [2]);
});
test('large hierarchy never hides duplicate GUID and source in a later batch', async () => {
  const entries = Array.from({ length: 300 }, (_, at) => [at + 1, at === 0 || at === 299 ? properties() : []]);
  const f = fixture(entries);
  f.rows.set(0, Array.from({ length: TRAY_IDENTITY_LIMITS.propertiesPerRow + 1 }, (_, at) => childProperty(at + 1)));
  const match = await resolve(f);
  assert.equal(match.status, 'ambiguous'); assert.deepEqual(match.objectIds, [1, 300]);
});
test('only complete SDK structural relation shapes are exempt from the metadata quota', async () => {
  for (const changes of [{ hidden: false }, { hidden: 0 }, { type: 20 }, { displayCategory: 'Item' },
    { attributeName: 'GUID' }, { displayValue: '2' }, { displayValue: -1 }]) {
    const property = { ...childProperty(2), ...changes };
    const f = fixture([[2, Array(TRAY_IDENTITY_LIMITS.propertiesPerRow + 1).fill(property)]]);
    await assert.rejects(() => resolve(f), error => error.code === 'TRAY_IDENTITY_ROW_LIMIT');
  }
  const metadata = { displayCategory: 'Item', displayName: 'Description', displayValue: 'Ordinary metadata', hidden: 1 };
  const f = fixture([[2, Array(TRAY_IDENTITY_LIMITS.propertiesPerRow + 1).fill(metadata)]]);
  await assert.rejects(() => readTrayObjectIdentities(f.model, [2]), error => error.code === 'TRAY_IDENTITY_ROW_LIMIT');
});
test('raw structural property count is budgeted before reading any oversized row entries', async () => {
  let entryRead = false;
  const props = new Proxy([], { get(target, key, receiver) {
    if (key === 'length') return TRAY_IDENTITY_LIMITS.scannedProperties + 1;
    entryRead = true; return Reflect.get(target, key, receiver);
  } });
  const f = fixture([[2, props]]);
  await assert.rejects(() => resolve(f), error => error.code === 'TRAY_IDENTITY_INDEX_LIMIT');
  assert.equal(entryRead, false);
});
test('large hierarchy with omitted SDK rows remains unavailable and is not cached', async () => {
  const f = fixture([[2, properties()], [3, []]]), original = f.model.getBulkProperties;
  f.rows.set(0, Array.from({ length: TRAY_IDENTITY_LIMITS.propertiesPerRow + 1 }, (_, at) => childProperty(at + 1)));
  let omit = true;
  f.model.getBulkProperties = (ids, options, yes) => original(ids, options, rows => yes(omit ? rows.filter(row => row.dbId !== 3) : rows));
  assert.equal((await resolve(f)).status, 'unavailable');
  const incompleteCalls = f.calls.length;
  omit = false;
  assert.equal((await resolve(f)).status, 'unique'); assert.ok(f.calls.length > incompleteCalls);
});
test('missing or malformed SDK property arrays report read failures and do not establish cached matches', async () => {
  for (const props of [undefined, null, {}, 'unavailable']) {
    const f = fixture([[2, properties()]]), original = f.model.getBulkProperties;
    f.model.getBulkProperties = (ids, options, yes) => original(ids, options, rows => yes(rows.map(row => row.dbId === 2 ? { dbId: 2, properties: props } : row)));
    await assert.rejects(() => resolve(f), error => error.code === 'TRAY_IDENTITY_READ_FAILED');
    f.model.getBulkProperties = original;
    assert.equal((await resolve(f)).status, 'unique');
  }
});
test('conflicting GUID properties never establish a source identity', async () => {
  const f = fixture([[2, [...properties(), { displayName: 'GUID', displayValue: H }]]]);
  const [seed] = await readTrayObjectIdentities(f.model, [2]); assert.equal(seed.identity.guid, null);
  assert.equal((await resolve(f)).status, 'missing');
});
test('GUID case and Windows source path separators are normalized without stripping source path', async () => {
  const f = fixture([[2, properties(G.toUpperCase(), 'Models\\TRAYS.DWG')], [3, properties(G, 'Other/TRAYS.DWG')]]);
  assert.deepEqual((await resolve(f, identity({ sourceFile: 'models/TRAYS.dwg' }))).objectIds, [2]);
  assert.equal((await resolve(f, identity({ sourceFile: 'TRAYS.dwg' }))).status, 'missing');
});
test('duplicate SDK external aliases for one dbId do not become an arbitrary persisted identity', async () => {
  const f = fixture([[2, properties()]], { first: 2, second: 2 });
  assert.equal((await readTrayObjectIdentities(f.model, [2]))[0].identity.externalId, null);
});
test('current GUID properties normalize braces, outer whitespace, case and compatibility property labels', async () => {
  const props = properties(` \t{${G.toUpperCase()}} \t`); props[0].displayName = 'ＧＵＩＤ';
  const f = fixture([[2, props]]);
  assert.equal((await readTrayObjectIdentities(f.model, [2]))[0].identity.guid, G);
  assert.deepEqual((await resolve(f)).objectIds, [2]);
});
test('SDK external identity retains exact whitespace without becoming an alias', async () => {
  const f = fixture([[2, []]], { ' exact external ': 2 });
  assert.equal((await readTrayObjectIdentities(f.model, [2]))[0].identity.externalId, ' exact external ');
  assert.equal((await resolve(f, identity({ externalId: 'exact external', guid: null, sourceFile: null }))).status, 'missing');
  assert.deepEqual((await resolve(f, identity({ externalId: ' exact external ', guid: null, sourceFile: null }))).objectIds, [2]);
});
test('near-limit valid identity requests allow room for echoed match wrappers in the response', async () => {
  let identities;
  for (let length = 600; length <= 1024; length++) {
    const candidate = Array.from({ length: 32 }, (_, at) => identity({ externalId: 'x'.repeat(length) + at, guid: null, sourceFile: null }));
    if (!validateTrayIdentityRequest({ schemaVersion: 'wfc.pf.tray-identity-request.v1', identities: candidate })) break;
    identities = candidate;
  }
  const request = { schemaVersion: 'wfc.pf.tray-identity-request.v1', identities };
  assert.ok(Buffer.byteLength(JSON.stringify(request)) > 23500);
  const mapping = Object.fromEntries(identities.map((value, at) => [value.externalId, at + 1]));
  const f = fixture(identities.map((_, at) => [at + 1, []]), mapping);
  const matches = await resolveTrayObjectIdentities(f.model, identities);
  const response = { schemaVersion: 'wfc.pf.tray-identity-response.v1', matches };
  assert.ok(matches.every(match => match.status === 'unique'));
  assert.ok(Buffer.byteLength(JSON.stringify(response)) > 24576);
  assert.equal(validateTrayIdentityResponse(response), true);
  const oversized = { ...response, matches: matches.map(match => ({ ...match, identity: identity({ externalId: 'x'.repeat(1024), sourceFile: 'y'.repeat(1024) }) })) };
  assert.equal(validateTrayIdentityResponse(oversized), false);
});
test('cancellation and active model changes stop identity reads', async () => {
  const f = fixture([[2, properties()]]), controller = new AbortController(); controller.abort();
  await assert.rejects(() => resolve(f, identity(), { signal: controller.signal }), error => error.name === 'AbortError');
  await assert.rejects(() => resolve(f, identity(), { check: () => { throw new Error('MODEL_CHANGED'); } }), /MODEL_CHANGED/);
});
test('malformed and duplicated SDK property rows refuse instead of matching partial output', async () => {
  const f = fixture([[2, properties()]]);
  f.model.getBulkProperties = (_ids, _options, yes) => yes([{ dbId: 2, properties: properties() }, { dbId: 2, properties: properties() }]);
  await assert.rejects(() => resolve(f), error => error.code === 'TRAY_IDENTITY_READ_FAILED');
});
test('strict request and result envelopes retain bounded IDs and ambiguity semantics', () => {
  const request = { schemaVersion: 'wfc.pf.tray-identity-request.v1', identities: [identity()] };
  assert.equal(validateTrayIdentityRequest(request), true);
  for (const input of [{ ...request, extra: true }, { ...request, identities: [identity({ externalId: null, guid: null })] },
    { ...request, identities: Array.from({ length: 33 }, () => identity()) }, { ...request, identities: [identity({ guid: 'not-guid' })] },
    { ...request, identities: Array.from({ length: 32 }, () => identity({ sourceFile: 'a'.repeat(1024), externalId: 'b'.repeat(1024) })) }])
    assert.equal(validateTrayIdentityRequest(input), false);
  const result = { schemaVersion: 'wfc.pf.tray-identity-response.v1', matches: [{ identity: identity(), status: 'unique', objectIds: [2] }] };
  assert.equal(validateTrayIdentityResponse(result), true);
  assert.equal(validateTrayIdentityResponse({ ...result, matches: [{ ...result.matches[0], status: 'ambiguous' }] }), false);
  assert.equal(validateTrayIdentityResponse({ ...result, matches: [{ ...result.matches[0], objectIds: [-1] }] }), false);
});
