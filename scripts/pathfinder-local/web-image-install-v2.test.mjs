import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareWebImageInstallV2, WEB_INSTALL_V2_BASELINE, webImageInstallV2Digest } from './web-image-install-v2.mjs';

const OLD_BASELINE = Object.freeze({
  api: 'sha256:ac0d16ab1b0f4c92922c20d1a13a5ea142d4c6e92558de1870daf4db7fd60fcf',
  web: 'sha256:a0e6972c41356185cefc12a5781995a71820e5298ebb405ed34dc59a79270529',
});
const EARLIER_B19_PAIR = Object.freeze({
  api: 'sha256:c4b66ae84f28bdc6e86f547d9f5ff9aba9e586402efadae5042f2652f77aa6c7',
  web: 'sha256:495f286c563c39d0a320e2e6244c854ac4fc0e59ecdd6c8410c2b4a724ed02c3',
});

function fixture() {
  const root = path.resolve('/isolated'), webImage = 'sha256:' + 'd'.repeat(64);
  const sourceEnvBytes = Buffer.from([
    'PF_PROJECT=' + WEB_INSTALL_V2_BASELINE.project,
    'PF_OWNER=' + WEB_INSTALL_V2_BASELINE.owner,
    'PF_HTTP_PORT=5191',
    'PF_API_IMAGE=' + WEB_INSTALL_V2_BASELINE.api,
    'PF_WEB_IMAGE=' + WEB_INSTALL_V2_BASELINE.web,
    'PF_JWT_SECRET=synthetic-private-value',
    'PF_PRODUCER_CONTROL_KEY=synthetic-preserve',
    'PF_PREPARATION_CAPACITY_PROFILE=synthetic-preserve', '',
  ].join('\n'));
  const source = {
    format: 'WFC-PF-LOCAL', schemaVersion: 1, root,
    owner: WEB_INSTALL_V2_BASELINE.owner, project: WEB_INSTALL_V2_BASELINE.project, port: 5191,
    runtime: path.join(root, 'pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600'),
    images: { api: WEB_INSTALL_V2_BASELINE.api, web: WEB_INSTALL_V2_BASELINE.web, extra: 'retain' },
    tags: { api: 'original-api-tag', web: 'original-web-tag' },
    build: { finishedAt: '2026-10-21T22:30:57.643Z' }, unknown: { retain: true }, status: 'started',
    envSha256: webImageInstallV2Digest(sourceEnvBytes),
  };
  const sourceStateBytes = Buffer.from(JSON.stringify(source, null, 2) + '\n');
  return {
    root, source, sourceStateBytes, sourceEnvBytes,
    expectedStateSha256: webImageInstallV2Digest(sourceStateBytes), expectedEnvSha256: source.envSha256,
    webImage, inspectedImage: { Id: webImage, Os: 'linux', Architecture: 'amd64', Config: { Labels: {
      'wfc.pathfinder.owner': source.owner, 'wfc.pathfinder.project': source.project,
    } } },
    resources: { containers: ['api', 'web'].map((role, index) => ({
      role, id: String(index + 1).repeat(64), image: WEB_INSTALL_V2_BASELINE[role], running: role === 'api',
    })) },
    operationId: '22222222-2222-4222-8222-222222222222',
  };
}
const reseal = f => {
  f.source.envSha256 = f.expectedEnvSha256 = webImageInstallV2Digest(f.sourceEnvBytes);
  f.sourceStateBytes = Buffer.from(JSON.stringify(f.source));
  f.expectedStateSha256 = webImageInstallV2Digest(f.sourceStateBytes);
};
const assertRefused = (f, code) => assert.throws(() => prepareWebImageInstallV2(f), error =>
  error.code === code && error.message === code && !error.message.includes('synthetic-private'));

