// @vitest-environment node

import type { Request, Response, Router } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  hashPassword: vi.fn(),
  signAccessToken: vi.fn(),
}));
vi.mock('../db.js', () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
vi.mock('../auth.js', () => ({
  hashPassword: mocks.hashPassword,
  signAccessToken: mocks.signAccessToken,
  createUserId: () => 'new-user-id',
  verifyAccessToken: vi.fn(),
  verifyPassword: vi.fn(),
}));

import { adminUsersRouter } from './adminUserRoutes.js';
import { authRouter } from './authRoutes.js';
import { userRouter } from './userRoutes.js';

type Handler = (req: Request, res: Response) => Promise<void>;
type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] };
};

const handlerFor = (router: Router, method: string, path: string): Handler => {
  const layers = (router as unknown as { stack: Layer[] }).stack;
  const route = layers.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  )?.route;
  const handler = route?.stack.at(-1)?.handle;
  if (!handler) throw new Error(`Missing ${method} ${path}`);
  return handler;
};

const responseStub = () => {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
};

const row = {
  id: 'target-user-id',
  email: 'user@example.com',
  password_hash: 'stored-hash',
  is_admin: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};
const client = { query: vi.fn(), release: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.query.mockResolvedValue({ rows: [row] });
  mocks.connect.mockResolvedValue(client);
  mocks.hashPassword.mockResolvedValue('new-password-hash');
  mocks.signAccessToken.mockReturnValue({ token: 'token', expiresInSeconds: 60 });
  client.query.mockResolvedValue({ rows: [row] });
});

afterEach(() => vi.restoreAllMocks());

describe.each([
  { name: 'own profile', router: userRouter, path: '/me', targetId: 'actor-id' },
  {
    name: 'admin profile',
    router: adminUsersRouter,
    path: '/users/:userId',
    targetId: 'target-user-id',
  },
])('$name', ({ router, path, targetId }) => {
  const requestWith = (body: unknown) =>
    ({ userId: 'actor-id', params: { userId: targetId }, body }) as unknown as Request;

  it('stores a hashed password and a normalized email for the correct account', async () => {
    const response = responseStub();
    await handlerFor(
      router,
      'patch',
      path,
    )(requestWith({ email: 'USER@example.com', password: 'new-password' }), response);
    expect(mocks.hashPassword).toHaveBeenCalledWith('new-password');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('password_hash = $2'), [
      'user@example.com',
      'new-password-hash',
      targetId,
    ]);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({
      user: expect.not.objectContaining({ password_hash: expect.anything() }),
    });
  });

  it('returns a JSON error when password hashing fails, before updating any data', async () => {
    mocks.hashPassword.mockRejectedValue(new Error('Hashing failed'));
    const response = responseStub();
    await handlerFor(router, 'patch', path)(requestWith({ password: 'new-password' }), response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('preserves password and other omitted fields for a name-only edit', async () => {
    const response = responseStub();
    await handlerFor(router, 'patch', path)(requestWith({ firstName: 'Changed' }), response);

    expect(mocks.hashPassword).not.toHaveBeenCalled();
    const [sql, values] = mocks.query.mock.calls[0];
    expect(sql).toContain('SET first_name = $1, updated_at = NOW()');
    expect(sql).not.toContain('password_hash =');
    expect(values).toEqual(['Changed', targetId]);
  });
});

describe('registration', () => {
  const request = {
    body: { email: 'new@example.com', password: 'new-password' },
  } as Request;

  it.each(['hash', 'connection'])('handles a %s failure with a JSON error', async (failure) => {
    if (failure === 'hash') mocks.hashPassword.mockRejectedValue(new Error('Hashing failed'));
    else mocks.connect.mockRejectedValue(new Error('Database unavailable'));
    const response = responseStub();

    await handlerFor(authRouter, 'post', '/register')(request, response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ error: 'Failed to register user' });
    expect(mocks.signAccessToken).not.toHaveBeenCalled();
  });

  it.each([0, 1])('grants admin access only when the locked user count is %i', async (count) => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT COUNT')) return { rows: [{ count: String(count) }] };
      return { rows: [{ ...row, is_admin: count === 0 }] };
    });
    const response = responseStub();

    await handlerFor(authRouter, 'post', '/register')(request, response);

    const calls = client.query.mock.calls;
    expect(calls[0]).toEqual(['BEGIN']);
    expect(calls[1]).toEqual(['LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE']);
    expect(calls.find(([sql]) => sql.includes('INSERT INTO users'))?.[1]).toEqual([
      'new-user-id',
      'new@example.com',
      'new-password-hash',
      null,
      null,
      count === 0,
    ]);
    expect(calls.at(-1)).toEqual(['COMMIT']);
    expect(client.release).toHaveBeenCalledOnce();
    expect(response.status).toHaveBeenCalledWith(201);
  });
});
