// @vitest-environment node

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), verifyAccessToken: vi.fn() }));
vi.mock('./db.js', () => ({ pool: { query: mocks.query } }));
vi.mock('./auth.js', () => ({ verifyAccessToken: mocks.verifyAccessToken }));

import { authenticate, requireAdmin, requireProjectEditor, protectDomainMutations, authenticateExports } from './middleware.js';

const responseStub = () => {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
};

beforeEach(() => vi.clearAllMocks());

describe('assigned project engineer boundaries', () => {
  const projectId = '00000000-0000-4000-8000-000000000001';
  it.each(['cables', 'cable-types', 'trays', 'support-distances', 'change-orders', 'internal-ncrs'])(
    'allows an assigned engineer in %s', async (resource) => {
      mocks.verifyAccessToken.mockReturnValue({ sub: 'engineer', isAdmin: false });
      mocks.query.mockResolvedValue({ rows: [{ is_admin: false, assigned: true }] });
      const next = vi.fn();
      protectDomainMutations({ method: 'POST', baseUrl: '/api/projects', params: {}, path: `/${projectId}/${resource}`, header: () => 'Bearer token' } as unknown as Request, responseStub(), next);
      await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
      expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('project_engineers'), ['engineer', projectId]);
    });
  it.each(['', '/clear-data', '/files', '/roxtec-entries'])(
    'keeps main settings and ungranted operations administrator-only: %s', async (suffix) => {
      mocks.verifyAccessToken.mockReturnValue({ sub: 'engineer', isAdmin: false });
      mocks.query.mockResolvedValue({ rows: [{ is_admin: false, assigned: true }] });
      const response = responseStub(); const next = vi.fn();
      protectDomainMutations({ method: 'PATCH', baseUrl: '/api/projects', params: {}, path: `/${projectId}${suffix}`, header: () => 'Bearer token' } as unknown as Request, response, next);
      await vi.waitFor(() => expect(response.status).toHaveBeenCalledWith(403));
      expect(next).not.toHaveBeenCalled();
    });
  it('denies another project or revoked assignment despite an old administrative token', async () => {
    mocks.query.mockResolvedValue({ rows: [{ is_admin: false, assigned: false }] });
    const response = responseStub(); const next = vi.fn();
    await requireProjectEditor({ userId: 'engineer', isAdmin: true, params: { projectId } } as unknown as Request, response, next);
    expect(response.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
  });
});

