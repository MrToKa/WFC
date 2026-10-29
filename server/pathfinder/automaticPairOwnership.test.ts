// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { readAutomaticPairOwnership } from './automaticPairOwnership.js';
import { automaticPairOwnTransition, automaticPairHistoryMatches } from './automaticPairReceiptProof.js';

const id = (n: number) => `ba000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const current = { id: id(2), project_id: id(1), routing: '/A', design_length: '7.00', cable_write_revision: '8', mto: 'LV' };
  const history = { id: id(5), version: '4' }, fact = { receiptId: id(3), receiptSha256: 'a'.repeat(64), originReceiptId: id(4), before: {}, after: { ...current }, history };
  const state = { receipt: true,provenanceVersion:undefined as string|undefined, latest: { ...history, change_source: 'pathfinder' }, fact: fact as typeof fact | null };
  const query = vi.fn(async (sql: string) => { if (sql.includes('latest-receipt')) return { rows: state.receipt ? [{ id: id(3),provenance_version:state.provenanceVersion }] : [] };
    if (sql.includes('latest-history')) return { rows: [state.latest] }; throw Error(sql); });
  const proof = vi.fn(async () => state.fact), run = () => readAutomaticPairOwnership({ query } as unknown as PoolClient,
    { projectId: id(1), cableId: id(2), currentSnapshot: current }, undefined, { proof }); return { current, history, state, query, proof, run };
}
describe('automatic pair ownership from receipt revision and exact history', () => {
  it('recognizes a verified capacity-clear origin while keeping manual blanking protected',async()=>{
    const f=fixture();Object.assign(f.current,{routing:null,design_length:null});Object.assign(f.state.fact!.after,{routing:null,design_length:null});
    Object.assign(f.state.fact!,{clearedForCapacity:true});f.state.provenanceVersion='pathfinder.automatic-pair-capacity-clear.v1';
    expect(await f.run()).toMatchObject({kind:'automatic',previousReceiptId:id(3)});
    f.state.latest.change_source='manual';expect(await f.run()).toMatchObject({kind:'review-required'});
  });
  it('requires both fields blank for a fresh root', async () => {
    const f = fixture(); f.current.routing = '\t\n'; f.current.design_length = null as unknown as string; f.state.receipt = false;
    expect(await f.run()).toEqual({ kind: 'empty' }); expect(f.proof).not.toHaveBeenCalled();
  });
  it('protects manual clearing of both fields after a prior Path Finder write', async () => {
    const f = fixture(); f.current.routing = ''; f.current.design_length = null as unknown as string; f.current.cable_write_revision = '9';
    expect(await f.run()).toEqual({ kind: 'review-required', reasonCode: 'AUTOMATIC_PAIR_MANUAL_CLEAR' }); expect(f.proof).not.toHaveBeenCalled();
  });
  it('recognizes verified receipt plus unchanged revision and history', async () => {
    const f = fixture(); expect(await f.run()).toMatchObject({ kind: 'automatic', previousReceiptId: id(3), originReceiptId: id(4), history: f.history });
  });
  it.each(['routing', 'length', 'revision', 'restored', 'history', 'manual same values', 'unproven', 'no receipt'] as const)('protects %s', async kind => {
    const f = fixture(); if (kind === 'routing') f.current.routing = '/MANUAL'; if (kind === 'length') f.current.design_length = '8';
    if (kind === 'revision' || kind === 'restored') f.current.cable_write_revision = '10';
    if (kind === 'history') f.state.latest.id = id(99); if (kind === 'manual same values') f.state.latest.change_source = 'manual';
    if (kind === 'unproven') f.state.fact = null; if (kind === 'no receipt') f.state.receipt = false;
    expect(await f.run()).toMatchObject({ kind: 'review-required' });
  });
  it('does not treat one empty field or zero Design as fresh ownership', async () => {
    const f = fixture(); f.current.routing = ''; f.current.design_length = '0'; f.state.receipt = false;
    expect(await f.run()).toMatchObject({ kind: 'review-required' });
  });
  it('requires a unit own-write revision and unchanged unrelated fields', () => {
    const before = { id: id(2), project_id: id(1), cable_write_revision: '7', routing: '/OLD', design_length: '5', install_length: '9', tag: 'T' };
    const after = { ...before, cable_write_revision: '8', routing: '/NEW', design_length: '7' };
    expect(automaticPairOwnTransition(id(1), id(2), before, after)).toBe(true);
    expect(automaticPairOwnTransition(id(1), id(2), before, { ...after, tag: 'Changed' })).toBe(false);
    expect(automaticPairOwnTransition(id(1), id(2), before, { ...after, cable_write_revision: '9' })).toBe(false);
  });
  it('requires the complete audited snapshot rather than route-only equality', () => {
    expect(automaticPairHistoryMatches({ change_source: 'pathfinder', changed_by: id(9), cable_number: '1' }, { cable_id: 1 }, id(9))).toBe(false);
  });
});
