// @vitest-environment node

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), verifyAccessToken: vi.fn() }));
vi.mock('./db.js', () => ({ pool: { query: mocks.query } }));
vi.mock('./auth.js', () => ({ verifyAccessToken: mocks.verifyAccessToken }));

import { authenticate, requireAdmin } from './middleware.js';

const responseStub = () => {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
};

beforeEach(() => vi.clearAllMocks());

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
