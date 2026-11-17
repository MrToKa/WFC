// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getAalborgPocPorts } from '../../shared/cadPocPorts.js';
import { rotateVector } from '../../shared/cadTransforms.js';
import { encodeCadOverlay } from './cadOverlay.js';
import { defaultOptions } from './jobContracts.js';
import { runEngine } from './engine.js';
import { syntheticStraightSnapshot } from './syntheticFixture.js';
vi.mock('../db.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../config.js', () => ({ config: { jwtSecret: 'test-only', bcryptRounds: 4 } }));
vi.mock('../services/objectStorageService.js', () => ({
  getObjectStream: vi.fn(),
  getProjectBucket: vi.fn(),
}));
import {
  buildCadChain,
  cadRouteSegments,
  type PublicationInstance,
} from '../cadDesign/routePublication.js';

const projectId = randomUUID(),
  modelVersionId = randomUUID(),
  snapshotId = randomUUID();
const routeId = randomUUID(),
  routeCode = '/BC027-1';
const sourcePorts = getAalborgPocPorts(
  'NDX_KLT_60-303_MED_214.step',
  'd2d9934607cc4a8aac6331e732522541fe23afce08a4c621685092188b5d936f',
);
// This fixture tests graph topology, not a manufacturer cable bend-length rule.
// Terminals retain the original STEP frames; three synthetic axes meet at
// their common T-axis intersection, well away from the base model tray.
const junction = [10, 10, 0.5];
const point = (p: { x: number; y: number; z: number }) => [
  p.x / 1000 + 10.795,
  p.y / 1000 + 9.97,
  p.z / 1000 + 0.5,
];
const tuple = (p: { x: number; y: number; z: number }) => [p.x, p.y, p.z];
const arms = sourcePorts.map((port, index) => ({
  id: `cad:${index === 0 ? routeId : randomUUID()}`,
  name: routeCode,
  allowedCategoryMask: 4,
  pointsMetres: [junction, point(port.local.position)],
  ports: [
    {
      pointMetres: point(port.local.position),
      outward: tuple(rotateVector({ x: 0, y: 0, z: 1 }, port.local.rotation)),
      u: tuple(rotateVector({ x: 1, y: 0, z: 0 }, port.local.rotation)),
      v: tuple(rotateVector({ x: 0, y: 1, z: 0 }, port.local.rotation)),
      widthMetres: 0.3,
      heightMetres: 0.06,
    },
  ],
}));
let root: string, sha: string;

beforeAll(async () => {
  expect(sourcePorts.map((port) => port.id)).toEqual(['start', 'end', 'branch']);
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wfc-cad-tee-overlay-'));
  await fs.mkdir(path.join(root, 'snapshots'));
  const bytes = Buffer.from(
    JSON.stringify(syntheticStraightSnapshot(projectId, modelVersionId, 'a'.repeat(64))),
  );
  sha = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(root, 'snapshots', `${snapshotId}.json`), bytes, { flag: 'wx' });
  vi.stubEnv('PF_ROOT', root);
  vi.stubEnv(
    'PF_ENGINE_DLL',
    process.env.PF_MODEL_RUNNER_DLL ??
      path.resolve(
        'pathfinder-engine/tools/PathFinder.ModelRunner/bin/Debug/net9.0/PathFinder.ModelRunner.dll',
      ),
  );
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (!root) return;
  if (
    path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) ||
    !path.basename(root).startsWith('wfc-cad-tee-overlay-')
  )
    throw new Error('Unexpected owned tee test directory');
  await fs.rm(root, { recursive: true, force: true });
});

const position = (value: number[]) => ({ x: value[0], y: value[1], z: value[2] });
const envelope = (segments = arms) =>
  encodeCadOverlay({
    schemaVersion: 'wfc.pf.cad-overlay-payload.v3',
    projectId,
    modelVersionId,
    baseSnapshotSha256: sha,
    segments,
  });
const request = (first = 0, last = 1) => ({
  schemaVersion: 'pathfinder.model.runner.v1',
  requestId: randomUUID(),
  operation: 'calculate',
  projectId,
  modelVersionId,
  snapshotId,
  snapshotSha256: sha,
  timeoutMilliseconds: 30000,
  category: 'Control',
  includeLengthLedger: true,
  from: position(arms[first].pointsMetres[1]),
  to: position(arms[last].pointsMetres[1]),
  allowedPurposeRouteCodes: [routeCode],
  cadOverlay: envelope(),
  options: { ...defaultOptions, connectionToleranceMeters: 1e-6, preferVerticalApproach: false },
  projectSettings: {
    revision: '1',
    secondaryTrayLength: '0',
    endConnectionLength: '0',
    additionalBendingPercent: '0',
  },
});

