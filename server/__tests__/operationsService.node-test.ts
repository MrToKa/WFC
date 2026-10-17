// Pure/control-flow unit tests. Fake SQL and verified-reader receipts are not raw-byte or real DB proof.
// Importing the service must not initialize storage.ts/config.ts or load a local .env file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import type { ModelResourceReader, ModelStorage, VerifiedModelResource } from '../modelRegistry/storage.js';
import { auditModels, canonicalJson, fenceRestored, inventory, recoveryReport, requireQuarantine } from '../operations/service.js';

type Row = Record<string, unknown>;
type QueryResult = { rows: Row[]; rowCount: number };
const answer = (rows: Row[] = [], rowCount = rows.length): QueryResult => ({ rows, rowCount });
const projectId = '10000000-0000-4000-8000-000000000001';
const versionId = '20000000-0000-4000-8000-000000000002';
const targetId = '30000000-0000-4000-8000-000000000003';
const quarantine = { WFC_OPS_QUARANTINE: 'true', WFC_OPS_TARGET_ID: targetId };
const fingerprint = 'a'.repeat(64);
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

class FakePool {
  statements: string[] = [];
  connects = 0;
  releases = 0;
  constructor(readonly execute: (sql: string, parameters: readonly unknown[]) => QueryResult | Promise<QueryResult>) {}
  async query(sql: string, parameters: readonly unknown[] = []): Promise<QueryResult> {
    this.statements.push(sql);
    return this.execute(sql, parameters);
  }
  async connect() {
    this.connects++;
    return { query: this.query.bind(this), release: () => { this.releases++; } };
  }
  asPool(): Pool { return this as unknown as Pool; }
}

function versionRow() {
  const resources = [
    { path: 'resources/output/0/0.svf', bytes: 7, sha256: 'b'.repeat(64) },
    { path: 'resources/output/0/properties.db', bytes: 11, sha256: 'c'.repeat(64) },
  ];
  return {
    id: versionId, project_id: projectId, package_id: randomUUID(), content_fingerprint: fingerprint,
    label: 'Original label \u212b', source: { name: 'original.nwd', bytes: 19, sha256: 'd'.repeat(64), identityBasis: 'observed-local-file' },
    support_profile: 'svf-local-7.130.0-v1', entrypoint: 'resources/output/0/0.svf',
    prepared_at: '2026-10-16T00:00:00.000Z', imported_at: '2026-10-17T00:00:00.000Z', imported_by: randomUUID(),
    state: 'ready', health: 'unavailable', resource_count: resources.length, total_bytes: 18,
    validation_report_id: randomUUID(), failure: null,
    manifest: { resources, contentFingerprint: fingerprint },
    storage_prefix: `projects/${projectId}/versions/${versionId}/`, owner_import_id: randomUUID(),
  };
}

