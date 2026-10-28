import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPathFinderJob } from './pathfinder';
const id = (n: number) => `1e740000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = { cableId: id(3), status: 'calculated', state: 'complete', message: null };
const job = (update?: unknown) => ({ id: id(2), projectId: id(1), status: 'complete', total: 1, completed: 1, cancelRequested: false,
  failure: null, attempts: 1, createdAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:01Z', items: [{ ...item, ...(update === undefined ? {} : { automaticUpdate: update }) }] });
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());
describe('exact job automatic output transport', () => {
  it('preserves writer refusal separately from calculated routing and makes one GET only', async () => {
    const update = { status: 'refused', receiptId: null, reasonCode: 'PROPOSAL_NOT_APPLICABLE' };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(job(update)));
    expect((await fetchPathFinderJob(id(1), 'token', id(2))).items?.[0]).toEqual({ ...item, automaticUpdate: update });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`/jobs/${id(2)}`), expect.objectContaining({ method: 'GET' }));
  });
  it('accepts historical items without an output disposition', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(job()));
    expect((await fetchPathFinderJob(id(1), 'token', id(2))).items?.[0]).toEqual(item);
  });
  it.each([{ status: 'invented', receiptId: null, reasonCode: null }, { status: 'written', receiptId: null, reasonCode: null },
    { status: 'refused', receiptId: id(8), reasonCode: null }, { status: 'refused', receiptId: null, reasonCode: 'BAD\nREASON' },
    { status: 'refused', receiptId: null, reasonCode: 'A'.repeat(97) }])('rejects malformed output evidence: %j', async update => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(job(update)));
    await expect(fetchPathFinderJob(id(1), 'token', id(2))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
