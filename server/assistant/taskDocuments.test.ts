// @vitest-environment node
import express from 'express';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ query: vi.fn(), remove: vi.fn(), upload: vi.fn() }));
vi.mock('../middleware.js', () => ({
  requireProjectEdit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../db.js', () => ({ pool: {} }));
vi.mock('../pathfinder/transactions.js', () => ({
  transaction: (_pool: unknown, save: (client: unknown) => unknown) => save({ query: mock.query }),
}));
vi.mock('../pathfinder/endpointBindingRepository.js', () => ({
  readCurrentEndpointBindingContext: async () => ({ traceId: 'trace', modelVersionId: model }),
}));
vi.mock('../services/objectStorageService.js', () => ({
  getProjectBucket: () => 'project',
  deleteObject: mock.remove,
  uploadObject: mock.upload,
}));
import { assistantRouter } from './routes.js';
const project = randomUUID(),
  model = randomUUID(),
  author = randomUUID();
const job = {
  id: randomUUID(),
  rulesRevision: 0,
  instructions: '',
  modelVersionId: model,
  files: [
    { id: randomUUID(), versionId: null },
    { id: randomUUID(), versionId: null },
  ],
};
let server: Server, url: string;
beforeAll(async () => {
  vi.stubEnv('WFC_ASSISTANT_URL', 'http://worker');
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    req.userId = author;
    next();
  });
  app.use('/:projectId/assistant', assistantRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url =
    'http://127.0.0.1:' +
    (server.address() as AddressInfo).port +
    '/' +
    project +
    '/assistant/jobs';
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  vi.resetAllMocks();
  mock.query.mockResolvedValue({ rows: [] });
  mock.upload.mockImplementation(async ({ data }) => {
    for await (const _chunk of data) {
      /* drain staging stream */
    }
  });
  mock.remove.mockResolvedValue(undefined);
});
function postDocuments(second = 'лист.csv') {
  const form = new FormData();
  form.set('job', JSON.stringify(job));
  form.append('documents', new Blob(['first']), 'pump.pdf');
  form.append('documents', new Blob(['second']), second);
  return fetch(url, { method: 'POST', body: form });
}
it('saves task sources in order and keeps them available for a later document recheck', async () => {
  expect((await postDocuments()).status).toBe(202);
  const insert = mock.query.mock.calls.find(([sql]) =>
    sql.startsWith('INSERT INTO assistant_jobs'),
  );
  const files = JSON.parse(insert![1][7]);
  expect(files).toMatchObject([
    { name: 'pump.pdf', taskDocument: true },
    { name: 'лист.csv', taskDocument: true },
  ]);
  expect(new Set(files.map((f: { key: string }) => f.key)).size).toBe(2);
  expect(mock.query.mock.calls.some(([sql]) => sql.includes('project_files'))).toBe(false);
  mock.query.mockImplementation(async (sql: string) => ({
    rows: sql.startsWith('SELECT files,scope') ? [{ files, scope: { modelVersionId: model } }] : [],
  }));
  const next = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...job,
      id: randomUUID(),
      previousJobId: job.id,
      instructions: 'Check again',
      followUpMode: 'documents',
      files: [],
    }),
  });
  expect(next.status).toBe(202);
  expect(mock.upload).toHaveBeenCalledTimes(2);
  expect(mock.remove).not.toHaveBeenCalled();
});
it('discards staged objects when a batch fails validation', async () => {
  expect((await postDocuments('unsupported.exe')).status).toBe(400);
  expect(mock.remove).toHaveBeenCalledTimes(1);
  expect(mock.query).not.toHaveBeenCalled();
});