async function prepare() {
  const input = {
    schemaVersion: 'pathfinder.model.runner.v1',
    requestId: randomUUID(),
    operation: 'prepare',
    projectId,
    modelVersionId,
    snapshotId,
    snapshotSha256: sha,
    timeoutMilliseconds: 30000,
    cadOverlay: envelope(),
  };
  if (process.platform === 'linux') return runEngine(input, new AbortController().signal);
  // Production RSS qualification requires Linux /proc. On Windows exercise
  // the real stdio preparation contract without inventing memory evidence.
  return new Promise<{ status: string; prepared: { segmentCount: number } }>((resolve, reject) => {
    const child = spawn('dotnet', [process.env.PF_ENGINE_DLL!], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 30000,
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        if (code !== 0) throw new Error('Native tee preparation failed');
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(input));
  });
}

describe('actual native three-arm CAD tee overlay', () => {
  it.each([
    [0, 1],
    [0, 2],
    [1, 2],
  ])(
    'routes the server-generated tee from terminal %i to %i without an unused arm',
    async (first, last) => {
      const tee: PublicationInstance = {
        id: randomUUID(),
        catalog_item_id: randomUUID(),
        material_asset_id: randomUUID(),
        revision: 1,
        part_number: 'KSLT 60.303 S',
        original_filename: 'NDX_KLT_60-303_MED_214.step',
        source_sha256: 'd2d9934607cc4a8aac6331e732522541fe23afce08a4c621685092188b5d936f',
        component_kind: 'tee',
        cut_length_mm: null,
        x_mm: 10795,
        y_mm: 9970,
        z_mm: 500,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
      };
      const geometry = buildCadChain([tee], []);
      const segments = cadRouteSegments({ id: routeId, tag: 'BC027-1' }, geometry);
      expect(segments).toHaveLength(3);
      expect(geometry.lengthMetres).toBeCloseTo(2.385, 10);
      const atTerminal = (index: number) =>
        segments.find((segment) => {
          const p = segment.ports[0].pointMetres,
            expected = arms[index].ports[0].pointMetres;
          return Math.hypot(...p.map((value, axis) => value - expected[axis])) < 1e-9;
        })!;
      const payload = encodeCadOverlay({
        schemaVersion: 'wfc.pf.cad-overlay-payload.v3',
        projectId,
        modelVersionId,
        baseSnapshotSha256: sha,
        segments,
      });
      const result = await runEngine(
        { ...request(first, last), cadOverlay: payload },
        new AbortController().signal,
      );
      expect(result.status, JSON.stringify(result)).toBe('calculated');
      expect(result.route?.routeCodes).toEqual([routeCode]);
      expect(new Set(result.route?.segmentIds)).toEqual(
        new Set([atTerminal(first).id, atTerminal(last).id]),
      );
      expect(result.route?.lengthMeters).toBeCloseTo(1.59, 10);
      expect(result.lengthLedger?.raw.lengthMeters).toBeCloseTo(1.59, 10);
      expect(result.route?.connectionGapCount).toBe(0);
    },
    40000,
  );

  it('routes through a measured 50 mm join bridge without dropping its length', async () => {
    const branch = arms[2].ports[0];
    const startPoint = [...branch.pointMetres];
    startPoint[0] += 0.05;
    const endPoint = [...startPoint];
    endPoint[0] += 1;
    const reverse = (port: typeof branch) => ({
      ...port,
      outward: port.outward.map((value) => -value),
      u: port.u.map((value) => -value),
    });
    const start = { ...reverse(branch), pointMetres: startPoint };
    const end = { ...branch, pointMetres: endPoint };
    const straight = {
      id: `cad:${randomUUID()}`,
      name: routeCode,
      allowedCategoryMask: 4,
      pointsMetres: [startPoint, endPoint],
      ports: [start, end],
    };
    const bridge = {
      id: `cad:${randomUUID()}`,
      name: routeCode,
      allowedCategoryMask: 4,
      pointsMetres: [branch.pointMetres, startPoint],
      ports: [reverse(branch), reverse(start)],
    };
    const input = { ...request(0, 2), to: position(endPoint) };
    const disconnected = await runEngine(
      { ...input, cadOverlay: envelope([...arms, straight]) },
      new AbortController().signal,
    );
    expect(disconnected.status).toBe('no_path');
    const result = await runEngine(
      { ...input, cadOverlay: envelope([...arms, straight, bridge]) },
      new AbortController().signal,
    );
    expect(result.status, JSON.stringify(result)).toBe('calculated');
    expect(new Set(result.route?.segmentIds)).toEqual(
      new Set([arms[0].id, arms[2].id, bridge.id, straight.id]),
    );
    expect(result.route?.routeCodes).toEqual([routeCode]);
    expect(result.route?.lengthMeters).toBeCloseTo(2.64, 10);
    expect(result.lengthLedger?.raw.lengthMeters).toBeCloseTo(2.64, 10);
    expect(result.route?.connectionGapCount).toBe(0);
  }, 40000);

  it('connects two tees through a straight body and includes both admitted join bridges', async () => {
    const reverse = (port: (typeof arms)[number]['ports'][number]) => ({
      ...port,
      outward: port.outward.map((value) => -value),
      u: port.u.map((value) => -value),
    });
    const firstBranch = arms[2].ports[0];
    const startPoint = [...firstBranch.pointMetres];
    startPoint[0] += 0.05;
    const endPoint = [...startPoint];
    endPoint[0] += 1;
    const start = { ...reverse(firstBranch), pointMetres: startPoint };
    const end = { ...firstBranch, pointMetres: endPoint };
    const straight = {
      id: `cad:${randomUUID()}`,
      name: routeCode,
      allowedCategoryMask: 4,
      pointsMetres: [startPoint, endPoint],
      ports: [start, end],
    };
    const oppositePoint = (p: number[]) => [12.69 - (p[0] - junction[0]), p[1], 1 - p[2]];
    const oppositeVector = (p: number[]) => [-p[0], p[1], -p[2]];
    const secondArms = arms.map((arm) => ({
      ...arm,
      id: `cad:${randomUUID()}`,
      pointsMetres: arm.pointsMetres.map(oppositePoint),
      ports: arm.ports.map((port) => ({
        ...port,
        pointMetres: oppositePoint(port.pointMetres),
        outward: oppositeVector(port.outward),
        u: oppositeVector(port.u),
        v: oppositeVector(port.v),
      })),
    }));
    const bridge = (a: typeof firstBranch, b: typeof firstBranch) => ({
      id: `cad:${randomUUID()}`,
      name: routeCode,
      allowedCategoryMask: 4,
      pointsMetres: [a.pointMetres, b.pointMetres],
      ports: [reverse(a), reverse(b)],
    });
    const firstJoin = bridge(firstBranch, start),
      lastJoin = bridge(end, secondArms[2].ports[0]);
    const result = await runEngine(
      {
        ...request(),
        to: position(secondArms[0].pointsMetres[1]),
        cadOverlay: envelope([...arms, straight, firstJoin, lastJoin, ...secondArms]),
      },
      new AbortController().signal,
    );
    expect(result.status, JSON.stringify(result)).toBe('calculated');
    expect(new Set(result.route?.segmentIds)).toEqual(
      new Set([
        arms[0].id,
        arms[2].id,
        firstJoin.id,
        straight.id,
        lastJoin.id,
        secondArms[2].id,
        secondArms[0].id,
      ]),
    );
    expect(result.route?.routeCodes).toEqual([routeCode]);
    expect(result.route?.lengthMeters).toBeCloseTo(4.28, 10);
    expect(result.lengthLedger?.raw.lengthMeters).toBeCloseTo(4.28, 10);
  }, 40000);

  it.each([
    [0, 1],
    [0, 2],
    [1, 2],
  ])(
    'routes terminal %i to %i through only the two traversed arms',
    async (first, last) => {
      const result = await runEngine(request(first, last), new AbortController().signal);
      expect(result.status, JSON.stringify(result)).toBe('calculated');
      expect(result.route?.success).toBe(true);
      expect(result.route?.routeCodes).toEqual([routeCode]);
      expect(new Set(result.route?.segmentIds)).toEqual(new Set([arms[first].id, arms[last].id]));
      expect(result.route?.lengthMeters).toBeCloseTo(1.59, 10);
      expect(result.lengthLedger?.raw.lengthMeters).toBeCloseTo(1.59, 10);
      expect(result.route?.connectionGapCount).toBe(0);
      const unused = arms.find((_arm, index) => index !== first && index !== last)!;
      expect(result.route?.segmentIds).not.toContain(unused.id);
      expect(
        result.route?.pathPoints.some(
          (p) => Math.hypot(p.x - junction[0], p.y - junction[1], p.z - junction[2]) < 1e-9,
        ),
      ).toBe(true);
    },
    40000,
  );

  it('counts all three arms in the native preparation proof', async () => {
    const result = await prepare();
    expect(result.status).toBe('prepared');
    expect(result.prepared).toMatchObject({ segmentCount: 4 });
  }, 40000);

  it('excludes the complete tee when its common route code is capacity-blocked', async () => {
    const result = await runEngine(
      { ...request(), excludedRouteCodes: [routeCode] },
      new AbortController().signal,
    );
    expect(result.status).toBe('no_path');
    expect(result.route?.success ?? false).toBe(false);
  }, 40000);

  it('excludes all tee arms when cable purpose does not permit the common route code', async () => {
    const result = await runEngine(
      { ...request(), allowedPurposeRouteCodes: [] },
      new AbortController().signal,
    );
    expect(result.status).toBe('no_path');
    expect(result.route?.success ?? false).toBe(false);
  }, 40000);
});
