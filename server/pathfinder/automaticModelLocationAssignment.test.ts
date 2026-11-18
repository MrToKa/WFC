// @vitest-environment node
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assignAutomaticModelLocationsInTransaction } from './automaticModelLocationAssignment.js';
import { PathFinderError } from './errors.js';

const seams = vi.hoisted(() => ({ current: vi.fn(), match: vi.fn(), confirm: vi.fn() }));
vi.mock('./automaticEndpointCandidates.js', () => ({ readPreparedNamedEndpointMatches: seams.match }));
vi.mock('./endpointBindingRepository.js', () => ({
  readCurrentEndpointBindingContext: seams.current,
  confirmEndpointBindingChangeInTransaction: seams.confirm,
}));

const id = (n: number) => `bf000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const traceId = id(2);
const object = { traceId, objectRevisionId: id(3), recordSha256: 'a'.repeat(64) };
type Match = { status: string; object: typeof object | null };
const ready = { status: 'automatic-ready', object };
const missing = { status: 'missing', object: null };
const unassigned = { key: 'NEW', id: null, name: null, revision: null, aliases: [] };
const existing = { key: 'EXISTING', id: id(4), name: 'EXISTING', revision: '5', aliases: ['ALIAS'] };

function fixture() {
  const projectId = id(1), who = { userId: id(5), loginId: id(6), loginExpiresAt: Date.now() + 60000 };
  const current = { traceId, modelVersionId: id(7), aggregateId: id(8), projectionSha256: 'b'.repeat(64),
    captureFrameId: id(9), selectionRevision: '17' };
  const state = { names: ['  New ', 'NEW', 'EXISTING', 'ALIAS', 'Assigned', 'Legacy'],
    available: [existing, { ...existing, key: 'ALIAS' }, unassigned] as (typeof existing | typeof unassigned)[] };
  const query = vi.fn(async (sql: string, _args: unknown[]) => {
    if (sql.includes('automatic-location-assignment:names')) return { rows: state.names.map(name => ({ name })) };
    if (sql.includes('automatic-location-assignment:unassigned')) return { rows: state.available };
    if (sql.includes('automatic-location-assignment:registry')) return { rows: [{ revision: '23' }] };
    throw new Error('Unexpected assignment query');
  });
  const client = { query } as unknown as PoolClient;
  const beforeWrite = vi.fn(async () => {});
  const controller = new AbortController();
  seams.current.mockResolvedValue(current);
  seams.match.mockResolvedValue(new Map<string, Match>([['NEW', ready], ['EXISTING', ready], ['ALIAS', missing]]));
  seams.confirm.mockResolvedValueOnce({ registryRevision: '24' }).mockResolvedValue({ registryRevision: '25' });
  return { projectId, state, query, who, current, controller, beforeWrite,
    run: () => assignAutomaticModelLocationsInTransaction(client, projectId, who, controller.signal, beforeWrite) };
}
beforeEach(() => vi.resetAllMocks());

describe('automatic prepared-model Find and assign From/To', () => {
  it('saves one verified object-derived binding for each unique unbound location, using the scheduler actor', async () => {
    const f = fixture();
    await expect(f.run()).resolves.toBe(2);
    expect(seams.match).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      projectId: f.projectId, current: f.current, signal: f.controller.signal, names: ['EXISTING', 'ALIAS', 'New'],
    });
    const unbound = f.query.mock.calls.find(([sql]) => sql.includes(':unassigned'))!;
    expect(unbound[0]).toContain('NOT EXISTS(SELECT 1 FROM pf_endpoint_binding_heads');
    expect(unbound[0]).toContain('NOT EXISTS(SELECT 1 FROM pf_location_bindings');
    expect(f.query.mock.calls[0][0]).toContain("c.mto IS DISTINCT FROM 'MV'");
    expect(f.beforeWrite).toHaveBeenCalledOnce();
    expect(f.beforeWrite).toHaveBeenCalledBefore(seams.confirm);
    expect(seams.confirm).toHaveBeenNthCalledWith(1, expect.anything(), f.projectId, f.who, existing.id, expect.objectContaining({
      expectedRegistryRevision: '23', expectedLocationRevision: '5', expectedHeadId: null, object, mode: 'object-derived',
      expectedSelectionRevision: '17', location: { name: 'EXISTING', aliases: ['ALIAS'] },
    }), f.controller.signal);
    expect(seams.confirm).toHaveBeenNthCalledWith(2, expect.anything(), f.projectId, f.who, expect.any(String), expect.objectContaining({
      expectedRegistryRevision: '24', expectedLocationRevision: null, expectedHeadId: null,
      location: { name: 'New', aliases: [] }, object,
    }), f.controller.signal);
  });

  it('keeps different objects across aliases, unavailable proofs, missing, and ambiguous matches unresolved', async () => {
    const f = fixture();
    seams.match.mockResolvedValue(new Map<string, Match>([
      ['EXISTING', ready], ['ALIAS', { ...ready, object: { ...object, objectRevisionId: id(55) } }],
      ['NEW', { status: 'ambiguous', object: null }],
    ]));
    await expect(f.run()).resolves.toBe(0);
    seams.match.mockResolvedValue(new Map<string, Match>([['EXISTING', ready], ['ALIAS', { status: 'object-unverified', object: null }], ['NEW', missing]]));
    await expect(f.run()).resolves.toBe(0);
    expect(f.beforeWrite).not.toHaveBeenCalled();
    expect(seams.confirm).not.toHaveBeenCalled();
  });

  it('requires active scheduler write authority and cancellation before assigning', async () => {
    const f = fixture();
    f.beforeWrite.mockRejectedValueOnce(new PathFinderError('AUTOMATIC_ENROLLMENT_REVOKED', 409));
    await expect(f.run()).rejects.toMatchObject({ code: 'AUTOMATIC_ENROLLMENT_REVOKED' });
    f.beforeWrite.mockImplementationOnce(async () => f.controller.abort());
    await expect(f.run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(seams.confirm).not.toHaveBeenCalled();
  });

  it('bounds the work per transaction, advancing to the next generation after successful assignment', async () => {
    const f = fixture();
    f.state.names = Array.from({ length: 70 }, (_, n) => `EQ-${n}`);
    f.state.available = f.state.names.map(key => ({ ...unassigned, key }));
    seams.match.mockResolvedValue(new Map(f.state.names.map(name => [name, ready])));
    await expect(f.run()).resolves.toBe(64);
    expect(f.beforeWrite).toHaveBeenCalledOnce();
    expect(seams.confirm).toHaveBeenCalledTimes(64);
  });
});
