// @vitest-environment node
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadOverlaySegment } from '../../shared/pathfinderCadOverlay.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { encodeCadOverlay } from '../pathfinder/cadOverlay.js';
import { cadRouteRevisionPublicationRouter, reviewCadRouteCables } from './routeRevisionPublication.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), groupInputs: vi.fn(), networkOptions: vi.fn(), segments: vi.fn(),
  promote: vi.fn(), executePreparation: vi.fn(), readExport: vi.fn(),
  requireScope: vi.fn(), markDirty: vi.fn(), recordChanges: vi.fn(),
}));
vi.mock('../middleware.js', () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('./routePublication.js', () => ({
  groupInputs: mocks.groupInputs,
  networkOptions: mocks.networkOptions,
  cadRouteSegments: mocks.segments,
  publicationTransaction: (_req: unknown, work: (client: unknown) => unknown) => work({ query: mocks.query }),
  PublicationError: class extends Error {
    readonly status = 409;
    constructor(readonly code: string, message: string) { super(message); }
  },
}));
vi.mock('./routeRevisionDraft.js', () => ({
  assertCadRouteRevisionHasNoExternalMates: vi.fn(),
  CadRouteRevisionError: class extends Error {},
  promoteCadRouteRevisionMembers: mocks.promote,
}));
vi.mock('./routeTrayExports.js', () => ({
  cadTrayProjection: (row: unknown) => row,
  deriveCadTrayExport: () => ({
    fields: { trayType: 'KL 60.303', widthMm: 300, heightMm: 60, lengthMm: 2000 },
    source: { centreline: 'revised' }, sourceSha256: 'b'.repeat(64), centerlineSha256: 'c'.repeat(64), elementCount: 1,
  }),
  readCadTrayExport: mocks.readExport,
}));
vi.mock('../pathfinder/runtime.js', () => ({
  getPathFinderRuntime: () => ({ worker: { executePreparation: mocks.executePreparation } }),
}));
vi.mock('../pathfinder/routingScope.js', () => ({ requirePreparedRoutingScope: mocks.requireScope }));
vi.mock('../pathfinder/recalculationSchema.js', () => ({ markRecalculationDirty: mocks.markDirty }));
vi.mock('../services/trayChangeLogService.js', () => ({ recordTrayChanges: mocks.recordChanges }));

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const projectId = id(1), designId = id(2), parentId = id(3), draftId = id(4), trayId = id(5);
const modelVersionId = id(6), artifactId = id(7), userId = id(8);
const affected = { id: id(9), tag: 'CW001', routing: '/BC059-1/BC060' };
const port: CadOverlaySegment['ports'][number] = {
  pointMetres: [0, 0, 0], outward: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], widthMetres: 0.3, heightMetres: 0.06,
};
const previous: CadOverlaySegment = {
  id: `cad:${parentId}`, name: '/BC059-1', allowedCategoryMask: 7, pointsMetres: [[0, 0, 0], [1, 0, 0]],
  ports: [port, { ...port, pointMetres: [1, 0, 0], outward: [1, 0, 0] }],
};
const revised: CadOverlaySegment = {
  ...previous, pointsMetres: [[0, 0, 0], [2, 0, 0]],
  ports: [port, { ...previous.ports[1], pointMetres: [2, 0, 0] }],
};
const overlay = {
  schemaVersion: 'wfc.pf.cad-overlay-payload.v3', projectId, modelVersionId,
  baseSnapshotSha256: 'a'.repeat(64), segments: [previous],
};
const tray = { id: trayId, name: 'BC059-1', purpose: 'Control', tray_type: 'KL 60.303', width_mm: '300', height_mm: '60', length_mm: '1000' };
const parent = {
  id: parentId, name: 'BC059-1', tag: 'BC059-1', purpose: 'Control', status: 'published', revision: 3,
  project_tray_id: trayId, publication: { baseArtifactId: artifactId, overlay, trayInBaseCatalog: true },
};
const draft = { id: draftId, revision: 2, status: 'draft', revision_of_route_id: parentId, revision_base_number: 3 };

