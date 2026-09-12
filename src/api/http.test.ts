import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request, uploadExcelFile } from './http';
import { downloadProjectFileVersion, uploadProjectFile } from './projectFiles';
import { downloadTemplateFile, uploadTemplateFile } from './templateFiles';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => vi.restoreAllMocks());

describe('HTTP transport', () => {
  it('retries an uncertain protected mutation with the same operation key and revision', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Connection reset'))
      .mockResolvedValueOnce(jsonResponse({ saved: true }));
    await expect(request('/api/example', {
      method: 'PATCH', body: { quantity: 3 }, expectedRevision: 7,
    })).resolves.toEqual({ saved: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual(fetchMock.mock.calls[1]);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      'If-Match': '"7"', 'Idempotency-Key': expect.any(String),
    });
  });

  it('surfaces a stale revision without retrying it', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      error: 'Reload before saving', code: 'REVISION_CONFLICT',
    }, 409));
    await expect(request('/api/example', { method: 'DELETE', expectedRevision: 2 }))
      .rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retains the key for a user retry after both transport attempts fail', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Offline'));
    const options = { method: 'POST' as const, body: { quantity: 2 }, expectedRevision: 10 };
    await expect(request('/api/uncertain-save', options)).rejects.toThrow('Offline');
    const firstKey = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['Idempotency-Key'];
    fetchMock.mockImplementation(async () => jsonResponse({ saved: true }));
    await request('/api/uncertain-save', options);
    expect((fetchMock.mock.calls[2][1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(firstKey);
    await request('/api/uncertain-save', options);
    expect((fetchMock.mock.calls[3][1]?.headers as Record<string, string>)['Idempotency-Key']).not.toBe(firstKey);
  });

  it('does not retry writes without an atomic receipt contract', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network lost'));
    await expect(request('/api/example', { method: 'POST', body: {} })).rejects.toThrow('Network lost');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('preserves the revision, operation key and file across uncertain import retries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Offline'));
    const file = new File(['workbook'], 'materials.xlsx');
    await expect(uploadExcelFile('/api/uncertain-import', 'token', file, 'Import failed', { expectedRevision: 3 }))
      .rejects.toThrow('Offline');
    expect(fetchMock.mock.calls[0][1]).toBe(fetchMock.mock.calls[1][1]);
    fetchMock.mockResolvedValue(jsonResponse({ imported: 2 }));
    await uploadExcelFile('/api/uncertain-import', 'token', file, 'Import failed', { expectedRevision: 3 });
    expect(fetchMock.mock.calls[2][1]?.headers).toEqual(fetchMock.mock.calls[0][1]?.headers);
    expect((fetchMock.mock.calls[2][1]?.body as FormData).get('file')).toBe(file);
  });

  it.each([false, 0, '', null])('preserves the JSON request body %j', async (body) => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ saved: true }));
    await request('/api/example', { method: 'POST', token: 'token', body });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/example$/),
      expect.objectContaining({ body: JSON.stringify(body) }),
    );
  });

  it('accepts successful empty JSON responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204, headers: { 'content-type': 'application/json' } }),
    );
    await expect(request('/api/example', { method: 'DELETE' })).resolves.toBeNull();
  });

  it('preserves the HTTP status when an error body contains invalid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 401, headers: { 'content-type': 'application/json' } }),
    );
    await expect(request('/api/example')).rejects.toMatchObject({
      status: 401,
      message: 'Request failed',
    });
  });

  it('rejects malformed successful JSON instead of returning an empty success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(request('/api/example')).rejects.toThrow(
      'Received invalid JSON response from API',
    );
  });

  it('uses the first actual field validation message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: { fieldErrors: { optional: [], name: ['Name is required'] } } }, 400),
    );
    await expect(request('/api/example')).rejects.toMatchObject({
      status: 400,
      message: 'Name is required',
    });
  });

  it('falls back safely for an unexpected error payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: { fieldErrors: null } }, 500),
    );
    await expect(request('/api/example')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('project and template files', () => {
  it('preserves both duplicate-file identifiers for the replace dialogs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'Already exists', fileId: 'file-1' }, 409),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'Already exists', templateId: 'template-1' }, 409),
    );
    const file = new File(['content'], 'design.pdf');
    await expect(uploadProjectFile('token', 'project-1', file)).rejects.toMatchObject({
      status: 409,
      fileId: 'file-1',
    });
    await expect(uploadTemplateFile('token', file)).rejects.toMatchObject({
      status: 409,
      templateId: 'template-1',
    });
  });

  it('uploads multipart data with an encoded replacement ID', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ file: { id: 'file' } }));
    const file = new File(['content'], 'design.pdf');
    await uploadProjectFile('token', 'project', file, { replaceFileId: 'a/b&c' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/projects\/project\/files\?replaceId=a%2Fb%26c$/);
    expect(options?.headers).toEqual({ Authorization: 'Bearer token' });
    expect((options?.body as FormData).get('file')).toBe(file);
  });

  it('retains server errors on version downloads and returns binary content on success', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Version no longer exists' }, 404));
    await expect(
      downloadProjectFileVersion('token', 'project', 'file', 'version'),
    ).rejects.toMatchObject({
      status: 404,
      message: 'Version no longer exists',
    });
    fetchMock.mockResolvedValueOnce(
      new Response('pdf', { headers: { 'content-type': 'application/pdf' } }),
    );
    const download = await downloadTemplateFile('token', 'template');
    expect(download.contentType).toBe('application/pdf');
    expect(download.blob.size).toBe(3);
  });
});
