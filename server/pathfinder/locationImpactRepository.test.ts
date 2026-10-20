// @vitest-environment node
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { appendLocationImpactInTransaction } from './locationImpactRepository.js';
import { endpointBindingFixture, endpointFixtureId as id } from './endpointBindingFixtures.js';
import { endpointBindingHash, readCurrentEndpointBindingContext } from './endpointBindingRepository.js';
import type { LocationImpactRecord } from '../../shared/pathfinderLocationImpacts.js';
async function fixture() {
  const f = endpointBindingFixture(), binding = await f.repo.confirm(f.f.aggregate.projectId, f.who, f.locationId, f.command()), current = (await readCurrentEndpointBindingContext(f.client as never, f.f.aggregate.projectId))!;
  const state = { history: 0, admin: true, adminRevision: '0', installation: id(400) as string | null, oversized: false,
    records: new Map<string, Record<string, unknown>>(), targets: new Map<string, { impactId: string; generation: string }>(), items: [] as Array<Record<string, any>>,
    dispatch: [] as Array<{ id: string; status: string; reasons: string[] }>, categories: new Map(f.state.cables.map(row => [row.id, 'LV' as string | null])) };
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql.startsWith('SELECT i.project_id')) return { rows: [...state.records.values()].filter(row => row.actor_id === args[1] && row.idempotency_key === args[2]) };
    if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: state.history }] };
    if (sql.startsWith('SELECT is_admin')) return { rows: [{ is_admin: state.admin, revision: state.adminRevision }] };
    if (sql.startsWith('SELECT installation_epoch')) return { rows: state.installation ? [{ installation_epoch: state.installation }] : [] };
    if (sql.startsWith('/* location-impact:cables */')) return { rows: f.state.cables.filter(row => args[1].includes(row.id)).sort((a, b) => a.id.localeCompare(b.id)).map(row => ({ ...row, cable_write_revision: '7', mto: state.categories.get(row.id), oversized: state.oversized })) };
    if (sql.startsWith('INSERT INTO pf_location_impacts(')) { const row = { project_id: args[0], id: args[1], actor_id: args[2], login_id: args[3], idempotency_key: args[4], command_sha256: args[5], record_sha256: args[6], record: args[7] }; state.records.set(args[1], row); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pf_location_impact_targets')) return { rows: args[2].map((cableId: string) => { const target = { impactId: args[1], generation: (BigInt(state.targets.get(cableId)?.generation ?? '0') + 1n).toString() }; state.targets.set(cableId, target); return { cable_id: cableId, generation: target.generation }; }) };
    if (sql.startsWith('INSERT INTO pf_location_impact_items')) { state.items.push(...JSON.parse(args[2])); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pf_location_impact_dispatch')) { state.dispatch.push({ id: args[1], status: args[2], reasons: JSON.parse(args[3]) }); return { rows: [] }; }
    throw Error('Unhandled mocked SQL: ' + sql.slice(0, 100));
  });
  const input: Parameters<typeof appendLocationImpactInTransaction>[1] = { projectId: f.f.aggregate.projectId, principal: f.who, idempotencyKey: id(500), commandSha256: 'a'.repeat(64), binding, current,
    affectedCableIds: f.state.cables.map(row => row.id).sort(), calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 } };
  const append = (value = input) => appendLocationImpactInTransaction({ query } as unknown as PoolClient, value, () => { if (f.who.loginExpiresAt <= Date.now()) throw Error('expired'); });
  return { f, state, query, input, append };
}
describe('same-transaction impact append protocol with synthetic SQL, not actual PostgreSQL', () => {
  it('records all20 eligible shared occurrences once, with normalized From/To identity and no engine/cable writes', async () => {
    const f = await fixture(); f.f.state.cables = Array.from({ length: 20 }, (_, index) => ({ id: id(index + 1000), from_location: index % 2 ? 'Alias' : 'EQUIPMENT', to_location: index % 2 ? 'equipment' : 'Alias' }));
    f.input.affectedCableIds = f.f.state.cables.map(row => row.id); for (const row of f.f.state.cables) f.state.categories.set(row.id, 'LV');
    const ref = await f.append(); expect(ref.eligibleCables).toBe(20); expect(f.state.items).toHaveLength(20); expect(f.state.targets.size).toBe(20);
    expect(f.state.items[0].record.fromLogicalKey).toBe('EQUIPMENT'); expect(f.state.items[1].record.toLogicalKey).toBe('EQUIPMENT');
    expect(f.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/UPDATE cables|INSERT INTO pf_jobs|INSERT INTO pf_reviews|pf_recalculation_dirty/);
  });
  it('partitions Instrumentation, MV and unknown categories exactly without treating unknown as allowed', async () => {
    const f = await fixture(); f.state.categories.set(id(10), 'Instrumentation'); f.state.categories.set(id(11), 'MV'); f.state.categories.set(id(12), null);
    const ref = await f.append(); expect(ref).toMatchObject({ status: 'pending', eligibleCables: 1, excludedMvCables: 1, blockedCategoryCables: 1 });
    expect(f.state.targets.has(id(11))).toBe(false); expect(f.state.items.find(item => item.cable_id === id(12))?.eligible).toBe(false);
  });
  it('seals real original admin revision/login/installation epoch and bounds the finite authority to login expiry', async () => {
    const f = await fixture(); f.state.adminRevision = '9007199254740993'; const ref = await f.append(), record = f.state.records.get(ref.id)!.record as LocationImpactRecord;
    expect(record.actorAdminRevision).toBe('9007199254740993'); expect(record.loginId).toBe(f.f.who.loginId); expect(record.installationEpoch).toBe(f.state.installation);
    expect(Date.parse(record.authorityExpiresAt)).toBeLessThanOrEqual(f.f.who.loginExpiresAt); const { contentSha256, ...body } = record; expect(contentSha256).toBe(endpointBindingHash(body));
  });
  it('missing explicit calculation config creates a blocked intent, not guessed preferences or a queued job', async () => {
    const f = await fixture(), ref = await f.append({ ...f.input, calculation: null }); expect(ref.status).toBe('blocked'); expect(f.state.dispatch[0].reasons).toEqual(['LOCATION_IMPACT_PREFERENCES_REQUIRED']);
  });
  it('exact duplicate/replay creates no second intent, target generation or dispatch', async () => {
    const f = await fixture(), first = await f.append(), second = await f.append(); expect(second).toEqual(first); expect(f.state.records.size).toBe(1); expect(f.state.dispatch).toHaveLength(1); expect(f.state.targets.get(id(10))?.generation).toBe('1');
    await expect(f.append({ ...f.input, commandSha256: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'LOCATION_IMPACT_IDEMPOTENCY_CONFLICT' });
  });
  it('two quick saves advance only overlapping cable heads and preserve an unrelated sibling', async () => {
    const f = await fixture(), first = await f.append(), second = await f.append({ ...f.input, idempotencyKey: id(501), commandSha256: 'b'.repeat(64), affectedCableIds: [id(10), id(11)] });
    expect(f.state.targets.get(id(10))).toEqual({ impactId: second.id, generation: '2' }); expect(f.state.targets.get(id(12))).toEqual({ impactId: first.id, generation: '1' });
  });
  it('retains valid non-idempotent NFC/uppercase Greek normalization without inventing another name', async () => {
    const f = await fixture(); f.f.state.cables[0].from_location = 'ΐ'; await f.append(); expect(f.state.items[0].record.fromLogicalKey).toBe('ΐ'.normalize('NFC').trim().toUpperCase());
  });
  it.each(['history', 'admin', 'installation', 'oversized', 'missing-cable'] as const)('refuses %s before recording an intent', async kind => {
    const f = await fixture(); if (kind === 'history') f.state.history = 10000; if (kind === 'admin') f.state.admin = false; if (kind === 'installation') f.state.installation = null;
    if (kind === 'oversized') f.state.oversized = true; if (kind === 'missing-cable') f.input.affectedCableIds = [id(999)];
    await expect(f.append()).rejects.toBeDefined(); expect(f.state.records.size).toBe(0);
  });
  it('all-MV scope is explicitly blocked, with no calculation targets or member rows', async () => {
    const f = await fixture(); for (const row of f.f.state.cables) f.state.categories.set(row.id, 'MV');
    expect(await f.append()).toMatchObject({ status: 'blocked', eligibleCables: 0, excludedMvCables: 3 }); expect(f.state.targets.size).toBe(0); expect(f.state.items).toHaveLength(0);
  });
});
