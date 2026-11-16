// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { repairAutomaticRoutingMigrationControls } from './automaticRoutingMigrationRepair.js';
import type { AutomaticPairReceiptFact } from './automaticPairReceiptProof.js';
import { PathFinderError } from './errors.js';
import { z } from 'zod';

const id = (n: number) => `cc000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const current: Record<string, any> = { id: id(2), project_id: id(1), cable_write_revision: '5', routing: '/A/B',
    design_length: '24', install_length: null, pull_date: null, connected_from: null, connected_to: null, tested: null };
  const control: Record<string, any> = { revision: '1', manual_revision: '1', manual_routing: '/A/B', manual_protected: true,
    execution_locked: false, execution_routing: null, updated_at: new Date('2026-11-16T07:01:58Z') };
  const fact: AutomaticPairReceiptFact = { receiptId: id(3), receiptSha256: 'a'.repeat(64), originReceiptId: id(4),
    before: { ...current, cable_write_revision: '4' }, after: { ...current }, history: { id: id(5), version: '6' } };
  const state = { projectExists: true, cableExists: true, controlExists: true, event: false,
    receipt: { id: id(3), predates_control: true } as Record<string, any> | null,
    history: { id: id(5), version: '6', change_source: 'pathfinder' }, fact: fact as AutomaticPairReceiptFact | null, updateWon: true };
  const query = vi.fn(async (sql: string, _args?: unknown[]) => {
    if (sql.includes('routing-migration:project')) return { rows: state.projectExists ? [{ id: id(1) }] : [] };
    if (sql.includes('routing-migration:cable')) return { rows: state.cableExists ? [{ snapshot: current }] : [] };
    if (sql.includes('routing-migration:control')) return { rows: state.controlExists ? [control] : [] };
    if (sql.includes('routing-migration:events')) return { rows: state.event ? [{ id: 1 }] : [] };
    if (sql.includes('routing-migration:latest-receipt')) return { rows: state.receipt ? [state.receipt] : [] };
    if (sql.includes('routing-migration:latest-history')) return { rows: [state.history] };
    if (sql.includes('routing-migration:repair-control')) return { rows: state.updateWon ? [{ revision: '2' }] : [] };
    if (sql.includes('routing-migration:audit') || sql.includes('routing-migration:manual-retire')) return { rows: [] };
    throw Error(sql);
  });
  const proof = vi.fn(async () => state.fact);
  const run = (dryRun?: boolean, cableIds = [id(2)], check?: () => void) => repairAutomaticRoutingMigrationControls({ query } as unknown as PoolClient,
    { projectId: id(1), cableIds, ...(dryRun !== undefined ? { dryRun } : {}) }, check, { proof });
  return { current, control, fact, state, query, proof, run };
}

describe('repair of bootstrap-misclassified historical automatic routing', () => {
  it('defaults to a read-only preview with an exact proof manifest and no route mutation', async () => {
    const f = fixture(), original = structuredClone(f.current);
    expect(await f.run()).toMatchObject({ dryRun: true, eligible: 1, repaired: 0,
      items: [{ cableId: id(2), eligible: true, repaired: false, manifest: { routing: '/A/B', designLength: '24',
        cableWriteRevision: '5', controlRevision: '1', manualRevision: '1', receiptId: id(3), historyId: id(5), historyVersion: '6' } }] });
    expect(f.proof).toHaveBeenCalledWith({ projectId: id(1), cableId: id(2), receiptId: id(3) });
    expect(f.query.mock.calls.every(([sql]) => !/\b(UPDATE\s+pf_\w+|INSERT|DELETE)\b/.test(sql))).toBe(true);
    expect(f.query.mock.calls.every(([sql]) => !/FOR (?:UPDATE|NO KEY UPDATE)/.test(sql))).toBe(true);
    expect(f.current).toEqual(original);
  });
  it('clears only the mistaken manual control, audits as a system repair and retires its manual job', async () => {
    const f = fixture(), original = structuredClone(f.current), result = await f.run(false);
    expect(result).toMatchObject({ eligible: 1, repaired: 1 });
    const mutations = f.query.mock.calls.filter(([sql]) => /\b(UPDATE\s+pf_\w+|INSERT|DELETE)\b/.test(sql));
    expect(f.query.mock.calls.filter(([sql]) => /FOR (?:UPDATE|NO KEY UPDATE)/.test(sql))).toHaveLength(3);
    expect(mutations).toHaveLength(3);
    expect(mutations[0][0]).toContain('manual_routing=NULL,manual_protected=false');
    expect(mutations[1][0]).toContain('VALUES($1,$2,NULL');
    expect(mutations[1][1]?.[4]).toMatchObject({ schemaVersion: 'wfc.automatic-routing-migration-repair.v1',
      before: { manualRouting: '/A/B', manualProtected: true }, after: { manualRouting: null, manualProtected: false },
      proof: { receiptId: id(3), receiptSha256: 'a'.repeat(64) } });
    expect(mutations[2][0]).toContain('DELETE FROM pf_manual_route_jobs');
    expect(f.current).toEqual(original);
    expect(f.query.mock.calls.some(([sql]) => /UPDATE cables|pf_automatic_pair_dispatch|pf_automatic_pair_mandates/.test(sql))).toBe(false);
  });
  it.each(['install_length', 'pull_date', 'connected_from', 'connected_to', 'tested', 'latch', 'retained execution route'])('retains execution protection: %s', async field => {
    const f = fixture();
    if (field === 'install_length') f.current.install_length = '1';
    else if (field === 'latch') f.control.execution_locked = true;
    else if (field === 'retained execution route') f.control.execution_routing = '/A/B';
    else f.current[field] = '2026-11-10';
    expect(await f.run(false)).toMatchObject({ eligible: 0, repaired: 0, items: [{ reasonCode: 'ROUTING_EXECUTION_PROTECTED' }] });
    expect(f.proof).not.toHaveBeenCalled();
  });
  it.each(['revision', 'manual_revision', 'manual_routing', 'unprotected', 'blank route', 'events'])('does not undo an explicit or changed manual control: %s', async change => {
    const f = fixture();
    if (change === 'revision' || change === 'manual_revision') f.control[change] = '2';
    if (change === 'manual_routing') f.control.manual_routing = '/MANUAL';
    if (change === 'unprotected') f.control.manual_protected = false;
    if (change === 'blank route') f.current.routing = '';
    if (change === 'events') f.state.event = true;
    expect(await f.run(false)).toMatchObject({ eligible: 0, repaired: 0 });
    expect(f.proof).not.toHaveBeenCalled();
  });
  it.each(['missing', 'newer or same time'])('requires a receipt older than the untouched bootstrap control: %s', async change => {
    const f = fixture(); if (change === 'missing') f.state.receipt = null; else f.state.receipt!.predates_control = false;
    expect(await f.run(false)).toMatchObject({ eligible: 0, items: [{ reasonCode: 'AUTOMATIC_ROUTING_MIGRATION_OLDER_RECEIPT_REQUIRED' }] });
    expect(f.proof).not.toHaveBeenCalled();
  });
  it.each(['null', 'different receipt', 'capacity clear', 'routing', 'length', 'revision', 'other cable', 'other project', 'history id', 'history version', 'manual history'])('rejects unsupported or changed proof: %s', async change => {
    const f = fixture();
    if (change === 'null') f.state.fact = null;
    if (change === 'different receipt') f.fact.receiptId = id(99);
    if (change === 'capacity clear') f.fact.clearedForCapacity = true;
    if (change === 'routing') f.current.routing = f.control.manual_routing = '/NEW';
    if (change === 'length') f.current.design_length = '25';
    if (change === 'revision') f.current.cable_write_revision = '6';
    if (change === 'other cable') f.fact.after.id = id(99);
    if (change === 'other project') f.fact.after.project_id = id(99);
    if (change === 'history id') f.state.history.id = id(99);
    if (change === 'history version') f.state.history.version = '7';
    if (change === 'manual history') f.state.history.change_source = 'manual';
    expect(await f.run(false)).toMatchObject({ eligible: 0, repaired: 0 });
    expect(f.query.mock.calls.some(([sql]) => sql.includes('routing-migration:repair-control'))).toBe(false);
  });
  it('does not bypass a refused historical proof or a deadline to complete a repair', async () => {
    const f = fixture(); f.proof.mockRejectedValueOnce(new Error('proof budget exceeded'));
    await expect(f.run(false)).rejects.toThrow('proof budget exceeded');
    expect(f.query.mock.calls.some(([sql]) => sql.includes('routing-migration:repair-control'))).toBe(false);
    const g = fixture(); await expect(g.run(false, undefined, () => { throw Error('deadline'); })).rejects.toThrow('deadline');
    expect(g.query).not.toHaveBeenCalled();
  });
  it.each(['proof limit', 'invalid historical schema'])('retains protection for an unsupported historical proof: %s', async kind => {
    const f = fixture();
    const schemaError = z.string().safeParse(null);
    f.proof.mockRejectedValueOnce(kind === 'proof limit' ? new PathFinderError('AUTOMATIC_PAIR_PROOF_READ_LIMIT', 413)
      : schemaError.success ? new Error('invalid test fixture') : schemaError.error);
    expect(await f.run(false)).toMatchObject({ eligible: 0, repaired: 0, items: [{ reasonCode: kind === 'proof limit'
      ? 'AUTOMATIC_PAIR_PROOF_READ_LIMIT' : 'AUTOMATIC_ROUTING_MIGRATION_AUTOMATIC_PROOF_INVALID' }] });
    expect(f.query.mock.calls.some(([sql]) => sql.includes('routing-migration:repair-control'))).toBe(false);
  });
  it('fails rather than auditing a changed control or silently widening the scope', async () => {
    const f = fixture(); f.state.updateWon = false;
    await expect(f.run(false)).rejects.toMatchObject({ code: 'AUTOMATIC_ROUTING_MIGRATION_CONTROL_CHANGED' });
    expect(f.query.mock.calls.some(([sql]) => sql.includes('routing-migration:audit'))).toBe(false);
    const g = fixture();
    await expect(g.run(false, [])).rejects.toMatchObject({ code: 'AUTOMATIC_ROUTING_MIGRATION_SCOPE_INVALID' });
    await expect(g.run(false, [id(2), id(2)])).rejects.toMatchObject({ code: 'AUTOMATIC_ROUTING_MIGRATION_SCOPE_INVALID' });
    await expect(g.run(false, Array.from({ length: 501 }, (_, i) => id(i)))).rejects.toMatchObject({ code: 'AUTOMATIC_ROUTING_MIGRATION_SCOPE_INVALID' });
    expect(g.query).not.toHaveBeenCalled();
  });
});
