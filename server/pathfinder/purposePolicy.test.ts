// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { createPurposePolicyRepository, purposePolicyTransaction, readRoutingPolicyScope, initializeRoutingPolicySchema } from './purposePolicy.js';
import { parsePolicyJson, POLICY_BODY_BYTES } from './policyJson.js';
import type { JobPrincipal } from './jobContracts.js';
import { readCatalog, readRoutingCatalogScope } from './catalog.js';

vi.mock('./catalog.js', () => ({ readCatalog: vi.fn(), readRoutingCatalogScope: vi.fn() }));
const id = (n: number) => '77777777-7777-4777-8777-' + String(n).padStart(12, '0');
const projectId = id(1), userId = id(2), loginId = id(3), trayId = id(4), incarnationId = id(5);
const who = (): JobPrincipal => ({ userId, loginId, loginExpiresAt: Date.now() + 3600000 });
type Rule = { purpose_key: string; purpose_incarnation_id: string; allowed_categories: string[] };
const command = (key = id(10), patch: Record<string, unknown> = {}) => ({ schemaVersion: 'pathfinder.routing-purpose-policy.write.v1', expectedCatalogRevision: '2', expectedRevision: '0', idempotencyKey: key, changes: [{ purposeKey: 'Synthetic purpose', operation: 'set', allowedCategories: ['Control'] }], ...patch });
function database(options: { admin?: boolean; missingUser?: boolean; revoked?: boolean; projectExists?: boolean; failAt?: string; commitLost?: boolean } = {}) {
  const principal = who(), calls: { sql: string; values: any[] }[] = [];
  const state = { catalog_revision: '2', routing_policy_revision: '0', drawing_policy_revision: '0', drawing_input_revision: '3' };
  const epochs = [{ purpose_key: 'Synthetic purpose', incarnation_id: incarnationId, row_count: '1', active: true }];
  const rules: Rule[] = [], events: any[] = [], receipts = new Map<string, any>();
  const catalog: any = { schemaVersion: 'pathfinder.project-tray-catalog.v1', projectId, catalogRevision: '2', rows: [{ projectTrayId: trayId, rawName: '/Synthetic', nameKey: '/Synthetic', rawPurpose: 'Synthetic purpose', purposeKey: 'Synthetic purpose', dimensionsMm: { width: null, height: null, declaredLength: null } }], diagnostics: [] };
  let tail = Promise.resolve(), failCommit = options.commitLost === true;
  const pool = { connect: vi.fn(async () => {
    let unlock: (() => void) | undefined, backup: any, committed = false;
    const query = vi.fn(async (sql: string, values: any[] = []) => {
      calls.push({ sql, values });
      if (options.failAt && sql.includes(options.failAt)) throw new Error('synthetic-private-secret');
      if (sql === 'BEGIN') return { rows: [] };
      if (sql.startsWith('SELECT id FROM projects')) {
        const waiting = tail; tail = new Promise<void>(resolve => { unlock = resolve; }); await waiting;
        backup = { state: { ...state }, rules: structuredClone(rules), events: structuredClone(events), receipts: structuredClone(receipts) };
        return { rows: options.projectExists === false ? [] : [{ id: projectId }] };
      }
      if (sql === 'COMMIT') { committed = true; unlock?.(); unlock = undefined; if (failCommit) { failCommit = false; throw new Error('synthetic-private-secret'); } return { rows: [] }; }
      if (sql === 'ROLLBACK') {
        if (backup && !committed) { Object.assign(state, backup.state); rules.splice(0, rules.length, ...backup.rules); events.splice(0, events.length, ...backup.events); receipts.clear(); for (const [key, value] of backup.receipts) receipts.set(key, value); }
        unlock?.(); unlock = undefined; return { rows: [] };
      }
      if (sql.startsWith('SELECT is_admin')) return { rows: options.missingUser ? [] : [{ is_admin: options.admin !== false }] };
      if (sql.startsWith('INSERT INTO viewer_login_bindings')) return { rows: [] };
      if (sql.startsWith('SELECT user_id,expires_at')) return { rows: [{ user_id: userId, expires_at: new Date(principal.loginExpiresAt), revoked_at: options.revoked ? new Date() : null }] };
      if (sql.startsWith('SELECT catalog_revision::text')) return { rows: [{ ...state }] };
      if (sql.startsWith('SELECT purpose_key,incarnation_id::text')) return { rows: epochs.filter(e => e.active) };
      if (sql.startsWith('SELECT r.purpose_key')) return { rows: rules.filter(r => epochs.some(e => e.active && e.purpose_key === r.purpose_key && e.incarnation_id === r.purpose_incarnation_id)).sort((a, b) => a.purpose_key < b.purpose_key ? -1 : 1) };
      if (sql.startsWith('SELECT request_sha256')) return { rows: receipts.has(values.join(':')) ? [receipts.get(values.join(':'))] : [] };
      if (sql.startsWith('INSERT INTO pf_routing_purpose_rules')) {
        const row = { purpose_key: values[1], purpose_incarnation_id: values[2], allowed_categories: JSON.parse(values[3]) }, i = rules.findIndex(r => r.purpose_key === row.purpose_key && r.purpose_incarnation_id === row.purpose_incarnation_id);
        if (i < 0) rules.push(row); else rules[i] = row; return { rows: [] };
      }
      if (sql.startsWith('DELETE FROM pf_routing_purpose_rules')) { const i = rules.findIndex(r => r.purpose_key === values[1] && r.purpose_incarnation_id === values[2]); if (i >= 0) rules.splice(i, 1); return { rows: [] }; }
      if (sql.startsWith('UPDATE pf_purpose_project_state')) { if (state.catalog_revision !== values[1] || state.routing_policy_revision !== values[2]) return { rows: [] }; state.routing_policy_revision = String(BigInt(state.routing_policy_revision) + 1n); return { rows: [{ revision: state.routing_policy_revision }] }; }
      if (sql.startsWith('INSERT INTO pf_routing_policy_history')) { events.push({ audit_id: values[0], project_id: values[1], actor_id: values[2], login_id: values[3], occurred_at: values[4], catalog_revision: values[5], previous_revision: values[6], revision: values[7], idempotency_key: values[8], request_sha256: values[9], before_rules: JSON.parse(values[10]), after_rules: JSON.parse(values[11]) }); return { rows: [] }; }
      if (sql.startsWith('INSERT INTO pf_routing_policy_receipts')) { const key = values.slice(0, 3).join(':'); if (receipts.has(key)) throw new Error('duplicate'); receipts.set(key, { request_sha256: values[3], request_body: JSON.parse(values[4]), receipt: JSON.parse(values[5]) }); return { rows: [] }; }
      if (sql.startsWith('SELECT audit_id')) return { rows: events.filter(e => values[1] === null || BigInt(e.revision) < BigInt(values[1])).sort((a, b) => BigInt(a.revision) > BigInt(b.revision) ? -1 : 1).slice(0, values[2]) };
      throw new Error('Unexpected synthetic query');
    });
    return { query, release: vi.fn(() => { unlock?.(); }) };
  }) } as unknown as Pool;
  vi.mocked(readCatalog).mockImplementation(async () => ({ ...catalog, catalogRevision: state.catalog_revision }));
  vi.mocked(readRoutingCatalogScope).mockImplementation(async () => ({ catalogRevision: state.catalog_revision, routingContentSha256: 'a'.repeat(64) }));
  const repository = createPurposePolicyRepository(pool);
  return { options, principal, pool, calls, state, epochs, rules, events, receipts, catalog, repository, save: (input: unknown = command()) => repository.save(projectId, principal, input), get: () => repository.get(projectId, principal), scope: () => purposePolicyTransaction(pool, projectId, principal, c => readRoutingPolicyScope(c, projectId)) };
}
beforeEach(() => vi.clearAllMocks());

