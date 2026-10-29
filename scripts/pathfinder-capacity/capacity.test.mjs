import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, sha256, parseOutput, parseStat, rssBytes, validateManifest, validateResponse, routeDigest, stableContainerMetadata, assertContainer } from './lib.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const manifest = () => ({ schemaVersion: 'pathfinder.capacity.input.v1', label: 'Synthetic validation only', snapshot: { path: '/input/snapshots/' + id + '.json', sha256: 'a'.repeat(64), projectId: id, modelVersionId: id, contentSha256: 'b'.repeat(64) }, request: { category: 'Control', from: [0, 0, .5], to: [10, 0, .5], options: { connectionToleranceMeters: 1, sampleSpacingMeters: .125, secondaryDistanceMeters: 2, preferVerticalApproach: true, maxGraphNodes: 200000, maxGraphConnections: 1000000 }, projectSettings: { revision: '2', secondaryTrayLength: '3', endConnectionLength: '5', additionalBendingPercent: '10' }, connectionGap: '1' }, repeatQueries: 8, caseTimeoutMilliseconds: 30000, totalTimeoutMilliseconds: 180000, syntheticSizes: [8, 64, 256, 1024] });
test('known input is preserved without altering project values or points', () => { const input = manifest(), before = canonical(input); assert.equal(validateManifest(input), input); assert.equal(canonical(input), before); });
for (const [name, mutate] of [
  ['nonfinite point', v => { v.request.from[0] = NaN; }],
  ['invented option', v => { v.request.options.extra = true; }],
  ['gap/option mismatch', v => { v.request.options.connectionToleranceMeters = .25; }],
  ['missing decimal', v => { v.request.projectSettings.endConnectionLength = null; }],
  ['nonnumeric settings revision', v => { v.request.projectSettings.revision = 'fixture'; }],
  ['overflow settings revision', v => { v.request.projectSettings.revision = '9223372036854775808'; }],
  ['excess deadline', v => { v.totalTimeoutMilliseconds = 300001; }],
  ['excess repetition', v => { v.repeatQueries = 65; }],
  ['excess synthetic size', v => { v.syntheticSizes = [2048]; }],
  ['unknown member', v => { v.secret = 'not accepted'; }]
]) test('rejects ' + name, () => { const value = manifest(); mutate(value); assert.throws(() => validateManifest(value)); });
test('full-output parser rejects truncation, trailing junk, invalid UTF8 and nonfinite numeric overflow', () => {
  for (const bytes of [Buffer.from('{"x":'), Buffer.from('{}junk'), Buffer.from([0xff]), Buffer.from('{"x":1e999}')]) assert.throws(() => parseOutput(bytes, 100));
  assert.throws(() => parseOutput(Buffer.from('{}'), 1)); assert.deepEqual(parseOutput(Buffer.from('{"x":[1,2,3]}\n'), 100), { x: [1, 2, 3] });
});
test('duplicate JSON keys including escaped nested aliases are rejected before reserialization', () => {
  assert.throws(() => parseOutput(Buffer.from('{"request":{"category":"Control","\\u0063ategory":"MV"}}'), 1000), /OUTPUT_DUPLICATE_MEMBER/);
  assert.throws(() => parseOutput(Buffer.from('{"x":1,"x":2}'), 1000), /OUTPUT_DUPLICATE_MEMBER/);
  assert.deepEqual(parseOutput(Buffer.from('{"x":{"x":2},"y":{"x":3}}'), 1000), { x: { x: 2 }, y: { x: 3 } });
});
test('shared v1 limits allow the documented wider ceilings but reject empty sizes, duplicate sizes and nested extras', () => {
  const value = manifest(); value.caseTimeoutMilliseconds = 60000; value.totalTimeoutMilliseconds = 300000; value.syntheticSizes = [64, 8]; assert.equal(validateManifest(value), value);
  for (const mutate of [v => { v.syntheticSizes = []; }, v => { v.syntheticSizes = [8, 8]; }, v => { v.syntheticSizes = [2]; }, v => { v.totalTimeoutMilliseconds = 100; }, v => { v.snapshot.extra = true; }, v => { v.request.extra = true; }, v => { v.request.projectSettings.extra = true; }]) { const altered = manifest(); mutate(altered); assert.throws(() => validateManifest(altered)); }
});
test('canonical full-route hashes ignore key order but preserve point precision, flags and decimal strings', () => {
  const left = { route: { points: [[1.0000000000000002, 2, 3]], flag: true }, design: { designLengthMeters: '18' }, effectiveCategory: 'Control' };
  const right = { effectiveCategory: 'Control', design: { designLengthMeters: '18' }, route: { flag: true, points: [[1.0000000000000002, 2, 3]] } };
  assert.equal(routeDigest(left), routeDigest(right)); right.route.points[0][0] = 1; assert.notEqual(routeDigest(left), routeDigest(right));
  right.route.points[0][0] = 1.0000000000000002; right.design.designLengthMeters = '18.0'; assert.notEqual(routeDigest(left), routeDigest(right));
  assert.equal(sha256(canonical(left)), sha256(canonical(left)));
});
test('source metadata ignores unordered Docker mount enumeration while preserving every binding and route array order', () => {
  const left = { id, mounts: [{ destination: '/z', name: 'second', writable: true }, { destination: '/a', name: 'first', writable: true }] }, right = structuredClone(left); right.mounts.reverse();
  assert.equal(canonical(stableContainerMetadata(left)), canonical(stableContainerMetadata(right))); assert.equal(left.mounts[0].destination, '/z');
  right.mounts[0].name = 'foreign'; assert.notEqual(canonical(stableContainerMetadata(left)), canonical(stableContainerMetadata(right)));
  assert.notEqual(canonical([[1, 2, 3], [4, 5, 6]]), canonical([[4, 5, 6], [1, 2, 3]]));
});
test('Linux stat parser accepts spaces/closing parentheses in process names and reads RSS in kB', () => {
  assert.deepEqual(parseStat('123 (dotnet ) worker) S 122 123 0 0'), { pid: 123, ppid: 122, group: 123, state: 'S' });
  assert.equal(rssBytes('Name:\tdotnet\nVmRSS:\t12345 kB\n'), 12345 * 1024); assert.equal(rssBytes('State:\tZ\n'), 0); assert.throws(() => parseStat('not a stat'));
});
test('production response needs complete finite route and design, matching request and false engineering acceptance', () => {
  const request = { requestId: id }, result = { schemaVersion: 'pathfinder.model.response.v1', requestId: id, status: 'calculated', engineeringAccepted: false, route: { success: true, lengthMeters: 10, pathPoints: [{ x: 0, y: 0, z: .5 }], segmentIds: ['/TEST'] }, design: { designLengthMeters: '17' }, prepared: { loadedFromDisk: false, engineeringAccepted: false } };
  assert.equal(validateResponse(result, request), result); assert.throws(() => validateResponse({ ...result, engineeringAccepted: true }, request));
  assert.throws(() => validateResponse({ ...result, route: { ...result.route, pathPoints: [] } }, request)); assert.throws(() => validateResponse(result, { requestId: 'different' }));
});
const identity = () => {
  const mounts = ['/input', '/bench', '/tools', '/work'].map((Target, i) => ({ Type: 'bind', Source: '/owned/' + i, Target, ReadOnly: i !== 3 }));
  const expected = { id, image: 'sha256:' + 'a'.repeat(64), name: 'wfc-capacity-test', owner: id, project: 'wfc-pathfinder-local-abcdef123456', mounts };
  const actual = { Id: id, Image: expected.image, Name: '/' + expected.name, Config: { Labels: { 'wfc.pathfinder.owner': id, 'wfc.pathfinder.project': expected.project, 'wfc.pathfinder.capacity': 'true', 'wfc.pathfinder.isolated': 'true' } }, HostConfig: { NetworkMode: 'none', PortBindings: {}, ReadonlyRootfs: true, Memory: 4 * 1024 ** 3, PidsLimit: 256, NanoCpus: 2e9, Mounts: structuredClone(mounts) }, Mounts: mounts.map(m => ({ Type: m.Type, Source: m.Source, Destination: m.Target, RW: !m.ReadOnly })) };
  return { actual, expected };
};
test('only exact own networkless bounded container and mount bindings are accepted', () => { const { actual, expected } = identity(); assert.equal(assertContainer(actual, expected), actual); });
test('Docker omitted writable-mount ReadOnly zero value remains false without weakening actual RW checks', () => { const { actual, expected } = identity(); delete actual.HostConfig.Mounts[3].ReadOnly; assert.equal(assertContainer(actual, expected), actual); actual.Mounts[0].RW = true; assert.throws(() => assertContainer(actual, expected)); });
for (const [name, mutate] of [
  ['owner', v => { v.Config.Labels['wfc.pathfinder.owner'] = 'foreign'; }],
  ['image', v => { v.Image = 'sha256:' + 'b'.repeat(64); }],
  ['network', v => { v.HostConfig.NetworkMode = 'bridge'; }],
  ['published port', v => { v.HostConfig.PortBindings = { '80/tcp': [{ HostPort: '5190' }] }; }],
  ['writable input', v => { v.Mounts[0].RW = true; }],
  ['foreign host source', v => { v.HostConfig.Mounts[0].Source = '/foreign'; }],
  ['foreign actual source', v => { v.Mounts[0].Source = '/foreign'; }],
  ['memory ceiling', v => { v.HostConfig.Memory = 8 * 1024 ** 3; }]
]) test('refuses unsafe container ' + name, () => { const { actual, expected } = identity(); mutate(actual); assert.throws(() => assertContainer(actual, expected)); });