function auditDatabase() {
  const version = versionRow();
  const selection = { project_id: projectId, active_model_version_id: versionId, selection_revision: 4, updated_at: '2026-10-17T12:00:00.123456+00:00' };
  const events: string[] = [];
  const pool = new FakePool((sql, parameters) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return answer();
    if (sql.startsWith("SELECT to_jsonb(v)-'health'")) {
      const { health: omitted, ...immutable } = structuredClone(version);
      void omitted;
      return answer([{ value: immutable }]);
    }
    if (sql.startsWith('SELECT to_jsonb(s) AS value FROM project_model_selections')) return answer([{ value: structuredClone(selection) }]);
    if (sql === "SELECT id,project_id FROM model_versions WHERE state='ready' ORDER BY project_id,id") return answer([{ id: version.id, project_id: version.project_id }]);
    if (sql === 'SELECT * FROM model_versions WHERE project_id=$1 AND id=$2') {
      assert.deepEqual(parameters, [projectId, versionId]);
      return answer([structuredClone(version)]);
    }
    if (sql === 'SELECT id FROM projects WHERE id=$1 FOR UPDATE') return answer([{ id: projectId }]);
    if (sql.startsWith('UPDATE model_versions SET health=$1')) {
      assert.deepEqual(parameters.slice(1), [projectId, versionId]);
      version.health = String(parameters[0]);
      events.push('health:' + version.health);
      return answer([structuredClone(version)]);
    }
    throw Error('Unexpected fake query: ' + sql);
  });
  const reader = (options: { failAt?: number; error?: Error; closeErrorAt?: number; onClose?: (index: number) => void; expectedSignal?: AbortSignal } = {}): ModelResourceReader => {
    let index = 0;
    return {
      async readVerifiedResource(prefix, resource, signal) {
        const current = index++;
        assert.equal(prefix, version.storage_prefix);
        if (options.expectedSignal) assert.equal(signal, options.expectedSignal);
        events.push('read:' + current);
        if (current === options.failAt) throw options.error ?? Error('STORAGE_INTEGRITY_FAILED');
        // Already-verified receipt only; auditModels delegates the actual SHA/stream implementation.
        return {
          handle: null as unknown as VerifiedModelResource['handle'], bytes: resource.bytes,
          async close() {
            events.push('close:' + current);
            options.onClose?.(current);
            if (current === options.closeErrorAt) throw Error('fixture close failure');
          },
        };
      },
    };
  };
  return { pool, version, selection, events, reader };
}

test('canonical hashes ignore object key order but preserve Unicode, whitespace, array order and dates', () => {
  assert.equal(digest({ b: [1, { z: null, a: true }], a: 'x' }), digest({ a: 'x', b: [1, { a: true, z: null }] }));
  for (const [left, right] of [['\u212b', '\u00c5'], [' A ', 'A'], ['A\r\nB', 'A\nB'], [[1, 2], [2, 1]]]) assert.notEqual(digest(left), digest(right));
  assert.equal(canonicalJson(new Date('2026-10-17T01:02:03.004Z')), '"2026-10-17T01:02:03.004Z"');
  assert.notEqual(digest(new Date('2026-10-17T01:02:03.004Z')), digest(new Date('2026-10-17T01:02:03.005Z')));
  assert.notEqual(digest('2026-10-17T01:02:03.004001+00:00'), digest('2026-10-17T01:02:03.004002+00:00'));
});

function inventoryDatabase(data: Record<string, Row[]>, sizes: Record<string, { count?: number; jsonBytes?: number }> = {}) {
  return new FakePool(sql => {
    if (sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' || sql === 'COMMIT' || sql === 'ROLLBACK') return answer();
    if (sql.startsWith('SELECT tablename FROM pg_tables')) return answer(Object.keys(data).sort().map(tablename => ({ tablename })));
    const sizeTable = sql.match(/FROM public\."([^"]+)" t$/)?.[1];
    if (sql.startsWith('SELECT COUNT(*)') && sizeTable) return answer([{ count: String(sizes[sizeTable]?.count ?? data[sizeTable].length), json_bytes: String(sizes[sizeTable]?.jsonBytes ?? Buffer.byteLength(JSON.stringify(data[sizeTable]))) }]);
    const valueTable = sql.match(/^SELECT to_jsonb\(t\) AS value FROM public\."([^"]+)" t$/)?.[1];
    if (valueTable) return answer(data[valueTable].map(value => ({ value: structuredClone(value) })));
    if (sql.startsWith('SELECT state,COUNT(*)')) return answer([{ state: 'complete', count: 1 }]);
    if (sql.startsWith('SELECT to_jsonb(s)')) return answer((data.project_model_selections ?? []).map(value => ({ value })));
    if (sql.startsWith('SELECT id,project_id,state,health')) return answer(data.model_versions ?? []);
    throw Error('Unexpected fake query: ' + sql);
  });
}

