// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { modelLocationMatchFixture } from './modelLocationMatchFixtures.js';
import { endpointFixtureId as id } from './endpointBindingFixtures.js';
import { createEndpointBindingRepository, endpointBindingHash, readCurrentEndpointBindingContext, readEndpointBindingScope } from './endpointBindingRepository.js';
import { endpointBindingSchema } from '../../shared/pathfinderEndpointBindings.js';
import { requalifyCableEndpointBindings, requalifyAutomaticEndpointBindingsInTransaction } from './endpointBindingRequalification.js';
import { readMatchedLocationDisplay } from './modelLocationMatchDisplay.js';

async function fixture() {
  const f = await modelLocationMatchFixture(); await f.repo.assign(f.projectId, f.who, f.command());
  const fromId = f.resolved('EQUIPMENT'), toId = f.resolved('Alias'), from = f.state.locations.get(fromId)!;
  const sourceHead = f.state.bindings.get(f.state.heads.get(fromId)!)!;
  const endpointRepo = createEndpointBindingRepository(f.pool);
  await endpointRepo.confirm(f.projectId, f.who, fromId, { schemaVersion: 'wfc.pf.endpoint-binding-write.v1',
    expectedRegistryRevision: f.state.registry, expectedLocationRevision: from.revision, expectedHeadId: sourceHead.id,
    expectedSelectionRevision: f.state.selectedRevision, modelVersionId: f.context.current.modelVersionId,
    aggregateId: f.context.current.aggregateId, projectionSha256: f.context.current.projectionSha256, captureFrameId: f.context.current.captureFrameId,
    idempotencyKey: id(920), reason: 'Manual correction kept across unchanged model publication', location: { name: from.name, aliases: [] },
    mode: 'fixed-world', pointProjectMetres: [8, 9, 10], derivation: 'manual-world-point', provenanceObject: null });
  const source = { aggregate: structuredClone(f.f.aggregate), trace: structuredClone(f.built.manifest), object: structuredClone(f.built.records[0]) };
  const target = structuredClone(source); target.aggregate.id = id(921); target.aggregate.artifactId = id(922); target.aggregate.geometryRevision = '2';
  target.trace.id = id(923); target.trace.aggregateId = target.aggregate.id; target.trace.geometryRevision = '2';
  const { contentSha256: _sha, ...traceBody } = target.trace; target.trace.contentSha256 = endpointBindingHash(traceBody);
  target.object.traceId = target.trace.id; target.object.aggregateId = target.aggregate.id;
  const original = f.query.getMockImplementation()!;
  let active = true;
  f.query.mockImplementation(async (sql, args = []) => {
    const p = args as string[];
    if (sql.startsWith('SELECT p.current_aggregate_id') && active) return { rows: [{ current_aggregate_id: target.aggregate.id,
      current_artifact_id: target.aggregate.artifactId, geometry_revision: target.aggregate.geometryRevision, manifest: target.aggregate, snapshot_sha256: target.aggregate.projection.sha256 }] };
    if (sql.startsWith('SELECT id,manifest FROM pf_geometry_trace_sets') && active) return { rows: [{ id: target.trace.id, manifest: target.trace }] };
    if (sql.startsWith('/* endpoint-requalify:replay */')) {
      const saved = f.state.commands.get(p[1] + ':' + p[2]); return { rows: saved ? [saved] : [] };
    }
    if (sql.startsWith('/* endpoint-requalify:cable */')) return { rows: f.state.cables.filter(cable => cable.id === p[1]) };
    if (sql.startsWith('/* endpoint-requalify:heads */')) return { rows: [...f.state.aliases.values()].filter(alias => (args[1] as string[]).includes(alias.normalized_alias)).flatMap(alias => {
      const location = f.state.locations.get(alias.location_id)!, binding = f.state.bindings.get(f.state.heads.get(location.id) ?? '');
      return binding ? [{ normalized_alias: alias.normalized_alias, location_id: location.id, location_revision: location.revision,
        binding_id: binding.id, binding_revision: binding.bindingRevision, record_sha256: binding.contentSha256, record: binding }] : [];
    }) };
    if (sql.startsWith('/* endpoint-requalify:publication */')) {
      const value = p[1] === source.aggregate.id ? source : p[1] === target.aggregate.id ? target : null;
      return { rows: value ? [{ aggregate: value.aggregate, trace: value.trace, artifact_id: value.aggregate.artifactId, snapshot_sha256: value.aggregate.projection.sha256 }] : [] };
    }
    if (sql.startsWith('/* endpoint-requalify:frame */')) {
      const value = p[1] === source.trace.id ? source : target;
      return { rows: [{ frame: { coordinateFrame: 'canonical-world-metres', displayToWorldMetres: value.object.coordinates.displayToWorldMetres,
        globalOffsetMetres: value.object.coordinates.globalOffsetMetres }, record: value.object, record_sha256: endpointBindingHash(value.object) }] };
    }
    if (sql.startsWith('INSERT INTO pf_endpoint_binding_revisions') && sql.includes('NULL,NULL')) {
      f.state.bindings.set(p[0], args[7] as typeof sourceHead); return { rows: [] };
    }
    if (sql.startsWith('UPDATE pf_endpoint_binding_heads')) { f.state.heads.set(p[1], p[2]); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pf_endpoint_binding_commands') && sql.includes("'confirm'")) {
      f.state.commands.set(p[1] + ':' + p[2], { kind: 'confirm', request_sha256: p[3], request: args[4], receipt: args[5] }); return { rows: [] };
    }
    return original(sql, args);
  });
  const current = (await readCurrentEndpointBindingContext(f.client as unknown as PoolClient, f.projectId))!;
  const command = { schemaVersion: 'wfc.pf.endpoint-requalify.v1' as const, cableId: f.state.cables[0].id, idempotencyKey: id(924), expectedCurrent: current };
  return { ...f, source, target, command, fromId, toId, endpointRepo, setActive: (value: boolean) => { active = value; } };
}

