// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchPathFinderState } from './pathfinder';

const captured = process.env.WFC_CENTRE_STATE_CAPTURE;
const projectId = '11111111-1111-4111-8111-111111111111';
const modelId = '22222222-2222-4222-8222-222222222222';
function state(derivation: string) {
  return { schemaVersion: 1, projectId, registryRevision: '19',
    activeModel: { modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) },
    settings: { revision: '1', connectionGap: '1', secondaryTrayLength: null, endConnectionLength: null, additionalBendingPercent: null },
    cables: [], locations: [{ id: '33333333-3333-4333-8333-333333333333', name: '15-P-3820', aliases: [], revision: '1',
      binding: { modelVersionId: modelId, revision: '1', point: [1, 2, 3], objectId: 'dbid:7', externalId: null,
        source: 'automatic', status: 'confirmed', derivation, coordinateFrame: 'canonical-world-metres' } }],
    artifacts: [], jobs: [], proposals: [] };
}
afterEach(() => vi.unstubAllGlobals());
it.each(['matched-model-bottom-aabb.v1', 'matched-model-centre-fallback.v1'])('accepts the supported %s binding without changing the active model', async derivation => {
  const body = state(derivation); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
  const parsed = await fetchPathFinderState(projectId, 'parser-test-token');
  expect(parsed.activeModel).toEqual(body.activeModel); expect(parsed.locations[0].binding).toMatchObject({ derivation, point: [1, 2, 3], objectId: 'dbid:7' });
});
it('continues rejecting unknown derivations rather than weakening the binding validator', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(state('unverified-centre-point'))));
  await expect(fetchPathFinderState(projectId, 'parser-test-token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
});
it.skipIf(!captured)('parses the actual captured centre-fallback state through the frontend transport and validator', async () => {
  const response = JSON.parse(readFileSync(captured!, 'utf8'));
  expect(response.status).toBe(200);
  const body = response.body;
  expect(body.locations.some((location: any) => location.binding?.derivation === 'matched-model-centre-fallback.v1')).toBe(true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
  const parsed = await fetchPathFinderState(body.projectId, 'parser-test-token');
  expect(parsed.activeModel).toEqual(body.activeModel); expect(parsed.cables).toHaveLength(body.cables.length);
  const expected = body.locations.filter((location: any) => location.binding?.derivation === 'matched-model-centre-fallback.v1');
  for (const location of expected) expect(parsed.locations.find(item => item.id === location.id)?.binding).toMatchObject({
    derivation: location.binding.derivation, point: location.binding.point, objectId: location.binding.objectId });
});
