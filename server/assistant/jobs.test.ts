// @vitest-environment node
import { describe, it, vi, expect, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';
import type { EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
const seams = vi.hoisted(() => ({
  current: vi.fn(),
  matches: vi.fn(),
  object: vi.fn(),
  local: vi.fn(),
  heads: vi.fn(),
}));
vi.mock('./localModelEvidence.js', () => ({ assistantLocalModelEvidence: seams.local }));
vi.mock('../db.js', () => ({ pool: {} }));
vi.mock('../services/objectStorageService.js', () => ({
  getObjectStream: vi.fn(),
  getProjectBucket: vi.fn(),
}));
vi.mock('../pathfinder/endpointBindingRepository.js', () => ({
  readCurrentEndpointBindingContext: seams.current,
  objectEvidence: seams.object,
  readNeededEndpointBindingHeads: seams.heads,
  endpointBindingHash: JSON.stringify,
}));
vi.mock('../pathfinder/automaticEndpointCandidates.js', () => ({
  readPreparedNamedEndpointMatches: seams.matches,
}));
import { resolveFindings } from './jobs.js';
const scope = { modelVersionId: 'active' } as EndpointCurrentScope;
const base = {
  file: 'drawing.pdf',
  sourceIndex: 0,
  page: 3,
  evidence: 'Switch on valve V1',
  tag: 'ZS1',
  target: 'V1',
  branch: 'Utilities',
  property: 'Tag',
  review: false,
};
describe('document and 3D review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seams.current.mockResolvedValue(scope);
    seams.matches.mockResolvedValue(
      new Map([['V1', { status: 'automatic-ready', object: { traceId: 'trace' } }]]),
    );
    seams.object.mockResolvedValue({
      historicalModel: {
        leafToRootNames: ['Utilities'],
        properties: [{ name: 'Tag', value: 'V1' }],
      },
      geometry: { equipmentAnchor: { pointMetres: [1, 2, 3] } },
      identity: { dbId: 42 },
    });
  });
  it('qualifies the visible instrument from a positive cited repeated-unit pair but never substitutes the rack', async () => {
    const item = {
      ...base,
      tag: '=H2=HA1=BTA2',
      target: '=H2=UBA5',
      branch: '',
      property: '',
      review: true,
      evidence:
        'Стр. 17: =H1=HA1=BTA2 на =H1=UBA5; бележката указва смяна на =H1 на =H2. Видимостта в модела не е установена.',
    };
    seams.local.mockResolvedValue({ dbId: 31, rackDbId: 34, point: [1, 2, 3] });
    const missing = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rowCount: 1 }),
    } as unknown as PoolClient;
    expect((await resolveFindings(missing, 'project', scope, [item], 'job'))[0]).toMatchObject({
      dbId: 31,
      ref: null,
      point: [1, 2, 3],
    });
    const present = {
      query: vi
        .fn()
        .mockResolvedValue({ rows: [{ id: 'previous', assigned: true, head_id: 'head' }] }),
    } as unknown as PoolClient;
    seams.heads.mockResolvedValue(
      new Map([['previous', { ready: true, binding: { autoMatchEvidence: { sdkObjectId: 28 } } }]]),
    );
    expect((await resolveFindings(present, 'project', scope, [item], 'job'))[0]).toMatchObject({
      reason: 'Existing assignment preserved',
      locationId: null,
      localModel: { dbId: 31 },
      existingModelObjectId: 28,
    });
    seams.heads.mockResolvedValue(
      new Map([
        [
          'previous',
          {
            ready: true,
            binding: { id: 'head', status: 'confirmed', autoMatchEvidence: { sdkObjectId: 28 } },
          },
        ],
      ]),
    );
    expect(
      (await resolveFindings(present, 'project', scope, [item], 'job', true))[0],
    ).toMatchObject({
      locationId: 'previous',
      replaceHeadId: 'head',
      dbId: 31,
      existingModelObjectId: 28,
    });
    seams.heads.mockResolvedValue(
      new Map([
        [
          'previous',
          {
            ready: true,
            binding: { id: 'head', status: 'confirmed', autoMatchEvidence: { sdkObjectId: 31 } },
          },
        ],
      ]),
    );
    expect(
      (await resolveFindings(present, 'project', scope, [item], 'job', true))[0],
    ).toMatchObject({ reason: 'Existing assignment preserved', locationId: null });
    seams.local.mockClear();
    const unsupported = {
      ...item,
      evidence: item.evidence.replace('смяна на =H1 на =H2', 'смяна на =H1 на =H3'),
    };
    expect(
      (await resolveFindings(client(), 'project', scope, [unsupported], 'job'))[0].locationId,
    ).toBeNull();
    expect(seams.local).toHaveBeenCalled();
  });
  function client(assigned = false) {
    return {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'location', name: 'ZS1', aliases: [], revision: '1', assigned }],
      }),
    } as unknown as PoolClient;
  }
  it('qualifies a documented parent inside the selected branch and property', async () => {
    const [p] = await resolveFindings(client(), 'project', scope, [base]);
    expect(p).toMatchObject({
      tag: 'ZS1',
      target: 'V1',
      page: 3,
      dbId: 42,
      point: [1, 2, 3],
      locationId: 'location',
    });
    expect(seams.matches.mock.lastCall?.[1].filter).toMatchObject({
      branch: 'Utilities',
      property: 'Tag',
    });
  });
  it('leaves conflicting sources, ambiguous equipment and existing assignments untouched', async () => {
    const [conflict] = await resolveFindings(client(), 'project', scope, [
      base,
      { ...base, target: 'V2' },
    ]);
    expect(conflict.ref).toBeNull();
    seams.matches.mockResolvedValue(
      new Map([['V1', { status: 'ambiguous', candidateIds: ['a', 'b'] }]]),
    );
    expect((await resolveFindings(client(), 'project', scope, [base]))[0]).toMatchObject({
      ref: null,
      candidates: ['a', 'b'],
    });
    expect((await resolveFindings(client(true), 'project', scope, [base]))[0].reason).toContain(
      'preserved',
    );
  });
  it('rejects stale models and excludes objects outside task criteria', async () => {
    expect(
      (await resolveFindings(client(), 'project', scope, [{ ...base, branch: 'Other plant' }]))[0]
        .ref,
    ).toBeNull();
    seams.current.mockResolvedValue(null);
    await expect(resolveFindings(client(), 'project', scope, [base])).rejects.toThrow(
      'Model revision changed',
    );
  });
});
