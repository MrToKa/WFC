// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('../db.js', () => ({
  pool: {
    query: vi.fn(() => {
      throw Error('Runtime SQL forbidden in pure builder test');
    }),
    connect: vi.fn(),
  },
}));
vi.mock('../auth.js', () => ({
  signAccessToken: vi.fn(() => {
    throw Error('Runtime signing forbidden in pure builder test');
  }),
}));
vi.mock('./catalog.js', () => ({ readRoutingCatalog: vi.fn() }));
vi.mock('./purposePolicy.js', () => ({ readRoutingPolicyScope: vi.fn() }));
import { pool } from '../db.js';
import { preparationFixture } from '../../src/test/preparationFixtures.js';
import { buildPreparationPlan } from './preparationPlans.js';
import { preparationCreateSchema } from '../../shared/pathfinderPreparation.js';
import { mergePreparationParts } from '../../shared/preparationMerge.js';
import {
  cleanupPreparationFixture,
  preparationIntegrationDiscovery,
  preparationIntegrationPart,
} from './preparation.integration.js';
describe('private preparation integration fixture builders', () => {
  it('uses real complete synthetic leaves to split connected route segments across two server parts', () => {
    const { context } = preparationFixture();
    context.trays[0] = { ...context.trays[0], rawName: '/R301', routeName: '/R301' };
    context.trays.push({
      ...context.trays[0],
      projectTrayId: '88888888-8888-4888-8888-888888888888',
      rawName: '/R302',
      routeName: '/R302',
    });
    const discovery = preparationIntegrationDiscovery(context);
    const input = preparationCreateSchema.parse({
      schemaVersion: 'wfc.pf.preparation-create.v1',
      expected: context.scope,
      idempotencyKey: '99999999-9999-4999-8999-999999999999',
      discovery,
    });
    const plan = buildPreparationPlan(context, input);
    expect(plan.partPlan).toHaveLength(2);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.partPlan[0].physicalLeafIds).toContain('dbid:10');
    expect(plan.partPlan[1].physicalLeafIds).toContain('dbid:1000');
    expect(plan.partPlan[0].physicalLeafIds).not.toContain('dbid:1000');
    const parts = plan.partPlan.map((part) => ({
      partId: part.partId,
      payload: preparationIntegrationPart(plan, part.partId),
    }));
    const merged = mergePreparationParts(plan, [...parts].reverse());
    expect(
      merged.snapshot.objects.filter((object) => object.geometryRole === 'routing-leaf'),
    ).toHaveLength(513);
    expect(merged.snapshot.capture).not.toHaveProperty('engineeringAccepted');
  });
});

describe('mocked exact-owned cleanup fences', () => {
  for (const kind of ['foreign actor', 'queued job', 'validating preparation'] as const)
    it(`refuses ${kind} before any DELETE`, async () => {
      vi.stubEnv('PF_LOCAL_DEMO', 'true');
      const projectId = '11111111-1111-4111-8111-111111111111',
        actorId = '22222222-2222-4222-8222-222222222222',
        marker = `PF-R3-${projectId}`,
        email = `${actorId}@pf-r3-integration.invalid`;
      const query = vi.fn(async (sql: string) => ({
        rows: sql.startsWith('SELECT project_number')
          ? [{ project_number: marker }]
          : sql.startsWith('SELECT email')
            ? [{ email: kind === 'foreign actor' ? 'foreign@example.invalid' : email }]
            : sql.includes('count(*)')
              ? [
                  {
                    count:
                      (sql.includes('pf_jobs') && kind === 'queued job') ||
                      (sql.includes('pf_preparation_sessions') && kind === 'validating preparation')
                        ? 1
                        : 0,
                  },
                ]
              : [],
      }));
      vi.mocked(pool.query).mockResolvedValue({
        rows: [{ name: 'wfc_pathfinder_local' }],
      } as never);
      vi.mocked(pool.connect).mockResolvedValue({ query, release: vi.fn() } as never);
      await expect(
        cleanupPreparationFixture({ projectId, actorId, marker, email }),
      ).rejects.toThrow();
      expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
      expect(query.mock.calls[2][0]).toContain('FOR NO KEY UPDATE');
      expect(query.mock.calls[3][0]).toContain('FOR UPDATE');
      vi.unstubAllEnvs();
    });
});
