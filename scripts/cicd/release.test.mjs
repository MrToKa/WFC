import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeRelease } from './release.mjs';

const input = () => ({ repository: 'MrToKa/WFC', commit: 'a'.repeat(40), compatibility: 'wfc-v1', images: { api: `ghcr.io/mrtoka/wfc-api@sha256:${'b'.repeat(64)}` } });
test('a release records one exact commit and content-addressed images', () => {
  const release = makeRelease(input());
  assert.equal(release.schemaVersion, 1);
  assert.equal(release.commit, 'a'.repeat(40));
  assert.match(release.images.api, /@sha256:/);
});
for (const image of ['ghcr.io/mrtoka/wfc-api:latest', `ghcr.io/other/wfc-api@sha256:${'b'.repeat(64)}`, `evil.example/wfc-api@sha256:${'b'.repeat(64)}`, 'ghcr.io/mrtoka/wfc-api@undefined']) {
  test(`refuses image ${image}`, () => {
    const value = input(); value.images.api = image;
    assert.throws(() => makeRelease(value), /immutable digest/);
  });
}
test('refuses missing images, untrusted commits and invalid contracts', () => {
  assert.throws(() => makeRelease({ ...input(), images: {} }));
  assert.throws(() => makeRelease({ ...input(), commit: 'main' }));
  assert.throws(() => makeRelease({ ...input(), compatibility: '../v1' }));
});