test('v2 exports the immutable installed B21 pair, not a caller-selected baseline', () => {
  assert.deepEqual(WEB_INSTALL_V2_BASELINE, {
    owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46',
    project: 'wfc-pathfinder-local-0cba87606e9b', port: 5191,
    api: 'sha256:a43cac0dce21c81760c865f5cce81b774a07ecb3aa0f15963b530afe20c152dd',
    web: 'sha256:e3426832821bad6d25fd138e352aa16cb080e66a09a70f8d61e7fbdea5a8e673',
  });
  assert.equal(Object.isFrozen(WEB_INSTALL_V2_BASELINE), true);
  assert.throws(() => { WEB_INSTALL_V2_BASELINE.api = OLD_BASELINE.api; }, TypeError);
  for (const baseline of [OLD_BASELINE, WEB_INSTALL_V2_BASELINE, { api: fixture().webImage }]) {
    const f = fixture(); f.baseline = baseline;
    assertRefused(f, 'PF_WEB_INSTALL_V2_ARGUMENTS');
  }
});

test('only the web image and env hash change; all API/private/producer/capacity/unknown state remains exact', () => {
  const f = fixture(), before = structuredClone(f.source), originalEnv = Buffer.from(f.sourceEnvBytes);
  const stateBytes = Buffer.from(f.sourceStateBytes), resources = structuredClone(f.resources);
  const result = prepareWebImageInstallV2(f);
  assert.deepEqual(f.source, before);
  assert.deepEqual(f.sourceStateBytes, stateBytes);
  assert.deepEqual(f.sourceEnvBytes, originalEnv);
  assert.deepEqual(f.resources, resources);
  assert.deepEqual(result.state, { ...before, images: { ...before.images, web: f.webImage }, envSha256: webImageInstallV2Digest(result.envBytes) });
  assert.equal(result.envBytes.toString(), originalEnv.toString().replace('PF_WEB_IMAGE=' + before.images.web, 'PF_WEB_IMAGE=' + f.webImage));
  assert.deepEqual(JSON.parse(result.stateBytes), result.state);
  assert.equal(result.stateBytes.at(-1), 10);
});

test('private UTF-8, blank lines, comments and unrelated image-like values remain byte-exact', () => {
  const f = fixture();
  f.sourceEnvBytes = Buffer.concat([f.sourceEnvBytes, Buffer.from(
    '\n# retain comment\nPF_OTHER_IMAGE=' + WEB_INSTALL_V2_BASELINE.web + '\nPF_LABEL=синтетична стойност\n')]);
  reseal(f);
  const before = Buffer.from(f.sourceEnvBytes), result = prepareWebImageInstallV2(f);
  const start = before.indexOf(Buffer.from('PF_WEB_IMAGE=')) + Buffer.byteLength('PF_WEB_IMAGE=');
  assert.deepEqual(result.envBytes.subarray(0, start), before.subarray(0, start));
  assert.deepEqual(result.envBytes.subarray(start + f.webImage.length), before.subarray(start + WEB_INSTALL_V2_BASELINE.web.length));
});

for (const key of ['root', 'owner', 'project', 'runtime', 'port']) test('refuses foreign source ' + key, () => {
  const f = fixture(); f.source[key] = key === 'port' ? 5180 : 'foreign';
  assertRefused(f, 'PF_WEB_INSTALL_V2_EXACT_SOURCE_REQUIRED');
});

test('refuses relative or noncanonical roots and mismatched source format/version', () => {
  for (const mutate of [f => { f.root = '.'; }, f => { f.root += path.sep; },
    f => { f.source.format = 'OTHER'; }, f => { f.source.schemaVersion = 2; }]) {
    const f = fixture(); mutate(f);
    assertRefused(f, 'PF_WEB_INSTALL_V2_EXACT_SOURCE_REQUIRED');
  }
});

for (const role of ['api', 'web']) test('requires the exact installed B21 ' + role + ' image', () => {
  const f = fixture(); f.source.images[role] = 'sha256:' + 'c'.repeat(64);
  assertRefused(f, 'PF_WEB_INSTALL_V2_BASELINE_IMAGES_REQUIRED');
});

