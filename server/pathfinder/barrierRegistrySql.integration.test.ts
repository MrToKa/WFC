// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BARRIER_CAPTURE_VERSION, barrierCanonicalJson, type BarrierCapture, type BarrierModelScope } from '../../shared/pathfinderBarriers.js';
import { barrierEnumerationHashInput } from '../../viewer-runtime/barrier-capture.mjs';
import { initializeBarrierRegistrySchema } from './barrierRegistrySchema.js';
import { barrierRegistryTransaction, createBarrierRegistryRepository, type BarrierCaptureCommand, type BarrierCaptureIntent,
  type BarrierRegistryAdapters } from './barrierRegistryRepository.js';
import { barrierBytesHash, barrierValueHash, encodeBarrierJson, readBarrierBytes } from './barrierStorage.js';
import type { JobPrincipal } from './jobContracts.js';

/** Real PostgreSQL + immutable local storage tests in one fresh disposable database.
 * Qualification is an explicitly trusted TEST STUB, not C#/SDK/engineering evidence.
 * Never imports the application database singleton or its full initializer. */
const sqlUrl = process.env.PF_B2_SQL_URL;
const id = (n: number) => `b2100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), otherProjectId = id(2), modelId = id(3), otherModelId = id(4);
const firstAdmin = id(5), secondAdmin = id(6);
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
let pool: Pool | undefined;
let who: JobPrincipal, secondWho: JobPrincipal;
let sequence = 100;
const nextId = () => id(sequence++);
function scope(project = projectId): BarrierModelScope {
  return { projectId: project, modelVersionId: project === projectId ? modelId : otherModelId, contentFingerprint: 'a'.repeat(64),
    selectionRevision: '1', captureFrameId: id(7), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' };
}
const currentScope: BarrierRegistryAdapters['currentScope'] = async (client, project) => {
  // Deliberately small authoritative SQL fixture: actual row locks and tenant
  // identity, while active model/SDK frame collection is tested separately.
  const rows = (await client.query<{ id: string }>('SELECT id FROM model_versions WHERE project_id=$1 FOR SHARE', [project])).rows;
  if (rows.length !== 1 || rows[0].id !== scope(project).modelVersionId) throw Error('Synthetic current scope unavailable.');
  return scope(project);
};
const qualification = () => ({ producerVersion: 'wfc.pf.barrier-verifier.v1' as const,
  computationalMeshes: 1, verificationSha256: 'c'.repeat(64) });
function repository(qualifyCapture: BarrierRegistryAdapters['qualifyCapture'] = async () => qualification()) {
  if (!pool) throw Error('Disposable SQL fixture is not initialized.');
  return createBarrierRegistryRepository(pool, { currentScope, qualifyCapture });
}
async function captureCommand(actor = who): Promise<BarrierCaptureCommand> {
  const current = await repository().get(projectId, actor);
  return { schemaVersion: 'wfc.pf.barrier-capture-command.v1', scope: scope(), expectedRegistryRevision: current.registryRevision,
    idempotencyKey: nextId(), selectedParents: [{ selectionId: nextId(), kind: 'wall', objectId: 'dbid:10', dbId: 10,
      externalId: null, name: 'Synthetic tetrahedron parent', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }] };
}
function capture(intent: BarrierCaptureIntent): BarrierCapture {
  const value: BarrierCapture = { schemaVersion: BARRIER_CAPTURE_VERSION, captureId: intent.id, scope: intent.command.scope,
    selectedParents: intent.command.selectedParents,
    fragments: [{ source: { fragmentId: 15, ownerObjectId: 'dbid:11', parentSelectionIds: [intent.command.selectedParents[0].selectionId],
      sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: [...matrix], transformSha256: barrierValueHash(matrix) },
    bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] }, verticesMetres: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
    triangleIndices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3] }],
    observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: [15],
      unavailableFragmentIds: [], enumerationSha256: 'd'.repeat(64) } };
  value.observation.enumerationSha256 = barrierValueHash(barrierEnumerationHashInput(value)); return value;
}
const captureBytes = (intent: BarrierCaptureIntent) => Buffer.from(barrierCanonicalJson(capture(intent)));
async function stateCounts() {
  const result = await pool!.query<{ heads: string; snapshots: string; receipts: string }>(`SELECT
    (SELECT count(*)::text FROM pf_barrier_heads WHERE project_id=$1) AS heads,
    (SELECT count(*)::text FROM pf_barrier_snapshots WHERE project_id=$1) AS snapshots,
    (SELECT count(*)::text FROM pf_barrier_receipts WHERE project_id=$1) AS receipts`, [projectId]);
  return { ...result.rows[0], head: (await pool!.query('SELECT revision::text,snapshot_id FROM pf_barrier_heads WHERE project_id=$1', [projectId])).rows };
}
async function assertFreshOwnedRoot() {
  const configured = process.env.PF_ROOT;
  if (!configured || !path.isAbsolute(configured)) throw Error('PF_B2_SQL_URL also requires a fresh absolute PF_ROOT.');
  const worktree = path.resolve(fileURLToPath(new URL('../../', import.meta.url))), scratch = path.join(worktree, 'pathfinder-engine', '.scratch');
  const target = path.resolve(configured), relative = path.relative(scratch, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw Error('Refuse storage outside the isolated worktree scratch directory.');
  // Inspect all already-existing target ancestors, without creating or removing
  // anything. The production storage writer creates only the fresh owned root.
  let current = target;
  for (;;) {
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(current) !== path.resolve(current))
        throw Error('Refuse an unsafe disposable storage ancestor.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current === scratch) break;
    const parent = path.dirname(current); if (parent === current) throw Error('Scratch root was not reached.'); current = parent;
  }
  try { if ((await fs.readdir(target)).length) throw Error('Refuse nonempty disposable PF_ROOT.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

describe.runIf(Boolean(sqlUrl))('PF-B2 actual SQL and storage in fresh explicit 55439 fixture', () => {
  beforeAll(async () => {
    const url = new URL(sqlUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== '55439'
      || url.pathname !== '/pf_b2_fixture' || decodeURIComponent(url.username) !== 'pf_b2_fixture' || url.search || url.hash)
      throw Error('Refuse any database other than explicit loopback 55439/pf_b2_fixture.');
    await assertFreshOwnedRoot();
    pool = new Pool({ connectionString: sqlUrl, max: 4, connectionTimeoutMillis: 3000, query_timeout: 10000 });
    const identity = (await pool.query<{ db: string; username: string }>('SELECT current_database() AS db,current_user AS username')).rows;
    if (identity.length !== 1 || identity[0].db !== 'pf_b2_fixture' || identity[0].username !== 'pf_b2_fixture')
      throw Error('Disposable database identity mismatch.');
    const existing = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    if (existing.rows.length) throw Error('Refuse an existing database: this fixture never resets tables.');
    await pool.query(`CREATE TABLE projects(id uuid PRIMARY KEY);
      CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL);
      CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid,expires_at timestamptz,revoked_at timestamptz);
      CREATE TABLE model_versions(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),UNIQUE(project_id,id));`);
    await initializeBarrierRegistrySchema(pool); await initializeBarrierRegistrySchema(pool);
    await pool.query('INSERT INTO projects VALUES($1),($2)', [projectId, otherProjectId]);
    await pool.query('INSERT INTO users VALUES($1,true),($2,true)', [firstAdmin, secondAdmin]);
    await pool.query('INSERT INTO model_versions VALUES($1,$2),($3,$4)', [modelId, projectId, otherModelId, otherProjectId]);
    who = { userId: firstAdmin, loginId: id(8), loginExpiresAt: Date.now() + 600000 };
    secondWho = { userId: secondAdmin, loginId: id(9), loginExpiresAt: Date.now() + 600000 };
  }, 20000);
  afterAll(async () => { await pool?.end(); }); // Root owns fixture retirement; preserve all evidence.

  it('initializes the real schema twice and starts unconfigured without fabricating a barrier scope', async () => {
    const tables = (await pool!.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'pf_barrier_%' ORDER BY tablename")).rows;
    expect(tables.map(row => row.tablename)).toEqual(['pf_barrier_capture_intents', 'pf_barrier_heads', 'pf_barrier_receipts', 'pf_barrier_snapshots']);
    const triggers = (await pool!.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'pf_barrier_%'")).rows;
    expect(triggers).toHaveLength(4);
    expect(await repository().get(projectId, who)).toMatchObject({ state: 'unconfigured', registryRevision: '0', snapshot: null });
  });

  it('serializes concurrent same-key capture admissions to one durable intent', async () => {
    const repo = repository(), command = await captureCommand();
    const values = await Promise.all([repo.begin(projectId, who, command), repo.begin(projectId, who, command)]);
    expect(values[0].intent).toEqual(values[1].intent); expect(values.map(value => value.duplicate).sort()).toEqual([false, true]);
    expect((await pool!.query('SELECT id FROM pf_barrier_capture_intents WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3',
      [projectId, who.userId, command.idempotencyKey])).rows).toHaveLength(1);
    expect((await stateCounts()).head).toEqual([]);
    await expect(repo.begin(projectId, who, { ...command, selectedParents: [{ ...command.selectedParents[0], name: 'Changed same key' }] }))
      .rejects.toMatchObject({ code: 'BARRIER_IDEMPOTENCY_CONFLICT' });
  });

  it('publishes an explicit empty scope once and reconciles the identical command without another revision', async () => {
    const qualify = vi.fn<BarrierRegistryAdapters['qualifyCapture']>(async () => qualification()), repo = repository(qualify);
    const command = { schemaVersion: 'wfc.pf.barrier-registry-command.v1', action: 'declare-empty', scope: scope(),
      expectedRegistryRevision: '0', idempotencyKey: nextId(), reason: 'Synthetic SQL fixture explicitly selects no barriers.' };
    const first = await repo.command(projectId, who, command), counts = await stateCounts(), again = await repo.command(projectId, who, command);
    expect(first.snapshot).toMatchObject({ mode: 'explicit-empty', registryRevision: '1' }); expect(again).toEqual({ ...first, duplicate: true });
    expect(await stateCounts()).toEqual(counts); expect(qualify).not.toHaveBeenCalled();
    expect(await repo.get(projectId, who)).toMatchObject({ state: 'ready', registryRevision: '1', selectedParents: [] });
    expect((await repo.getSnapshot(projectId, who, first.snapshot.snapshotId)).geometry.mode).toBe('explicit-empty');
  });

  it('atomically publishes exact capture/fragment provenance with the trusted SQL-only qualifier stub', async () => {
    const qualify = vi.fn<BarrierRegistryAdapters['qualifyCapture']>(async () => qualification()), repo = repository(qualify);
    const { intent } = await repo.begin(projectId, who, await captureCommand()), raw = captureBytes(intent);
    const first = await repo.publish(projectId, who, intent.id, raw), counts = await stateCounts();
    const again = await repo.publish(projectId, who, intent.id, raw);
    expect(again).toEqual({ ...first, duplicate: true }); expect(await stateCounts()).toEqual(counts); expect(qualify).toHaveBeenCalledOnce();
    expect(qualify.mock.calls[0][0].captureSha256).toBe(barrierBytesHash(raw));
    const manifest = await repo.getSnapshot(projectId, who, first.snapshot.snapshotId);
    expect(manifest.capture).toEqual({ captureId: intent.id, payloadSha256: barrierBytesHash(raw) });
    expect(manifest.selectedParents).toEqual(intent.command.selectedParents); expect(manifest.engineeringAccepted).toBe(false);
    expect(manifest.geometry.mode).toBe('mesh-set'); if (manifest.geometry.mode !== 'mesh-set') throw Error('Expected mesh fixture.');
    const source = capture(intent).fragments[0], fragment = manifest.geometry.fragments[0];
    expect(fragment.source).toEqual(source.source); expect(fragment.bounds).toEqual(source.bounds); expect(fragment.vertices).toBe(4); expect(fragment.triangles).toBe(4);
    expect(await readBarrierBytes(projectId, intent.id, fragment.mesh)).toEqual(encodeBarrierJson({ verticesMetres: source.verticesMetres, triangleIndices: source.triangleIndices }));
    const row = (await pool!.query('SELECT state,capture_sha256 FROM pf_barrier_capture_intents WHERE id=$1', [intent.id])).rows[0];
    expect(row).toEqual({ state: 'complete', capture_sha256: barrierBytesHash(raw) });
    expect(await repo.get(projectId, who)).toMatchObject({ state: 'ready', snapshot: first.snapshot });
    expect(await repo.list(projectId, who)).toMatchObject({ snapshots: [first.snapshot, expect.objectContaining({ mode: 'explicit-empty' })] });
  });

  it('rechecks current role after asynchronous qualification and retains the previous head on revocation', async () => {
    const before = await stateCounts();
    const qualify = vi.fn<BarrierRegistryAdapters['qualifyCapture']>(async () => {
      await pool!.query('UPDATE users SET is_admin=false WHERE id=$1', [secondWho.userId]); return qualification();
    });
    const repo = repository(qualify), { intent } = await repo.begin(projectId, secondWho, await captureCommand(secondWho));
    try {
      await expect(repo.publish(projectId, secondWho, intent.id, captureBytes(intent))).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
      expect(qualify).toHaveBeenCalledOnce(); expect(await stateCounts()).toEqual(before);
      expect((await pool!.query('SELECT state FROM pf_barrier_capture_intents WHERE id=$1', [intent.id])).rows[0].state).toBe('pending');
    } finally { await pool!.query('UPDATE users SET is_admin=true WHERE id=$1', [secondWho.userId]); }
  });

  it('retains the immutable publication if the qualification callback refuses', async () => {
    const before = await stateCounts(), repo = repository(async () => { throw Error('Synthetic topology refusal'); });
    const { intent } = await repo.begin(projectId, who, await captureCommand());
    await expect(repo.publish(projectId, who, intent.id, captureBytes(intent))).rejects.toThrow('Synthetic topology refusal');
    expect(await stateCounts()).toEqual(before);
    expect((await repository().get(projectId, who)).state).toBe('ready');
  });

  it('enforces tenant composite foreign keys for model and published head identities', async () => {
    const existing = (await pool!.query('SELECT id FROM pf_barrier_snapshots WHERE project_id=$1 LIMIT 1', [projectId])).rows[0].id;
    await expect(pool!.query(`INSERT INTO pf_barrier_snapshots(id,project_id,model_version_id,registry_revision,storage_intent_id,manifest_blob,manifest,created_by,login_id)
      VALUES($1,$2,$3,99,$4,'{}','{}',$5,$6)`, [nextId(), projectId, otherModelId, nextId(), who.userId, who.loginId])).rejects.toMatchObject({ code: '23503' });
    await expect(pool!.query('INSERT INTO pf_barrier_heads(project_id,revision,snapshot_id) VALUES($1,1,$2)', [otherProjectId, existing]))
      .rejects.toMatchObject({ code: '23503' });
    await expect(repository().getSnapshot(otherProjectId, who, existing)).rejects.toMatchObject({ code: 'BARRIER_SNAPSHOT_NOT_FOUND' });
    expect((await pool!.query('SELECT id FROM pf_barrier_snapshots WHERE project_id=$1', [otherProjectId])).rows).toEqual([]);
  });

  it('keeps snapshot, receipt and completed intent evidence immutable in real PostgreSQL', async () => {
    const before = await stateCounts();
    const snapshot = (await pool!.query('SELECT id,manifest FROM pf_barrier_snapshots WHERE project_id=$1 ORDER BY registry_revision DESC LIMIT 1', [projectId])).rows[0];
    const intent = (await pool!.query("SELECT id,frozen FROM pf_barrier_capture_intents WHERE project_id=$1 AND state='complete' LIMIT 1", [projectId])).rows[0];
    await expect(pool!.query("UPDATE pf_barrier_snapshots SET manifest='{}' WHERE id=$1", [snapshot.id])).rejects.toMatchObject({ code: 'P0001' });
    await expect(pool!.query('DELETE FROM pf_barrier_receipts WHERE project_id=$1', [projectId])).rejects.toMatchObject({ code: 'P0001' });
    await expect(pool!.query("UPDATE pf_barrier_capture_intents SET frozen='{}' WHERE id=$1", [intent.id])).rejects.toMatchObject({ code: 'P0001' });
    await expect(pool!.query('DELETE FROM pf_barrier_capture_intents WHERE id=$1', [intent.id])).rejects.toMatchObject({ code: 'P0001' });
    expect((await pool!.query('SELECT manifest FROM pf_barrier_snapshots WHERE id=$1', [snapshot.id])).rows[0].manifest).toEqual(snapshot.manifest);
    expect((await pool!.query('SELECT frozen FROM pf_barrier_capture_intents WHERE id=$1', [intent.id])).rows[0].frozen).toEqual(intent.frozen);
    expect(await stateCounts()).toEqual(before);
  });

  it('rolls back all transaction mutations when the synchronous final authority fence fails', async () => {
    expect((await pool!.query('SELECT project_id FROM pf_barrier_heads WHERE project_id=$1', [otherProjectId])).rows).toEqual([]);
    await expect(barrierRegistryTransaction(pool!, otherProjectId, who, async client => {
      await client.query('INSERT INTO pf_barrier_heads(project_id,revision) VALUES($1,0)', [otherProjectId]); return 'uncommitted';
    }, undefined, () => { throw Error('Synthetic final authority expiry'); })).rejects.toThrow('Synthetic final authority expiry');
    expect((await pool!.query('SELECT project_id FROM pf_barrier_heads WHERE project_id=$1', [otherProjectId])).rows).toEqual([]);
  });
});