describe('routing policy transaction and authority', () => {
  it('saves strict categories, one revision and audit in one transaction', async () => {
    const db = database(), receipt = await db.save(); expect(receipt).toMatchObject({ revision: '1', previousRevision: '0', duplicate: false });
    expect(db.events).toHaveLength(1); expect(db.receipts.size).toBe(1); expect(db.events[0].actor_id).toBe(userId); expect(db.events[0].login_id).toBe(loginId);
    expect(await db.get()).toMatchObject({ routingPolicyRevision: '1', rules: [{ purposeKey: 'Synthetic purpose', allowedCategories: ['Control'] }] });
    const project = db.calls.findIndex(c => c.sql.startsWith('SELECT id FROM projects')), actor = db.calls.findIndex(c => c.sql.startsWith('SELECT is_admin'));
    expect(project).toBeLessThan(actor); expect(db.calls.some(c => c.sql.includes('FOR SHARE'))).toBe(true); expect(db.calls.at(-1)?.sql).toBe('COMMIT');
  });
  it.each([{ label: 'nonadmin', options: { admin: false }, code: 'ADMIN_REQUIRED' }, { label: 'missing account', options: { missingUser: true }, code: 'LOGIN_REVOKED' }, { label: 'revoked login', options: { revoked: true }, code: 'LOGIN_REVOKED' }, { label: 'deleted project', options: { projectExists: false }, code: 'PROJECT_NOT_FOUND' }])('denies $label before receipt or catalog', async ({ options, code }) => {
    const db = database(options); await expect(db.save()).rejects.toMatchObject({ code }); expect(db.events).toHaveLength(0); expect(db.calls.some(c => c.sql.startsWith('SELECT request_sha256'))).toBe(false); expect(readCatalog).not.toHaveBeenCalled();
  });
  it('hides project existence from a current nonadmin', async () => { const db = database({ admin: false, projectExists: false }); await expect(db.save()).rejects.toMatchObject({ code: 'ADMIN_REQUIRED', currentRevisions: null }); });
  it('rejects expired principal before connecting', async () => { const db = database(); db.principal.loginExpiresAt = Date.now() - 1; await expect(db.save()).rejects.toMatchObject({ code: 'LOGIN_EXPIRED' }); expect(db.pool.connect).not.toHaveBeenCalled(); });
  it('holds state lock and does not include drawing-only data in routing scope', async () => { const db = database(), a = await db.scope(); db.state.drawing_input_revision = '99'; db.state.drawing_policy_revision = '55'; const b = await db.scope(); expect(a).toEqual(b); expect(Object.keys(a).sort()).toEqual(['catalogRevision', 'routingContentSha256', 'routingPolicyRevision', 'routingPolicySha256']); expect(db.calls.some(c => c.sql.startsWith('SELECT catalog_revision') && c.sql.endsWith('FOR UPDATE'))).toBe(true); });
  it('rejects failed audit with atomic rollback and no receipt', async () => { const db = database({ failAt: 'INSERT INTO pf_routing_policy_history' }); await expect(db.save()).rejects.toMatchObject({ code: 'POLICY_FAILURE' }); expect(db.state.routing_policy_revision).toBe('0'); expect(db.rules).toHaveLength(0); expect(db.events).toHaveLength(0); expect(db.receipts.size).toBe(0); });
});

