// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPreparationContext,
  fetchPreparationSession,
  createPreparation,
  verifyPreparationSession,
} from './pathfinderPreparation';
import { preparationFixture, preparationIds as ids } from '../test/preparationFixtures';
afterEach(() => vi.unstubAllGlobals());
describe('strict project preparation transport', () => {
  it('verifies frozen plan and part bindings without accepting foreign sessions or altered plan bytes', async () => {
    const { session } = preparationFixture();
    await expect(verifyPreparationSession(session, ids.project, ids.session)).resolves.toEqual(
      session,
    );
    await expect(
      verifyPreparationSession(
        { ...session, plan: { ...session.plan, objectOrder: [2, 1] } },
        ids.project,
      ),
    ).rejects.toThrow();
    await expect(verifyPreparationSession(session, ids.model)).rejects.toThrow();
  });
  it('rejects invalid identities, escaped duplicate JSON and unknown outgoing fields', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"x":1,"\\u0078":2}'));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchPreparationContext(ids.project + '\n', 'login')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(fetchPreparationContext(ids.project, 'login')).rejects.toThrow();
    await expect(
      createPreparation(ids.project, 'login', { unknown: true } as never),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses only fixed paths and refuses mismatched committed coverage', async () => {
    const { session, committed } = preparationFixture();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(session)));
    vi.stubGlobal('fetch', fetch);
    await fetchPreparationSession(ids.project, 'login', ids.session);
    expect(fetch.mock.calls[0][0]).toMatch(
      new RegExp(`/api/projects/${ids.project}/pathfinder/preparations/${ids.session}$`),
    );
    await expect(
      verifyPreparationSession({ ...session, parts: [committed] }, ids.project),
    ).rejects.toThrow();
  });
});
