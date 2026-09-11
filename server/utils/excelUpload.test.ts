// @vitest-environment node

import express from 'express';
import type { Server } from 'node:http';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uploadExcelFile } from './excelUpload.js';

describe('Excel upload middleware', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    const app = express();
    app.post('/import', uploadExcelFile, (_req, res) => res.json({ accepted: true }));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    url = `http://127.0.0.1:${address.port}/import`;
  });

  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  });

  const upload = async (content: Uint8Array | string, name: string, field = 'file') => {
    const body = new FormData();
    body.append(
      field,
      new Blob([typeof content === 'string' ? content : new Uint8Array(content)]),
      name,
    );
    return fetch(url, { method: 'POST', body });
  };

  it('accepts an actual XLSX workbook with a case-insensitive extension', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Type'], ['Material']]));
    const response = await upload(
      XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
      'materials.XLSX',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
  });

  it.each([
    ['Type\nMaterial', 'materials.csv', 'Only .xlsx'],
    ['Type\nMaterial', 'materials.xlsx', 'not a valid .xlsx'],
    ['', 'materials.xlsx', 'not a valid .xlsx'],
  ])(
    'returns an actionable JSON error for invalid file %s / %s',
    async (content, name, message) => {
      const response = await upload(content, name);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.stringContaining(message) });
    },
  );

  it('returns JSON when the file is larger than 5 MB', async () => {
    const response = await upload(new Uint8Array(5 * 1024 * 1024 + 1), 'materials.xlsx');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringContaining('5 MB') });
  });

  it('returns JSON for an unexpected multipart file field', async () => {
    const response = await upload('file', 'materials.xlsx', 'wrongField');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringContaining('Select one .xlsx') });
  });

  it('returns JSON for a missing upload', async () => {
    const response = await fetch(url, { method: 'POST', body: new FormData() });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringContaining('Select an .xlsx') });
  });
});
