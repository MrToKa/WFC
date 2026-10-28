import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRoutingPurposePolicy, fetchRoutingPurposeHistory, saveRoutingPurposePolicy } from './pathfinderPolicies';
const id = '11111111-1111-1111-1111-111111111111';
afterEach(() => vi.unstubAllGlobals());
describe('strict routing policy transport', () => {
  it('reads the exact project Cable types purposes and independent Power and VFD permissions', async () => {
    const policy = { schemaVersion: 'pathfinder.routing-purpose-policy.v1', projectId: id, catalogRevision: '1', routingPolicyRevision: '4',
      cablePurposes: ['Control', 'Grounding', 'MV', 'Power', 'VFD'], cablePurposesSha256: 'a'.repeat(64),
      rules: [{ purposeKey: 'VFD trays', allowedCategories: ['VFD'] }, { purposeKey: 'Power trays', allowedCategories: ['Power'] }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(policy))));
    await expect(fetchRoutingPurposePolicy(id, 'login')).resolves.toEqual(policy);
  });
  it('rejects noncanonical project ids and history revisions before fetching', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(fetchRoutingPurposePolicy(id + '\n', 'login')).rejects.toThrow();
    await expect(fetchRoutingPurposeHistory(id, 'login', '1\n')).rejects.toThrow();
    await expect(fetchRoutingPurposeHistory(id, 'login', '9223372036854775808')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects escaped duplicate JSON members in a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"projectId":"a","project\\u0049d":"b"}')));
    await expect(fetchRoutingPurposePolicy(id, 'login')).rejects.toThrow();
  });
  it('uses a fixed endpoint and refuses unknown outgoing members', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(saveRoutingPurposePolicy(id, 'login', { schemaVersion: 'pathfinder.routing-purpose-policy.write.v1', expectedCatalogRevision: '1', expectedRevision: '0', idempotencyKey: id, changes: [{ purposeKey: 'custom', operation: 'reset' }], url: 'https://example.test' } as never)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
