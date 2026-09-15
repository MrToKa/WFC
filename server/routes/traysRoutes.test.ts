// @vitest-environment node
import type { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrayRow } from '../models/tray.js';

const database = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
vi.mock('../services/projectService.js', () => ({
  ensureProjectExists: vi.fn().mockResolvedValue({ id: 'project' }),
}));
import { traysRouter } from './traysRoutes.js';
import { ensureProjectExists } from '../services/projectService.js';

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
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};
const request = (body: unknown) =>
  ({
    params: { projectId: 'project', trayId: 'tray' },
    userId: 'actor',
    body,
  }) as unknown as Request;

beforeEach(() => {
  vi.clearAllMocks();
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
      stored = { ...stored, id: values![0] as string, length_mm: values![7] as number };
      return { rows: [{ ...stored }], rowCount: 1 };
    }
    if (sql.includes('UPDATE trays') && !sql.includes('change_log =')) {
      stored = {
        ...stored,
        length_mm: (sql.includes('tray_type = $1') ? values![4] : values![0]) as number,
      };
      return { rows: [{ ...stored }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
});
afterEach(() => vi.restoreAllMocks());

describe('tray history transactions', () => {
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