for (const [name, images] of [['B15', OLD_BASELINE], ['B19', EARLIER_B19_PAIR]]) {
  test('fully resealed old ' + name + ' source/env/resources cannot become the v2 baseline', () => {
    for (const roles of [['api'], ['web'], ['api', 'web']]) {
      const f = fixture();
      for (const role of roles) {
        f.source.images[role] = images[role];
        f.sourceEnvBytes = Buffer.from(f.sourceEnvBytes.toString().replace(
          'PF_' + role.toUpperCase() + '_IMAGE=' + WEB_INSTALL_V2_BASELINE[role],
          'PF_' + role.toUpperCase() + '_IMAGE=' + images[role]));
        f.resources.containers.find(row => row.role === role).image = images[role];
      }
      reseal(f);
      assertRefused(f, 'PF_WEB_INSTALL_V2_BASELINE_IMAGES_REQUIRED');
    }
  });
}

for (const key of ['expectedStateSha256', 'expectedEnvSha256']) test('requires exact source-file CAS ' + key, () => {
  const f = fixture(); f[key] = 'f'.repeat(64);
  assertRefused(f, 'PF_WEB_INSTALL_V2_CAS_CHANGED');
});

test('state object and private env hash must match the pinned bytes', () => {
  for (const mutate of [f => { f.source.unknown.retain = false; }, f => { f.source.envSha256 = 'f'.repeat(64); }]) {
    const f = fixture(); mutate(f);
    assertRefused(f, 'PF_WEB_INSTALL_V2_STATE_CHANGED');
  }
});

test('requires one stopped old web and one running exact API', () => {
  for (const mutate of [f => { f.resources.containers[0].running = false; }, f => { f.resources.containers[1].running = true; },
    f => { f.resources.containers[0].image = f.webImage; }, f => { f.resources.containers[1].image = f.webImage; },
    f => { f.resources.containers.push({ ...f.resources.containers[0] }); }, f => { f.resources.containers.pop(); },
    f => { f.resources.containers[1].id = 'unverified'; }, f => { f.resources.containers[0].running = 1; },
    f => { f.resources.containers[1].running = 0; }, f => { f.resources.containers[1].role = 'api'; },
    f => { f.resources.containers[0].id = { toString: () => '1'.repeat(64) }; }]) {
    const f = fixture(); mutate(f);
    assertRefused(f, 'PF_WEB_INSTALL_V2_SERVICE_STATE_CHANGED');
  }
  for (const resources of [undefined, {}, { containers: {} }]) {
    const f = fixture(); f.resources = resources;
    assertRefused(f, 'PF_WEB_INSTALL_V2_RESOURCE_REQUIRED');
  }
});

test('old resource pair refuses even while source state and env remain current', () => {
  for (const role of ['api', 'web']) {
    const f = fixture(); f.resources.containers.find(row => row.role === role).image = OLD_BASELINE[role];
    assertRefused(f, 'PF_WEB_INSTALL_V2_SERVICE_STATE_CHANGED');
  }
});

test('candidate requires exact ID, linux/amd64 and installation owner/project', () => {
  for (const mutate of [f => { f.webImage = 'latest'; }, f => { f.webImage = WEB_INSTALL_V2_BASELINE.api; },
    f => { f.webImage = WEB_INSTALL_V2_BASELINE.web; }, f => { f.inspectedImage.Id = WEB_INSTALL_V2_BASELINE.web; },
    f => { f.inspectedImage.Os = 'windows'; }, f => { f.inspectedImage.Architecture = 'arm64'; },
    f => { f.inspectedImage.Config.Labels['wfc.pathfinder.owner'] = 'foreign'; },
    f => { f.inspectedImage.Config.Labels['wfc.pathfinder.project'] = 'foreign'; },
    f => { delete f.inspectedImage.Config.Labels['wfc.pathfinder.owner']; },
    f => { delete f.inspectedImage.Config.Labels; }, f => { delete f.inspectedImage.Config; },
    f => { f.inspectedImage = null; }, f => { f.webImage += '\n'; },
    f => { f.webImage = f.inspectedImage.Id = { toString: () => 'sha256:' + 'd'.repeat(64) }; }]) {
    const f = fixture(); mutate(f);
    assertRefused(f, 'PF_WEB_INSTALL_V2_CANDIDATE_REQUIRED');
  }
});