describe('same-model fixed endpoint requalification', () => {
  it('automatic preflight carries a stale saved end when its other end is unbound, then performs no repeated writes',async()=>{
    const f=await fixture(),cable=f.state.cables[0],before=f.state.bindings.get(f.state.heads.get(f.fromId)!)!;
    cable.to_location='NO_BOUND_LOCATION';
    f.state.locations.get(f.toId)!.revision='99';
    f.state.cables.unshift({id:id(951),from_location:'Alias',to_location:'NO_BOUND_LOCATION'});
    const original=f.query.getMockImplementation()!;
    f.query.mockImplementation(async(sql,args=[])=>{
      if(sql.startsWith('/* automatic-endpoint-recovery:cables */'))return {rows:[f.state.cables[0],cable]};
      if(sql.startsWith('/* automatic-endpoint-recovery:aliases */'))return {rows:[...f.state.aliases.values()].filter(a=>(args[1] as string[]).includes(a.normalized_alias)).map(a=>({normalized_alias:a.normalized_alias,location_id:a.location_id}))};
      if(sql.startsWith('SAVEPOINT ')||sql.startsWith('RELEASE SAVEPOINT ')||sql.startsWith('ROLLBACK TO SAVEPOINT '))return {rows:[]};
      if(sql.startsWith('SELECT h.location_id,')&&sql.includes('h.location_id=ANY'))return {rows:(args[1] as string[]).flatMap(locationId=>{const l=f.state.locations.get(locationId)!,binding=f.state.bindings.get(f.state.heads.get(locationId)??'');return binding?[{location_id:locationId,location_revision:l.revision,binding_id:binding.id,binding_revision:binding.bindingRevision,record_sha256:binding.contentSha256,record:binding}]:[];})};
      return original(sql,args);
    });
    expect(await requalifyAutomaticEndpointBindingsInTransaction(f.client as unknown as PoolClient,f.projectId,f.who,AbortSignal.timeout(30000))).toBe(1);
    const after=f.state.bindings.get(f.state.heads.get(f.fromId)!)!;expect(after.pointProjectMetres).toEqual(before.pointProjectMetres);expect(after.aggregateId).toBe(f.target.aggregate.id);
    const count=f.state.commands.size;expect(await requalifyAutomaticEndpointBindingsInTransaction(f.client as unknown as PoolClient,f.projectId,f.who,AbortSignal.timeout(30000))).toBe(0);expect(f.state.commands.size).toBe(count);
  });

  it('carries only the cable shared manual/matched heads, preserves their points and human confirmation, and enables strict current scope', async () => {
    const f = await fixture(), before = structuredClone(f.state), oldFrom = f.state.bindings.get(f.state.heads.get(f.fromId)!)!, oldTo = f.state.bindings.get(f.state.heads.get(f.toId)!)!;
    const receipt = await requalifyCableEndpointBindings(f.pool, f.projectId, f.who, f.command);
    expect(receipt.updatedLocationIds.sort()).toEqual([f.fromId, f.toId].sort());
    expect(f.state.registry).toBe(before.registry); expect(f.state.locations).toEqual(before.locations); expect(f.state.cables).toEqual(before.cables);
    for (const old of [oldFrom, oldTo]) {
      const carried = f.state.bindings.get(f.state.heads.get(old.locationId)!)!;
      expect(endpointBindingSchema.safeParse(carried).success).toBe(true);
      expect(carried).toMatchObject({ pointProjectMetres: old.pointProjectMetres, locationRevision: old.locationRevision,
        confirmedBy: old.confirmedBy, confirmedAt: old.confirmedAt, derivation: old.derivation,
        aggregateId: f.target.aggregate.id, artifactId: f.target.aggregate.artifactId,
        sameModelReuse: { sourceBindingId: old.id, sourceBindingSha256: old.contentSha256, originalBindingId: old.id } });
      expect((await readEndpointBindingScope(f.client as unknown as PoolClient, { projectId: f.projectId, locationId: old.locationId,
        modelVersionId: f.command.expectedCurrent.modelVersionId, aggregateId: f.target.aggregate.id,
        projectionSha256: f.target.aggregate.projection.sha256, captureFrameId: f.target.aggregate.coordinateFrameId })).status).toBe('confirmed');
    }
    const toHead = f.state.bindings.get(f.state.heads.get(f.toId)!)!;
    expect(await readMatchedLocationDisplay(f.client as unknown as PoolClient, { projectId: f.projectId, current: f.command.expectedCurrent,
      head: toHead, location: { ...f.state.locations.get(f.toId)!, aliases: [] } }, () => {}))
      .toMatchObject({ sdkObjectId: oldTo.autoMatchEvidence!.sdkObjectId, bindingId: toHead.id, pointProjectMetres: oldTo.pointProjectMetres });
    const count = f.state.bindings.size;
    expect(await requalifyCableEndpointBindings(f.pool, f.projectId, f.who, f.command)).toMatchObject({ duplicate: true, updatedLocationIds: receipt.updatedLocationIds });
    expect(f.state.bindings.size).toBe(count);
    expect(await requalifyCableEndpointBindings(f.pool, f.projectId, f.who, { ...f.command, idempotencyKey: id(925) })).toMatchObject({ updatedLocationIds: [] });
    expect(f.state.bindings.size).toBe(count);
  });
  it.each(['offset', 'matrix', 'fingerprint', 'head-revision', 'object-mode', 'context'] as const)('refuses %s changes before any carried authority is committed', async kind => {
    const f = await fixture();
    if (kind === 'offset') f.target.object.coordinates.globalOffsetMetres[0] += 1;
    if (kind === 'matrix') f.target.object.coordinates.displayToWorldMetres[12] += 1;
    if (kind === 'fingerprint') f.target.aggregate.contentFingerprint = 'f'.repeat(64);
    if (kind === 'head-revision') f.state.locations.get(f.fromId)!.revision = '99';
    if (kind === 'object-mode') {
      const binding = f.state.bindings.get(f.state.heads.get(f.fromId)!)!;
      binding.mode = 'object-derived'; binding.derivation = 'equipment-bottom-aabb.v1';
      const { contentSha256: _sha, ...body } = binding; binding.contentSha256 = endpointBindingHash(body);
    }
    if (kind === 'context') f.command.expectedCurrent.selectionRevision = '99';
    const before = structuredClone(f.state);
    await expect(requalifyCableEndpointBindings(f.pool, f.projectId, f.who, f.command)).rejects.toBeDefined();
    expect(f.state).toEqual(before);
  });
  it('retains exact committed reconciliation after the model context changes', async () => {
    const f = await fixture(); await requalifyCableEndpointBindings(f.pool, f.projectId, f.who, f.command);
    f.setActive(false);
    expect(await requalifyCableEndpointBindings(f.pool, f.projectId, f.who, f.command)).toMatchObject({ duplicate: true });
    await expect(requalifyCableEndpointBindings(f.pool, f.projectId, f.who, { ...f.command, cableId: id(930) })).rejects.toMatchObject({ code: 'ENDPOINT_REQUALIFICATION_IDEMPOTENCY_CONFLICT' });
  });
  it('retires carried authority in both display and calculation reads when its target trace is superseded', async () => {
    const f = await fixture(); await requalifyCableEndpointBindings(f.pool, f.projectId, f.who, f.command);
    f.target.trace.id = id(940);
    const { contentSha256: _sha, ...body } = f.target.trace; f.target.trace.contentSha256 = endpointBindingHash(body);
    expect(await readEndpointBindingScope(f.client as unknown as PoolClient, { projectId: f.projectId, locationId: f.fromId,
      modelVersionId: f.command.expectedCurrent.modelVersionId, aggregateId: f.target.aggregate.id,
      projectionSha256: f.target.aggregate.projection.sha256, captureFrameId: f.target.aggregate.coordinateFrameId }))
      .toEqual({ status: 'stale', code: 'ENDPOINT_BINDING_STALE' });
    expect((await f.endpointRepo.context(f.projectId, f.who, f.fromId)).readiness.calculationReady).toBe(false);
  });
});
