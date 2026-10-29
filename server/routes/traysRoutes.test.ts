// @vitest-environment node
import type { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrayRow } from '../models/tray.js';

const database = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
const autoLength = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
vi.mock('../services/trayAutoLengthService.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/trayAutoLengthService.js')>(),
  readCurrentTrayAutoLength: autoLength.read,
}));
vi.mock('../services/projectService.js', () => ({
  ensureProjectExists: vi.fn().mockResolvedValue({ id: 'project' }),
}));
import { traysRouter } from './traysRoutes.js';
import { ensureProjectExists } from '../services/projectService.js';
import { TrayAutoLengthError } from '../services/trayAutoLengthService.js';

type Handler = (req: Request, res: Response) => Promise<void>;
type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] };
};
const handler = (method: string, path: string) =>
  (traysRouter as unknown as { stack: Layer[] }).stack
    .find((layer) => layer.route?.path === path && layer.route.methods[method])!
    .route!.stack.at(-1)!.handle;
const client = { query: vi.fn(), release: vi.fn() };
let stored: TrayRow;
const response = () => {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};
const request = (body: unknown) =>
  ({
    params: { projectId: 'project', trayId: 'tray' },
    userId: 'actor',
    query: {},
    body,
  }) as unknown as Request;

beforeEach(() => {
  vi.clearAllMocks();
  autoLength.read.mockReset();
  vi.mocked(ensureProjectExists).mockResolvedValue({ id: 'project' } as Awaited<
    ReturnType<typeof ensureProjectExists>
  >);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  stored = {
    id: 'tray',
    project_id: 'project',
    name: 'T1',
    tray_type: null,
    purpose: null,
    width_mm: null,
    height_mm: null,
    length_mm: 3000,
    include_grounding_cable: false,
    grounding_cable_type_id: null,
    use_trefoil_clamps: false,
    trefoil_clamp_spacing_mm: 600,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    change_log: [],
  };
  database.connect.mockResolvedValue(client);
  database.query.mockImplementation(async () => ({ rows: [stored], rowCount: 1 }));
  client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
    if (sql.includes('FROM users')) return { rows: [{ name: 'Editor' }] };
    if (sql.includes('FROM trays')) return { rows: [{ ...stored }], rowCount: 1 };
    if (sql.includes('INSERT INTO trays')) {
      stored = {
        ...stored,
        id: values![0] as string,
        length_mm: values![7] as number,
        use_trefoil_clamps: (values![8] as boolean | undefined) ?? false,
        trefoil_clamp_spacing_mm: (values![9] as number | undefined) ?? 600,
      };
      return { rows: [{ ...stored }], rowCount: 1 };
    }
    if (sql.includes('UPDATE trays') && !sql.includes('change_log =')) {
      const assignments = sql.slice(sql.indexOf('SET'), sql.indexOf('WHERE'));
      for (const [, field, parameter] of assignments.matchAll(/(\w+) = \$(\d+)/g)) {
        const value = values![Number(parameter) - 1];
        stored = { ...stored, [field]: field === 'length_calculation' && typeof value === 'string' ? JSON.parse(value) : value };
      }
      if (assignments.includes("length_source = 'manual'")) stored.length_source = 'manual';
      if (assignments.includes('length_calculation = NULL')) stored.length_calculation = null;
      return { rows: [{ ...stored }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
});

describe('automatic tray length persistence', () => {
  const reference = { modelVersionId: '00000000-0000-4000-8000-000000000001', geometryRevision: '2', aggregateId: '00000000-0000-4000-8000-000000000002', traceId: '00000000-0000-4000-8000-000000000003' };
  const measurement = { ...reference, lengthMm: 4567.891, elementCount: 3 };
  const automaticInput = { lengthMm: measurement.lengthMm, lengthSource: 'auto', autoLengthReference: reference };
  const makeAutomatic = (lengthMm = measurement.lengthMm) => {
    stored.length_mm = lengthMm;
    stored.length_source = 'auto';
    stored.length_calculation = { ...measurement, lengthMm, calculatedAt: '2026-10-29T12:00:00.000Z' };
  };
  beforeEach(() => autoLength.read.mockResolvedValue(measurement));

  it('previews a project tray measurement without changing stored data', async () => {
    const res = response();
    await handler('get', '/:trayId/auto-length')(request({}), res);
    expect(autoLength.read).toHaveBeenCalledWith(database, 'project', 'tray');
    expect(res.json).toHaveBeenCalledWith({ autoLength: measurement });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(database.connect).not.toHaveBeenCalled();
  });

  it('returns actionable service errors without raw internal error details', async () => {
    autoLength.read.mockRejectedValue(new TrayAutoLengthError('TRAY_AUTO_LENGTH_UNAVAILABLE', 'Prepare the current network first.'));
    const res = response();
    await handler('get', '/:trayId/auto-length')(request({}), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Prepare the current network first.', code: 'TRAY_AUTO_LENGTH_UNAVAILABLE' });
  });

  it('rolls back when automatic geometry becomes unavailable during Save', async () => {
    stored.length_mm = null;
    autoLength.read.mockRejectedValue(new TrayAutoLengthError('TRAY_AUTO_LENGTH_UNAVAILABLE', 'Prepare the current network first.'));
    const res = response();
    await handler('patch', '/:trayId')(request(automaticInput), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Prepare the current network first.', code: 'TRAY_AUTO_LENGTH_UNAVAILABLE' });
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(stored.length_mm).toBeNull();
  });

  it('does not calculate a tray from a different project', async () => {
    database.query.mockResolvedValue({ rows: [] });
    const res = response();
    await handler('get', '/:trayId/auto-length')(request({}), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(autoLength.read).not.toHaveBeenCalled();
  });

  it('saves an empty length from a freshly recomputed measurement and its provenance in one transaction', async () => {
    stored.length_mm = null;
    const res = response();
    await handler('patch', '/:trayId')(request(automaticInput), res);
    expect(autoLength.read).toHaveBeenCalledWith(client, 'project', 'tray');
    expect(res.json).toHaveBeenCalledWith({ tray: expect.objectContaining({ lengthMm: measurement.lengthMm, lengthSource: 'auto', lengthCalculation: { ...measurement, calculatedAt: expect.any(String) } }) });
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it.each([undefined, 'manual'] as const)('protects a pre-existing manual length with source %s when no approval was supplied', async (source) => {
    stored.length_source = source;
    const res = response();
    await handler('patch', '/:trayId')(request(automaticInput), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TRAY_MANUAL_LENGTH_APPROVAL_REQUIRED' }));
    expect(autoLength.read).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(stored.length_mm).toBe(3000);
  });

  it.each([3000, 0])('replaces a manual length %s only after approval for that locked value', async (lengthMm) => {
    stored.length_mm = lengthMm;
    const res = response();
    await handler('patch', '/:trayId')(request({ ...automaticInput, approvedManualLengthMm: lengthMm }), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(stored.length_source).toBe('auto');
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('rejects approval for an old manual value after another editor changed it', async () => {
    stored.length_mm = 3100;
    const res = response();
    await handler('patch', '/:trayId')(request({ ...automaticInput, approvedManualLengthMm: 3000 }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(stored.length_mm).toBe(3100);
    expect(autoLength.read).not.toHaveBeenCalled();
  });

  it('can refresh an already automatic length without manual replacement approval', async () => {
    makeAutomatic(4000);
    await handler('patch', '/:trayId')(request(automaticInput), response());
    expect(stored.length_mm).toBe(measurement.lengthMm);
    expect(stored.length_source).toBe('auto');
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it.each(['modelVersionId', 'geometryRevision', 'aggregateId', 'traceId', 'lengthMm'] as const)('rejects a preview whose %s changed', async (field) => {
    stored.length_mm = null;
    autoLength.read.mockResolvedValue({ ...measurement, [field]: field === 'lengthMm' ? 4567.892 : field === 'geometryRevision' ? '3' : '00000000-0000-4000-8000-000000000099' });
    const res = response();
    await handler('patch', '/:trayId')(request(automaticInput), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TRAY_AUTO_LENGTH_STALE' }));
    expect(stored.length_mm).toBeNull();
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it.each([{ purpose: 'Power' }, { lengthMm: measurement.lengthMm }])('preserves automatic provenance for unrelated or unchanged legacy saves', async (input) => {
    makeAutomatic();
    const previousCalculation = stored.length_calculation;
    await handler('patch', '/:trayId')(request(input), response());
    expect(stored.length_source).toBe('auto');
    expect(stored.length_calculation).toEqual(previousCalculation);
    expect(autoLength.read).not.toHaveBeenCalled();
  });

  it.each([{ lengthMm: 1234.567 }, { lengthMm: null }, { lengthSource: 'manual' }])('clears auto provenance on an explicit manual length edit', async (input) => {
    makeAutomatic();
    await handler('patch', '/:trayId')(request(input), response());
    expect(stored.length_source).toBe('manual');
    expect(stored.length_calculation).toBeNull();
    expect(autoLength.read).not.toHaveBeenCalled();
  });

  it.each([4000, null])('clears automatic provenance on Excel overwrite, including blank cells', async (importedLength) => {
    makeAutomatic();
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Name', 'Length [mm]'], ['T1', importedLength]]), 'Trays');
    const req = { ...request({}), file: { originalname: 'trays.xlsx', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) } };
    await handler('post', '/import')(req as unknown as Request, response());
    expect(stored.length_source).toBe('manual');
    expect(stored.length_calculation).toBeNull();
    expect(stored.length_mm).toBe(importedLength);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });
});
afterEach(() => vi.restoreAllMocks());

describe('tray history transactions', () => {
  it('returns the persisted clamp preferences when listing trays', async () => {
    stored.use_trefoil_clamps = true;
    stored.trefoil_clamp_spacing_mm = '750';
    const res = response();
    await handler('get', '/')(request({}), res);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('trefoil_clamp_spacing_mm'),
      ['project'],
    );
    expect(res.json).toHaveBeenCalledWith({
      trays: [expect.objectContaining({ useTrefoilClamps: true, trefoilClampSpacingMm: 750 })],
    });
  });

  it('saves the clamp preferences and records both changes in the same transaction', async () => {
    const res = response();
    await handler('patch', '/:trayId')(
      request({ useTrefoilClamps: true, trefoilClampSpacingMm: 750 }),
      res,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('use_trefoil_clamps = $1, trefoil_clamp_spacing_mm = $2'),
      [true, 750, 'tray', 'project'],
    );
    expect(res.json).toHaveBeenCalledWith({
      tray: expect.objectContaining({
        useTrefoilClamps: true,
        trefoilClampSpacingMm: 750,
        changeLog: [
          expect.objectContaining({
            changes: ['Use trefoil clamps: No → Yes', 'Trefoil clamp spacing [mm]: 600 → 750'],
          }),
        ],
      }),
    });
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('retains the spacing when disabling clamps', async () => {
    stored.use_trefoil_clamps = true;
    stored.trefoil_clamp_spacing_mm = 750;
    const res = response();
    await handler('patch', '/:trayId')(request({ useTrefoilClamps: false }), res);
    expect(res.json).toHaveBeenCalledWith({
      tray: expect.objectContaining({ useTrefoilClamps: false, trefoilClampSpacingMm: 750 }),
    });
  });

  it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN, 1_000_001, null])(
    'rejects invalid clamp spacing %s before opening a transaction',
    async (trefoilClampSpacingMm) => {
      const res = response();
      await handler('patch', '/:trayId')(request({ trefoilClampSpacingMm }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(database.connect).not.toHaveBeenCalled();
    },
  );

  it.each([
    { input: {}, enabled: false, spacing: 600 },
    { input: { useTrefoilClamps: true, trefoilClampSpacingMm: 900 }, enabled: true, spacing: 900 },
  ])('creates a tray with the default or explicit clamp preferences', async ({ input, enabled, spacing }) => {
    const res = response();
    await handler('post', '/')(request({ name: 'T1', ...input }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('use_trefoil_clamps'),
      [expect.any(String), 'project', 'T1', null, null, null, null, null, enabled, spacing],
    );
    expect(res.json).toHaveBeenCalledWith({
      tray: expect.objectContaining({ useTrefoilClamps: enabled, trefoilClampSpacingMm: spacing }),
    });
  });

  it('locks the tray and commits its update and history together', async () => {
    const res = response();
    await handler('patch', '/:trayId')(request({ lengthMm: 4000 }), res);
    expect(client.query.mock.calls[1]).toEqual([
      expect.stringContaining('FOR UPDATE'),
      ['project', 'tray'],
    ]);
    expect(res.json).toHaveBeenCalledWith({
      tray: expect.objectContaining({
        lengthMm: 4000,
        changeLog: [
          expect.objectContaining({
            userName: 'Editor',
            userId: 'actor',
            changes: ['Length [mm]: 3000 → 4000'],
          }),
        ],
      }),
    });
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('does not log unchanged saves', async () => {
    await handler('patch', '/:trayId')(request({ lengthMm: 3000 }), response());
    expect(client.query.mock.calls.some(([sql]) => sql.includes('change_log ='))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('rolls back the update if writing history fails', async () => {
    const query = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('change_log =')) throw new Error('History failed');
      return query(sql, values);
    });
    const res = response();
    await handler('patch', '/:trayId')(request({ lengthMm: 4000 }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('does not update a tray outside the project', async () => {
    client.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = response();
    await handler('patch', '/:trayId')(request({ lengthMm: 4000 }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE trays'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it('includes initial history when creating a tray', async () => {
    const res = response();
    await handler('post', '/')(request({ name: 'T1', lengthMm: 3000 }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      tray: expect.objectContaining({
        changeLog: [
          expect.objectContaining({ changes: expect.arrayContaining(['Tray created.']) }),
        ],
      }),
    });
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it.each([true, false])('logs Excel imports for existing=%s', async (existing) => {
    const query = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (!existing && sql.includes('FROM trays')) return { rows: [], rowCount: 0 };
      return query(sql, values);
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Name', 'Length [mm]'],
        ['T1', 4000],
      ]),
      'Trays',
    );
    const req = {
      ...request({}),
      file: {
        originalname: 'trays.xlsx',
        buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
      },
    };
    const res = response();
    await handler('post', '/import')(req as unknown as Request, res);
    expect(res.status).not.toHaveBeenCalled();
    const log = client.query.mock.calls.find(([sql]) => sql.includes('change_log ='));
    expect(JSON.parse(log![1][2])[0]).toMatchObject({
      userId: 'actor',
      changes: expect.arrayContaining([existing ? 'Length [mm]: 3000 → 4000' : 'Tray created.']),
    });
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });
});