test('inventory hashes full original rows independently of row/key order and excludes only transient session tables from business hash', async () => {
  const data = {
    cables: [{ id: 'b', routing: ' A;B ', from_location: null, to_location: '\u212b' }, { id: 'a', routing: 'A\r\nB', from_location: '', to_location: 'Z' }],
    model_versions: [{ id: versionId, source: { name: 'raw.nwd', bytes: 9 }, health: 'healthy' }],
    project_model_selections: [{ project_id: projectId, active_model_version_id: versionId, selection_revision: 1, updated_at: '2026-10-17T12:00:00.123456+00:00' }],
    viewer_login_bindings: [{ id: 'login', revoked_at: null }], viewer_resource_sessions: [{ id: 'resource', revoked_at: null }],
  };
  const firstDb = inventoryDatabase(data), first = await inventory(firstDb.asPool());
  const shuffled = structuredClone(data);
  shuffled.cables.reverse();
  shuffled.cables[0] = { to_location: shuffled.cables[0].to_location, from_location: shuffled.cables[0].from_location, routing: shuffled.cables[0].routing, id: shuffled.cables[0].id };
  const second = await inventory(inventoryDatabase(shuffled).asPool());
  assert.equal(first.businessSha256, second.businessSha256);
  assert.equal(first.registrySha256, second.registrySha256);
  assert.deepEqual(first.selection, data.project_model_selections);
  assert.equal(first.selection[0] && (first.selection[0] as Row).updated_at, '2026-10-17T12:00:00.123456+00:00');
  const changedSessions = structuredClone(data) as Record<string, Row[]>;
  changedSessions.viewer_login_bindings[0].revoked_at = '2026-10-17T12:00:01Z';
  const third = await inventory(inventoryDatabase(changedSessions).asPool());
  assert.equal(first.businessSha256, third.businessSha256);
  assert.notEqual(first.tables.find(row => row.table === 'viewer_login_bindings')?.sha256, third.tables.find(row => row.table === 'viewer_login_bindings')?.sha256);
  const changedBusiness = structuredClone(data);
  changedBusiness.cables[0].routing = 'A;B';
  assert.notEqual(first.businessSha256, (await inventory(inventoryDatabase(changedBusiness).asPool())).businessSha256);
  assert.equal(firstDb.releases, 1);
  assert.ok(firstDb.statements.every(sql => !/^(?:UPDATE|DELETE|INSERT|ALTER|DROP)\b/.test(sql)));
});

test('inventory rejects unsafe names, excessive rows/bytes/table counts and releases rolled-back read transaction', async () => {
  const cases = [
    inventoryDatabase({ 'unsafe"table': [] }),
    inventoryDatabase({ cables: [] }, { cables: { count: 1_000_001 } }),
    inventoryDatabase({ cables: [] }, { cables: { jsonBytes: 128 * 1024 ** 2 + 1 } }),
    inventoryDatabase(Object.fromEntries(Array.from({ length: 501 }, (_, index) => ['t' + index, []]))),
  ];
  for (const database of cases) {
    await assert.rejects(inventory(database.asPool()), /^(?:Error: )?(?:UNSAFE_TABLE|INVENTORY_LIMIT)$/);
    assert.equal(database.statements.at(-1), 'ROLLBACK');
    assert.equal(database.releases, 1);
  }
});

test('full audit restores healthy only after every verified receipt has been closed', async () => {
  const db = auditDatabase();
  const signal = new AbortController().signal;
  const result = await auditModels(db.pool.asPool(), db.reader({ expectedSignal: signal }), signal);
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.totals, { versions: 1, resources: 2, bytes: 18 });
  assert.deepEqual(db.events, ['read:0', 'close:0', 'read:1', 'close:1', 'health:healthy']);
  assert.equal(db.version.health, 'healthy');
  assert.equal(result.selectionUnchanged, true);
  assert.ok(db.pool.statements.filter(sql => sql.startsWith('UPDATE')).every(sql => sql.startsWith('UPDATE model_versions SET health=')));
});

