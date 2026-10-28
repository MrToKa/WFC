import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareWebImageInstall, WEB_INSTALL_BASELINE, webImageInstallDigest } from './web-image-install.mjs';

function fixture() {
  const root = path.resolve('/isolated'), webImage = 'sha256:' + 'd'.repeat(64);
  const sourceEnvBytes = Buffer.from([
    'PF_PROJECT=' + WEB_INSTALL_BASELINE.project,
    'PF_OWNER=' + WEB_INSTALL_BASELINE.owner,
    'PF_HTTP_PORT=5191',
    'PF_API_IMAGE=' + WEB_INSTALL_BASELINE.api,
    'PF_WEB_IMAGE=' + WEB_INSTALL_BASELINE.web,
    'PF_JWT_SECRET=synthetic-private-value',
    'PF_PRODUCER_CONTROL_KEY=synthetic-preserve',
    'PF_PREPARATION_CAPACITY_PROFILE=synthetic-preserve', '',
  ].join('\n'));
  const source = {
    format: 'WFC-PF-LOCAL', schemaVersion: 1, root,
    owner: WEB_INSTALL_BASELINE.owner, project: WEB_INSTALL_BASELINE.project, port: 5191,
    runtime: path.join(root, 'pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600'),
    images: { api: WEB_INSTALL_BASELINE.api, web: WEB_INSTALL_BASELINE.web, extra: 'retain' },
    tags: { api: 'original-api-tag', web: 'original-web-tag' },
    build: { finishedAt: '2026-10-21T22:30:57.643Z' }, unknown: { retain: true }, status: 'started',
    envSha256: webImageInstallDigest(sourceEnvBytes),
  };
  const sourceStateBytes = Buffer.from(JSON.stringify(source, null, 2) + '\n');
  return {
    root, source, sourceStateBytes, sourceEnvBytes,
    expectedStateSha256: webImageInstallDigest(sourceStateBytes), expectedEnvSha256: source.envSha256,
    webImage, inspectedImage: { Id: webImage, Os: 'linux', Architecture: 'amd64', Config: { Labels: {
      'wfc.pathfinder.owner': source.owner, 'wfc.pathfinder.project': source.project,
    } } },
    resources: { containers: ['api', 'web'].map((role, index) => ({
      role, id: String(index + 1).repeat(64), image: WEB_INSTALL_BASELINE[role], running: role === 'api',
    })) },
    operationId: '22222222-2222-4222-8222-222222222222',
  };
}
const reseal = f => {
  f.source.envSha256 = f.expectedEnvSha256 = webImageInstallDigest(f.sourceEnvBytes);
  f.sourceStateBytes = Buffer.from(JSON.stringify(f.source));
  f.expectedStateSha256 = webImageInstallDigest(f.sourceStateBytes);
};

test('only the web image and env hash change; API/private/producer/capacity/unknown state remain exact', () => {
  const f = fixture(), before = structuredClone(f.source), originalEnv = Buffer.from(f.sourceEnvBytes);
  const result = prepareWebImageInstall(f);
  assert.deepEqual(f.source, before);
  assert.deepEqual(f.sourceEnvBytes, originalEnv);
  assert.deepEqual(result.state, { ...before, images: { ...before.images, web: f.webImage }, envSha256: webImageInstallDigest(result.envBytes) });
  assert.equal(result.envBytes.toString(), originalEnv.toString().replace('PF_WEB_IMAGE=' + before.images.web, 'PF_WEB_IMAGE=' + f.webImage));
  assert.deepEqual(JSON.parse(result.stateBytes), result.state);
});