let base: string;
let stop: () => void;
let cables: typeof affected[];
beforeEach(async () => {
  vi.resetAllMocks();
  cables = [affected];
  mocks.groupInputs.mockImplementation((_client, _project, _design, routeId) => routeId === parentId
    ? { group: parent } : { group: draft, chain: {}, instances: [], transitions: [] });
  mocks.segments.mockReturnValue([revised]);
  mocks.networkOptions.mockResolvedValue({
    artifact: { id: artifactId, snapshot_sha256: overlay.baseSnapshotSha256 },
    routing: { cadOverlay: encodeCadOverlay(overlay) }, segmentCount: 4,
  });
  mocks.readExport.mockResolvedValue({ row: tray });
  mocks.executePreparation.mockResolvedValue({ status: 'prepared', prepared: { segmentCount: 5 } });
  mocks.query.mockImplementation((sql: string) => {
    if (sql.startsWith('SELECT model_version_id')) return { rows: [{ model_version_id: modelVersionId }] };
    if (sql.includes('FROM cables c')) return { rows: cables };
    if (sql.startsWith('UPDATE trays')) return { rows: [{ ...tray, length_mm: '2000' }] };
    return { rows: [] };
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = userId; next(); });
  app.use('/projects/:projectId/cad', cadRouteRevisionPublicationRouter);
  const server = app.listen(0, '127.0.0.1');
  stop = () => server.close();
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/projects/${projectId}/cad/designs/${designId}/routes/${draftId}/revision`;
});
afterEach(() => stop());

const post = (path: string, body: unknown) => fetch(`${base}/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const preview = async () => (await post('preview', { expectedRevision: 2 })).json();

describe('published CAD route revisions', () => {
  it('reviews the exact saved route tag before any publication writes', async () => {
    const result = await preview();
    expect(result).toMatchObject({
      reviewToken: expect.stringMatching(/^[a-f0-9]{64}$/), cables: [{ id: affected.id, tag: affected.tag, needsRecalculation: true }],
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE btrim(part.value)=$2'), [projectId, 'BC059-1']);
    expect(mocks.query.mock.calls.some(([sql]) => /^UPDATE|^INSERT/.test(sql))).toBe(false);
    expect(mocks.promote).not.toHaveBeenCalled();
  });

  it('requires a new review when saved routing changes while the worker verifies the replacement', async () => {
    const { reviewToken } = await preview();
    mocks.executePreparation.mockImplementationOnce(() => {
      cables = [];
      return { status: 'prepared', prepared: { segmentCount: 5 } };
    });
    const response = await post('publish', { expectedRevision: 2, reviewToken });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CAD_ROUTE_REVISION_REVIEW_CHANGED' });
    expect(mocks.promote).not.toHaveBeenCalled();
  });

  it('keeps the original publication when network verification fails', async () => {
    const { reviewToken } = await preview();
    mocks.executePreparation.mockResolvedValueOnce({ status: 'prepared', prepared: { segmentCount: 6 } });
    const response = await post('publish', { expectedRevision: 2, reviewToken });
    expect(response.status).toBe(409);
    expect(mocks.promote).not.toHaveBeenCalled();
  });

  it('verifies the replacement overlay and keeps the route and tray IDs', async () => {
    const { reviewToken } = await preview();
    const response = await post('publish', { expectedRevision: 2, reviewToken });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: parentId, projectTrayId: trayId, revision: 4 });
    const request = mocks.executePreparation.mock.calls[0][0];
    expect(JSON.parse(Buffer.from(request.cadOverlay.payloadBase64, 'base64').toString('utf8')).segments).toEqual([revised]);
    expect(mocks.promote).toHaveBeenCalledWith(expect.anything(), projectId, designId, parentId, draftId);
    expect(mocks.requireScope).toHaveBeenCalledWith(expect.anything(), projectId, artifactId);
    expect(mocks.markDirty).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ projectId, domain: 'geometry' }));
  });

  it('returns a domain failure if final catalog validation fails', async () => {
    const { reviewToken } = await preview();
    mocks.requireScope.mockRejectedValueOnce(new PathFinderError('CAD_ROUTE_CATALOG_CHANGED', 409));
    const response = await post('publish', { expectedRevision: 2, reviewToken });
    expect(response.status).toBe(409);
    expect(mocks.markDirty).not.toHaveBeenCalled();
  });

  it('preserves the routing status when the published geometry is identical', () => {
    const reordered = { ...previous, id: `cad:${draftId}`,
      pointsMetres: [...previous.pointsMetres].reverse(), ports: [...previous.ports].reverse() };
    expect(reviewCadRouteCables([affected], [previous], [reordered])).toMatchObject([{ needsRecalculation: false }]);
    expect(reviewCadRouteCables([affected], [previous], [revised])).toMatchObject([{ needsRecalculation: true }]);
  });

  it('identifies affected protected and locked cable routes for manual review', () => {
    expect(reviewCadRouteCables([
      { ...affected, manual_protected: true },
      { ...affected, execution_locked: true },
    ], [previous], [revised])).toMatchObject([
      { needsRecalculation: true, reason: expect.stringContaining('protected') },
      { needsRecalculation: true, reason: expect.stringContaining('locked') },
    ]);
  });
});
