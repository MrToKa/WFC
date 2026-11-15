// @vitest-environment node
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { revisionResultEnvelopeSchema } from '../../shared/pathfinderRevisionResults.js';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { buildAutoLengthSource } from './autoLengthStore.js';
import { readCableRoutingViews } from './cableRoutingControlRepository.js';
import { buildManualRoutingSource } from './manualRoutingValidation.js';

const hash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
function fixture() {
  const f = syntheticBarrierWriteInputs(), projectId = f.dependencies.projectId, cableId = f.dependencies.cableId,
    admissionId = f.id(101), jobId = f.id(102), proposalId = f.id(103), baselineHash = 'c'.repeat(64);
  const body = { schemaVersion: 'wfc.pf.cable-revision-result.v1', id: f.id(104), projectId, admissionId, jobId, cableId, proposalId,
    proposalHash: hash({ dependencies: f.dependencies, result: f.result, baselineHash }), baselineHash,
    dependencyHash: hash(f.dependencies), engineResultSha256: hash(f.result), ledgerHash: hash(f.result.lengthLedger), oldModel: null,
    summary: { calculationMode: 'calculate', newModel: f.dependencies.model, routeText: '/A', rawLengthMeters: 5, designLengthMeters: '7', unroundedMeters: '6.6',
      delta: { rawLengthMeters: null, designLengthMeters: null, unroundedMeters: null, baseline: 'unavailable' }, reasonCodes: [] }, comparisonRef: null,
    observedEvents: [], lengthLedger: f.result.lengthLedger, physicalChangeProven: false, createdAt: '2026-10-21T16:00:00.000Z' };
  const seal = revisionResultEnvelopeSchema.parse({ ...body, revisionResultSha256: hash(body) });
  const source = buildAutoLengthSource({ projectId, cableId, jobId, proposalId, dependencies: f.dependencies, result: f.result, seal, admissionOrdinal: '1' });
  const row: Record<string, any> = { cable_id: cableId, revision: '7', current_manual_revision: '2', cable_write_revision: '88',
    manual_routing: '/A', manual_protected: true, execution_locked: false, execution_routing: null,
    manual_state: 'calculated', length_metres: 7, manual_revision: '2', diagnostics: [],
    source, source_sha256: hash(source), proposal_id: proposalId, proposal_hash: seal.proposalHash, proposal_status: 'calculated',
    result_sha256: seal.revisionResultSha256, engine_result_sha256: seal.engineResultSha256, ledger_sha256: seal.ledgerHash,
    sealed_record: seal, automatic_routing: '/UNTRUSTED_MUTABLE_PROPOSAL' };
  const {calculationMode:_manualMode,...manualResponse}=structuredClone(f.result);
  if(manualResponse.route)manualResponse.route.routeCodes=['/A'];
  if(manualResponse.schemaVersion==='pathfinder.model.response.v3')manualResponse.barriers.directSecondary=null;
  const manualDependencies={schemaVersion:'pathfinder.manual-route.dependencies.v1',manualRevision:'2',constraint:{schemaVersion:'pathfinder.manual-ordered-route.v1',routeText:'/A'},protected:f.dependencies,capacity:null};
  const manualRecord={schemaVersion:'pathfinder.manual-route.result.v1',id:f.id(111),projectId,cableId,manualRevision:'2',generation:'4',
    dependencies:manualDependencies,inputSha256:hash(manualDependencies),response:manualResponse,lengthMetres:7,calculatedAt:'2026-11-15T10:00:00.000Z'};
  Object.assign(row,{manual_generation:'4',manual_input_sha256:manualRecord.inputSha256,manual_result_id:manualRecord.id,manual_result_sha256:hash(manualRecord),manual_result_record:manualRecord});
  const manualSource=buildManualRoutingSource(manualRecord,hash(manualRecord));Object.assign(row,{manual_source_record:manualSource,manual_source_sha256:hash(manualSource)});
  const query = vi.fn(async () => ({ rows: [row] }));
  const read = async () => (await readCableRoutingViews({ query } as unknown as PoolClient, projectId, [cableId])).get(cableId)!;
  return { row, query, read };
}
describe('routing display projections from immutable successful results', () => {
  it('uses the exact sealed auto route and retains manual length after execution-only control revisions', async () => {
    const f = fixture(); expect(await f.read()).toMatchObject({ autoCalculatedRouting: '/A', autoRoutingStatus: 'last-successful',
      manualRouteLength: 7, manualRouteLengthStatus: 'calculated', cableWriteRevision: '88', routingControlRevision: '7' });
  });
  it.each(['source hash', 'seal hash', 'seal body', 'proposal', 'ledger', 'status', 'crossed source'] as const)('refuses an unverifiable %s', async kind => {
    const f = fixture();
    if (kind === 'source hash') f.row.source_sha256 = '0'.repeat(64);
    if (kind === 'seal hash') f.row.result_sha256 = '0'.repeat(64);
    if (kind === 'seal body') f.row.sealed_record.summary.routeText = '/CHANGED';
    if (kind === 'proposal') f.row.proposal_hash = '0'.repeat(64);
    if (kind === 'ledger') f.row.ledger_sha256 = '0'.repeat(64);
    if (kind === 'status') f.row.proposal_status = 'no_path';
    if (kind === 'crossed source') { f.row.source.calculatedAt = '2026-11-15T10:00:00.000Z'; f.row.source_sha256 = hash(f.row.source); }
    expect(await f.read()).toMatchObject({ autoCalculatedRouting: null, autoRoutingStatus: 'unavailable', routingControl: { manualRouting: '/A' } });
  });
  it('marks manual length stale only when its causal text revision differs', async () => {
    const f = fixture(); f.row.current_manual_revision = '3'; expect((await f.read()).manualRouteLengthStatus).toBe('stale');
  });
  it('retains legacy invalid text with a diagnostic so it can be corrected explicitly',async()=>{
    const f=fixture();f.row.manual_routing='/A\n/B';
    expect(await f.read()).toMatchObject({routingControl:{manualRouting:'/A\n/B'},routingDiagnostics:expect.arrayContaining(['MANUAL_ROUTING_INVALID_TEXT'])});
  });
  it.each(['hash','generation','input','length','manual text'] as const)('marks a crossed manual %s projection stale',async kind=>{
    const f=fixture();if(kind==='hash')f.row.manual_result_sha256='0'.repeat(64);if(kind==='generation')f.row.manual_generation='5';
    if(kind==='input')f.row.manual_input_sha256='0'.repeat(64);if(kind==='length')f.row.length_metres=8;if(kind==='manual text')f.row.manual_routing='/B';
    expect(await f.read()).toMatchObject({manualRouteLengthStatus:'stale',routingDiagnostics:expect.arrayContaining(['MANUAL_ROUTE_RESULT_UNVERIFIED'])});
  });
});
