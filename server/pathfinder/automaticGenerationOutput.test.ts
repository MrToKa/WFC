import { describe, it, expect, vi } from 'vitest';
import { createRecalculationRepository } from './recalculationRepository.js';
import { recalculationFixture, RECALCULATION_FIXTURE as f } from './recalculationFixtures.js';
import { AUTOMATIC_PAIR_POLICY, type AutomaticPairMandate, type AutomaticPairSource } from '../../shared/pathfinderAutomaticPair.js';
import { activeAutomaticGenerationAuthorization, requireAutomaticGenerationOutput } from './automaticGenerationOutput.js';
import { appendAutomaticPairMandatesInTransaction, requireCurrentAutomaticPairMandate } from './automaticPairMandates.js';
import { hash } from './dependencies.js';

const enable = { schemaVersion: 'wfc.pf.recalculation-command.v2' as const, action: 'enable' as const, expectedControlRevision: '1',
  idempotencyKey: f.key, reason: 'Automatically save empty and unchanged Path Finder values', preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true },
  timeoutMilliseconds: 60000, automaticPairPolicy: AUTOMATIC_PAIR_POLICY };
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function fixture() {
  const x = recalculationFixture(), repo = createRecalculationRepository(x.pool, x.adapter);
  const receipt = await repo.command(f.projectId, x.who, enable), authorization = receipt.automaticPairAuthorization!;
  const source: Extract<AutomaticPairSource, { kind: 'automatic-generation' }> = { kind: 'automatic-generation', generation: x.db.state.desired_generation,
    controlRevision: x.db.state.control_revision, authorityEpoch: x.db.state.authority_epoch, authorization };
  const dependencies = { schemaVersion: 'pathfinder.dependencies.v8', projectId: f.projectId, cableId: f.actorId, cableWriteRevision: '7' };
  const cables = new Map([[f.actorId, { id: f.actorId, project_id: f.projectId, cable_write_revision: '7', mto: 'LV', routing: null as string | null, design_length: null }],
    [other, { id: other, project_id: f.projectId, cable_write_revision: '7', mto: 'LV', routing: '/MANUAL', design_length: null }]]);
  const mandates: AutomaticPairMandate[] = [], original = x.query.getMockImplementation()!;
  const enrollment = { generation: source.generation, control_revision: source.controlRevision, authority_epoch: source.authorityEpoch,
    actor_id: x.who.userId, login_id: x.who.loginId, automatic_pair_authority: authorization };
  const currentSource = () => ({ ...x.db.state, is_admin: x.db.authority, admin_revision: '1', installation_epoch: f.owner });
  x.query.mockImplementation(async (raw, args = []) => {
    const sql = typeof raw === 'string' ? raw : raw.text;
    if (sql.includes('automatic-generation:state')) return { rows: [currentSource()], rowCount: 1 };
    if (sql.includes('automatic-generation:enable-command')) { const c = x.db.commands.get(args[2]); return { rows: c ? [c] : [], rowCount: c ? 1 : 0 }; }
    if (sql.includes('automatic-generation:enrollment')) return { rows: [enrollment], rowCount: 1 };
    if (sql.includes('automatic-pair:principal')) return { rows: [{ is_admin: x.db.authority, admin_revision: '1', installation_epoch: f.owner }], rowCount: 1 };
    if (sql.includes('automatic-pair:admitted-job')) return { rows: [{ requested_by: x.who.userId, login_id: x.who.loginId, login_expires_at: new Date(x.who.loginExpiresAt),
      authority_kind: 'current-login', state: 'queued', cancel_requested: false, request_hash: 'a'.repeat(64) }], rowCount: 1 };
    if (sql.includes('automatic-pair:admitted-item')) return { rows: [{ dependencies: { ...dependencies, cableId: args[2] } }], rowCount: 1 };
    if (sql.includes('automatic-pair:cable-baseline')) return { rows: [{ value: cables.get(args[1]) }], rowCount: 1 };
    if (sql.includes('automatic-pair:latest-receipt')) return { rows: [], rowCount: 0 };
    if (sql.includes('automatic-pair:mandate')) { const m = mandates.find(m => m.cableId === args[2]); return { rows: m ? [{ record: m, record_sha256: m.contentSha256,
      project_id: m.projectId, job_id: m.jobId, cable_id: m.cableId, id: m.id, actor_id: m.actorId, login_id: m.loginId }] : [], rowCount: m ? 1 : 0 }; }
    if (sql.startsWith('INSERT INTO pf_automatic_pair_mandates')) { mandates.push(args[7]); return { rows: [], rowCount: 0 }; }
    if (sql.startsWith('INSERT INTO pf_automatic_pair_dispatch')) return { rows: [], rowCount: 0 };
    if (sql.includes('automatic-pair:current-authority')) return { rows: [{ is_admin: x.db.authority, admin_revision: '1', installation_epoch: f.owner,
      requested_by: x.who.userId, login_id: x.who.loginId, login_expires_at: new Date(x.who.loginExpiresAt), authority_kind: 'current-login',
      state: 'running', cancel_requested: false, request_hash: 'a'.repeat(64) }], rowCount: 1 };
    if (sql.startsWith('SELECT impact_id FROM pf_location_impact_enrollments')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT authority_kind,grant_provenance')) return { rows: [{ authority_kind: 'current-login' }], rowCount: 1 };
    if (sql.startsWith('SELECT actor_id,login_id FROM pf_recalculation_enrollments')) return { rows: [{ actor_id: x.who.userId, login_id: x.who.loginId }], rowCount: 1 };
    if (sql.startsWith('SELECT e.generation::text')) return { rows: [{ ...enrollment, desired_generation: x.db.state.desired_generation,
      authority_expires_at: x.db.state.authority_expires_at, current_epoch: x.db.state.authority_epoch, enabled: x.db.state.enabled, paused: x.db.state.paused,
      current_actor: x.who.userId, current_login: x.who.loginId, current_expiry: x.db.state.authority_expires_at, requested_by: x.who.userId,
      job_login: x.who.loginId, login_expires_at: new Date(x.who.loginExpiresAt), is_admin: true, login_user: x.who.userId,
      expires_at: new Date(x.who.loginExpiresAt), revoked_at: null }], rowCount: 1 };
    return original(raw, args);
  });
  const admission = () => appendAutomaticPairMandatesInTransaction(x.client, { projectId: f.projectId, jobId: f.jobId, principal: x.who,
    source, policy: AUTOMATIC_PAIR_POLICY, requestSha256: 'a'.repeat(64), items: [...cables.keys()].sort().map(cableId => ({ cableId,
      cableWriteRevision: '7', dependencyHash: hash({ ...dependencies, cableId }) })) });
  const proof = (admission = false) => requireAutomaticGenerationOutput(x.client, source,
    { projectId: f.projectId, actorId: x.who.userId, loginId: x.who.loginId, jobId: f.jobId, admission });
  return { ...x, repo, receipt, source, authorization, mandates, enrollment, cables, admission, proof };
}
describe('explicit current-login automatic project output authority', () => {
  it('passes the exact frozen output authority from a guarded current claim to its real admission boundary', async () => {
    const x=await fixture(),claim={...x.claim,generation:x.source.generation,controlRevision:x.source.controlRevision,
      authorityEpoch:x.source.authorityEpoch,automaticPairAuthorization:x.authorization};
    Object.assign(x.db.claim!,{generation:claim.generation,control_revision:claim.controlRevision,authority_epoch:claim.authorityEpoch});
    await x.repo.enrollClaim(claim);
    expect(vi.mocked(x.adapter.createInTransaction).mock.calls[0][1].automaticPairSource).toEqual(x.source);
    const old=recalculationFixture();await createRecalculationRepository(old.pool,old.adapter).enrollClaim(old.claim);
    expect(vi.mocked(old.adapter.createInTransaction).mock.calls[0][1].automaticPairSource).toBeUndefined();
  });
  it('keeps historical v1 proposal-only and opts a new v2 enable into a new generation', async () => {
    const x = recalculationFixture(), repo = createRecalculationRepository(x.pool, x.adapter);
    const { automaticPairPolicy: _policy, ...old } = enable;
    expect((await repo.command(f.projectId, x.who, { ...old, schemaVersion: 'wfc.pf.recalculation-command.v1' })).context.automaticPairPolicy).toBeUndefined();
    const next = await repo.command(f.projectId, x.who, { ...enable, idempotencyKey: other });
    expect(next.context.automaticPairPolicy).toEqual(AUTOMATIC_PAIR_POLICY); expect(next.context.desiredGeneration).toBe('3');
    expect(next.automaticPairAuthorization?.commandKey).toBe(other);
  });
  it('proves the original v2 enable before enrolling only eligible empty rows; manual pairs stay untouched', async () => {
    const x = await fixture(); expect(await x.proof(true)).toEqual(x.authorization);
    expect(await x.admission()).toBe(1); expect(x.mandates[0].cableId).toBe(f.actorId); expect(x.mandates[0].source).toEqual(x.source);
    expect(x.mandates[0].authorityExpiresAt).toBe(x.authorization.authorityExpiresAt);
    expect(x.cables.get(other)?.routing).toBe('/MANUAL');
    await expect(requireCurrentAutomaticPairMandate(x.client, x.mandates[0])).resolves.toEqual(x.mandates[0]);
  });
  it.each(['generation','control','epoch','pause','policy','original-command','original-receipt','admin-revision','enrollment'] as const)('rejects changed %s without adding a mandate', async field => {
    const x = await fixture();
    if (field === 'generation') x.db.state.desired_generation = '999';
    if (field === 'control') x.db.state.control_revision = '999';
    if (field === 'epoch') x.db.state.authority_epoch = '999';
    if (field === 'pause') x.db.state.paused = true;
    if (field === 'policy') x.db.state.automatic_pair_authority = null;
    if (field === 'original-command') x.db.commands.get(f.key)!.request = { ...enable, reason: 'substituted' };
    if (field === 'original-receipt') x.db.commands.get(f.key)!.receipt.automaticPairAuthorization = undefined;
    if (field === 'admin-revision') { x.source.authorization = { ...x.authorization, actorAdminRevision: '99' }; x.db.state.automatic_pair_authority = x.source.authorization; }
    if (field === 'enrollment') x.enrollment.control_revision = '999';
    await expect(x.proof()).rejects.toBeDefined(); expect(x.mandates).toHaveLength(0);
  });
  it('does not turn issuer provenance into grant write authority', async () => {
    const x = await fixture(); await expect(appendAutomaticPairMandatesInTransaction(x.client, { projectId: f.projectId, jobId: f.jobId,
      principal: { ...x.who, kind: 'calculation-grant' } as never, source: x.source, policy: AUTOMATIC_PAIR_POLICY, requestSha256: 'a'.repeat(64),
      items: [{ cableId: f.actorId, cableWriteRevision: '7', dependencyHash: 'a'.repeat(64) }] })).rejects.toMatchObject({ code: 'AUTOMATIC_PAIR_HUMAN_AUTHORITY_REQUIRED' });
  });
  it('retry preserves its original output expiry and exact replay never renews it', async () => {
    const x = await fixture(), original = structuredClone(x.authorization);
    expect((await x.repo.command(f.projectId, x.who, enable)).automaticPairAuthorization).toEqual(original);
    await x.repo.command(f.projectId, x.who, { schemaVersion: 'wfc.pf.recalculation-command.v1', action: 'retry', expectedControlRevision: x.db.state.control_revision,
      idempotencyKey: other, reason: 'Retry calculation only' });
    expect(x.db.state.automatic_pair_authority).toEqual(original);
    expect(activeAutomaticGenerationAuthorization(x.db.state)?.authorityExpiresAt).toBe(original.authorityExpiresAt);
    await expect(x.proof()).rejects.toMatchObject({ code: 'AUTOMATIC_OUTPUT_GENERATION_CHANGED' });
  });
  it('expired output permission is omitted rather than renewed by retry', async () => {
    const x = await fixture(); vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.parse(x.authorization.authorityExpiresAt) + 1);
      expect(activeAutomaticGenerationAuthorization(x.db.state)).toBeNull();
      const result = await x.repo.command(f.projectId, x.who, { schemaVersion: 'wfc.pf.recalculation-command.v1', action: 'retry', expectedControlRevision: x.db.state.control_revision,
        idempotencyKey: other, reason: 'Retry after output permission expired' });
      expect(result.context.automaticPairPolicy).toBeUndefined(); expect(x.db.state.automatic_pair_authority).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