test('BOM and CRLF env variants refuse rather than being silently normalized', () => {
  for (const change of [bytes => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    bytes => Buffer.from(bytes.toString().replaceAll('\n', '\r\n'))]) {
    const f = fixture(); f.sourceEnvBytes = change(f.sourceEnvBytes); reseal(f);
    assertRefused(f, 'PF_WEB_INSTALL_V2_SOURCE_ENCODING');
  }
});

test('duplicate, absent or mismatched bound env keys fail without printing private values', () => {
  for (const key of ['PF_OWNER', 'PF_PROJECT', 'PF_HTTP_PORT', 'PF_API_IMAGE', 'PF_WEB_IMAGE']) {
    for (const change of ['duplicate', 'absent', 'different']) {
      const f = fixture(), current = f.sourceEnvBytes.toString();
      f.sourceEnvBytes = Buffer.from(change === 'duplicate' ? current + key + '=foreign\n'
        : change === 'absent' ? current.replace(new RegExp('^' + key + '=.*\\n', 'm'), '')
          : current.replace(new RegExp('^' + key + '=.*$', 'm'), key + '=foreign'));
      reseal(f);
      assertRefused(f, 'PF_WEB_INSTALL_V2_ENV_BINDING_CHANGED');
    }
  }
});

test('old env images cannot be substituted by resealing only the env and state hashes', () => {
  for (const role of ['api', 'web']) {
    const f = fixture(); f.sourceEnvBytes = Buffer.from(f.sourceEnvBytes.toString().replace(
      'PF_' + role.toUpperCase() + '_IMAGE=' + WEB_INSTALL_V2_BASELINE[role],
      'PF_' + role.toUpperCase() + '_IMAGE=' + OLD_BASELINE[role]));
    reseal(f);
    assertRefused(f, 'PF_WEB_INSTALL_V2_ENV_BINDING_CHANGED');
  }
});

test('exact keyset, valid operation and lowercase fixed-length file pins are mandatory', () => {
  for (const mutate of [f => { f.extra = true; }, f => { delete f.expectedEnvSha256; },
    f => { f.operationId = 'old'; }, f => { f.operationId += '\n'; },
    f => { f.operationId = { toString: () => '22222222-2222-4222-8222-222222222222' }; },
    f => { f.expectedEnvSha256 = 'invalid'; }, f => { f.expectedEnvSha256 = 'A'.repeat(64); },
    f => { f.expectedStateSha256 += '\n'; },
    f => { f.expectedEnvSha256 = { toString: () => 'f'.repeat(64) }; }]) {
    const f = fixture(); mutate(f); assert.throws(() => prepareWebImageInstallV2(f));
  }
  for (const f of [null, [], Object.create(null)]) {
    assert.throws(() => prepareWebImageInstallV2(f), { code: 'PF_WEB_INSTALL_V2_ARGUMENTS' });
  }
});

test('bounded buffers and malformed UTF-8/JSON refuse before any plan is produced', () => {
  for (const mutate of [f => { f.sourceStateBytes = new Uint8Array(f.sourceStateBytes); },
    f => { f.sourceEnvBytes = 'not-a-buffer'; },
    f => { f.sourceStateBytes = Buffer.alloc(1024 ** 2 + 1); },
    f => { f.sourceEnvBytes = Buffer.alloc(65537); }]) {
    const f = fixture(); mutate(f);
    assertRefused(f, 'PF_WEB_INSTALL_V2_SOURCE_BYTES_REQUIRED');
  }
  for (const mutate of [f => { f.sourceStateBytes = Buffer.from('{'); f.expectedStateSha256 = webImageInstallV2Digest(f.sourceStateBytes); },
    f => { f.sourceStateBytes = Buffer.from([0xc3, 0x28]); f.expectedStateSha256 = webImageInstallV2Digest(f.sourceStateBytes); },
    f => { f.sourceEnvBytes = Buffer.from([0xc3, 0x28]); reseal(f); }]) {
    const f = fixture(); mutate(f);
    assertRefused(f, 'PF_WEB_INSTALL_V2_SOURCE_ENCODING');
  }
});
