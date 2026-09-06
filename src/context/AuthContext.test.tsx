import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { ApiError, type User } from '@/api/client';

const mocks = vi.hoisted(() => ({
  fetchUser: vi.fn(),
  login: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchCurrentUser: mocks.fetchUser,
  loginUser: mocks.login,
  updateCurrentUser: mocks.update,
  deleteCurrentUser: mocks.remove,
}));

const user: User = {
  id: 'user-1',
  email: 'user@example.com',
  firstName: 'First',
  lastName: 'User',
  isAdmin: false,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem('wfc_auth_token', 'old-token');
  mocks.fetchUser.mockResolvedValue({ user });
});

describe('authentication request races', () => {
  it.each(['refresh', 'profile'] as const)(
    'does not restore a user when %s finishes after sign-out',
    async (operation) => {
      const { result } = renderHook(useAuth, { wrapper });
      await waitFor(() => expect(result.current.initializing).toBe(false));
      const pending = deferred<{ user: User }>();
      mocks.fetchUser.mockReturnValueOnce(pending.promise);
      mocks.update.mockReturnValueOnce(pending.promise);
      let action!: Promise<void>;
      act(() => {
        action =
          operation === 'refresh'
            ? result.current.refreshUser()
            : result.current.updateProfile({ firstName: 'Updated' });
      });
      act(() => result.current.signOut());
      await act(async () => {
        pending.resolve({ user });
        await action;
      });
      expect(result.current.user).toBeNull();
      expect(result.current.token).toBeNull();
      expect(window.localStorage.getItem('wfc_auth_token')).toBeNull();
    },
  );

  it('does not clear a new session when an old refresh fails with 401', async () => {
    const { result } = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(result.current.initializing).toBe(false));
    const pending = deferred<{ user: User }>();
    mocks.fetchUser.mockReturnValueOnce(pending.promise);
    let refreshing!: Promise<void>;
    act(() => {
      refreshing = result.current.refreshUser();
    });
    act(() => result.current.signOut());
    const newUser = { ...user, id: 'user-2', email: 'second@example.com' };
    mocks.login.mockResolvedValue({ user: newUser, token: 'new-token' });
    mocks.fetchUser.mockResolvedValue({ user: newUser });
    await act(async () => result.current.signIn({ email: newUser.email, password: 'password' }));
    await act(async () => {
      pending.reject(new ApiError(401, 'Expired token'));
      await refreshing;
    });
    expect(result.current.user?.id).toBe('user-2');
    expect(result.current.token).toBe('new-token');
  });

  it('does not apply a pending sign-in after the session is signed out', async () => {
    const { result } = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(result.current.initializing).toBe(false));
    const pending = deferred<{ user: User; token: string }>();
    mocks.login.mockReturnValueOnce(pending.promise);
    let signingIn!: Promise<void>;
    act(() => {
      signingIn = result.current.signIn({ email: user.email, password: 'password' });
    });
    act(() => result.current.signOut());
    await act(async () => {
      pending.resolve({ user, token: 'late-token' });
      await signingIn;
    });
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });
});