for (const key of ['root', 'owner', 'project', 'runtime', 'port']) test('refuses foreign source ' + key, () => {
  const f = fixture(); f.source[key] = key === 'port' ? 5180 : 'foreign';
  assert.throws(() => prepareWebImageInstall(f), { code: 'PF_WEB_INSTALL_EXACT_SOURCE_REQUIRED' });
});
for (const role of ['api', 'web']) test('requires the exact qualified previous ' + role + ' image', () => {
  const f = fixture(); f.source.images[role] = 'sha256:' + 'c'.repeat(64);
  assert.throws(() => prepareWebImageInstall(f), { code: 'PF_WEB_INSTALL_BASELINE_IMAGES_REQUIRED' });
});
for (const key of ['expectedStateSha256', 'expectedEnvSha256']) test('requires exact file CAS ' + key, () => {
  const f = fixture(); f[key] = 'f'.repeat(64);
  assert.throws(() => prepareWebImageInstall(f), { code: 'PF_WEB_INSTALL_CAS_CHANGED' });
});
test('state object and private env hash must match the pinned bytes', () => {
  for (const mutate of [f => { f.source.unknown.retain = false; }, f => { f.source.envSha256 = 'f'.repeat(64); }]) {
    const f = fixture(); mutate(f);
    assert.throws(() => prepareWebImageInstall(f), { code: 'PF_WEB_INSTALL_STATE_CHANGED' });
  }
});
test('requires one stopped old web and one running exact API', () => {
  for (const mutate of [f => { f.resources.containers[0].running = false; }, f => { f.resources.containers[1].running = true; },
    f => { f.resources.containers[0].image = f.webImage; }, f => { f.resources.containers[1].image = f.webImage; },
    f => { f.resources.containers.push({ ...f.resources.containers[0] }); }, f => { f.resources.containers.pop(); },
    f => { f.resources.containers[1].id = 'unverified'; }]) {
    const f = fixture(); mutate(f);
    assert.throws(() => prepareWebImageInstall(f), { code: 'PF_WEB_INSTALL_SERVICE_STATE_CHANGED' });
  }
});
test('candidate requires exact ID, linux/amd64 and this installation owner/project', () => {
  for (const mutate of [f => { f.webImage = 'latest'; }, f => { f.webImage = WEB_INSTALL_BASELINE.api; },
    f => { f.webImage = WEB_INSTALL_BASELINE.web; }, f => { f.inspectedImage.Id = WEB_INSTALL_BASELINE.web; },
    f => { f.inspectedImage.Os = 'windows'; }, f => { f.inspectedImage.Architecture = 'arm64'; },
    f => { f.inspectedImage.Config.Labels['wfc.pathfinder.owner'] = 'foreign'; },
    f => { f.inspectedImage.Config.Labels['wfc.pathfinder.project'] = 'foreign'; }]) {
    const f = fixture(); mutate(f);
    assert.throws(() => prepareWebImageInstall(f), { code: 'PF_WEB_INSTALL_CANDIDATE_REQUIRED' });
  }
});
test('BOM and CRLF env variants are refused rather than silently normalized', () => {
  for (const change of [bytes => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    bytes => Buffer.from(bytes.toString().replaceAll('\n', '\r\n'))]) {
    const f = fixture(); f.sourceEnvBytes = change(f.sourceEnvBytes); reseal(f);
    assert.throws(() => prepareWebImageInstall(f), { code: 'PF_WEB_INSTALL_SOURCE_ENCODING' });
  }
});
test('duplicate or mismatched bound env keys fail without printing private values', () => {
  for (const key of ['PF_OWNER', 'PF_PROJECT', 'PF_HTTP_PORT', 'PF_API_IMAGE', 'PF_WEB_IMAGE']) {
    for (const duplicate of [true, false]) {
      const f = fixture(); f.sourceEnvBytes = Buffer.from(duplicate ? f.sourceEnvBytes.toString() + key + '=foreign\n'
        : f.sourceEnvBytes.toString().replace(new RegExp('^' + key + '=.*$', 'm'), key + '=foreign'));
      reseal(f);
      assert.throws(() => prepareWebImageInstall(f), error => error.code === 'PF_WEB_INSTALL_ENV_BINDING_CHANGED' && !error.message.includes('synthetic-private'));
    }
  }
});
test('extra options, invalid operations, missing pins and malformed UTF-8/JSON refuse', () => {
  for (const mutate of [f => { f.extra = true; }, f => { f.operationId = 'old'; }, f => { f.expectedEnvSha256 = 'invalid'; },
    f => { f.sourceStateBytes = Buffer.from('{'); f.expectedStateSha256 = webImageInstallDigest(f.sourceStateBytes); },
    f => { f.sourceEnvBytes = Buffer.from([0xc3, 0x28]); reseal(f); }]) {
    const f = fixture(); mutate(f); assert.throws(() => prepareWebImageInstall(f));
  }
});
