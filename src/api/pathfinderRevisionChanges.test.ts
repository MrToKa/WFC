import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRevisionComparisonContext,
  fetchRevisionComparison,
  createRevisionComparison,
  fetchRevisionChanges,
  saveRevisionDecision,
  fetchRevisionDecisionHead,
} from './pathfinderRevisionChanges';
import { revisionComparisonFixture, revisionIds as ids } from '@/test/revisionComparisonFixtures';
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
describe('fixed revision comparison API', () => {
  it('reads strict historical choices and comparison pages without model-selection mutations', async () => {
    const f = revisionComparisonFixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(f.context))
      .mockResolvedValueOnce(response(f.manifest))
      .mockResolvedValueOnce(response(f.page));
    await expect(fetchRevisionComparisonContext(ids.project, 'token')).resolves.toEqual(f.context);
    await expect(fetchRevisionComparison(ids.project, 'token', ids.comparison)).resolves.toEqual(
      f.manifest,
    );
    await expect(fetchRevisionChanges(ids.project, 'token', ids.comparison)).resolves.toEqual(
      f.page,
    );
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(
          ([url, init]) => String(url).includes('/revision-comparisons') && init?.method === 'GET',
        ),
    ).toBe(true);
  });
  it('verifies create/decision receipts and authoritative exact-subject head reads', async () => {
    const f = revisionComparisonFixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(f.receipt))
      .mockResolvedValueOnce(response(f.head))
      .mockResolvedValueOnce(response(f.decisionReceipt));
    await expect(createRevisionComparison(ids.project, 'token', f.create)).resolves.toEqual(
      f.receipt,
    );
    await expect(
      fetchRevisionDecisionHead(ids.project, 'token', ids.comparison, {
        kind: 'object-mapping',
        sourceObjectRevisionIds: [ids.sourceObject],
      }),
    ).resolves.toEqual(f.head);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        `decision-head?kind=object-mapping&sourceObjectRevisionIds=${ids.sourceObject}`,
      ),
      expect.anything(),
    );
    await expect(
      saveRevisionDecision(ids.project, 'token', ids.comparison, f.write),
    ).resolves.toEqual(f.decisionReceipt);
  });
  it('refuses duplicate JSON, changed content/identity and unsupported command fields while preserving unknown outcomes', async () => {
    const f = revisionComparisonFixture();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('{"projectId":"a","projectId":"b"}'))
      .mockResolvedValueOnce(response({ ...f.manifest, reason: 'Tampered' }))
      .mockResolvedValueOnce(
        response(
          {
            schemaVersion: 'wfc.pf.revision-comparison-error.v1',
            code: 'COMMIT_UNKNOWN',
            message: 'Retry same command.',
            outcome: 'unknown',
          },
          503,
        ),
      );
    await expect(fetchRevisionComparisonContext(ids.project, 'token')).rejects.toThrow();
    await expect(fetchRevisionComparison(ids.project, 'token', ids.comparison)).rejects.toThrow();
    await expect(createRevisionComparison(ids.project, 'token', f.create)).rejects.toMatchObject({
      outcome: 'unknown',
      status: 503,
    });
    await expect(
      createRevisionComparison(ids.project, 'token', { ...f.create, matrix: [] } as never),
    ).rejects.toMatchObject({ outcome: 'refused' });
    await expect(
      fetchRevisionComparison(ids.project + '\n', 'token', ids.comparison),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
