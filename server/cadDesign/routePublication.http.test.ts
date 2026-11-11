// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRAIGHT_SOURCE_SHA256 } from '../../shared/cadLengths.js';
import { geometryObjectRevisionSchema } from '../../shared/pathfinderGeometryTrace.js';
import { buildGeometryTrace } from '../pathfinder/geometryTraceBuilder.js';
import { geometryTraceFixture } from '../pathfinder/geometryTraceFixtures.js';
import { PathFinderError } from '../pathfinder/errors.js';
import type { RoutingScope } from '../pathfinder/routingScope.js';
import { cadRoutePublicationRouter, type PublicationInstance } from './routePublication.js';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  adminQuery: vi.fn(),
  release: vi.fn(),
  artifact: vi.fn(),
  prepared: vi.fn(),
  policy: vi.fn(),
  audit: vi.fn(),
  execute: vi.fn(),
  timeline: [] as string[],
}));
vi.mock('../db.js', () => ({ pool: { query: mocks.adminQuery, connect: mocks.connect } }));
vi.mock('../config.js', () => ({ config: { jwtSecret: 'test-only', bcryptRounds: 4 } }));
vi.mock('../pathfinder/repository.js', () => ({ latestArtifact: mocks.artifact }));
vi.mock('../pathfinder/routingScope.js', () => ({ requirePreparedRoutingScope: mocks.prepared }));
vi.mock('../pathfinder/purposePolicy.js', () => ({ readRoutingPolicyScope: mocks.policy }));
vi.mock('../services/trayChangeLogService.js', () => ({ recordTrayChanges: mocks.audit }));
vi.mock('../pathfinder/runtime.js', () => ({
  getPathFinderRuntime: () => ({ worker: { executePreparation: mocks.execute } }),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1),
  designId = id(2),
  routeId = id(3),
  actorId = id(4),
  loginId = id(5),
  modelId = id(6),
  artifactId = id(7),
  trayId = id(8);
const expiry = Date.now() + 3600000;
const preparedScope: RoutingScope = {
  catalogRevision: '1',
  routingContentSha256: 'b'.repeat(64),
  routingPolicyRevision: '1',
  routingPolicySha256: 'c'.repeat(64),
};
const instance: PublicationInstance = {
  id: id(10),
  catalog_item_id: id(11),
  material_asset_id: id(12),
  revision: 4,
  part_number: 'KL 60.303 F',
  material_tray_id: id(13),
  material_tray_type: 'KL 60.303 F',
  material_width_mm: 300,
  material_height_mm: 60,
  original_filename: 'NDX_KL_60-303_F_MED_214.step',
  source_sha256: STRAIGHT_SOURCE_SHA256,
  component_kind: 'straight',
  cut_length_mm: 1500,
  x_mm: 0,
  y_mm: 0,
  z_mm: 0,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
};
const draft = {
  id: routeId,
  name: 'Main riser',
  tag: 'CAD-01',
  purpose: 'Control',
  status: 'draft',
  revision: 7,
  project_tray_id: null,
  publication: null,
};
const published = {
  ...draft,
  status: 'published',
  revision: 8,
  project_tray_id: trayId,
  publication: { baseArtifactId: artifactId },
};
const port = {
  pointMetres: [0, 0.03, 0],
  outward: [0, 0, 1],
  u: [1, 0, 0],
  v: [0, 1, 0],
  widthMetres: 0.3,
  heightMetres: 0.06,
};
const retained = buildGeometryTrace(geometryTraceFixture()).records[0];
const record = geometryObjectRevisionSchema.parse({
  ...retained,
  id: id(20),
  projectId,
  modelVersionId: modelId,
  geometry: {
    ...retained.geometry,
    fitted: {
      ...retained.geometry.fitted!,
      pointsMetres: [
        [0, 0.03, -1],
        [0, 0.03, 0],
      ],
      ports: [port],
      geometricLengthMetres: 1,
      geometricLengthRoundTrip: '1',
    },
  },
});
const attachment = {
  instanceId: instance.id,
  portName: 'start',
  targetObjectRevisionId: record.id,
  targetPortIndex: 0,
};
const publishBody = { expectedRevision: 7, attachments: [attachment] };
let currentGroup: typeof draft | typeof published;
let inUse: boolean, admin: boolean, currentAdmin: boolean, revoked: boolean;
let memberCount: number;
let server: Server | undefined;
let client: { query: typeof mocks.query; release: typeof mocks.release };

async function start() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.header('x-test-login') === 'yes') {
      req.userId = actorId;
      req.loginId = loginId;
      req.loginExpiresAt = expiry;
    }
    next();
  });
  app.use('/projects/:projectId/cad', cadRoutePublicationRouter);
  app.use(
    (
      _error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ code: 'UNHANDLED_TEST_FAILURE' });
    },
  );
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  return `http://127.0.0.1:${address.port}/projects/${projectId}/cad/designs/${designId}/routes/${routeId}`;
}
const post = (base: string, action: string, body: unknown, login = true) =>
  fetch(`${base}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(login ? { 'x-test-login': 'yes' } : {}) },
    body: JSON.stringify(body),
  });
const sql = (prefix: string) => mocks.query.mock.calls.find(([text]) => text.startsWith(prefix));
const mutations = () =>
  mocks.query.mock.calls.filter(([text]) =>
    /^(INSERT INTO trays|UPDATE cad_route_groups|DELETE FROM trays)/.test(text),
  );

beforeEach(() => {
  vi.resetAllMocks();
  mocks.timeline.length = 0;
  currentGroup = draft;
  inUse = false;
  admin = true;
  currentAdmin = true;
  revoked = false;
  memberCount = 1;
  client = { query: mocks.query, release: mocks.release };
  mocks.connect.mockResolvedValue(client);
  mocks.adminQuery.mockResolvedValue({ rows: [{ is_admin: true }] });
  mocks.adminQuery.mockImplementation(async () => ({ rows: [{ is_admin: admin }] }));
  mocks.query.mockImplementation(async (text: string, values: unknown[] = []) => {
    mocks.timeline.push(text);
    if (text.startsWith('SELECT id FROM projects')) return { rows: [{ id: projectId }] };
    if (text.startsWith('SELECT is_admin')) return { rows: [{ is_admin: currentAdmin }] };
    if (text.startsWith('SELECT user_id,expires_at'))
      return {
        rows: [
          {
            user_id: actorId,
            expires_at: new Date(expiry),
            revoked_at: revoked ? new Date() : null,
          },
        ],
      };
    if (text.startsWith('SELECT d.id')) return { rows: [{ id: designId }] };
    if (text.startsWith('SELECT * FROM cad_route_groups')) return { rows: [currentGroup] };
    if (text.startsWith('SELECT i.*,c.original_filename')) return { rows: [instance] };
    if (text.startsWith('SELECT COUNT(*)::int AS member_count'))
      return { rows: [{ member_count: memberCount }] };
    if (text.startsWith('SELECT cc.source_instance_id')) return { rows: [] };
    if (text.startsWith('SELECT model_version_id'))
      return { rows: [{ model_version_id: modelId }] };
    if (text.startsWith('SELECT o.record')) return { rows: [{ record }] };
    if (text.startsWith('SELECT r.allowed_categories'))
      return { rows: [{ allowed_categories: ['Control'] }] };
    if (/^SELECT (c\.)?id FROM cables/.test(text)) return { rows: inUse ? [{ id: id(99) }] : [] };
    if (text.startsWith('SELECT id FROM trays')) return { rows: [] };
    if (text.startsWith('INSERT INTO trays'))
      return {
        rows: [
          {
            id: values[0],
            project_id: projectId,
            name: 'CAD-01',
            purpose: 'Control',
            tray_type: instance.part_number,
            width_mm: 300,
            height_mm: 60,
            length_mm: 1500,
          },
        ],
      };
    return { rows: [] };
  });
  mocks.artifact.mockResolvedValue({ id: artifactId, snapshot_sha256: 'a'.repeat(64) });
  mocks.prepared.mockImplementation(async () => {
    mocks.timeline.push('prepared-scope');
    return preparedScope;
  });
  mocks.policy.mockImplementation(async () => {
    mocks.timeline.push('policy-scope');
    return {};
  });
  mocks.audit.mockImplementation(async () => {
    mocks.timeline.push('tray-audit');
  });
  // Synthetic engine boundary: this checks HTTP/transaction behavior, not native
  // engine readiness. The real worker's composite proof is covered separately.
  mocks.execute.mockImplementation(async () => {
    mocks.timeline.push('engine-proof');
    return { status: 'prepared', prepared: { segmentCount: 2 } };
  });
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  }
});

describe('CAD publication HTTP authorization and refusal', () => {
  it.each(['publish', 'attachment-options'])(
    'rejects mixed canonical and legacy members before %s can silently use a subset',
    async (action) => {
      memberCount = 2; // The canonical source join returns one member; another legacy member has no asset link.
      const base = await start();
      const response =
        action === 'publish'
          ? await post(base, action, publishBody)
          : await fetch(`${base}/${action}`, { headers: { 'x-test-login': 'yes' } });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'CAD_ROUTE_UNSUPPORTED_GEOMETRY' });
      expect(sql('SELECT COUNT(*)::int AS member_count')?.[1]).toEqual([
        projectId,
        designId,
        routeId,
      ]);
      expect(sql('SELECT cc.source_instance_id')).toBeUndefined();
      expect(mocks.artifact).not.toHaveBeenCalled();
      expect(mocks.prepared).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mutations()).toEqual([]);
      expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    },
  );
  it('requires real administrator middleware for publish, withdrawal and attachment choices', async () => {
    const base = await start();
    expect((await post(base, 'publish', publishBody, false)).status).toBe(401);
    admin = false;
    expect((await post(base, 'publish', publishBody)).status).toBe(403);
    expect((await post(base, 'withdraw', { expectedRevision: 8 })).status).toBe(403);
    expect(
      (await fetch(`${base}/attachment-options`, { headers: { 'x-test-login': 'yes' } })).status,
    ).toBe(403);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it.each([
    { ...publishBody, force: true },
    { ...publishBody, attachments: [] },
    { ...publishBody, attachments: [{ ...attachment, pointMetres: [0, 0, 0] }] },
  ])('rejects an invalid strict publication body before opening a transaction', async (body) => {
    const response = await post(await start(), 'publish', body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_CAD_ROUTE_PUBLICATION' });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it.each(['admin', 'login'])(
    'rechecks current %s inside the transaction before reading CAD data',
    async (kind) => {
      if (kind === 'admin') currentAdmin = false;
      else revoked = true;
      const response = await post(await start(), 'publish', publishBody);
      expect(response.status).toBe(kind === 'admin' ? 403 : 401);
      expect(await response.json()).toMatchObject({
        code: kind === 'admin' ? 'ADMIN_REQUIRED' : 'LOGIN_REVOKED',
      });
      expect(sql('SELECT * FROM cad_route_groups')).toBeUndefined();
      expect(mutations()).toHaveLength(0);
      expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
      expect(mocks.release).toHaveBeenCalledOnce();
    },
  );
  it('refuses a stale expected revision without publishing or invoking the engine', async () => {
    const response = await post(await start(), 'publish', { ...publishBody, expectedRevision: 6 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'STALE_CAD_ROUTE' });
    expect(mutations()).toHaveLength(0);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('requires a prepared base artifact instead of declaring a standalone CAD route usable', async () => {
    mocks.artifact.mockResolvedValue(null);
    const response = await post(await start(), 'publish', publishBody);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CAD_ROUTE_NETWORK_REQUIRED' });
    expect(mutations()).toHaveLength(0);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.prepared).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('refuses an engine proof that does not include the new composite segment', async () => {
    mocks.execute.mockResolvedValue({ status: 'prepared', prepared: { segmentCount: 1 } });
    const response = await post(await start(), 'publish', publishBody);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CAD_ROUTE_ENGINE_PROOF_REQUIRED' });
    expect(mutations()).toHaveLength(0);
    // Phase one is read-only and commits before the external proof runs.
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});

describe('CAD publication atomic SQL mutations', () => {
  it('pins source revisions and actual material type only after composite proof, then validates scope before commit', async () => {
    const response = await post(await start(), 'publish', publishBody);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      id: routeId,
      status: 'published',
      revision: 8,
      lengthMetres: 1.5,
    });
    const insertion = sql('INSERT INTO trays')!;
    expect(insertion[1]).toEqual([
      result.projectTrayId,
      projectId,
      'CAD-01',
      'Control',
      'KL 60.303 F',
      300,
      60,
      1500,
    ]);
    expect(mocks.audit).toHaveBeenCalledWith(
      client,
      actorId,
      null,
      expect.objectContaining({ id: result.projectTrayId, tray_type: instance.part_number }),
    );
    const update = sql('UPDATE cad_route_groups')!;
    const publication = JSON.parse(update[1][4]);
    expect(update[1].slice(0, 4)).toEqual([projectId, designId, routeId, result.projectTrayId]);
    expect(publication).toMatchObject({
      schemaVersion: 'wfc.cad.route-publication.v1',
      baseArtifactId: artifactId,
      sources: [
        {
          instanceId: instance.id,
          instanceRevision: 4,
          catalogItemId: instance.catalog_item_id,
          assetId: instance.material_asset_id,
          sha256: STRAIGHT_SOURCE_SHA256,
          lengthMm: 1500,
        },
      ],
      attachments: [attachment],
      traySnapshot: { trayType: 'KL 60.303 F', widthMm: 300, heightMm: 60, lengthMm: 1500 },
      overlay: {
        projectId,
        modelVersionId: modelId,
        baseSnapshotSha256: 'a'.repeat(64),
        segments: [
          {
            name: '/CAD-01',
            pointsMetres: [
              [0, 0.03, 0],
              [0, 0.03, 1.5],
            ],
            allowedCategoryMask: 7,
          },
        ],
      },
    });
    const proofRequest = mocks.execute.mock.calls[0][0];
    expect(proofRequest).toMatchObject({
      operation: 'prepare',
      projectId,
      modelVersionId: modelId,
      snapshotId: artifactId,
      snapshotSha256: 'a'.repeat(64),
      timeoutMilliseconds: 120000,
    });
    const overlay = JSON.parse(
      Buffer.from(proofRequest.cadOverlay.payloadBase64, 'base64').toString('utf8'),
    );
    expect(overlay.segments).toEqual(publication.overlay.segments);
    expect(mocks.timeline.indexOf('engine-proof')).toBeLessThan(
      mocks.timeline.indexOf(insertion[0]),
    );
    expect(mocks.timeline.indexOf('tray-audit')).toBeLessThan(mocks.timeline.indexOf(update[0]));
    expect(mocks.timeline.lastIndexOf('prepared-scope')).toBeGreaterThan(
      mocks.timeline.indexOf(update[0]),
    );
    expect(mocks.timeline.at(-1)).toBe('COMMIT');
    expect(mocks.prepared).toHaveBeenCalledTimes(3);
    for (const args of mocks.prepared.mock.calls)
      expect(args).toEqual([client, projectId, artifactId]);
    expect(sql('SELECT d.id')?.[0]).toContain('FOR UPDATE OF d FOR SHARE OF s,v');
    expect(sql('SELECT * FROM cad_route_groups')?.[1]).toEqual([projectId, designId, routeId]);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(mocks.release).toHaveBeenCalledTimes(2);
    const firstCommit = mocks.timeline.indexOf('COMMIT');
    expect(firstCommit).toBeLessThan(mocks.timeline.indexOf('engine-proof'));
    expect(mocks.timeline.lastIndexOf('BEGIN')).toBeGreaterThan(
      mocks.timeline.indexOf('engine-proof'),
    );
  });
  it('rolls back both mutations when the final composite scope validation fails', async () => {
    mocks.prepared
      .mockResolvedValueOnce(preparedScope)
      .mockResolvedValueOnce(preparedScope)
      .mockRejectedValueOnce(new PathFinderError('ROUTING_PREPARATION_REQUIRED', 409));
    const response = await post(await start(), 'publish', publishBody);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'ROUTING_PREPARATION_REQUIRED' });
    expect(sql('INSERT INTO trays')).toBeDefined();
    expect(sql('UPDATE cad_route_groups')).toBeDefined();
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(mocks.query.mock.calls.filter(([text]) => text === 'COMMIT')).toHaveLength(1);
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
  it('refuses changed network inputs between proof and the publishing transaction', async () => {
    mocks.execute.mockImplementation(async () => {
      mocks.prepared.mockResolvedValue({ ...preparedScope, routingPolicyRevision: '2' });
      return { status: 'prepared', prepared: { segmentCount: 2 } };
    });
    const response = await post(await start(), 'publish', publishBody);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CAD_ROUTE_CHANGED_DURING_PROOF' });
    expect(mutations()).toHaveLength(0);
    expect(mocks.query.mock.calls.filter(([text]) => text === 'COMMIT')).toHaveLength(1);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
  it('rechecks administrator authority after the unlocked engine proof and refuses mutation after revocation', async () => {
    mocks.execute.mockImplementation(async () => {
      currentAdmin = false;
      return { status: 'prepared', prepared: { segmentCount: 2 } };
    });
    const response = await post(await start(), 'publish', publishBody);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(mutations()).toHaveLength(0);
    expect(mocks.query.mock.calls.filter(([text]) => text === 'COMMIT')).toHaveLength(1);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('refuses withdrawal while a cable uses the route, preserving the published group and generated tray', async () => {
    currentGroup = published;
    inUse = true;
    const response = await post(await start(), 'withdraw', { expectedRevision: 8 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CAD_ROUTE_IN_USE' });
    expect(sql('SELECT c.id FROM cables')?.[1]).toEqual([projectId, 'CAD-01']);
    expect(mutations()).toHaveLength(0);
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('withdraws safely by restoring draft and deleting only its own generated project tray before commit', async () => {
    currentGroup = published;
    const response = await post(await start(), 'withdraw', { expectedRevision: 8 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: routeId, status: 'draft', revision: 9 });
    const update = sql('UPDATE cad_route_groups')!;
    const deletion = sql('DELETE FROM trays')!;
    expect(update[0]).toContain("status='draft',project_tray_id=NULL");
    expect(update[1]).toEqual([projectId, designId, routeId]);
    expect(deletion).toEqual([
      'DELETE FROM trays WHERE project_id=$1 AND id=$2',
      [projectId, trayId],
    ]);
    expect(mutations()).toHaveLength(2);
    expect(mocks.timeline.indexOf(update[0])).toBeLessThan(mocks.timeline.indexOf(deletion[0]));
    expect(mocks.timeline.indexOf('policy-scope')).toBeGreaterThan(
      mocks.timeline.indexOf(deletion[0]),
    );
    expect(mocks.policy).toHaveBeenCalledWith(client, projectId);
    expect(mocks.timeline.at(-1)).toBe('COMMIT');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