describe('idempotency, staleness, orphan rules and history', () => {
  it('returns historical receipt before new CAS/catalog resolution', async () => { const db = database(), first = await db.save(); db.state.catalog_revision = '20'; db.state.routing_policy_revision = '30'; vi.mocked(readCatalog).mockClear(); const replay = await db.save(); expect(replay).toEqual({ ...first, duplicate: true }); expect(readCatalog).not.toHaveBeenCalled(); expect(db.events).toHaveLength(1); expect(db.state.routing_policy_revision).toBe('30'); });
  it('same key with changed expected revision or payload conflicts', async () => { const db = database(); await db.save(); await expect(db.save(command(id(10), { expectedRevision: '1' }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' }); expect(db.events).toHaveLength(1); });
  it('new key with stale expectation refuses instead of replaying', async () => { const db = database(); await db.save(); await expect(db.save(command(id(11)))).rejects.toMatchObject({ code: 'POLICY_REVISION_CONFLICT' }); });
  it('catalog CAS takes precedence for a new stale command', async () => { const db = database(); db.state.catalog_revision = '3'; await expect(db.save()).rejects.toMatchObject({ code: 'CATALOG_REVISION_CONFLICT', currentRevisions: { catalogRevision: '3' } }); });
  it('concurrent identical requests persist one audit and increment once', async () => { const db = database(), results = await Promise.all([db.save(), db.save()]); expect(results.map(r => r.duplicate).sort()).toEqual([false, true]); expect(db.events).toHaveLength(1); expect(db.state.routing_policy_revision).toBe('1'); });
  it('concurrent different new saves cannot both consume one revision', async () => { const db = database(), results = await Promise.allSettled([db.save(), db.save(command(id(11)))]); expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(db.events).toHaveLength(1); });
  it('same values saved with a new valid command increment once again', async () => { const db = database(); await db.save(); await db.save(command(id(11), { expectedRevision: '1' })); expect(db.state.routing_policy_revision).toBe('2'); expect(db.events).toHaveLength(2); });
  it('lost commit acknowledgement is reconciled by the same historical key', async () => { const db = database({ commitLost: true }); await expect(db.save()).rejects.toMatchObject({ code: 'POLICY_FAILURE' }); expect((await db.save()).duplicate).toBe(true); expect(db.events).toHaveLength(1); });
  it('revoked admin cannot replay an existing receipt', async () => { const db = database(); await db.save(); db.options.admin = false; await expect(db.save()).rejects.toMatchObject({ code: 'ADMIN_REQUIRED', currentRevisions: null }); });
  it('remove and readd creates a detached epoch which cannot revive a rule', async () => { const db = database(); await db.save(); db.epochs[0].active = false; db.epochs.push({ ...db.epochs[0], active: true, incarnation_id: id(99) }); db.state.catalog_revision = '4'; expect((await db.get()).rules).toEqual([]); expect((await db.save()).duplicate).toBe(true); expect((await db.get()).rules).toEqual([]); });
  it('empty set is excluded and reset removes the active rule', async () => { const db = database(); await db.save(command(id(10), { changes: [{ purposeKey: 'Synthetic purpose', operation: 'set', allowedCategories: [] }] })); expect((await db.get()).rules[0].allowedCategories).toEqual([]); await db.save(command(id(11), { expectedRevision: '1', changes: [{ purposeKey: 'Synthetic purpose', operation: 'reset' }] })); expect((await db.get()).rules).toEqual([]); });
  it('unknown purpose cannot be authored', async () => { const db = database(); await expect(db.save(command(id(10), { changes: [{ purposeKey: 'Unknown', operation: 'set', allowedCategories: ['MV'] }] }))).rejects.toMatchObject({ code: 'PURPOSE_UNAVAILABLE' }); expect(db.events).toHaveLength(0); });
  it('normalization collision cannot receive permissions', async () => { const db = database(); db.catalog.rows.push({ ...db.catalog.rows[0], projectTrayId: id(88), rawPurpose: ' Synthetic purpose ' }); await expect(db.save()).rejects.toMatchObject({ code: 'PURPOSE_UNAVAILABLE' }); });
  it('catalog identity diagnostics block authoring through affected purposes', async () => { const db = database(); db.catalog.diagnostics.push({ code: 'TRAY_NAME_COLLISION', projectTrayIds: [trayId], message: 'Synthetic collision' }); await expect(db.save()).rejects.toMatchObject({ code: 'PURPOSE_UNAVAILABLE' }); });
  it('drawing-only invalid dimensions remain visible without denying valid routing permissions or changing routing scope', async () => {
    const db = database(), before = await db.scope(); db.catalog.diagnostics.push({ code: 'INVALID_DIMENSION', projectTrayIds: [trayId], message: 'Synthetic dimension requires drawing review.' });
    expect(await db.scope()).toEqual(before); expect((await db.save()).revision).toBe('1'); expect(db.catalog.diagnostics).toHaveLength(1);
    expect((await db.get()).rules[0].allowedCategories).toEqual(['Control']);
  });
  it('history pages descending exclusive revisions and includes current actor metadata', async () => { const db = database(); for (let i = 0; i < 3; i++) await db.save(command(id(10 + i), { expectedRevision: String(i) })); const page = await db.repository.history(projectId, db.principal, { limit: 2 }); expect(page.events.map(e => e.revision)).toEqual(['3', '2']); expect(page.nextBeforeRevision).toBe('2'); const last = await db.repository.history(projectId, db.principal, { beforeRevision: '2', limit: 2 }); expect(last.events.map(e => e.revision)).toEqual(['1']); expect(last.nextBeforeRevision).toBe(null); expect(last.events[0].actorId).toBe(userId); });
  it('history default cursor does not lose the maximum BIGINT revision', async () => { const db = database(); db.state.routing_policy_revision = '9223372036854775806'; await db.save(command(id(10), { expectedRevision: db.state.routing_policy_revision })); expect((await db.repository.history(projectId, db.principal, {})).events[0].revision).toBe('9223372036854775807'); await expect(db.save(command(id(11), { expectedRevision: '9223372036854775807' }))).rejects.toMatchObject({ code: 'POLICY_REVISION_EXHAUSTED' }); });
  it.each(['1\n', '01', '9223372036854775808'])('repository history refuses noncanonical cursor %s', async beforeRevision => { const db = database(); await expect(db.repository.history(projectId, db.principal, { beforeRevision })).rejects.toMatchObject({ code: 'INVALID_POLICY_HISTORY' }); });
});

describe('strict transport and contracts', () => {
  it.each(['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"x":{"a":1,"a":2}}'])('rejects decoded duplicate keys before parsing %s', text => expect(() => parsePolicyJson(Buffer.from(text))).toThrow());
  it.each(['{"x":1e999}', '{"x":-1e999}', '{"x":NaN}', '{"x":01}', '{"x":1,}', '{"x":1} false', '{\u00a0"x":1}', '['.repeat(50) + ']'.repeat(50)])('rejects malformed/nonfinite/deep JSON %s', text => expect(() => parsePolicyJson(Buffer.from(text))).toThrow());
  it('rejects malformed UTF8 and body bytes above the exact limit', () => { expect(() => parsePolicyJson(Buffer.from([0xff]))).toThrow(); expect(() => parsePolicyJson(Buffer.alloc(POLICY_BODY_BYTES + 1, 32))).toThrow(); expect(parsePolicyJson(Buffer.from('{"x":[0,true,null,"A"]}'))).toEqual({ x: [0, true, null, 'A'] }); });
  it.each([
    { expectedRevision: 0 }, { expectedRevision: '01' }, { expectedRevision: '9223372036854775808' }, { expectedRevision: '0\n' },
    { idempotencyKey: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }, { idempotencyKey: id(10) + '\n' }, { actorId: userId }, { schemaVersion: 'unknown' },
    { changes: [] }, { changes: [{ purposeKey: 'Synthetic purpose', operation: 'set', allowedCategories: ['Instrumentation'] }] },
    { changes: [{ purposeKey: 'Synthetic purpose', operation: 'set', allowedCategories: ['Control', 'MV'] }] },
    { changes: [{ purposeKey: ' Synthetic purpose', operation: 'set', allowedCategories: ['MV'] }] },
    { changes: [{ purposeKey: 'Synthetic purpose', operation: 'reset', allowedCategories: [] }] },
  ])('rejects invalid authoring without audit %#', async patch => { const db = database(); await expect(db.save(command(id(10), patch))).rejects.toBeInstanceOf(Error); expect(db.events).toHaveLength(0); });
  it('initializer serializes schema under the shared advisory lock and protects append-only records', async () => { const calls: string[] = [], client = { query: vi.fn(async (s: string) => { calls.push(s); return { rows: [] }; }), release: vi.fn() }; await initializeRoutingPolicySchema({ connect: async () => client } as unknown as Pool); expect(calls[0]).toBe('BEGIN'); expect(calls[1]).toContain('wfc-purpose-policy-schema-v1'); expect(calls[2]).toContain('BEFORE UPDATE OR DELETE'); expect(calls[2]).toContain('purpose_incarnation_id'); expect(calls.at(-1)).toBe('COMMIT'); expect(client.release).toHaveBeenCalledOnce(); });
});
