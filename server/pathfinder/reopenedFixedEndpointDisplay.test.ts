// @vitest-environment node
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { modelLocationMatchFixture } from './modelLocationMatchFixtures.js';
import { endpointFixtureId as id } from './endpointBindingFixtures.js';
import { endpointBindingHash } from './endpointBindingRepository.js';
import { readReopenedFixedEndpointDisplay } from './reopenedFixedEndpointDisplay.js';

async function fixture() {
  const f = await modelLocationMatchFixture();
  await f.repo.assign(f.projectId, f.who, f.command());
  const locationId = f.resolved('Alias');
  const location = { ...f.state.locations.get(locationId)!, aliases: [] };
  const head = f.state.bindings.get(f.state.heads.get(locationId)!)!;
  const source = { aggregate: f.f.aggregate, trace: f.built.manifest, object: f.built.records[0] };
  const target = structuredClone(source);
  target.aggregate.id = id(151); target.aggregate.artifactId = id(152); target.aggregate.geometryRevision = '2';
  target.trace.id = id(153); target.trace.aggregateId = target.aggregate.id; target.trace.geometryRevision = '2';
  const { contentSha256: _hash, ...body } = target.trace;
  target.trace.contentSha256 = endpointBindingHash(body);
  target.object.traceId = target.trace.id; target.object.aggregateId = target.aggregate.id;
  const current = { ...f.context.current, aggregateId: target.aggregate.id, artifactId: target.aggregate.artifactId,
    traceId: target.trace.id, geometryRevision: target.aggregate.geometryRevision };
  const original = f.query.getMockImplementation()!;
  f.query.mockImplementation(async (sql, args = []) => {
    if (sql.startsWith('/* endpoint-requalify:publication */')) {
      const p = [source, target].find(({ aggregate }) => aggregate.id === args[1]);
      return { rows: p ? [{ aggregate: p.aggregate, trace: p.trace, artifact_id: p.aggregate.artifactId, snapshot_sha256: p.aggregate.projection.sha256 }] : [] };
    }
    if (sql.startsWith('/* endpoint-requalify:frame */')) {
      const p = [source, target].find(({ trace }) => trace.id === args[1])!;
      const { displayToWorldMetres, globalOffsetMetres } = p.object.coordinates;
      return { rows: [{ frame: { coordinateFrame: 'canonical-world-metres', displayToWorldMetres, globalOffsetMetres },
        record: p.object, record_sha256: endpointBindingHash(p.object) }] };
    }
    return original(sql, args);
  });
  f.query.mockClear();
  const read = () => readReopenedFixedEndpointDisplay(f.client as unknown as PoolClient,
    { projectId: f.projectId, current, location, head }, () => {});
  return { ...f, read, location, head, current, target };
}

describe('read-only fixed endpoint display on reopen', () => {
  it('recovers the selected object from its original receipt before recalculation or requalification', async () => {
    const f = await fixture(), before = structuredClone(f.head);
    expect(await f.read()).toEqual({ sdkObjectId: f.head.autoMatchEvidence!.sdkObjectId, name: f.head.autoMatchEvidence!.objectName });
    expect(f.head).toEqual(before);
    expect(f.query.mock.calls.every(([sql]) => !/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(true);
  });
  it('recovers a previously selected copy of the same model and preparation', async () => {
    const f = await fixture();
    Object.assign(f.current, f.context.current, { selectionRevision: '99' });
    expect(await f.read()).toMatchObject({ sdkObjectId: f.head.autoMatchEvidence!.sdkObjectId });
  });
  it.each(['model version','content fingerprint','physical frame','point','location revision','receipt'] as const)(
    'keeps the object unavailable with a changed or missing %s', async kind => {
      const f = await fixture();
      if (kind === 'model version') f.current.modelVersionId = id(154);
      if (kind === 'content fingerprint') f.current.contentFingerprint = '8'.repeat(64);
      if (kind === 'physical frame') f.target.object.coordinates.globalOffsetMetres[0] += 1;
      if (kind === 'point') f.head.pointProjectMetres = [99,0,0];
      if (kind === 'location revision') f.location.revision = '99';
      if (kind === 'receipt') f.state.commands.clear();
      expect(await f.read()).toBeNull();
    });
  it('propagates cancellation', async () => {
    const f = await fixture(), check = vi.fn(() => { throw new Error('Cancelled'); });
    await expect(readReopenedFixedEndpointDisplay(f.client as unknown as PoolClient,
      { projectId: f.projectId, head: f.head, current: f.current, location: f.location }, check)).rejects.toThrow('Cancelled');
  });
});
