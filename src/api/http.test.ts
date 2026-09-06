import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request } from './http';
import { downloadProjectFileVersion, uploadProjectFile } from './projectFiles';
import { downloadTemplateFile, uploadTemplateFile } from './templateFiles';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => vi.restoreAllMocks());

describe('HTTP transport', () => {
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
