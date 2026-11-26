import express, { Router } from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ask: vi.fn(),
  query: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('../middleware.js', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.userId = 'catalog-admin';
    next();
  },
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.header('Authorization') === 'Bearer admin') next();
    else res.sendStatus(403);
  },
}));
vi.mock('../services/materialAuditPool.js', () => ({
  withMaterialTransaction: (operation: (client: unknown) => unknown) =>
    operation({ query: mocks.query }),
}));
vi.mock('./pageRequest.js', async (original) => ({
  ...await original<typeof import('./pageRequest.js')>(),
  requestPageAssistant: mocks.ask,
}));

import { registerMaterialAssistant } from './materialRequest.js';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  vi.resetAllMocks();
});

async function send(authorization = 'Bearer admin', prompt = 'Add A2 washer, part 123') {
  const app = express();
  const router = Router();
  registerMaterialAssistant(router, 'Instrument installation material', mocks.insert);
  app.use(express.json(), router);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return fetch(`http://127.0.0.1:${address.port}/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authorization },
    body: JSON.stringify({ prompt }),
  });
}

describe('material assistant', () => {
  it('writes validated material to the selected catalog without a project', async () => {
    mocks.ask.mockResolvedValue({ answer: 'One item', materials: [
      { type: 'A2 washer', partNo: '123', weightKg: null, source: 'Supplier datasheet' },
    ] });
    mocks.query.mockResolvedValue({ rows: [{ is_admin: true }] });
    const response = await send();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ created: 1 });
    expect(mocks.ask).toHaveBeenCalledWith('Add A2 washer, part 123', '/materials', 'Instrument installation material');
    expect(mocks.insert).toHaveBeenCalledWith(expect.anything(), { type: 'A2 washer', partNo: '123' });
  });

  it('keeps a supplied web link and drops an invented link', async () => {
    const source = 'https://example.com/washer';
    mocks.ask.mockResolvedValue({ answer: 'Two items', materials: [
      { type: 'A2 washer', source },
      { type: 'A2 nut', source: 'https://example.com/nut' },
    ] });
    mocks.query.mockResolvedValue({ rows: [{ is_admin: true }] });
    expect((await send('Bearer admin', `Add a washer from ${source} and an A2 nut`)).status).toBe(201);
    expect(mocks.insert).toHaveBeenNthCalledWith(1, expect.anything(), { type: 'A2 washer', source });
    expect(mocks.insert).toHaveBeenNthCalledWith(2, expect.anything(), { type: 'A2 nut' });
  });

  it('validates every row before writing any material', async () => {
    mocks.ask.mockResolvedValue({ answer: 'Two items', materials: [
      { type: 'A2 washer' }, { type: 'A2 nut', minimumOrderQuantity: -1 },
    ] });
    expect((await send()).status).toBe(422);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('rejects non-admin requests before calling the worker', async () => {
    expect((await send('Bearer engineer')).status).toBe(403);
    expect(mocks.ask).not.toHaveBeenCalled();
  });
});