test('successful audit of an already healthy model does not rewrite any model or selection field', async () => {
  const db = auditDatabase(); db.version.health = 'healthy';
  assert.equal((await auditModels(db.pool.asPool(), db.reader())).status, 'PASS');
  assert.ok(!db.pool.statements.some(sql => sql.startsWith('UPDATE')));
});

for (const scenario of ['late corruption', 'late missing object']) {
  test(scenario + ' marks unavailable and never restores healthy after a partial audit', async () => {
    const db = auditDatabase(); db.version.health = 'healthy';
    // The production reader maps a missing object to this same integrity failure code.
    const error = Object.assign(Error(scenario), { code: 'STORAGE_INTEGRITY_FAILED' });
    const result = await auditModels(db.pool.asPool(), db.reader({ failAt: 1, error }));
    assert.equal(result.status, 'FAIL');
    assert.equal(result.versions[0].code, 'STORAGE_INTEGRITY_FAILED');
    assert.deepEqual(db.events, ['read:0', 'close:0', 'read:1', 'health:unavailable']);
    assert.equal(result.versions[0].resources, 1);
    assert.equal(db.version.health, 'unavailable');
  });
}

for (const initialHealth of ['healthy', 'unavailable']) {
  test('transient read outage preserves prior health ' + initialHealth, async () => {
    const db = auditDatabase(); db.version.health = initialHealth;
    const result = await auditModels(db.pool.asPool(), db.reader({ failAt: 1, error: Object.assign(Error('fixture timeout'), { code: 'ETIMEDOUT' }) }));
    assert.equal(result.status, 'FAIL');
    assert.equal(result.versions[0].code, 'STORAGE_UNAVAILABLE');
    assert.equal(result.versions[0].health, initialHealth);
    assert.equal(db.version.health, initialHealth);
    assert.ok(!db.events.some(event => event.startsWith('health:')));
  });
}

test('failed handle close prevents healthy restoration and preserves prior health', async () => {
  const db = auditDatabase();
  const result = await auditModels(db.pool.asPool(), db.reader({ closeErrorAt: 1 }));
  assert.equal(result.status, 'FAIL');
  assert.equal(result.versions[0].code, 'STORAGE_UNAVAILABLE');
  assert.equal(db.version.health, 'unavailable');
  assert.ok(!db.events.some(event => event.startsWith('health:')));
});

test('audit forwards caller cancellation to the reader without treating it as confirmed corruption', async () => {
  const db = auditDatabase(); db.version.health = 'healthy';
  const controller = new AbortController(); controller.abort();
  const result = await auditModels(db.pool.asPool(), db.reader({ expectedSignal: controller.signal, failAt: 0, error: Object.assign(Error('fixture abort'), { code: 'IMPORT_ABORTED' }) }), controller.signal);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.versions[0].code, 'STORAGE_UNAVAILABLE');
  assert.equal(db.version.health, 'healthy');
});

test('invalid manifest count/fingerprint/bytes/prefix and colliding resource names cannot restore healthy', async () => {
  const changes = [
    (v: ReturnType<typeof versionRow>) => { v.resource_count++; },
    (v: ReturnType<typeof versionRow>) => { v.manifest.contentFingerprint = 'e'.repeat(64); },
    (v: ReturnType<typeof versionRow>) => { v.total_bytes++; },
    (v: ReturnType<typeof versionRow>) => { v.storage_prefix = `projects/${projectId}/versions/${randomUUID()}/`; },
    (v: ReturnType<typeof versionRow>) => { v.manifest.resources[1].path = v.manifest.resources[0].path.toUpperCase(); },
  ];
  for (const change of changes) {
    const db = auditDatabase(); db.version.health = 'healthy'; change(db.version);
    const result = await auditModels(db.pool.asPool(), db.reader());
    assert.equal(result.status, 'FAIL');
    assert.equal(result.versions[0].code, 'STORAGE_RESOURCE_INVALID');
    assert.equal(db.version.health, 'unavailable');
    assert.ok(!db.events.includes('health:healthy'));
  }
});

