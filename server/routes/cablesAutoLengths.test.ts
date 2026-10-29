// @vitest-environment node
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
const database = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
const auto = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
vi.mock('../pathfinder/autoLengthStore.js', () => ({ readAutoLengths: auto.read }));
vi.mock('../services/projectService.js', () => ({ ensureProjectExists: vi.fn().mockResolvedValue({ id: 'project', project_number: 'SYNTHETIC' }) }));
// These are ordinary route-handler unit checks. The existing HTTP middleware
// permission chain is outside this suite and must be qualified separately.
vi.mock('../middleware.js', () => ({ authenticate: vi.fn((_request: unknown, _response: unknown, next: () => void) => next()) }));
import { cablesRouter } from './cablesRoutes.js';
import { createCableSchema, updateCableSchema } from '../validators.js';
import { emptyAutoLengthView, type AutoLengthView } from '../../shared/pathfinderAutoLength.js';

const PROJECT = '00000000-0000-4000-8000-000000000001', CABLE = '00000000-0000-4000-8000-000000000002',
  TYPE = '00000000-0000-4000-8000-000000000003', SECOND = '00000000-0000-4000-8000-000000000004';
type Handler = (request: Request, response: Response) => Promise<void>;
type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] } };
const handler = (path: string, method: string): Handler => (cablesRouter as unknown as { stack: Layer[] }).stack
  .find(layer => layer.route?.path === path && layer.route.methods[method])!.route!.stack.at(-1)!.handle;
const respond = () => { const value = { status: vi.fn(), json: vi.fn() }; value.status.mockReturnValue(value); return value; };
const cable = (id = CABLE, design = 90) => ({
  id, project_id: PROJECT, cable_id: id === CABLE ? 1 : 2, revision: 'A', mto: 'LV', tag: 'Synthetic cable', cable_type_id: TYPE,
  from_location: 'Synthetic From', to_location: 'Synthetic To', routing: '/SYNTHETIC', delivery: null,
  design_length: design, install_length: 110, pull_date: null, connected_from: null, connected_to: null, tested: null,
  created_at: '2026-10-21T00:00:00.000Z', updated_at: '2026-10-21T00:00:00.000Z', type_name: 'Synthetic type',
  type_purpose: 'power', type_diameter_mm: 10, type_weight_kg_per_m: 0.3,
});
const view = (length = 72): AutoLengthView => ({
  autoCalculatedLength: length, autoLengthStatus: 'calculated', autoLengthCalculatedAt: '2026-10-21T12:00:00.000Z',
  autoLengthBarrierStatus: 'clear', autoLengthMatchesLatestRequest: true,
});
const request = (body?: unknown) => ({ params: { projectId: PROJECT, cableId: CABLE }, body, query: {},
  userId: 'ordinary-editor', userRole: 'engineer' } as unknown as Request);

beforeEach(() => { vi.clearAllMocks(); database.query.mockResolvedValue({ rows: [cable()] });
  auto.read.mockResolvedValue(new Map([[CABLE, view()]])); });