describe('confirmed domain permission policy', () => {
  it('allows an authenticated ordinary user to generate the existing POST tray export', () => {
    mocks.verifyAccessToken.mockReturnValue({ sub: 'ordinary-user', isAdmin: false });
    const next = vi.fn();
    protectDomainMutations({ method: 'POST', baseUrl: '/api/projects',
      path: '/00000000-0000-4000-8000-000000000001/trays/export', header: () => 'Bearer token',
    } as unknown as Request, responseStub(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('blocks ordinary users making %s requests', async (method) => {
    mocks.verifyAccessToken.mockReturnValue({ sub: 'ordinary-user', isAdmin: false });
    mocks.query.mockResolvedValue({ rows: [{ is_admin: false }] });
    const response = responseStub();
    const next = vi.fn();
    protectDomainMutations({ method, header: () => 'Bearer token' } as unknown as Request, response, next);
    await vi.waitFor(() => expect(response.status).toHaveBeenCalledWith(403));
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('preserves the existing %s read policy', (method) => {
    const next = vi.fn();
    protectDomainMutations({ method } as Request, responseStub(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('allows an administrator after checking their current database role', async () => {
    mocks.verifyAccessToken.mockReturnValue({ sub: 'admin-user' });
    mocks.query.mockResolvedValue({ rows: [{ is_admin: true }] });
    const next = vi.fn();
    protectDomainMutations({ method: 'POST', header: () => 'Bearer token' } as unknown as Request, responseStub(), next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(mocks.query).toHaveBeenCalledWith(expect.any(String), ['admin-user']);
  });

  it.each(['/project/cables/export', '/project/export-excel', '/file/version/download'])
    ('requires authentication for export/download %s', (path) => {
      const response = responseStub();
      const next = vi.fn();
      authenticateExports({ method: 'GET', path, header: () => undefined } as unknown as Request, response, next);
      expect(response.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
});

describe('authenticate', () => {
  it.each(['', 'Basic signed-token', 'signed-token', 'Bearer token extra', 'Bearer '])(
    'rejects a missing or malformed bearer header: %s',
    (header) => {
      const response = responseStub();
      const next = vi.fn();
      authenticate({ header: () => header } as unknown as Request, response, next);
      expect(response.status).toHaveBeenCalledWith(401);
      expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    },
  );

  it('accepts a bearer scheme case-insensitively and authenticates its token', () => {
    mocks.verifyAccessToken.mockReturnValue({ sub: 'user-id', email: 'user@example.com' });
    const request = { header: () => 'bearer signed-token' } as unknown as Request;
    const response = responseStub();
    const next = vi.fn();

    authenticate(request, response, next);

    expect(mocks.verifyAccessToken).toHaveBeenCalledWith('signed-token');
    expect(request.userId).toBe('user-id');
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });
});

describe('requireAdmin', () => {
  it.each([
    '/api/projects/project-id?returnTo=/cables',
    '/api/admin/users?returnTo=/api/projects/project-id/cables',
    '/api/projects/project-id/cables',
  ])('checks database permissions regardless of URL contents: %s', async (originalUrl) => {
    mocks.query.mockResolvedValue({ rows: [{ is_admin: false }] });
    const request = { userId: 'user-id', isAdmin: true, originalUrl } as Request;
    const response = responseStub();
    const next = vi.fn();

    await requireAdmin(request, response, next);

    expect(mocks.query).toHaveBeenCalledWith(expect.any(String), ['user-id']);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests even when a URL contains a cable route', async () => {
    const response = responseStub();
    const next = vi.fn();
    await requireAdmin(
      { originalUrl: '/api/projects/project-id/cables' } as Request,
      response,
      next,
    );
    expect(response.status).toHaveBeenCalledWith(401);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a current database administrator', async () => {
    mocks.query.mockResolvedValue({ rows: [{ is_admin: true }] });
    const request = { userId: 'admin-id', isAdmin: false } as Request;
    const response = responseStub();
    const next = vi.fn();

    await requireAdmin(request, response, next);

    expect(request.isAdmin).toBe(true);
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });
});

describe('catalog export policy', () => {
  it.each(['GET', 'HEAD'])('enforces catalog permissions for case-insensitive Express mounts: %s', async (method) => {
    mocks.verifyAccessToken.mockReturnValue({ sub: 'ordinary' });
    mocks.query.mockResolvedValue({ rows: [{ is_admin: false, is_engineer: false }] });
    const response = responseStub(); const next = vi.fn();
    authenticateExports({ method, baseUrl: '/API/Materials', path: '/Cable-Types/EXPORT', header: () => 'Bearer token' } as unknown as Request, response, next);
    await vi.waitFor(() => expect(response.status).toHaveBeenCalledWith(403));
    expect(next).not.toHaveBeenCalled();
  });
  it.each(['/cable-types/export', '/trays/export', '/supports/template'])('blocks ordinary catalog download %s', async (path) => {
    mocks.verifyAccessToken.mockReturnValue({ sub: 'ordinary', isAdmin: true });
    mocks.query.mockResolvedValue({ rows: [{ is_admin: false, is_engineer: false }] });
    const response = responseStub(); const next = vi.fn();
    authenticateExports({ method: 'GET', baseUrl: '/api/materials', path, header: () => 'Bearer token' } as unknown as Request, response, next);
    await vi.waitFor(() => expect(response.status).toHaveBeenCalledWith(403));
    expect(next).not.toHaveBeenCalled();
  });
  it.each([{ is_admin: true, is_engineer: false }, { is_admin: false, is_engineer: true }])('allows current catalog exporter %o', async (role) => {
    mocks.verifyAccessToken.mockReturnValue({ sub: 'exporter' });
    mocks.query.mockResolvedValue({ rows: [role] });
    const next = vi.fn();
    authenticateExports({ method: 'GET', baseUrl: '/api/materials', path: '/cable-types/export', header: () => 'Bearer token' } as unknown as Request, responseStub(), next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
  });
});