test('audit detects immutable metadata changes even when every resource receipt succeeds', async () => {
  const db = auditDatabase();
  await assert.rejects(auditModels(db.pool.asPool(), db.reader({ onClose: index => { if (index === 1) db.version.label += ' '; } })), /IMMUTABLE_MODEL_OR_SELECTION_CHANGED/);
});

test('audit detects selection changes confined to PostgreSQL timestamp microseconds', async () => {
  const db = auditDatabase();
  await assert.rejects(auditModels(db.pool.asPool(), db.reader({ onClose: index => { if (index === 1) db.selection.updated_at = '2026-10-17T12:00:00.123457+00:00'; } })), /IMMUTABLE_MODEL_OR_SELECTION_CHANGED/);
  assert.equal(db.selection.selection_revision, 4);
  assert.equal(db.selection.active_model_version_id, versionId);
});

test('every writing entrypoint rejects a missing or malformed owned-quarantine guard before opening DB', async () => {
  const environments = [{}, { ...quarantine, WFC_OPS_QUARANTINE: 'TRUE' }, { ...quarantine, WFC_OPS_QUARANTINE: '1' }, { ...quarantine, WFC_OPS_TARGET_ID: '../target' }, { ...quarantine, WFC_OPS_TARGET_ID: targetId.toUpperCase().replace('3', 'Z') }];
  const pool = new FakePool(() => { throw Error('DB must not be touched'); });
  for (const environment of environments) {
    assert.throws(() => requireQuarantine(environment), /OWNED_QUARANTINE_REQUIRED/);
    await assert.rejects(fenceRestored(pool.asPool(), environment), /OWNED_QUARANTINE_REQUIRED/);
    await assert.rejects(recoveryReport(pool.asPool(), 'not-used', {} as ModelStorage, true, environment), /OWNED_QUARANTINE_REQUIRED/);
  }
  assert.equal(pool.connects, 0); assert.equal(pool.statements.length, 0);
  assert.equal(requireQuarantine(quarantine), targetId);
});

function fenceDatabase(options: { failLoginUpdate?: boolean; activeAfterUpdate?: number } = {}) {
  let sessions = [{ id: 'old', revoked_at: 'previous-time', revoke_reason: 'expired' }, { id: 'active', revoked_at: null as string | null, revoke_reason: null as string | null }];
  let logins = [{ id: 'old-login', revoked_at: 'previous-login-time' }, { id: 'active-login', revoked_at: null as string | null }];
  let saved: { sessions: typeof sessions; logins: typeof logins } | null = null;
  const pool = new FakePool(sql => {
    if (sql === 'BEGIN') { saved = structuredClone({ sessions, logins }); return answer(); }
    if (sql === 'ROLLBACK') { assert.ok(saved); ({ sessions, logins } = saved); saved = null; return answer(); }
    if (sql === 'COMMIT') { saved = null; return answer(); }
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return answer();
    if (sql.startsWith('UPDATE viewer_resource_sessions SET revoked_at=COALESCE')) {
      let count = 0;
      for (const row of sessions) if (row.revoked_at === null) { row.revoked_at = 'fenced-time'; row.revoke_reason ??= 'logout'; count++; }
      return answer([], count);
    }
    if (sql.startsWith('UPDATE viewer_login_bindings SET revoked_at=COALESCE')) {
      if (options.failLoginUpdate) throw Error('fixture DB failure');
      let count = 0;
      for (const row of logins) if (row.revoked_at === null) { row.revoked_at = 'fenced-time'; count++; }
      return answer([], count);
    }
    if (sql.startsWith('SELECT (SELECT COUNT(*) FROM viewer_resource_sessions')) return answer([{ count: String(options.activeAfterUpdate ?? sessions.filter(row => row.revoked_at === null).length + logins.filter(row => row.revoked_at === null).length) }]);
    throw Error('Unexpected fake query: ' + sql);
  });
  return { pool, rows: () => structuredClone({ sessions, logins }) };
}