describe('ordinary cable API Auto read model', () => {
  it('adds bounded server read-model fields without PF/model authority or replacing editable Design', async () => {
    database.query.mockResolvedValue({ rows: [cable(), cable(SECOND)] });
    const res = respond(); await handler('/', 'get')(request(), res as unknown as Response);
    expect(auto.read).toHaveBeenCalledTimes(1);
    expect(auto.read).toHaveBeenCalledWith(database, PROJECT, [CABLE, SECOND]);
    expect(database.connect).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ cables: [
      expect.objectContaining({ ...view(), routing: '/SYNTHETIC', designLength: 90, installLength: 110 }),
      expect.objectContaining({ ...emptyAutoLengthView(), designLength: 90 }),
    ] });
    const exposed = res.json.mock.calls[0][0].cables[0];
    for (const field of ['dependencies', 'model', 'barriers', 'geometry', 'proposalId', 'record'])
      expect(exposed).not.toHaveProperty(field);
  });

  it('does not query the projection for an empty ordinary cable list', async () => {
    database.query.mockResolvedValue({ rows: [] }); const res = respond();
    await handler('/', 'get')(request(), res as unknown as Response);
    expect(auto.read).not.toHaveBeenCalled(); expect(res.json).toHaveBeenCalledWith({ cables: [] });
  });

  it('keeps business rows available with an honest unavailable status during a projection outage', async () => {
    auto.read.mockRejectedValue(new Error('Synthetic projection outage')); const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { const res = respond(); await handler('/', 'get')(request(), res as unknown as Response);
      expect(res.json).toHaveBeenCalledWith({ cables: [expect.objectContaining({
        ...emptyAutoLengthView(), autoLengthStatus: 'unavailable', designLength: 90, installLength: 110,
      })] }); expect(res.status).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it('lets a normal Design edit diverge from Auto without writing projection state or changing installed length', async () => {
    const current = cable(), updated = cable(CABLE, 41), client = { query: vi.fn(), release: vi.fn() };
    database.connect.mockResolvedValue(client); database.query.mockResolvedValue({ rows: [updated] });
    auto.read.mockResolvedValue(new Map([[CABLE, { ...view(), autoLengthStatus: 'last-successful', autoLengthMatchesLatestRequest: false }]]));
    client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM cables c')) return { rows: [current] };
      if (/UPDATE cables\s+SET/.test(sql)) { expect(sql).not.toMatch(/auto_|pf_auto/); expect(values).toEqual([41, CABLE, PROJECT]); return { rows: [updated] }; }
      if (sql.includes('MAX(version_number)')) return { rows: [{ version: 1 }] };
      if (sql.includes('INSERT INTO cable_versions')) { expect(values?.[4]).toBe('manual'); expect(values?.[15]).toBe(41); expect(values?.[16]).toBe(110); }
      expect(sql).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?pf_auto/i);
      return { rows: [], rowCount: 1 };
    });
    const res = respond(); await handler('/:cableId', 'patch')(request({ designLength: 41 }), res as unknown as Response);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ cable: expect.objectContaining({ autoCalculatedLength: 72, designLength: 41, installLength: 110 }) });
  });

  it('exports the selected Auto value independently from editable Design', async () => {
    const res = { ...respond(), setHeader: vi.fn(), send: vi.fn() };
    const req = { ...request(), query: { columns: 'tag,autoCalculatedLength,designLength' } };
    await handler('/export', 'get')(req as unknown as Request, res as unknown as Response);
    expect(res.status).not.toHaveBeenCalled();
    const workbook = XLSX.read(res.send.mock.calls[0][0], { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
    expect(rows).toEqual([['Tag', 'Auto calculated length [m]', 'Design Length [m]'], ['Synthetic cable', 72, 90]]);
  });

  it('does not add the read-only Auto value to an editable import template', async () => {
    const res = { ...respond(), setHeader: vi.fn(), send: vi.fn() };
    await handler('/template', 'get')(request(), res as unknown as Response);
    expect(res.status).not.toHaveBeenCalled();
    const workbook = XLSX.read(res.send.mock.calls[0][0], { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
    expect(rows[0]).toContain('Design Length [m]');
    expect(rows[0]).not.toContain('Auto calculated length [m]');
  });

  it('ignores an Auto column in an imported workbook while applying an ordinary Design edit', async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([['Cable Id', 'Design Length [m]', 'Auto calculated length [m]'], [1, 41, 999]]);
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, 'Cables');
    const current = cable(), updated = cable(CABLE, 41), client = { query: vi.fn(), release: vi.fn() };
    database.connect.mockResolvedValue(client); database.query.mockResolvedValue({ rows: [updated] });
    client.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM cables c')) return { rows: [current] };
      if (/UPDATE cables\s+SET/.test(sql)) { expect(values).toEqual([41, CABLE]); expect(sql).not.toMatch(/auto_|pf_auto/); }
      if (sql.includes('MAX(version_number)')) return { rows: [{ version: 1 }] };
      if (sql.includes('INSERT INTO cable_versions')) { expect(values?.[4]).toBe('import'); expect(values?.[15]).toBe(41); expect(values?.[16]).toBe(110); }
      expect(sql).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?pf_auto/i);
      return { rows: [], rowCount: 1 };
    });
    const req = { ...request(), file: { originalname: 'synthetic.xlsx', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) } };
    const res = respond(); await handler('/import', 'post')(req as unknown as Request, res as unknown as Response);
    expect(client.query).toHaveBeenCalledWith('COMMIT'); expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ updated: 1 }),
      cables: [expect.objectContaining({ autoCalculatedLength: 72, designLength: 41, installLength: 110 })],
    }));
  });
});

describe('Auto remains absent from writable cable payloads', () => {
  it.each(['autoCalculatedLength', 'autoLengthStatus', 'autoLengthCalculatedAt', 'autoLengthBarrierStatus', 'autoLengthMatchesLatestRequest'])(
    'rejects injection through %s on both create and update', field => {
      const forged = { [field]: field === 'autoCalculatedLength' ? 14 : 'calculated' };
      expect(createCableSchema.safeParse({ cableId: 1, cableTypeId: TYPE, ...forged }).success).toBe(false);
      expect(updateCableSchema.safeParse({ designLength: 40, ...forged }).success).toBe(false);
    });

  it('retains ordinary Design input validation, including explicit clearing', () => {
    expect(updateCableSchema.parse({ designLength: 41 })).toEqual({ designLength: 41 });
    expect(updateCableSchema.parse({ designLength: null })).toEqual({ designLength: null });
  });
});
