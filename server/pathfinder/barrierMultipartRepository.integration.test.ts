import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BARRIER_MULTIPART_PROFILE, barrierMultipartCanonicalBytes,
  barrierMultipartPageHashInput, barrierMultipartSealHashInput, type BarrierMultipartPage, type BarrierMultipartScope,
  barrierMultipartRangeHashInput, barrierMultipartRangeBytes, barrierMultipartSealSchema, type BarrierMultipartGeometryRange,
  type BarrierMultipartSeal } from '../../shared/pathfinderBarrierMultipart.js';
import type { BarrierMultipartAdmitCommand, BarrierMultipartSession } from '../../shared/pathfinderBarrierMultipartSessions.js';
import type { JobPrincipal } from './jobContracts.js';
import { createBarrierMultipartRepository, type BarrierMultipartRepositoryAdapters } from './barrierMultipartRepository.js';
import { initializeBarrierMultipartSchema } from './barrierMultipartSchema.js';
import { createBarrierMultipartStorage } from './barrierMultipartStorage.js';

// Opt-in ONLY. This file is not a default database connection or a live migration.
const fixtureFile = process.env.PF_B13B_SQL_FIXTURE;
const id = () => randomUUID(), h = (value: unknown) => createHash('sha256').update(barrierMultipartCanonicalBytes(value)).digest('hex');
const same = (left: string, right: string) => path.resolve(left) === path.resolve(right);
const inside = (root: string, file: string) => { const relative = path.relative(root, file); return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep); };