test('fencing retains durable login tombstones and prior revocations, uses one transaction and is idempotent', async () => {
  const db = fenceDatabase(), before = db.rows();
  const result = await fenceRestored(db.pool.asPool(), quarantine);
  assert.equal(result.status, 'PASS'); assert.equal(result.targetId, targetId);
  assert.equal(result.sessionsRevoked, 1); assert.equal(result.durableLoginTombstones, 1);
  assert.equal(result.loginRowsDeleted, 0); assert.equal(result.requiresFreshJwtSigningSecret, true);
  assert.equal(db.rows().sessions.length, before.sessions.length); assert.equal(db.rows().logins.length, before.logins.length);
  assert.deepEqual(db.rows().sessions[0], before.sessions[0]); assert.deepEqual(db.rows().logins[0], before.logins[0]);
  assert.ok(db.rows().logins.every(row => row.revoked_at !== null));
  const repeated = await fenceRestored(db.pool.asPool(), quarantine);
  assert.equal(repeated.sessionsRevoked, 0); assert.equal(repeated.durableLoginTombstones, 0);
  assert.ok(!db.pool.statements.some(sql => /\b(?:DELETE|TRUNCATE|INSERT)\b/.test(sql)));
  assert.equal(db.pool.releases, 2);
});

for (const options of [{ failLoginUpdate: true }, { activeAfterUpdate: 1 }]) {
  test('fencing rolls back both updates when ' + (options.failLoginUpdate ? 'the second write fails' : 'any restored binding remains active'), async () => {
    const db = fenceDatabase(options), before = db.rows();
    await assert.rejects(fenceRestored(db.pool.asPool(), quarantine), options.failLoginUpdate ? /fixture DB failure/ : /RESTORED_SESSIONS_NOT_FENCED/);
    assert.deepEqual(db.rows(), before);
    assert.equal(db.pool.statements.at(-1), 'ROLLBACK');
    assert.ok(!db.pool.statements.includes('COMMIT')); assert.equal(db.pool.releases, 1);
  });
}

