// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRAIGHT_SOURCE_SHA256, getInstanceCadPorts } from '../../shared/cadLengths.js';
import {
  composeTransform,
  connectorAlignmentIsValid,
  rotateVector,
} from '../../shared/cadTransforms.js';
import { MATE_OPPOSING_FACE } from '../../shared/cadPocPorts.js';
import { geometryObjectRevisionSchema } from '../../shared/pathfinderGeometryTrace.js';
import { buildGeometryTrace } from '../pathfinder/geometryTraceBuilder.js';
import { geometryTraceFixture } from '../pathfinder/geometryTraceFixtures.js';
import type { PublicationInstance } from './routePublication.js';
import {
  cadNetworkPortTransform,
  computeCadRouteAlignment,
  cadRouteAlignmentRouter,
} from './routeAlignment.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  admin: vi.fn(),
  release: vi.fn(),
  artifact: vi.fn(),
  prepared: vi.fn(),
}));
vi.mock('../db.js', () => ({ pool: { query: mocks.admin, connect: mocks.connect } }));
vi.mock('../config.js', () => ({ config: { jwtSecret: 'test-only', bcryptRounds: 4 } }));
vi.mock('../pathfinder/repository.js', () => ({ latestArtifact: mocks.artifact }));
vi.mock('../pathfinder/routingScope.js', () => ({ requirePreparedRoutingScope: mocks.prepared }));
vi.mock('../services/trayChangeLogService.js', () => ({ recordTrayChanges: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1),
  designId = id(2),
  groupId = id(3),
  actorId = id(4),
  loginId = id(5),
  modelId = id(6);
const expiry = Date.now() + 3600000;
const first: PublicationInstance = {
  id: id(10),
  catalog_item_id: id(11),
  material_asset_id: id(12),
  revision: 2,
  part_number: 'KL 60.303 F',
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
const second = { ...first, id: id(13), revision: 5, z_mm: 1500, cut_length_mm: 1000 };
const members = [first, second];
const target = {
  pointMetres: [5, 6, 7] as [number, number, number],
  outward: [1, 0, 0] as [number, number, number],
  u: [0, 0, -1] as [number, number, number],
  v: [0, 1, 0] as [number, number, number],
  widthMetres: 0.3,
  heightMetres: 0.06,
};
const retained = buildGeometryTrace(geometryTraceFixture()).records[0];
const record = geometryObjectRevisionSchema.parse({
  ...retained,
  id: id(20),
  projectId,
  modelVersionId: modelId,
  geometry: { ...retained.geometry, fitted: { ...retained.geometry.fitted!, ports: [target] } },
});
const connection = {
  id: id(21),
  source_instance_id: first.id,
  source_catalog_item_id: first.catalog_item_id,
  source_port_id: id(22),
  target_instance_id: second.id,
  target_catalog_item_id: second.catalog_item_id,
  target_port_id: id(23),
  created_at: '2026-11-11T00:00:00.000Z',
};
const attachment = {
  instanceId: first.id,
  portName: 'start',
  targetObjectRevisionId: record.id,
  targetPortIndex: 0,
};
const body = { expectedRevision: 7, attachment };
const transform = (row: PublicationInstance) => ({
  position: { x: row.x_mm, y: row.y_mm, z: row.z_mm },
  rotation: { x: row.qx, y: row.qy, z: row.qz, w: row.qw },
});
const localPorts = getInstanceCadPorts(
  first.original_filename,
  first.source_sha256,
  first.cut_length_mm,
);

describe('whole-route rigid alignment geometry', () => {
  it('applies a quarter turn and translation while preserving distances, internal mating and source pins', () => {
    const before = structuredClone(members);
    const moved = computeCadRouteAlignment(
      members,
      { instanceId: first.id, portName: 'start' },
      target,
    );
    expect(members).toEqual(before);
    expect(moved[0].transform.position.x).toBeCloseTo(5000);
    expect(moved[0].transform.position.y).toBeCloseTo(5970);
    expect(moved[0].transform.position.z).toBeCloseTo(7000);
    expect(moved[1].transform.position.x).toBeCloseTo(6500);
    expect(moved[1].transform.position.y).toBeCloseTo(5970);
    expect(moved[1].transform.position.z).toBeCloseTo(7000);
    expect(
      Math.hypot(
        ...['x', 'y', 'z'].map(
          (axis) =>
            moved[1].transform.position[axis as 'x' | 'y' | 'z'] -
            moved[0].transform.position[axis as 'x' | 'y' | 'z'],
        ),
      ),
    ).toBeCloseTo(1500);
    expect(
      connectorAlignmentIsValid(
        moved[0].transform,
        localPorts[0].local,
        cadNetworkPortTransform(target),
        { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        MATE_OPPOSING_FACE,
      ),
    ).toBe(true);
    const secondStart = getInstanceCadPorts(
      second.original_filename,
      second.source_sha256,
      second.cut_length_mm,
    )[0];
    expect(
      connectorAlignmentIsValid(
        moved[0].transform,
        localPorts[1].local,
        moved[1].transform,
        secondStart.local,
        MATE_OPPOSING_FACE,
      ),
    ).toBe(true);
    expect(moved.map((row) => row.revision)).toEqual([2, 5]);
  });
  it.each([
    { ...target, u: [0, 0, 1] as [number, number, number] },
    { ...target, u: [0, 0, -2] as [number, number, number] },
    { ...target, widthMetres: 0.6 },
    { ...target, pointMetres: [NaN, 0, 0] as [number, number, number] },
  ])('refuses mirrored, scaled, incompatible or nonfinite target frames', (port) => {
    expect(() =>
      computeCadRouteAlignment(members, { instanceId: first.id, portName: 'start' }, port),
    ).toThrow();
  });
  it.each([
    {
      ...target,
      u: [1, 0, 0] as [number, number, number],
      v: [0, -1, 0] as [number, number, number],
      outward: [0, 0, -1] as [number, number, number],
    },
    {
      ...target,
      u: [-1, 0, 0] as [number, number, number],
      v: [0, 1, 0] as [number, number, number],
      outward: [0, 0, -1] as [number, number, number],
    },
    {
      ...target,
      u: [-1, 0, 0] as [number, number, number],
      v: [0, -1, 0] as [number, number, number],
      outward: [0, 0, 1] as [number, number, number],
    },
  ])('handles half turns around each axis without a singular quaternion', (port) => {
    const frame = cadNetworkPortTransform(port);
    const u = rotateVector({ x: 1, y: 0, z: 0 }, frame.rotation);
    const v = rotateVector({ x: 0, y: 1, z: 0 }, frame.rotation);
    const n = rotateVector({ x: 0, y: 0, z: 1 }, frame.rotation);
    expect([u.x, u.y, u.z]).toEqual(port.u);
    expect([v.x, v.y, v.z]).toEqual(port.v);
    expect([n.x, n.y, n.z]).toEqual(port.outward);
  });
  it('aligns a rotated component end rather than assuming the local start or zero orientation', () => {
    const rotated = {
      ...first,
      x_mm: 1000,
      y_mm: 2000,
      z_mm: 3000,
      qx: Math.SQRT1_2,
      qw: Math.SQRT1_2,
    };
    const [moved] = computeCadRouteAlignment(
      [rotated],
      { instanceId: first.id, portName: 'end' },
      target,
    );
    const end = composeTransform(moved.transform, localPorts[1].local);
    expect(end.position.x).toBeCloseTo(5000);
    expect(end.position.y).toBeCloseTo(6000);
    expect(end.position.z).toBeCloseTo(7000);
  });
});

type State = {
  members: PublicationInstance[];
  links: (typeof connection)[];
  group: {
    id: string;
    name: string;
    tag: string;
    purpose: string;
    status: string;
    revision: number;
    project_tray_id: null;
    publication: null;
  };
};
let state: State, snapshot: State | null, failRestore: boolean, failUpdate: boolean, admin: boolean;
let server: Server | undefined;
const original = (): State => ({
  members: structuredClone(members),
  links: [structuredClone(connection)],
  group: {
    id: groupId,
    name: 'Riser',
    tag: 'R-01',
    purpose: 'Control',
    status: 'draft',
    revision: 7,
    project_tray_id: null,
    publication: null,
  },
});
const mutations = () =>
  mocks.query.mock.calls.filter(([text]) =>
    /^(DELETE|UPDATE|INSERT INTO cad_design_connections)/.test(text),
  );
beforeEach(() => {
  vi.resetAllMocks();
  state = original();
  snapshot = null;
  failRestore = false;
  failUpdate = false;
  admin = true;
  mocks.admin.mockImplementation(async () => ({ rows: [{ is_admin: admin }] }));
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.artifact.mockResolvedValue({ id: id(30), snapshot_sha256: 'a'.repeat(64) });
  mocks.prepared.mockResolvedValue({
    catalogRevision: '1',
    routingContentSha256: 'b'.repeat(64),
    routingPolicyRevision: '1',
    routingPolicySha256: 'c'.repeat(64),
  });
  mocks.query.mockImplementation(async (text: string, values: unknown[] = []) => {
    if (text === 'BEGIN') snapshot = structuredClone(state);
    if (text === 'COMMIT') snapshot = null;
    if (text === 'ROLLBACK' && snapshot) {
      state = snapshot;
      snapshot = null;
    }
    if (text.startsWith('SELECT id FROM projects'))
      return { rows: values[0] === projectId ? [{ id: projectId }] : [] };
    if (text.startsWith('SELECT is_admin')) return { rows: [{ is_admin: true }] };
    if (text.startsWith('SELECT user_id,expires_at'))
      return { rows: [{ user_id: actorId, expires_at: new Date(expiry), revoked_at: null }] };
    if (text.startsWith('SELECT d.id'))
      return { rows: values[1] === designId ? [{ id: designId }] : [] };
    if (text.startsWith('SELECT * FROM cad_route_groups'))
      return { rows: values[2] === groupId ? [structuredClone(state.group)] : [] };
    if (text.startsWith('SELECT i.*,c.original_filename'))
      return { rows: structuredClone(state.members) };
    if (text.startsWith('SELECT cc.source_instance_id'))
      return {
        rows: state.links.map((link) => ({
          source_instance_id: link.source_instance_id,
          target_instance_id: link.target_instance_id,
          source_name: 'end',
          target_name: 'start',
        })),
      };
    if (text.startsWith('SELECT model_version_id'))
      return { rows: [{ model_version_id: modelId }] };
    if (text.startsWith('SELECT o.record')) return { rows: [{ record }] };
    if (text.startsWith('SELECT * FROM cad_design_connections'))
      return { rows: structuredClone(state.links) };
    if (text.startsWith('DELETE FROM cad_design_connections')) {
      const rows = state.links.map((link) => ({ id: link.id }));
      state.links = [];
      return { rows };
    }
    if (text.startsWith('UPDATE cad_design_instances')) {
      // Mimic the existing connected-component guard: links must be removed first.
      if (state.links.length) throw new Error('Connected instances cannot move');
      if (failUpdate) return { rows: [] };
      const row = state.members.find(
        (member) => member.id === values[2] && member.revision === values[3],
      );
      if (!row) return { rows: [] };
      Object.assign(row, {
        x_mm: values[4],
        y_mm: values[5],
        z_mm: values[6],
        qx: values[7],
        qy: values[8],
        qz: values[9],
        qw: values[10],
        revision: row.revision + 1,
      });
      return { rows: [{ id: row.id }] };
    }
    if (text.startsWith('INSERT INTO cad_design_connections')) {
      if (failRestore) throw new Error('Injected restore failure');
      state.links.push({
        id: String(values[0]),
        source_instance_id: String(values[3]),
        source_catalog_item_id: String(values[4]),
        source_port_id: String(values[5]),
        target_instance_id: String(values[6]),
        target_catalog_item_id: String(values[7]),
        target_port_id: String(values[8]),
        created_at: String(values[9]),
      });
    }
    if (text.startsWith('UPDATE cad_route_groups')) {
      state.group.revision++;
      return { rows: [{ id: groupId, revision: state.group.revision }] };
    }
    return { rows: [] };
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
  app.use('/projects/:projectId/cad', cadRouteAlignmentRouter);
  app.use(
    (_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(500).json({ code: 'UNHANDLED_TEST_FAILURE' }),
  );
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return `http://127.0.0.1:${address.port}/projects/${projectId}/cad/designs/${designId}/routes/${groupId}/align`;
}
const post = (base: string, payload: unknown = body, login = true) =>
  fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(login ? { 'x-test-login': 'yes' } : {}) },
    body: JSON.stringify(payload),
  });

describe('whole-route alignment HTTP transaction', () => {
  it('preserves connection identities, pins and lengths while moving every scoped member in one commit', async () => {
    const response = await post(await start());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: groupId, revision: 8, status: 'draft' });
    expect(state.links).toEqual([connection]);
    expect(state.group.revision).toBe(8);
    expect(state.members.map((row) => row.revision)).toEqual([3, 6]);
    state.members.forEach((row, index) =>
      expect(row).toMatchObject({
        catalog_item_id: members[index].catalog_item_id,
        material_asset_id: members[index].material_asset_id,
        source_sha256: members[index].source_sha256,
        cut_length_mm: members[index].cut_length_mm,
      }),
    );
    expect(state.members[0].x_mm).toBeCloseTo(5000);
    expect(state.members[1].x_mm).toBeCloseTo(6500);
    const calls = mocks.query.mock.calls;
    const deletion = calls.findIndex(([text]) =>
      text.startsWith('DELETE FROM cad_design_connections'),
    );
    const updates = calls
      .map(([text], index) => (text.startsWith('UPDATE cad_design_instances') ? index : -1))
      .filter((index) => index >= 0);
    const restored = calls.findIndex(([text]) =>
      text.startsWith('INSERT INTO cad_design_connections'),
    );
    expect(updates).toHaveLength(2);
    expect(deletion).toBeLessThan(updates[0]);
    expect(restored).toBeGreaterThan(updates[1]);
    expect(
      calls.find(([text]) => text.startsWith('SELECT * FROM cad_design_connections'))?.[0],
    ).toContain('FOR UPDATE');
    expect(calls[deletion][1]).toEqual([projectId, designId, [connection.id]]);
    for (const index of updates) {
      expect(calls[index][0]).toContain('WHERE project_id=$1 AND design_id=$2');
      expect(calls[index][1].slice(0, 2)).toEqual([projectId, designId]);
    }
    expect(calls[restored][1]).toEqual([
      connection.id,
      projectId,
      designId,
      connection.source_instance_id,
      connection.source_catalog_item_id,
      connection.source_port_id,
      connection.target_instance_id,
      connection.target_catalog_item_id,
      connection.target_port_id,
      connection.created_at,
    ]);
    expect(calls.at(-1)?.[0]).toBe('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it.each(['update', 'restore'])(
    'rolls back %s failure and restores every original link, transform and revision',
    async (phase) => {
      failUpdate = phase === 'update';
      failRestore = phase === 'restore';
      const response = await post(await start());
      expect(response.status).toBe(phase === 'update' ? 409 : 500);
      expect(state).toEqual(original());
      expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
      expect(mocks.release).toHaveBeenCalledOnce();
    },
  );
  it.each(['stale', 'published'])(
    'rejects a %s group before changing its geometry or links',
    async (kind) => {
      if (kind === 'published') state.group.status = 'published';
      const before = structuredClone(state);
      const response = await post(await start(), {
        ...body,
        expectedRevision: kind === 'stale' ? 6 : 7,
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: kind === 'stale' ? 'STALE_CAD_ROUTE' : 'CAD_ROUTE_PUBLISHED',
      });
      expect(mutations()).toHaveLength(0);
      expect(state).toEqual(before);
    },
  );
  it('requires administrator access and rejects untrusted geometry in the strict body', async () => {
    const base = await start();
    expect((await post(base, body, false)).status).toBe(401);
    admin = false;
    expect((await post(base)).status).toBe(403);
    admin = true;
    expect((await post(base, { ...body, transform: transform(first) })).status).toBe(400);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(state).toEqual(original());
  });
  it('refuses another project or design without updating any of their instances', async () => {
    const base = await start();
    expect((await post(base.replace(projectId, id(99)))).status).toBe(404);
    expect((await post(base.replace(designId, id(98)))).status).toBe(409);
    expect(mutations()).toHaveLength(0);
    expect(state).toEqual(original());
  });
  it('refuses an internal port or a chain connected outside its group', async () => {
    const base = await start();
    const response = await post(base, { ...body, attachment: { ...attachment, portName: 'end' } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CAD_ROUTE_ATTACHMENT_STALE' });
    state.links[0].target_instance_id = id(99);
    const outside = await post(base);
    expect(outside.status).toBe(409);
    expect(await outside.json()).toMatchObject({ code: 'CAD_ROUTE_CROSS_GROUP_CONNECTION' });
    expect(mutations()).toHaveLength(0);
  });
});