describe.skipIf(!fixtureFile).sequential('owned Linux PostgreSQL multipart staging, never publication', () => {
  let pool: Pool, connected: Pool, projectId: string, who: JobPrincipal, currentScope: BarrierMultipartScope, dataRoot: string;
  const controls = { afterStore: null as (() => Promise<void>) | null, commitUnknown: false, stores: 0 };
  let adapters: BarrierMultipartRepositoryAdapters, repository: ReturnType<typeof createBarrierMultipartRepository>;
  beforeAll(async () => {
    if (process.platform !== 'linux') throw Error('PF_B13B_LINUX_FIXTURE_REQUIRED');
    const root = process.env.PF_B13B_FIXTURE_ROOT, configuredData = process.env.PF_B13B_DATA_ROOT;
    if (!root || !configuredData || !fixtureFile || !path.isAbsolute(root) || !path.isAbsolute(configuredData)
      || !path.isAbsolute(fixtureFile) || !inside(root, fixtureFile)) throw Error('PF_B13B_EXPLICIT_FIXTURE_REQUIRED');
    for (const file of [root, configuredData]) {
      const stat = await fs.lstat(file); if (!stat.isDirectory() || stat.isSymbolicLink() || !same(await fs.realpath(file), file)) throw Error('PF_B13B_FIXTURE_PATH');
    }
    const stat = await fs.lstat(fixtureFile); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8192 || !same(await fs.realpath(fixtureFile), fixtureFile)) throw Error('PF_B13B_FIXTURE_PATH');
    const config = JSON.parse(await fs.readFile(fixtureFile, 'utf8')) as { ownerId: string; connectionString: string; database: string; dataRoot: string };
    if (Object.keys(config).sort().join(',') !== 'connectionString,dataRoot,database,ownerId' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.ownerId)
      || !/^wfc_pfb13b_[a-f0-9]{32}$/.test(config.database) || !same(config.dataRoot, configuredData)) throw Error('PF_B13B_FIXTURE_SCOPE');
    const url = new URL(config.connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== 'pg-b13b' || url.port && url.port !== '5432'
      || decodeURIComponent(url.pathname.slice(1)) !== config.database || url.search) throw Error('PF_B13B_FIXTURE_DATABASE');
    connected = new Pool({ connectionString: config.connectionString, max: 4 });
    const identity = (await connected.query<{ name: string; owner: string }>('SELECT current_database() AS name,owner::text FROM public.pfb13b_fixture_owner')).rows;
    if (identity.length !== 1 || identity[0].name !== config.database || identity[0].owner !== config.ownerId) throw Error('PF_B13B_FIXTURE_OWNER');
    if ((await connected.query("SELECT 1 FROM pg_namespace WHERE nspname='pfb13b_repository'")).rows.length) throw Error('PF_B13B_FRESH_SCHEMA_REQUIRED');
    await connected.query('CREATE SCHEMA pfb13b_repository'); await connected.end();
    connected = new Pool({ connectionString: config.connectionString, max: 4, options: '-c search_path=pfb13b_repository,public' });
    await connected.query(`CREATE TABLE projects(id uuid PRIMARY KEY);CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL);
      CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
      CREATE TABLE pf_barrier_heads(project_id uuid PRIMARY KEY,revision bigint NOT NULL,snapshot_id uuid);`);
    await initializeBarrierMultipartSchema(connected); projectId = id(); who = { userId: id(), loginId: id(), loginExpiresAt: Date.now() + 3600000 };
    await connected.query('INSERT INTO projects VALUES($1);', [projectId]); await connected.query('INSERT INTO users VALUES($1,true)', [who.userId]);
    currentScope = { schemaVersion: 'wfc.pf.barrier-multipart-scope.v2', modelScope: { projectId, modelVersionId: id(), contentFingerprint: 'a'.repeat(64), selectionRevision: '1',
      captureFrameId: id(), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' }, modelLoadId: id(),
    selectedParents: [{ selectionId: id(), dbId: 3, kind: 'wall' }], geometryPolicy: 'original-triangles-structural-only.v2' };
    dataRoot = path.join(config.dataRoot, 'repository-' + config.ownerId); await fs.mkdir(dataRoot, { mode: 0o700 });
    const realStorage = createBarrierMultipartStorage(dataRoot);
    const wrappedPool = { connect: async () => {
      const client = await connected.connect();
      return { release: (error?: boolean) => client.release(error), query: async (sql: string, values?: unknown[]) => {
        const result = await client.query(sql, values);
        if (sql === 'COMMIT' && controls.commitUnknown) { controls.commitUnknown = false; throw Error('synthetic lost COMMIT acknowledgement'); }
        return result;
      } } as unknown as PoolClient;
    } } as unknown as Pool;
    pool = wrappedPool;
    adapters = { currentScope: async (_client, currentProjectId) => ({ ...structuredClone(currentScope), modelScope: { ...structuredClone(currentScope.modelScope), projectId: currentProjectId } }), storage: { ...realStorage,
      store: async (...args) => { controls.stores++; const stored = await realStorage.store(...args); const action = controls.afterStore; controls.afterStore = null; if (action) await action(); return stored; } } };
    repository = createBarrierMultipartRepository(pool, adapters);
  });
  afterAll(async () => { if (connected) await connected.end(); });
  const command = (): BarrierMultipartAdmitCommand => ({ schemaVersion: 'wfc.pf.barrier-multipart-admit.v2', idempotencyKey: id(), scope: structuredClone(currentScope),
    profile: structuredClone(BARRIER_MULTIPART_PROFILE), expectedRegistryRevision: '0', selectedParentLabels: currentScope.selectedParents.map(parent => ({ selectionId: parent.selectionId, name: 'Synthetic wall' })),
    reservation: { bytes: 2 * 1024 ** 2, files: 40 } });
  async function admit() { const request = command(), receipt = await repository.admit(projectId, who, request); return { request, session: receipt.session }; }
  function page(session: BarrierMultipartSession, records: BarrierMultipartPage['records'], kind: BarrierMultipartPage['kind'] = 'nodes'): BarrierMultipartPage {
    const result = { schemaVersion: 'wfc.pf.barrier-multipart-page.v2', kind, scopeSha256: session.scopeSha256, profileSha256: session.profileSha256,
      index: 0, firstOrdinal: 0, previousPageSha256: null, records, pageSha256: '0'.repeat(64) } as BarrierMultipartPage;
    result.pageSha256 = h(barrierMultipartPageHashInput(result)); return result;
  }
  function pageCommand(session: BarrierMultipartSession, value = page(session, [{ dbId: 3, membershipMask: '0'.repeat(31) + '1' }])) {
    return { schemaVersion: 'wfc.pf.barrier-multipart-stage-page.v2', intentId: session.id, expectedSessionRevision: session.sessionRevision,
      idempotencyKey: id(), scopeSha256: session.scopeSha256, profileSha256: session.profileSha256, page: value };
  }
  async function stream(session: BarrierMultipartSession, kind: BarrierMultipartPage['kind'], records: BarrierMultipartPage['records'], totals: unknown) {
    const value = page(session, records, kind); await repository.stagePage(projectId, who, pageCommand(session, value));
    const next = await repository.get(projectId, who, session.id), seal = barrierMultipartSealSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-seal.v2', kind,
      scopeSha256: next.scopeSha256, profileSha256: next.profileSha256, pageCount: 1, recordCount: records.length, tailPageSha256: value.pageSha256,
      totals, sealSha256: '0'.repeat(64), ...(kind === 'plan' ? { qualification: 'NOT_MEASURED', authority: 'none' } : {}) });
    seal.sealSha256 = h(barrierMultipartSealHashInput(seal));
    await repository.stageSeal(projectId, who, { schemaVersion: 'wfc.pf.barrier-multipart-stage-seal.v2', intentId: next.id, expectedSessionRevision: next.sessionRevision,
      idempotencyKey: id(), scopeSha256: next.scopeSha256, profileSha256: next.profileSha256, seal });
    return repository.get(projectId, who, next.id);
  }
  it('admits only an exact own-login scope and holds reservations without creating a head', async () => {
    const { request, session } = await admit(); expect(session.state).toBe('admitted'); expect(session.authority).toBe('none');
    expect((await repository.admit(projectId, who, request)).duplicate).toBe(true);
    await expect(repository.admit(projectId, who, { ...request, selectedParentLabels: [{ selectionId: request.selectedParentLabels[0].selectionId, name: 'Changed' }] })).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_IDEMPOTENCY_CONFLICT' });
    const other = { ...who, loginId: id() }; await expect(repository.get(projectId, other, session.id)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_OWNER_CHANGED' });
    expect((await connected.query('SELECT * FROM pf_barrier_heads')).rows).toEqual([]);
    expect((await repository.get(projectId, who, session.id)).reservation.chargedBytes).toBe(0);
  });
  it('runs the protected binding hook atomically for new and duplicate admission, rolling back a failed binding', async () => {
    const request = command(), before = (await connected.query('SELECT count(*)::int AS count,COALESCE(sum(reserved_bytes),0)::text AS bytes FROM pf_barrier_multipart_sessions')).rows[0];
    let reject = true; const calls: boolean[] = [];
    const protectedRepository = createBarrierMultipartRepository(pool, { ...adapters, onAdmission: async (client, session, duplicate) => {
      calls.push(duplicate);
      if (!duplicate) await client.query(`INSERT INTO pf_barrier_multipart_viewer_contexts(intent_id,project_id,viewer_session_id,actor_id,login_id,model_version_id,model_load_id,
        scope_sha256,command_sha256,frame_sha256,frame_observation,producer_profile,context_sha256,effective_deadline)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}'::jsonb,'{}'::jsonb,$11,$12)`, [session.id, projectId, id(), who.userId, who.loginId,
        currentScope.modelScope.modelVersionId, currentScope.modelLoadId, session.scopeSha256, session.requestSha256, 'a'.repeat(64), 'b'.repeat(64), new Date(session.jobDeadline)]);
      if (reject) throw Error('synthetic context binding failure');
    } });
    await expect(protectedRepository.admit(projectId, who, request)).rejects.toThrow('synthetic context binding failure');
    expect((await connected.query('SELECT count(*)::int AS count,COALESCE(sum(reserved_bytes),0)::text AS bytes FROM pf_barrier_multipart_sessions')).rows[0]).toEqual(before);
    expect((await connected.query('SELECT * FROM pf_barrier_multipart_viewer_contexts')).rows).toEqual([]);
    reject = false; const saved = await protectedRepository.admit(projectId, who, request); expect((await protectedRepository.admit(projectId, who, request)).duplicate).toBe(true);
    expect(calls).toEqual([false, false, true]);
    expect((await connected.query('SELECT intent_id FROM pf_barrier_multipart_viewer_contexts WHERE intent_id=$1', [saved.session.id])).rows).toHaveLength(1);
    expect((await connected.query('SELECT * FROM pf_barrier_heads')).rows).toEqual([]);
  });
  it('replays exact stored page bytes without renewing any lease, revision or reservation and refuses a changed scope', async () => {
    const { session } = await admit(), request = pageCommand(session); await repository.stagePage(projectId, who, request);
    const before = await repository.get(projectId, who, session.id), bytes = await repository.readPage(projectId, who, session.id, 'nodes', 0);
    expect(bytes).toEqual(request.page); expect(await repository.get(projectId, who, session.id)).toEqual(before);
    expect(before.leaseDeadline).toBeNull(); expect(before.reservation.chargedFiles).toBe(2);
    const load = currentScope.modelLoadId; currentScope.modelLoadId = id();
    try { await expect(repository.readPage(projectId, who, session.id, 'nodes', 0)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_SCOPE_CHANGED' }); }
    finally { currentScope.modelLoadId = load; }
    const foreign = { ...who, loginId: id() }; await expect(repository.readPage(projectId, foreign, session.id, 'nodes', 0)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_OWNER_CHANGED' });
    await repository.cancel(projectId, who, { schemaVersion: 'wfc.pf.barrier-multipart-cancel.v2', intentId: session.id, expectedSessionRevision: before.sessionRevision,
      idempotencyKey: id(), scopeSha256: session.scopeSha256, profileSha256: session.profileSha256, reason: 'Synthetic stored-page cancellation' });
    await expect(repository.readPage(projectId, who, session.id, 'nodes', 0)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_CANCELLED' });
  });
  it('stores original bounded pages durably, replays exact receipts, and refuses changed same-key data', async () => {
    const { session } = await admit(), request = pageCommand(session), first = await repository.stagePage(projectId, who, request);
    expect(first).toMatchObject({ kind: 'page', authority: 'none', qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED' });
    const stores = controls.stores, replay = await repository.stagePage(projectId, who, request); expect(replay).toEqual({ ...first, duplicate: true }); expect(controls.stores).toBe(stores);
    const saved = await repository.get(projectId, who, session.id); expect(saved.counts.pages).toBe(1); expect(saved.reservation.chargedFiles).toBe(2);
    const changed = structuredClone(request); changed.page.records = [{ dbId: 4, membershipMask: '0'.repeat(31) + '1' }]; changed.page.pageSha256 = h(barrierMultipartPageHashInput(changed.page));
    await expect(repository.stagePage(projectId, who, changed)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_IDEMPOTENCY_CONFLICT' });
    await expect(connected.query("UPDATE pf_barrier_multipart_allocations SET command='{}'::jsonb WHERE session_id=$1", [session.id])).rejects.toThrow('Immutable multipart allocation');
    expect((await connected.query('SELECT * FROM pf_barrier_heads')).rows).toEqual([]);
  });
  it('refuses hash/order/owner tampering before storage or capacity charges', async () => {
    const { session } = await admit(), originalStores = controls.stores, bad = pageCommand(session); bad.page.pageSha256 = 'f'.repeat(64);
    await expect(repository.stagePage(projectId, who, bad)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_PAGE_HASH' });
    const gap = pageCommand(session); gap.page.index = 1; gap.page.firstOrdinal = 1; gap.page.previousPageSha256 = 'e'.repeat(64); gap.page.pageSha256 = h(barrierMultipartPageHashInput(gap.page));
    await expect(repository.stagePage(projectId, who, gap)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_PAGE_ORDER' });
    const mask = pageCommand(session, page(session, [{ dbId: 3, membershipMask: '0'.repeat(31) + '2' }]));
    await expect(repository.stagePage(projectId, who, mask)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_MEMBERSHIP' });
    expect(controls.stores).toBe(originalStores); expect((await repository.get(projectId, who, session.id)).reservation.chargedFiles).toBe(0);
  });
  it('binds a stream seal once and preserves exact roots with no publication authority', async () => {
    const { session } = await admit(), sourcePage = page(session, [{ dbId: 3, membershipMask: '0'.repeat(31) + '1' }]);
    await repository.stagePage(projectId, who, pageCommand(session, sourcePage)); const now = await repository.get(projectId, who, session.id);
    const seal: BarrierMultipartSeal = { schemaVersion: 'wfc.pf.barrier-multipart-seal.v2', kind: 'nodes', scopeSha256: now.scopeSha256, profileSha256: now.profileSha256,
      pageCount: 1, recordCount: 1, tailPageSha256: sourcePage.pageSha256, totals: { nodes: 1 }, sealSha256: '0'.repeat(64) };
    seal.sealSha256 = h(barrierMultipartSealHashInput(seal));
    const request = { schemaVersion: 'wfc.pf.barrier-multipart-stage-seal.v2', intentId: now.id, expectedSessionRevision: now.sessionRevision,
      idempotencyKey: id(), scopeSha256: now.scopeSha256, profileSha256: now.profileSha256, seal };
    const receipt = await repository.stageSeal(projectId, who, request); expect(receipt.kind).toBe('seal');
    const saved = await repository.get(projectId, who, session.id); expect(saved.roots.nodes).toBe(seal.sealSha256); expect(saved.counts.seals).toBe(1);
    await expect(repository.stageSeal(projectId, who, { ...request, idempotencyKey: id(), expectedSessionRevision: saved.sessionRevision })).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_STREAM_SEALED' });
    expect((await connected.query('SELECT * FROM pf_barrier_heads')).rows).toEqual([]);
  });
  it('stages every tiny stream and an opaque part while rejecting foreign owners and original-range gaps', async () => {
    let { session } = await admit(); const mask = '0'.repeat(31) + '1';
    session = await stream(session, 'nodes', [{ dbId: 3, membershipMask: mask }], { nodes: 1 });
    const fragment = { fragmentId: 7, ownerNodeOrdinal: 0, ownerDbId: 3, membershipMask: mask, primitive: 'triangles' as const,
      sourceGeometrySha256: 'c'.repeat(64), transformSha256: 'd'.repeat(64), sourceVertexCount: 4, sourceTriangleCount: 2 };
    await expect(repository.stagePage(projectId, who, pageCommand(session, page(session, [{ ...fragment, ownerDbId: 4 }], 'fragments')))).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_FOREIGN_OWNER' });
    session = await stream(session, 'fragments', [fragment], { fragments: 1, sourceVertices: 4, sourceTriangles: 2, unavailable: 0, nonTriangle: 0 });
    const range: BarrierMultipartGeometryRange = { fragmentOrdinal: 0, triangleStart: 0, triangleCount: 2, referencedVertexCount: 4,
      sourceVertexIdsSha256: 'e'.repeat(64), sourceIndicesSha256: 'f'.repeat(64), sourceGeometrySha256: fragment.sourceGeometrySha256,
      transformSha256: fragment.transformSha256, membershipMask: mask };
    await expect(repository.stagePage(projectId, who, pageCommand(session, page(session, [{ ...range, triangleStart: 1, triangleCount: 1, referencedVertexCount: 3 }], 'geometry-ranges')))).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_RANGE_COVERAGE' });
    session = await stream(session, 'geometry-ranges', [range], { ranges: 1, referencedVertices: 4, triangles: 2 });
    const placement = { partIndex: 0, rangeOrdinal: 0, fragmentOrdinal: 0, triangleStart: 0, triangleCount: 2, referencedVertexCount: 4,
      rangeSha256: h(barrierMultipartRangeHashInput(range)), plannedEncodedBytesUpperBound: barrierMultipartRangeBytes(4, 2) };
    session = await stream(session, 'plan', [placement], { parts: 1, ranges: 1, referencedVertices: 4, triangles: 2,
      plannedEncodedBytesUpperBound: 8192 + placement.plannedEncodedBytesUpperBound,
      nodeSealSha256: session.roots.nodes, fragmentSealSha256: session.roots.fragments, rangeSealSha256: session.roots['geometry-ranges'] });
    const bytes = Buffer.from('opaque synthetic geometry, deliberately NOT_VALIDATED'), payload = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    const receipt = await repository.stagePart(projectId, who, { schemaVersion: 'wfc.pf.barrier-multipart-stage-part.v2', intentId: session.id, expectedSessionRevision: session.sessionRevision,
      idempotencyKey: id(), scopeSha256: session.scopeSha256, profileSha256: session.profileSha256, partIndex: 0, planSealSha256: session.roots.plan, payload }, bytes);
    expect(receipt).toMatchObject({ kind: 'part', qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' });
    const saved = await repository.get(projectId, who, session.id); expect(saved.counts).toEqual({ pages: 4, seals: 4, parts: 1 });
    expect(saved.reservation.chargedFiles).toBe(18); expect(saved.state).toBe('staging'); expect((await connected.query('SELECT * FROM pf_barrier_heads')).rows).toEqual([]);
  });
  it('refuses node/fragment seals which omit a selected parent rather than silently shrinking selection', async () => {
    const original = structuredClone(currentScope); currentScope.selectedParents.push({ selectionId: id(), dbId: 4, kind: 'partition' });
    try {
      const first = await admit(), one = page(first.session, [{ dbId: 3, membershipMask: '0'.repeat(31) + '1' }]);
      await repository.stagePage(projectId, who, pageCommand(first.session, one)); const next = await repository.get(projectId, who, first.session.id);
      const seal = barrierMultipartSealSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-seal.v2', kind: 'nodes', scopeSha256: next.scopeSha256, profileSha256: next.profileSha256,
        pageCount: 1, recordCount: 1, tailPageSha256: one.pageSha256, totals: { nodes: 1 }, sealSha256: '0'.repeat(64) }); seal.sealSha256 = h(barrierMultipartSealHashInput(seal));
      await expect(repository.stageSeal(projectId, who, { schemaVersion: 'wfc.pf.barrier-multipart-stage-seal.v2', intentId: next.id, expectedSessionRevision: next.sessionRevision,
        idempotencyKey: id(), scopeSha256: next.scopeSha256, profileSha256: next.profileSha256, seal })).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_PARENT_NODE_COVERAGE' });
      let { session } = await admit(); session = await stream(session, 'nodes', [{ dbId: 3, membershipMask: '0'.repeat(31) + '1' }, { dbId: 4, membershipMask: '0'.repeat(31) + '2' }], { nodes: 2 });
      const fragment = { fragmentId: 1, ownerNodeOrdinal: 0, ownerDbId: 3, membershipMask: '0'.repeat(31) + '1', primitive: 'triangles' as const,
        sourceGeometrySha256: 'c'.repeat(64), transformSha256: 'd'.repeat(64), sourceVertexCount: 3, sourceTriangleCount: 1 };
      const fragmentPage = page(session, [fragment], 'fragments'); await repository.stagePage(projectId, who, pageCommand(session, fragmentPage)); session = await repository.get(projectId, who, session.id);
      const fragmentSeal = barrierMultipartSealSchema.parse({ ...seal, kind: 'fragments', scopeSha256: session.scopeSha256, profileSha256: session.profileSha256,
        tailPageSha256: fragmentPage.pageSha256, totals: { fragments: 1, sourceVertices: 3, sourceTriangles: 1, unavailable: 0, nonTriangle: 0 } }); fragmentSeal.sealSha256 = h(barrierMultipartSealHashInput(fragmentSeal));
      await expect(repository.stageSeal(projectId, who, { schemaVersion: 'wfc.pf.barrier-multipart-stage-seal.v2', intentId: session.id, expectedSessionRevision: session.sessionRevision,
        idempotencyKey: id(), scopeSha256: session.scopeSha256, profileSha256: session.profileSha256, seal: fragmentSeal })).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_PARENT_FRAGMENT_COVERAGE' });
    } finally { currentScope = original; }
  });
  it.each(['scope', 'login', 'cancel'] as const)('retains charged orphan bytes but never receipts final %s loss', async kind => {
    const { session } = await admit(), request = pageCommand(session), original = structuredClone(currentScope), expiry = who.loginExpiresAt;
    controls.afterStore = async () => {
      if (kind === 'scope') currentScope.modelLoadId = id();
      if (kind === 'login') who.loginExpiresAt = Date.now() - 1;
      if (kind === 'cancel') await repository.cancel(projectId, who, { schemaVersion: 'wfc.pf.barrier-multipart-cancel.v2', intentId: session.id,
        expectedSessionRevision: session.sessionRevision, idempotencyKey: id(), scopeSha256: session.scopeSha256, profileSha256: session.profileSha256, reason: 'Synthetic cancellation during storage' });
    };
    try { await expect(repository.stagePage(projectId, who, request)).rejects.toBeDefined(); }
    finally { currentScope = original; who.loginExpiresAt = expiry; controls.afterStore = null; }
    const row = await repository.get(projectId, who, session.id); expect(row.reservation.chargedFiles).toBe(2); expect(row.reservation.chargedBytes).toBeGreaterThan(0); expect(row.counts.pages).toBe(0);
    expect((await connected.query('SELECT 1 FROM pf_barrier_multipart_receipts WHERE session_id=$1 AND allocation_id IS NOT NULL', [session.id])).rows).toHaveLength(0);
    await expect(repository.stagePage(projectId, who, request)).rejects.toBeDefined();
  });
  it('reconciles an exact lost final COMMIT acknowledgement without another file write or lease', async () => {
    const { session } = await admit(), request = pageCommand(session); controls.afterStore = async () => { controls.commitUnknown = true; };
    await expect(repository.stagePage(projectId, who, request)).rejects.toMatchObject({ code: 'BARRIER_COMMIT_OUTCOME_UNKNOWN' });
    const stores = controls.stores, commandSha256 = h({ domain: 'wfc.pf.barrier-multipart-session.v2/command', value: request });
    const receipt = await repository.reconcile(projectId, who, { schemaVersion: 'wfc.pf.barrier-multipart-reconcile.v2', intentId: session.id,
      idempotencyKey: request.idempotencyKey, commandSha256 }); expect(receipt.duplicate).toBe(true);
    expect((await repository.stagePage(projectId, who, request)).duplicate).toBe(true); expect(controls.stores).toBe(stores);
    await expect(repository.reconcile(projectId, who, { schemaVersion: 'wfc.pf.barrier-multipart-reconcile.v2', intentId: session.id,
      idempotencyKey: request.idempotencyKey, commandSha256: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_IDEMPOTENCY_CONFLICT' });
  });
  it('retains cancellation reservations and prevents any subsequent allocation or root mutation', async () => {
    const { session } = await admit(), request = { schemaVersion: 'wfc.pf.barrier-multipart-cancel.v2', intentId: session.id, expectedSessionRevision: '0',
      idempotencyKey: id(), scopeSha256: session.scopeSha256, profileSha256: session.profileSha256, reason: 'Synthetic terminal cancellation' };
    const result = await repository.cancel(projectId, who, request); expect(result.session.reservation.bytes).toBe(session.reservation.bytes);
    expect((await repository.cancel(projectId, who, request)).duplicate).toBe(true);
    await expect(repository.stagePage(projectId, who, pageCommand(result.session))).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_CANCELLED' });
    await expect(connected.query("UPDATE pf_barrier_multipart_sessions SET state='staging' WHERE id=$1", [session.id])).rejects.toThrow('Immutable multipart session identity');
  });
  it('serializes competing global admission reservations across projects', async () => {
    const first = command(), second = command(), secondProject = id(); await connected.query('INSERT INTO projects VALUES($1)', [secondProject]);
    second.scope.modelScope.projectId = secondProject;
    first.reservation = { bytes: 5 * 1024 ** 3, files: 2 }; second.reservation = { bytes: 5 * 1024 ** 3, files: 2 };
    const results = await Promise.allSettled([repository.admit(projectId, who, first), repository.admit(secondProject, who, second)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected'); if (rejected?.status === 'rejected') expect(rejected.reason).toMatchObject({ code: 'BARRIER_MULTIPART_GLOBAL_QUOTA' });
    const reserved = (await connected.query<{ bytes: string }>('SELECT sum(reserved_bytes)::text AS bytes FROM pf_barrier_multipart_sessions')).rows[0];
    expect(Number(reserved.bytes)).toBeLessThanOrEqual(8 * 1024 ** 3);
  });
});
