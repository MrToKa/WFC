// @vitest-environment node
import type { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../db.js', () => ({ pool: db }));
vi.mock('../services/projectService.js', () => ({ ensureProjectExists: vi.fn(async () => ({ id: 'project' })) }));
vi.mock('../pathfinder/autoLengthStore.js', () => ({ readAutoLengths: vi.fn(async () => new Map()) }));
vi.mock('../pathfinder/cableRoutingControlRepository.js', () => ({
  readCableRoutingViews: vi.fn(async () => new Map()), cableExecutionFacts: vi.fn(() => ({})),
  initializeImportedCableRoutingControl: vi.fn(async () => ({ control: {} })),
  applyCableRoutingControlInTransaction: vi.fn(async (_client, input) => ({ routing: input.after.routing, control: {}, blockedReasons: [] })),
}));
import { cablesRouter } from './cablesRoutes.js';
import { createCableSchema, updateCableSchema } from '../validators.js';

const id = '00000000-0000-4000-8000-000000000001';
const note = 'User instruction\n[PathFinder obstacles] Crosses obstacles: #123.';
let saved: Record<string, any>;
const client = { query: vi.fn(), release: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  saved = { id, project_id: id, cable_id: 42, cable_type_id: id, type_name: 'Cable type', mto: 'LV', routing: '/A', remarks: 'User instruction',
    from_location: 'A', to_location: 'B', design_length: 5, install_length: null, created_at: '2026-01-01', updated_at: '2026-01-01' };
  client.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (/INSERT INTO cables\s*\(/.test(sql)) {
      const columns = /INSERT INTO cables\s*\(([^)]+)\)/.exec(sql)![1].split(',').map(column => column.trim());
      const parameters = /VALUES\s*\(([^)]+)\)/.exec(sql)![1].split(',').map(value => Number(value.trim().slice(1)));
      expect(columns).toHaveLength(values.length);
      expect(parameters).toEqual(Array.from({ length: columns.length }, (_, index) => index + 1));
      saved = { ...saved, ...Object.fromEntries(columns.map((column, index) => [column, values[index]])) };
      return { rows: [saved], rowCount: 1 };
    }
    if (/UPDATE cables\s+SET\s+remarks = \$1/.test(sql)) { saved.remarks = values[0]; return { rows: [saved], rowCount: 1 }; }
    if (sql.includes('FROM cables c')) return { rows: sql.includes('ANY($2::int[])') ? [] : [saved], rowCount: 1 };
    if (sql.includes('FROM cable_types')) return { rows: [{ id, name: 'Cable type' }], rowCount: 1 };
    if (sql.includes('FROM users')) return { rows: [{ name: 'Editor' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  db.connect.mockResolvedValue(client);
  db.query.mockImplementation(async (sql: string) => sql.includes('FROM cables c') ? { rows: [saved] } : { rows: [] });
});
async function invoke(method: string, path: string, input: Partial<Request>) {
  type Handler = (req: Request, res: Response) => Promise<void>;
  const stack = (cablesRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] } }[] }).stack;
  const handler = stack.find(layer => layer.route?.path === path && layer.route.methods[method])!.route!.stack.at(-1)!.handle;
  const response = { status: vi.fn(), json: vi.fn() }; response.status.mockReturnValue(response);
  await handler({ params: { projectId: id, cableId: id }, query: {}, userId: id, loginId: id, loginExpiresAt: Date.now() + 60000, ...input } as Request, response as unknown as Response);
  return response;
}
it('creates and reads cable Remarks with SQL column/parameter and history alignment', async () => {
  const response = await invoke('post', '/', { body: { cableId: 99, cableTypeId: id, remarks: note } });
  expect(response.status).toHaveBeenCalledWith(201);
  expect(response.json.mock.calls[0][0].cable.remarks).toBe(note);
  const version = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO cable_versions'))!;
  expect(version[0]).toContain('remarks'); expect(version[1]?.at(-1)).toBe(note);
});
it('edits only cable Remarks and writes its complete historical snapshot', async () => {
  const response = await invoke('patch', '/:cableId', { body: { remarks: note } });
  expect(response.status).not.toHaveBeenCalled();
  expect(response.json.mock.calls[0][0].cable.remarks).toBe(note);
  expect(client.query.mock.calls.find(([sql]) => /UPDATE cables\s+SET\s+remarks = \$1/.test(sql))?.[1]?.[0]).toBe(note);
  expect(client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO cable_versions'))?.[1]?.at(-1)).toBe(note);
});
it('removes stale generated crossing notes after a manual route edit while preserving user text', async () => {
  saved.remarks = note;
  const response = await invoke('patch', '/:cableId', { body: { routing: '/B' } });
  expect(response.status).not.toHaveBeenCalled();
  const update = client.query.mock.calls.find(([sql]) => /UPDATE cables\s+SET\s+remarks = \$1/.test(sql))!;
  expect(update[1]?.slice(0, 2)).toEqual(['User instruction', '/B']);
  expect(client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO cable_versions'))?.[1]?.at(-1)).toBe('User instruction');
});
it('imports cable Remarks with aligned INSERT values and unchanged multiline content', async () => {
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['ID', 'Type', 'Remarks'], [99, 'Cable type', note]]), 'Cables');
  const response = await invoke('post', '/import', { file: { buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), originalname: 'cables.xlsx' } as Express.Multer.File });
  expect(response.status).not.toHaveBeenCalled();
  expect(response.json.mock.calls[0][0].cables[0].remarks).toBe(note);
  expect(client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO cable_versions'))?.[1]?.at(-1)).toBe(note);
});
it('accepts a Remarks-only edit and rejects content larger than an Excel cell', () => {
  expect(updateCableSchema.safeParse({ remarks: note }).success).toBe(true);
  expect(createCableSchema.safeParse({ cableId: 1, cableTypeId: id, remarks: 'x'.repeat(32767) }).success).toBe(true);
  expect(updateCableSchema.safeParse({ remarks: 'x'.repeat(32768) }).success).toBe(false);
});
