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

async function send(authorization = 'Bearer admin') {
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
    body: JSON.stringify({ prompt: 'Add A2 washer, part 123' }),
  });
}

describe('material assistant', () => {
  it('writes validated material to the selected catalog without a project', async () => {
    mocks.ask.mockResolvedValue({ answer: 'One item', materials: [
      { type: 'A2 washer', partNo: '123', weightKg: null },
    ] });
    mocks.query.mockResolvedValue({ rows: [{ is_admin: true }] });
    const response = await send();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ created: 1 });
    expect(mocks.ask).toHaveBeenCalledWith('Add A2 washer, part 123', '/materials', 'Instrument installation material');
    expect(mocks.insert).toHaveBeenCalledWith(expect.anything(), { type: 'A2 washer', partNo: '123' });
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