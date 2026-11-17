// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAalborgPocPorts, MATE_OPPOSING_FACE } from '../../shared/cadPocPorts.js';
import { alignConnectorPorts, type RigidTransform } from '../../shared/cadTransforms.js';

const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock('../db.js', () => ({ pool: db }));
vi.mock('../config.js', () => ({ config: { jwtSecret: 'test-only', bcryptRounds: 4 } }));
vi.mock('../services/objectStorageService.js', () => ({
  getObjectStream: vi.fn(),
  getProjectBucket: vi.fn(),
}));
import { cadDesignRouter } from './routes.js';

const projectId = '00000000-0000-4000-8000-000000000001';
const designId = '00000000-0000-4000-8000-000000000002';
const sourceId = '00000000-0000-4000-8000-000000000003';
const targetId = '00000000-0000-4000-8000-000000000004';
const sourceCatalogId = '00000000-0000-4000-8000-000000000005';
const targetCatalogId = '00000000-0000-4000-8000-000000000006';
const sourcePortId = '00000000-0000-4000-8000-000000000007';
const targetPortId = '00000000-0000-4000-8000-000000000008';
const tee = {
  original_filename: 'NDX_KLT_60-303_MED_214.step',
  source_sha256: 'd2d9934607cc4a8aac6331e732522541fe23afce08a4c621685092188b5d936f',
};
const bend = {
  original_filename: 'NDX_KLBG_60-303_MED_214.step',
  source_sha256: '966eba08f801d9282f66ae09914502eef8ff24415a274c78267ee98a37926ef2',
};
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.canEditProject = true;
    next();
  });
  app.use('/api/projects/:projectId/cad-design', cadDesignRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${projectId}/cad-design/designs/${designId}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  db.connect.mockResolvedValue(client);
});

function arrangeConnection(displacementMm = 0, occupied = false) {
  const sourcePort = getAalborgPocPorts(tee.original_filename, tee.source_sha256).find(
    (port) => port.id === 'branch',
  );
  const targetPort = getAalborgPocPorts(bend.original_filename, bend.source_sha256).find(
    (port) => port.id === 'start',
  );
  expect(sourcePort, 'The measured tee branch must be registered').toBeDefined();
  expect(targetPort, 'The measured bend start must be registered').toBeDefined();
  const targetWorld: RigidTransform = {
    position: { x: 6450, y: 66550, z: 19300 },
    rotation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
  };
  const aligned = alignConnectorPorts(
    targetWorld,
    targetPort!.local,
    sourcePort!.local,
    MATE_OPPOSING_FACE,
  );
  const rowTransform = (transform: RigidTransform) => ({
    x_mm: transform.position.x,
    y_mm: transform.position.y,
    z_mm: transform.position.z,
    qx: transform.rotation.x,
    qy: transform.rotation.y,
    qz: transform.rotation.z,
    qw: transform.rotation.w,
  });
  const sourceRow = {
    ...tee,
    ...rowTransform(aligned),
    x_mm: aligned.position.x + displacementMm,
    instance_id: sourceId,
    catalog_item_id: sourceCatalogId,
    cut_length_mm: null,
    port_id: sourcePortId,
    port_name: 'branch',
    port_type: `cable-ladder-${sourcePort!.profile}`,
    local_transform: sourcePort!.local,
  };
  const targetRow = {
    ...bend,
    ...rowTransform(targetWorld),
    instance_id: targetId,
    catalog_item_id: targetCatalogId,
    cut_length_mm: null,
    port_id: targetPortId,
    port_name: 'start',
    port_type: `cable-ladder-${targetPort!.profile}`,
    local_transform: targetPort!.local,
  };
  client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
    if (sql.includes('SELECT d.id FROM cad_designs')) return { rows: [{ id: designId }] };
    if (sql.includes('SELECT i.id AS instance_id')) {
      const row = values?.[2] === sourceId ? sourceRow : targetRow;
      return { rows: values?.[3] === row.port_name ? [row] : [] };
    }
    if (sql.includes('SELECT id,source_instance_id,source_port_id')) {
      return {
        rows: occupied
          ? [
              {
                id: '00000000-0000-4000-8000-000000000009',
                source_instance_id: sourceId,
                source_port_id: sourcePortId,
                target_instance_id: '00000000-0000-4000-8000-000000000010',
                target_port_id: '00000000-0000-4000-8000-000000000011',
              },
            ]
          : [],
      };
    }
    return { rows: [] };
  });
}

const connect = () =>
  fetch(`${base}/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceInstanceId: sourceId,
      sourcePortName: 'branch',
      targetInstanceId: targetId,
      targetPortName: 'start',
    }),
  });

describe('measured Niedax fitting physical connections', () => {
  it('saves an aligned tee branch against a placed bend using the registered frames', async () => {
    arrangeConnection();
    const response = await connect();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: expect.any(String), reused: false });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO cad_design_connections'),
      [
        expect.any(String),
        projectId,
        designId,
        sourceId,
        sourceCatalogId,
        sourcePortId,
        targetId,
        targetCatalogId,
        targetPortId,
      ],
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('refuses a branch connection displaced beyond the physical mating tolerance', async () => {
    arrangeConnection(2);
    const response = await connect();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'INCOMPATIBLE_OR_UNALIGNED_PORTS' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO cad_design_connections'),
      ),
    ).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('refuses to connect the same tee branch to a second component', async () => {
    arrangeConnection(0, true);
    const response = await connect();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'CONNECTION_PORT_ALREADY_OCCUPIED' });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO cad_design_connections'),
      ),
    ).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