async function ownedTemp(t: { after(fn: () => Promise<void>): void }) {
  const base = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(base, 'wfc-operations-unit-'));
  t.after(async () => {
    assert.equal(path.dirname(root), base);
    assert.ok(path.basename(root).startsWith('wfc-operations-unit-'));
    assert.equal(await fs.realpath(root), root);
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

function jobRow(id: string, ownerToken: string) {
  return { id, project_id: projectId, requested_by: randomUUID(), idempotency_key: randomUUID(), archive_sha256: 'f'.repeat(64), expected_bytes: 100, owner_token: ownerToken, received_bytes: 40, state: 'receiving', model_version_id: null, failure: null, verification_report: null, duplicate: false, cleaned_at: null, staging_cleaned_at: null, created_at: '2026-10-17T00:00:00Z', updated_at: '2026-10-17T00:00:00Z' };
}

function recoveryDatabase(jobs: Row[] = [], ownership: Row[] = []) {
  return new FakePool(sql => {
    if (sql.startsWith("SELECT to_jsonb(v)-'health'")) return answer([{ value: { id: versionId, label: 'published original' } }]);
    if (sql.startsWith('SELECT to_jsonb(s)')) return answer([{ value: { project_id: projectId, active_model_version_id: versionId, selection_revision: 2, updated_at: '2026-10-17T00:00:00.123456+00:00' } }]);
    if (sql.startsWith('SELECT * FROM model_import_jobs WHERE staging_cleaned_at')) return answer(jobs);
    if (sql.startsWith('SELECT import_id,project_id,model_version_id,storage_prefix,published,cleaned_at')) return answer(ownership);
    if (sql === "SELECT id FROM model_versions WHERE state='ready'") return answer([{ id: versionId }]);
    if (sql.startsWith('SELECT * FROM model_storage_ownership WHERE published=FALSE')) return answer([]);
    throw Error('Unexpected fake query: ' + sql);
  });
}

const forbidStorage = (): ModelStorage => new Proxy({} as ModelStorage, { get(_object, property) { throw Error('Dry-run must not touch storage: ' + String(property)); } });

test('recovery dry-run distinguishes proven owned markers and retains unknown, mismatching and published-orphan data', async t => {
  const root = await ownedTemp(t), id = randomUUID(), ownerToken = randomUUID(), wrongId = randomUUID(), unknownId = randomUUID();
  await fs.mkdir(path.join(root, id)); await fs.mkdir(path.join(root, wrongId)); await fs.mkdir(path.join(root, unknownId));
  await fs.writeFile(path.join(root, id, '.owner.json'), JSON.stringify({ id, token: ownerToken }));
  await fs.writeFile(path.join(root, wrongId, '.owner.json'), JSON.stringify({ id: wrongId, token: randomUUID() }));
  const jobs = [jobRow(id, ownerToken), jobRow(wrongId, randomUUID())];
  const ownership = [
    { import_id: id, project_id: projectId, model_version_id: versionId, storage_prefix: 'published/', published: true, cleaned_at: null },
    { import_id: wrongId, project_id: projectId, model_version_id: randomUUID(), storage_prefix: 'published-orphan/', published: true, cleaned_at: null },
    { import_id: unknownId, project_id: projectId, model_version_id: randomUUID(), storage_prefix: 'unpublished/', published: false, cleaned_at: null },
  ];
  const pool = recoveryDatabase(jobs, ownership);
  const result = await recoveryReport(pool.asPool(), root, forbidStorage(), false, {});
  assert.equal(result.status, 'PASS'); assert.equal(result.dryRun, true);
  assert.deepEqual(result.pending.map(row => row.id), [id, wrongId]);
  assert.equal(result.staging.find(row => row.name === id)?.owned, true);
  assert.equal(result.staging.find(row => row.name === wrongId)?.action, 'retain-unproven');
  assert.equal(result.staging.find(row => row.name === unknownId)?.action, 'retain-unproven');
  assert.deepEqual(result.storageOwnership.map(row => row.action), ['retain-published', 'retain-published-orphan', 'existing-ownership-bounded-recovery-only']);
  assert.equal(result.publishedResourcesDeleted, 0); assert.equal(result.automaticRetentionDeadline, null);
  assert.ok(!canonicalJson(result).includes(ownerToken)); assert.ok(!canonicalJson(result).includes('owner_token'));
  assert.ok(pool.statements.every(sql => sql.startsWith('SELECT')));
  assert.deepEqual((await fs.readdir(root)).sort(), [id, wrongId, unknownId].sort());
});

test('recovery dry-run retains malformed marker and rejects a file used as staging root', async t => {
  const root = await ownedTemp(t), id = randomUUID();
  await fs.mkdir(path.join(root, id)); await fs.writeFile(path.join(root, id, '.owner.json'), '{broken');
  const result = await recoveryReport(recoveryDatabase([jobRow(id, randomUUID())]).asPool(), root, forbidStorage(), false, {});
  assert.equal(result.staging[0].action, 'retain-unproven');
  const file = path.join(root, 'not-a-directory'); await fs.writeFile(file, 'retain');
  await assert.rejects(recoveryReport(recoveryDatabase().asPool(), file, forbidStorage(), false, {}), /UNSAFE_STAGING_ROOT/);
  assert.equal(await fs.readFile(file, 'utf8'), 'retain');
});

test('empty recovery apply requires quarantine and delegates without changing ready metadata, selection or storage', async t => {
  const root = await ownedTemp(t), pool = recoveryDatabase();
  const result = await recoveryReport(pool.asPool(), root, forbidStorage(), true, quarantine);
  assert.equal(result.status, 'PASS'); assert.equal(result.dryRun, false);
  assert.deepEqual(result.remaining, []); assert.equal(result.selectionUnchanged, true);
  assert.ok(pool.statements.every(sql => sql.startsWith('SELECT')));
  assert.deepEqual(await fs.readdir(root), []);
});
