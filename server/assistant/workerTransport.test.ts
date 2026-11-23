import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { analyzeDocument } from './workerTransport.js';

it('waits for delayed analysis and diagnoses a timeout or an interrupted connection', async () => {
  const server = createServer(async (request, response) => {
    request.resume();
    if (request.url === '/interrupt') {
      request.socket.destroy();
      return;
    }
    if (request.url === '/stall') return;
    await delay(40);
    response.end('{"pages":[]}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  try {
    await expect(analyzeDocument(new URL(base), 'fixture', {}, 2000))
      .resolves.toEqual({ status: 200, result: { pages: [] } });
    await expect(analyzeDocument(new URL('/stall', base), 'fixture', {}, 100))
      .rejects.toThrow('Timed out waiting for the assistant worker.');
    await expect(analyzeDocument(new URL('/interrupt', base), 'fixture', {}, 2000))
      .rejects.toThrow('Connection to the assistant worker was interrupted');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
