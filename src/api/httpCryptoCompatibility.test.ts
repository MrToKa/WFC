import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRoutingPurposeCatalog } from './pathfinderPolicies';
import { saveEndpointBinding } from './pathfinderEndpointBindings';
import { buildCatalogProof } from '../../server/pathfinder/catalog';
import { canonicalPurposeJson, catalogManifestHashInput, catalogManifestSchema, catalogPageSchema } from '../../shared/pathfinderPurposePolicy';
import { endpointBindingFixture, endpointIds as ids } from '../test/endpointBindingFixtures';

const respond = (value: unknown) => new Response(JSON.stringify(value));
const hash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');

function catalogFixture() {
  // Use the server's real catalog proof and public schemas, independently of the browser digest.
  const { catalog } = buildCatalogProof(ids.project, '1', '0', [{
    id: ids.object, name: '/BC175', purpose: 'Control', tray_type: 'Type C', width_mm: '100', height_mm: '50', length_mm: null,
    include_grounding_cable: false, grounding_cable_type_id: null, use_trefoil_clamps: false, trefoil_clamp_spacing_mm: null,
  }], [], { snapshotId: ids.trace, recordedAt: '2026-10-19T00:00:00Z' });
  const { rows, ...metadata } = catalog;
  const partial = { schemaVersion: 'pathfinder.catalog-manifest.v1' as const, catalog: metadata, pageSize: 1000 as const, pageCount: 1, manifestSha256: '0'.repeat(64) };
  const manifest = catalogManifestSchema.parse({ ...partial, manifestSha256: hash(catalogManifestHashInput(partial)) });
  const page = catalogPageSchema.parse({
    schemaVersion: 'pathfinder.catalog-page.v1', projectId: ids.project, snapshotId: catalog.snapshotId,
    contentSha256: catalog.contentSha256, pageIndex: 0, rowCount: rows.length, rows, complete: true,
  });
  return { catalog, manifest, page };
}

beforeEach(() => {
  // LAN HTTP exposes random values, but neither randomUUID nor SubtleCrypto.
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('API integrity checks on LAN HTTP', () => {
  it('loads the complete routing-purpose catalog without secure-context crypto APIs', async () => {
    const fixture = catalogFixture();
    expect(globalThis.crypto.subtle).toBeUndefined();
    expect(globalThis.crypto.randomUUID).toBeUndefined();
    vi.mocked(fetch).mockResolvedValueOnce(respond(fixture.manifest)).mockResolvedValueOnce(respond(fixture.page));
    await expect(fetchRoutingPurposeCatalog(ids.project, 'token')).resolves.toEqual(fixture.catalog);
    expect(fetch).toHaveBeenNthCalledWith(2,
      expect.stringContaining(`/catalog/${fixture.catalog.snapshotId}/pages/0`),
      expect.objectContaining({ method: 'GET', cache: 'no-store', credentials: 'same-origin' }));
  });

  it('still rejects an altered catalog manifest hash before fetching pages', async () => {
    const fixture = catalogFixture();
    vi.mocked(fetch).mockResolvedValueOnce(respond({ ...fixture.manifest, manifestSha256: '0'.repeat(64) }));
    await expect(fetchRoutingPurposeCatalog(ids.project, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still rejects altered catalog content with otherwise valid manifest and page identities', async () => {
    const fixture = catalogFixture();
    vi.mocked(fetch).mockResolvedValueOnce(respond(fixture.manifest)).mockResolvedValueOnce(respond({
      ...fixture.page, rows: [{ ...fixture.page.rows[0], rawName: '/Changed', nameKey: '/Changed' }],
    }));
    await expect(fetchRoutingPurposeCatalog(ids.project, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('verifies endpoint save receipts and rejects altered binding hashes without SubtleCrypto', async () => {
    const fixture = endpointBindingFixture();
    vi.mocked(fetch).mockResolvedValueOnce(respond(fixture.receipt)).mockResolvedValueOnce(respond({
      ...fixture.receipt, binding: { ...fixture.binding, confirmedAt: '2026-10-20T00:00:00Z' },
    }));
    await expect(saveEndpointBinding(ids.project, 'token', ids.location, fixture.write)).resolves.toEqual(fixture.receipt);
    await expect(saveEndpointBinding(ids.project, 'token', ids.location, fixture.write)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
