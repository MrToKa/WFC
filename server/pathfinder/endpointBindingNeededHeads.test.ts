// @vitest-environment node
import type { PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointBinding, EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';
import { endpointBindingFixture, endpointFixtureId as id } from './endpointBindingFixtures.js';
import { endpointBindingHash, readNeededEndpointBindingHeads } from './endpointBindingRepository.js';

const proof = vi.hoisted(() => ({ valid: true, validators: [] as ((binding: unknown) => Promise<{ valid: boolean; code: string }>)[], clients: [] as unknown[] }));
vi.mock('./revisionComparisonEvidenceReader.js', () => ({
  createConfirmedRevisionBindingValidator: (client: unknown) => {
    const validator = vi.fn(async (_binding: unknown) => ({ valid: proof.valid, code: proof.valid ? 'ENDPOINT_MIGRATION_BASIS_CURRENT' : 'ENDPOINT_MIGRATION_FRAME_SUPERSEDED' }));
    proof.validators.push(validator); proof.clients.push(client); return validator;
  },
  readConfirmedRevisionBindingValidity: vi.fn(async () => ({ valid: false, code: 'ENDPOINT_MIGRATION_PROOF_REQUIRED' })),
}));

type Row = { location_id: string; location_revision: string; binding_id: string; binding_revision: string; record_sha256: string; record: EndpointBinding };
const NOW = 1_800_000_000_000;
beforeEach(() => { proof.valid = true; proof.validators = []; proof.clients = []; vi.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => vi.restoreAllMocks());

async function source() {
  const f = endpointBindingFixture(), saved = await f.repo.confirm(f.f.aggregate.projectId, f.who, f.locationId, f.command());
  const current: EndpointCurrentScope = { modelVersionId: f.f.aggregate.modelVersionId, selectionRevision: '1', contentFingerprint: f.f.aggregate.contentFingerprint, aggregateId: f.f.aggregate.id, artifactId: f.f.aggregate.artifactId, projectionSha256: f.f.aggregate.projection.sha256, captureFrameId: f.f.aggregate.coordinateFrameId, geometryRevision: f.f.aggregate.geometryRevision, traceId: f.f.traceId };
  proof.validators = []; proof.clients = [];
  return { binding: saved.binding, current, projectId: f.f.aggregate.projectId };
}
function row(base: EndpointBinding, n: number, change: Partial<EndpointBinding> = {}): Row {
  const { contentSha256: _hash, ...body } = { ...base, id: id(100_000 + n), locationId: id(n), ...change };
  const binding = { ...body, contentSha256: endpointBindingHash(body) };
  return { location_id: binding.locationId, location_revision: binding.locationRevision, binding_id: binding.id, binding_revision: binding.bindingRevision, record_sha256: binding.contentSha256, record: binding };
}
function client(all: Row[], customize?: (selected: string[], found: Row[]) => Row[]) {
  const query = vi.fn(async (sql: string, args: unknown[]) => {
    if (!sql.startsWith('SELECT h.location_id') || !sql.includes('h.location_id=ANY($2::uuid[])')) throw Error('Unexpected SQL outside needed-head scope');
    const selected = args[1] as string[], found = all.filter(r => selected.includes(r.location_id));
    return { rows: customize ? customize(selected, found) : found };
  });
  return { value: { query } as unknown as PoolClient, query };
}

describe('needed endpoint-head collection with mocked SQL and a mocked live-proof checker', () => {
  it('selects only requested locations, deduplicates aliases/ends, and preserves the caller array', async () => {
    const f = await source(), requested = [id(2), id(1), id(2)], original = [...requested], c = client([row(f.binding, 1), row(f.binding, 2), row(f.binding, 3)]);
    const result = await readNeededEndpointBindingHeads(c.value, { ...f, locationIds: requested, deadline: NOW + 1000 });
    expect([...result.keys()]).toEqual([id(1), id(2)]); expect([...result.values()].every(v => v.ready)).toBe(true); expect(requested).toEqual(original);
    expect(c.query).toHaveBeenCalledTimes(1); expect(c.query.mock.calls[0][1]).toEqual([f.projectId, [id(1), id(2)]]);
    expect(c.query.mock.calls[0][0]).toContain('FOR SHARE OF h,r,l'); expect(c.query.mock.calls[0][0]).not.toMatch(/LIMIT|BEGIN|COMMIT/);
  });
  it('uses exact chunk boundaries without the legacy 10,000 whole-project head cap', async () => {
    const f = await source(), ids = Array.from({ length: 10_001 }, (_, n) => id(n + 1)), c = client([]);
    const result = await readNeededEndpointBindingHeads(c.value, { ...f, locationIds: ids, deadline: NOW + 1000 });
    expect(result.size).toBe(0); expect(c.query).toHaveBeenCalledTimes(21);
    const selected = c.query.mock.calls.map(call => call[1][1] as string[]);
    expect(selected.slice(0, -1).every(group => group.length === 500)).toBe(true); expect(selected.at(-1)).toHaveLength(1);
    expect(selected.flat()).toEqual(ids); expect(new Set(selected.flat()).size).toBe(10_001);
  });
  it('returns all 501 requested ready heads across a chunk boundary', async () => {
    const f = await source(), all = Array.from({ length: 501 }, (_, n) => row(f.binding, n + 1)), c = client(all);
    const result = await readNeededEndpointBindingHeads(c.value, { ...f, locationIds: all.map(r => r.location_id).reverse(), deadline: NOW + 1000 });
    expect(result.size).toBe(501); expect(c.query).toHaveBeenCalledTimes(2); expect([...result.values()].every(v => v.ready)).toBe(true);
  });
  it('refuses excess unique needed locations before issuing any SQL', async () => {
    const f = await source(), c = client([]);
    await expect(readNeededEndpointBindingHeads(c.value, { ...f, locationIds: Array.from({ length: 20_001 }, (_, n) => id(n + 1)), deadline: NOW + 1000 })).rejects.toMatchObject({ code: 'ENDPOINT_NEEDED_LOCATION_LIMIT', status: 413 }); expect(c.query).not.toHaveBeenCalled();
  });
  it('leaves a missing requested head absent instead of creating a point or promoting a legacy binding', async () => {
    const f = await source(), c = client([row(f.binding, 1)]), result = await readNeededEndpointBindingHeads(c.value, { ...f, locationIds: [id(1), id(2)], deadline: NOW + 1000 });
    expect(result.get(id(1))?.ready).toBe(true); expect(result.has(id(2))).toBe(false); expect(c.query).toHaveBeenCalledTimes(1);
  });
  it.each(['record-hash', 'row-hash', 'binding-id', 'binding-revision', 'foreign-project', 'foreign-location', 'duplicate'] as const)('rejects %s integrity failure', async kind => {
    const f = await source(); let r = row(f.binding, 1);
    if (kind === 'record-hash') r.record = { ...r.record, pointProjectMetres: [0, 0, 0] };
    if (kind === 'row-hash') r.record_sha256 = 'f'.repeat(64);
    if (kind === 'binding-id') r.binding_id = id(9876);
    if (kind === 'binding-revision') r.binding_revision = '99';
    if (kind === 'foreign-project') r = row(f.binding, 1, { projectId: id(9876) });
    if (kind === 'foreign-location') r = row(f.binding, 3);
    const c = client([], () => kind === 'duplicate' ? [r, r] : [r]);
    await expect(readNeededEndpointBindingHeads(c.value, { ...f, locationIds: [id(1)], deadline: NOW + 1000 })).rejects.toMatchObject({ code: kind === 'record-hash' ? 'ENDPOINT_EVIDENCE_INTEGRITY' : 'ENDPOINT_HEAD_INTEGRITY' });
  });
  it.each(['location', 'aggregate', 'artifact', 'model', 'projection', 'frame'] as const)('keeps a current-hash but stale %s head unready', async kind => {
    const f = await source(), r = row(f.binding, 1), current = { ...f.current };
    if (kind === 'location') r.location_revision = '99';
    if (kind === 'aggregate') current.aggregateId = id(9876);
    if (kind === 'artifact') current.artifactId = id(9876);
    if (kind === 'model') current.modelVersionId = id(9876);
    if (kind === 'projection') current.projectionSha256 = 'f'.repeat(64);
    if (kind === 'frame') current.captureFrameId = id(9876);
    const c = client([r]), result = await readNeededEndpointBindingHeads(c.value, { projectId: f.projectId, current, locationIds: [id(1)], deadline: NOW + 1000 });
    expect(result.get(id(1))?.ready).toBe(false);
  });
  it('uses one transaction-owned migration checker for needed migrated heads and never reuses it across calls', async () => {
    const f = await source(), all = [row(f.binding, 1, { sourceDecisionId: id(8001) }), row(f.binding, 2, { sourceDecisionId: id(8002) })], c = client(all);
    let result = await readNeededEndpointBindingHeads(c.value, { ...f, locationIds: all.map(r => r.location_id), deadline: NOW + 1000 });
    expect(proof.validators).toHaveLength(1); expect(proof.clients).toEqual([c.value]); expect(proof.validators[0]).toHaveBeenCalledTimes(2); expect([...result.values()].every(r => r.ready)).toBe(true);
    proof.valid = false;
    result = await readNeededEndpointBindingHeads(c.value, { ...f, locationIds: all.map(r => r.location_id), deadline: NOW + 1000 });
    expect(proof.validators).toHaveLength(2); expect(proof.validators[1]).not.toBe(proof.validators[0]); expect([...result.values()].every(r => !r.ready)).toBe(true);
  });
  it('never asks live migration evidence to make a missing current preparation ready', async () => {
    const f = await source(), c = client([row(f.binding, 1, { sourceDecisionId: id(8001) })]);
    const result = await readNeededEndpointBindingHeads(c.value, { projectId: f.projectId, current: null, locationIds: [id(1)], deadline: NOW + 1000 });
    expect(result.get(id(1))?.ready).toBe(false); expect(proof.validators[0]).not.toHaveBeenCalled();
  });
  it('applies the serialized-row budget before parsing an oversized retained record', async () => {
    const f = await source(), r = row(f.binding, 1); r.record = { ...r.record, reason: 'x'.repeat(RECALCULATION_LIMITS.neededLocationBytes) };
    const c = client([r]); await expect(readNeededEndpointBindingHeads(c.value, { ...f, locationIds: [id(1)], deadline: NOW + 1000 })).rejects.toMatchObject({ code: 'ENDPOINT_NEEDED_LOCATION_BYTES', status: 413 });
  });
  it('refuses a deadline before SQL and again after a query completes late', async () => {
    const f = await source(), c = client([]);
    await expect(readNeededEndpointBindingHeads(c.value, { ...f, locationIds: [id(1)], deadline: NOW - 1 })).rejects.toMatchObject({ code: 'RECALCULATION_COLLECTION_DEADLINE' }); expect(c.query).not.toHaveBeenCalled();
    const late = client([], (_selected, found) => { vi.mocked(Date.now).mockReturnValue(NOW + 2); return found; });
    await expect(readNeededEndpointBindingHeads(late.value, { ...f, locationIds: [id(1)], deadline: NOW + 1 })).rejects.toMatchObject({ code: 'RECALCULATION_COLLECTION_DEADLINE' }); expect(late.query).toHaveBeenCalledTimes(1);
  });
  it('propagates cancellation before the first query and before returning a completed query', async () => {
    const f = await source(), aborted = new AbortController(); aborted.abort(); const c = client([]);
    await expect(readNeededEndpointBindingHeads(c.value, { ...f, locationIds: [id(1)], deadline: NOW + 1000, signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(c.query).not.toHaveBeenCalled();
    const during = new AbortController(), query = client([], (_selected, found) => { during.abort(); return found; });
    await expect(readNeededEndpointBindingHeads(query.value, { ...f, locationIds: [id(1)], deadline: NOW + 1000, signal: during.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(query.query).toHaveBeenCalledTimes(1);
  });
});
