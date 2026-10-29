// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { AUTOMATIC_PAIR_POLICY, automaticPairMandateHashInput, type AutomaticPairMandate, type AutomaticPairOwnership } from '../../shared/pathfinderAutomaticPair.js';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { automaticPairHash, createAutomaticPairReceiptProofReader } from './automaticPairReceiptProof.js';
import { automaticPairIdempotencyKey } from './automaticPairWriter.js';
import { requireBarrierWriteEvidence } from './barrierWrites.js';

type Row = Record<string, any>;
function fixture() {
  const { dependencies: base, result, id } = syntheticBarrierWriteInputs(), projectId = base.projectId, cableId = base.cableId, actorId = id(13);
  const blank: Row = { id: cableId, project_id: projectId, cable_id: 1, cable_write_revision: '7', mto: 'LV', routing: null, design_length: null, install_length: '9',
    tag: 'Cable', revision: '1', cable_type_id: id(17), from_location: 'FROM', to_location: 'TO', delivery: null, pull_date: null, connected_from: null, connected_to: null, tested: null };
  const receipts = new Map<string, Row>(), histories = new Map<string, Row>(), mandates = new Map<string, Row>(), seals = new Map<string, Row>();
  function add(n: number, before: Row, ownership: AutomaticPairOwnership = { kind: 'empty' }, capacityClear=false) {
    const now=Date.now();
    const receiptId = id(100 + n), proposalId = id(200 + n), jobId = id(300 + n), history = { id: id(400 + n), version: String(n + 1) };
    const after:Row = { ...before, routing: capacityClear?null:'/A', design_length: capacityClear?null:'7', cable_write_revision: (BigInt(before.cable_write_revision) + 1n).toString() };
    const dependencies = { ...base,settings:{...base.settings,...(capacityClear?{trayCapacity:{enabled:true as const,minimumFreeSpacePercent:30,layoutSha256:'c'.repeat(64),tolerancePercentagePoints:3 as const}}:{})}, cableWriteRevision: before.cable_write_revision };
    const output=structuredClone(result);
    if(capacityClear){Object.assign(output,{status:'no_path',trayCapacity:{schemaVersion:'wfc.pf.tray-capacity-diagnostics.v1',minimumFreeSpacePercent:30,
      effectiveMinimumFreeSpacePercent:27,tolerancePercentagePoints:3,occupancySha256:'f'.repeat(64),groupCableCount:1,blockedRouteCodes:['/A'],
      unavailableRouteCodes:[],trays:[{routeCode:'/A',freeSpacePercent:20,status:'below-minimum'}],outcome:'no-capacity',attempts:2,excludedRouteCodes:['/A']}});
      delete output.route;delete output.design;delete output.lengthLedger;
      if(output.schemaVersion==='pathfinder.model.response.v3')Object.assign(output.barriers,{proof:null,qualification:null,directSecondary:null,
        connectors:{from:null,to:null},diagnostics:{...output.barriers.diagnostics,status:'blocked'}});}
    const dependencyHash = automaticPairHash(dependencies);
    const seal = { projectId, cableId, jobId, proposalId, admissionId: id(500 + n), baselineHash: 'a'.repeat(64), revisionResultSha256: 'b'.repeat(64),
      engineResultSha256: automaticPairHash(output), ledgerHash: capacityClear?null:automaticPairHash(output.lengthLedger), dependencyHash };
    seals.set(proposalId, seal);
    const draft: AutomaticPairMandate = { schemaVersion: 'wfc.pf.automatic-pair-mandate.v1', id: id(600 + n), projectId, jobId, cableId, actorId, actorAdminRevision: '2', loginId: id(14),
      loginExpiresAt: new Date(now + 60000).toISOString(), authorityExpiresAt: new Date(now + 30000).toISOString(), createdAt: new Date(now - 1000).toISOString(), installationEpoch: id(15),
      policy: AUTOMATIC_PAIR_POLICY, source: { kind: 'explicit-job' }, requestSha256: 'c'.repeat(64), dependencyHash,
      baselineSha256: automaticPairHash(before), cableWriteRevision: before.cable_write_revision, ownership, contentSha256: '0'.repeat(64) };
    const mandate = { ...draft, contentSha256: automaticPairHash(automaticPairMandateHashInput(draft)) };
    const body = { schemaVersion: 'wfc.pf.automatic-pair-write.v1' as const, mandateId: mandate.id, mandateSha256: mandate.contentSha256,
      projectId, jobId, cableId, proposalId, proposalHash: 'd'.repeat(64), expectedCableWriteRevision: before.cable_write_revision };
    const request = { ...body, idempotencyKey: automaticPairIdempotencyKey(body) };
    const {outcome:_outcome,attempts:_attempts,excludedRouteCodes:_excluded,...checked}=output.trayCapacity??{};
    const provenance = {schemaVersion:capacityClear?'pathfinder.automatic-pair-capacity-clear.v1':'pathfinder.automatic-pair.v1',
      validationMethod:capacityClear?'automatic-owned-capacity-clear':'automatic-owned-pair', engineeringAccepted: false, nativeParity: 'not-performed',
      request, mandate, dependencies,...(capacityClear?{capacityEvidence:{schemaVersion:'wfc.pf.capacity-clear-evidence.v1',projectId,cableId,
        dependencySha256:dependencyHash,engineResultSha256:automaticPairHash(output),verifiedExclusions:checked}}
        :{barrierEvidence:requireBarrierWriteEvidence(dependencies,output)}), revisionResult: {
        admissionId: seal.admissionId, revisionResultSha256: seal.revisionResultSha256, baselineHash: seal.baselineHash, engineResultSha256: seal.engineResultSha256,
        ledgerHash: seal.ledgerHash, dependencyHash }, history, authorizedAt: new Date(now).toISOString() };
    const row: Row = { id: receiptId, project_id: projectId, cable_id: cableId, actor_id: actorId, idempotency_key: request.idempotencyKey, payload_hash: automaticPairHash(request),
      proposal_id: proposalId, before_snapshot: before, after_snapshot: after, provenance, dependencies, result:output, proposal_hash: body.proposalHash, dependency_hash: dependencyHash, job_id: jobId, status: capacityClear?'no_path':'calculated',
      applied_at: new Date(now+n).toISOString(),applied_at_exact:new Date(now+n).toISOString() };
    receipts.set(receiptId, row); histories.set(history.id, { ...after, id: history.id, version: history.version, change_source: 'pathfinder', changed_by: actorId, cable_number: 1,created_at:row.applied_at_exact });
    mandates.set(mandate.id, { record: mandate, record_sha256: mandate.contentSha256 }); return { row, after, history, mandate };
  }
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql.includes('receipt-proof')) return { rows: receipts.has(args[2]) ? [receipts.get(args[2])] : [] };
    if (sql.includes('historical-mandate')) return { rows: mandates.has(args[3]) ? [mandates.get(args[3])] : [] };
    if (sql.includes('recorded-history')) return { rows: histories.has(args[1]) ? [histories.get(args[1])] : [] };
    if (sql.includes('initial-history')) return { rows: [...histories.values()].filter(history=>history.created_at===args[1]) };
    throw Error(sql);
  });
  const client = { query } as unknown as PoolClient;
  const initialProof = vi.fn(async () => true);
  const read = () => createAutomaticPairReceiptProofReader(client, undefined, { seal: vi.fn(async (_c, input) => seals.get(input.proposalId)) as any, initialProof });
  return { blank, receipts, histories, mandates, query, add, read, initialProof, input: (receiptId: string) => ({ projectId, cableId, receiptId }), id };
}
describe('historical automatic pair receipt lineage proof', () => {
  it('retains automatic ownership through an audited capacity clear and a later refill',async()=>{
    const f=fixture(),root=f.add(1,f.blank),origin=(await f.read()(f.input(root.row.id)))!;
    const cleared=f.add(2,root.after,{kind:'automatic',originReceiptId:origin.originReceiptId,previousReceiptId:origin.receiptId,
      previousReceiptSha256:origin.receiptSha256,afterCableWriteRevision:root.after.cable_write_revision,history:origin.history},true);
    const clearFact=(await f.read()(f.input(cleared.row.id)))!;expect(clearFact).toMatchObject({clearedForCapacity:true,originReceiptId:root.row.id,after:{routing:null,design_length:null,install_length:'9'}});
    const refilled=f.add(3,cleared.after,{kind:'automatic',originReceiptId:clearFact.originReceiptId,previousReceiptId:clearFact.receiptId,
      previousReceiptSha256:clearFact.receiptSha256,afterCableWriteRevision:cleared.after.cable_write_revision,history:clearFact.history});
    expect(await f.read()(f.input(refilled.row.id))).toMatchObject({originReceiptId:root.row.id,receiptId:refilled.row.id,after:{routing:'/A',design_length:'7'}});
  });
  it.each(['generic no path','changed installed length','missing proof','manual origin'] as const)('rejects a capacity-clear receipt with %s',async kind=>{
    const f=fixture(),root=f.add(1,f.blank),origin=(await f.read()(f.input(root.row.id)))!;
    const cleared=f.add(2,root.after,{kind:'automatic',originReceiptId:origin.originReceiptId,previousReceiptId:origin.receiptId,
      previousReceiptSha256:origin.receiptSha256,afterCableWriteRevision:root.after.cable_write_revision,history:origin.history},true);
    if(kind==='generic no path')delete cleared.row.result.trayCapacity;if(kind==='changed installed length')cleared.row.after_snapshot.install_length='10';
    if(kind==='missing proof')delete cleared.row.provenance.capacityEvidence;if(kind==='manual origin')root.row.provenance={schemaVersion:'pathfinder.apply.v3'};
    expect(await f.read()(f.input(cleared.row.id))).toBeNull();
  });
  it('recognizes a verified empty root and its exact history without current authority', async () => {
    const f = fixture(), a = f.add(1, f.blank), fact = await f.read()(f.input(a.row.id));
    expect(fact).toMatchObject({ originReceiptId: a.row.id, history: a.history, after: a.after });
    expect(f.query.mock.calls.some(([sql]) => /users|viewer_login_bindings|UPDATE|INSERT/.test(sql))).toBe(false);
  });
  it('requires every automatic transition to continue the exact origin/revision/history', async () => {
    const f = fixture(), a = f.add(1, f.blank), fact = (await f.read()(f.input(a.row.id)))!;
    const b = f.add(2, a.after, { kind: 'automatic', originReceiptId: fact.originReceiptId, previousReceiptId: fact.receiptId,
      previousReceiptSha256: fact.receiptSha256, afterCableWriteRevision: fact.after.cable_write_revision, history: fact.history });
    expect(await f.read()(f.input(b.row.id))).toMatchObject({ originReceiptId: a.row.id, receiptId: b.row.id });
    a.row.after_snapshot = { ...a.after, routing: '/CORRUPT' }; expect(await f.read()(f.input(b.row.id))).toBeNull();
  });
  async function materialInitializationLineage(change?:(before:Row,root:ReturnType<ReturnType<typeof fixture>['add']>,f:ReturnType<typeof fixture>)=>void,initiallyInitialized=false){
    const f=fixture();Object.assign(f.blank,{materials_initialized:initiallyInitialized,materials_customized:false,updated_at:'2026-10-21T09:08:42.178872+00:00'});
    const root=f.add(1,f.blank),automatic=root.row.provenance;
    // The initial proof adapter independently certifies this historical root;
    // this test targets continuity from that exact root into automatic writes.
    root.row.provenance={schemaVersion:'pathfinder.initial-fill.v1',validationMethod:'automatic-initial-fill',nativeParity:'not-performed',engineeringAccepted:false,
      proposalId:root.row.proposal_id,proposalHash:root.row.proposal_hash,dependencies:root.row.dependencies,
      mandate:{id:f.id(70),contentSha256:'a'.repeat(64),impactId:f.id(71),mode:'when-both-empty'},
      request:{schemaVersion:'wfc.pf.initial-fill-request.v1',idempotencyKey:root.row.idempotency_key,proposalId:root.row.proposal_id,
        expectedProposalHash:root.row.proposal_hash,mandateId:f.id(70),expectedCableWriteRevision:'7'},revisionResult:automatic.revisionResult,
      authorized:{actorId:root.row.actor_id,loginId:f.id(14),installationEpoch:f.id(15),targetGeneration:'1',authorizedAt:new Date().toISOString()}};
    const fact=(await f.read()(f.input(root.row.id)))!;expect(fact).not.toBeNull();
    const before={...root.after,materials_initialized:true,updated_at:'2026-10-23T06:22:18.572355+00:00'};change?.(before,root,f);
    const next=f.add(2,before,{kind:'automatic',originReceiptId:fact.originReceiptId,previousReceiptId:fact.receiptId,
      previousReceiptSha256:fact.receiptSha256,afterCableWriteRevision:fact.after.cable_write_revision,history:fact.history});
    return{f,root,next};
  }
  it('preserves proven initial-fill ownership across default material initialization and another automatic write',async()=>{
    const {f,root,next}=await materialInitializationLineage();
    const fact=await f.read()(f.input(next.row.id));expect(fact).toMatchObject({originReceiptId:root.row.id,receiptId:next.row.id,history:next.history});
    const third=f.add(3,next.after,{kind:'automatic',originReceiptId:fact!.originReceiptId,previousReceiptId:fact!.receiptId,
      previousReceiptSha256:fact!.receiptSha256,afterCableWriteRevision:fact!.after.cable_write_revision,history:fact!.history});
    expect(await f.read()(f.input(third.row.id))).toMatchObject({originReceiptId:root.row.id,receiptId:third.row.id});
  });
  it('keeps four receipts eligible across initialization and repeated initialized-material timestamp updates',async()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-23T11:31:00.940Z'));
    try{
      const {f,root,next}=await materialInitializationLineage();
      next.after.updated_at='2026-10-23T11:30:59.340531+00:00';
      const second=(await f.read()(f.input(next.row.id)))!;expect(second).not.toBeNull();
      vi.setSystemTime(new Date('2026-10-23T17:00:00Z'));
      const beforeThird={...next.after,updated_at:'2026-10-23T16:50:20.222909+00:00'};
      const third=f.add(3,beforeThird,{kind:'automatic',originReceiptId:second.originReceiptId,previousReceiptId:second.receiptId,
        previousReceiptSha256:second.receiptSha256,afterCableWriteRevision:second.after.cable_write_revision,history:second.history});
      third.after.updated_at='2026-10-23T17:00:00Z';
      const thirdFact=(await f.read()(f.input(third.row.id)))!;expect(thirdFact).toMatchObject({originReceiptId:root.row.id,receiptId:third.row.id});
      vi.setSystemTime(new Date('2026-10-23T18:00:00Z'));
      const fourth=f.add(4,{...third.after,updated_at:'2026-10-23T17:50:20.222909+00:00'},
        {kind:'automatic',originReceiptId:thirdFact.originReceiptId,previousReceiptId:thirdFact.receiptId,
          previousReceiptSha256:thirdFact.receiptSha256,afterCableWriteRevision:thirdFact.after.cable_write_revision,history:thirdFact.history});
      expect(await f.read()(f.input(fourth.row.id))).toMatchObject({originReceiptId:root.row.id,receiptId:fourth.row.id});
    }finally{vi.useRealTimers();}
  });
  it.each(['reverse','after authorization'] as const)('rejects a material timestamp %s even within one millisecond',async kind=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-23T11:31:00.940Z'));
    try{
      const {f,next}=await materialInitializationLineage(before=>{before.updated_at=kind==='reverse'
        ?'2026-10-21T09:08:42.178100+00:00':'2026-10-23T11:31:00.940001Z';});
      expect(await f.read()(f.input(next.row.id))).toBeNull();
    }finally{vi.useRealTimers();}
  });
  it.each(['routing','design length','write revision','history','install length','tag','location','type','unknown field','customization','reset flag',
    'uninitialized timestamp only','reverse timestamp','future timestamp','invalid timestamp'] as const)(
    'never treats intervening %s as default material initialization',async kind=>{
      const {f,next}=await materialInitializationLineage((before,root,state)=>{
        if(kind==='routing')before.routing='/MANUAL';if(kind==='design length')before.design_length='8';if(kind==='write revision')before.cable_write_revision='99';
        if(kind==='history')state.histories.delete(root.history.id);if(kind==='install length')before.install_length='10';if(kind==='tag')before.tag='MANUAL';
        if(kind==='location')before.from_location='OTHER';if(kind==='type')before.cable_type_id=state.id(99);if(kind==='unknown field')before.extra=true;
        if(kind==='customization')before.materials_customized=true;if(kind==='reset flag'||kind==='uninitialized timestamp only')before.materials_initialized=false;
        if(kind==='reverse timestamp')before.updated_at='2026-10-20T00:00:00Z';if(kind==='future timestamp')before.updated_at='2099-01-01T00:00:00Z';
        if(kind==='invalid timestamp')before.updated_at='invalid';
      },kind==='reset flag');
      expect(await f.read()(f.input(next.row.id))).toBeNull();
    });
  it('never seeds ownership from manually reviewed Apply alone', async () => {
    const f = fixture(), a = f.add(1, f.blank); a.row.provenance = { schemaVersion: 'pathfinder.apply.v3', validationMethod: 'manual-review' } as never;
    expect(await f.read()(f.input(a.row.id))).toBeNull();
  });
  it('recognizes a proven legacy initial fill using the exact transaction timestamp including microseconds', async () => {
    const f = fixture(), a = f.add(1, f.blank), previous = a.row.provenance, request = { schemaVersion: 'wfc.pf.initial-fill-request.v1', idempotencyKey: a.row.idempotency_key,
      proposalId: a.row.proposal_id, expectedProposalHash: a.row.proposal_hash, mandateId: f.id(70), expectedCableWriteRevision: '7' };
    a.row.provenance = { schemaVersion: 'pathfinder.initial-fill.v2', validationMethod: 'automatic-initial-fill', nativeParity: 'not-performed', engineeringAccepted: false,
      proposalId: a.row.proposal_id, proposalHash: a.row.proposal_hash, dependencies: a.row.dependencies, barrierEvidence: previous.barrierEvidence,
      mandate: { id: f.id(70), contentSha256: 'a'.repeat(64), impactId: f.id(71), mode: 'when-both-empty' }, request,
      revisionResult: previous.revisionResult, authorized: { actorId: a.row.actor_id, loginId: f.id(14), installationEpoch: f.id(15), targetGeneration: '1', authorizedAt: new Date().toISOString() } };
    a.row.applied_at_exact = '2026-10-23 00:00:00.123456+00';
    f.histories.get(a.history.id)!.created_at=a.row.applied_at_exact;
    expect(await f.read()(f.input(a.row.id))).toMatchObject({ originReceiptId: a.row.id, history: a.history });
    expect(f.query.mock.calls.find(([sql]) => sql.includes('initial-history'))![1]![1]).toBe(a.row.applied_at_exact);
    f.initialProof.mockResolvedValue(false); expect(await f.read()(f.input(a.row.id))).toBeNull();
  });
  it.each(['history', 'mandate', 'payload', 'route', 'revision', 'barriers', 'expiry'] as const)('refuses inconsistent %s', async kind => {
    const f = fixture(), a = f.add(1, f.blank);
    if (kind === 'history') f.histories.delete(a.history.id); if (kind === 'mandate') f.mandates.get(a.mandate.id)!.record_sha256 = 'f'.repeat(64);
    if (kind === 'payload') a.row.payload_hash = 'f'.repeat(64); if (kind === 'route') a.row.after_snapshot.routing = '/WRONG';
    if (kind === 'revision') a.row.after_snapshot.cable_write_revision = '10'; if (kind === 'barriers') a.row.provenance.barrierEvidence = {} as never;
    if (kind === 'expiry') a.row.provenance.authorizedAt = a.mandate.authorityExpiresAt;
    expect(await f.read()(f.input(a.row.id))).toBeNull();
  });
});
