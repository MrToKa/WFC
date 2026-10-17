import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectDetailsData } from './useProjectDetailsData';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
const response = (canEdit: boolean) => new Response(JSON.stringify({ project: {
  id: 'current-project', canEdit, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
} }), { headers: { 'Content-Type': 'application/json' } });

describe('project permission response login binding', () => {
  it('uses the explicit current login even when stored token belongs to another login', async () => {
    localStorage.setItem('wfc_auth_token', 'old-login');
    const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, options) => {
      return response(new Headers(options?.headers).get('Authorization') === 'Bearer old-login');
    });
    const { result } = renderHook(() => useProjectDetailsData({ projectId: 'current-project', token: 'current-login' }));
    await waitFor(() => expect(result.current.project?.canEdit).toBe(false));
    expect(transport).toHaveBeenCalledOnce();
    const [, options] = transport.mock.calls[0];
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer current-login');
    expect(localStorage.getItem('wfc_auth_token')).toBe('old-login');
  });

  it('makes no request for explicit logout even when stored credentials remain', () => {
    localStorage.setItem('wfc_auth_token', 'old-login');
    const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(true));
    const { result } = renderHook(() => useProjectDetailsData({ projectId: 'current-project', token: null }));
    expect(result.current.project).toBeNull();
    expect(result.current.projectLoading).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it('preserves stored-token lookup for callers that omit the optional token', async () => {
    localStorage.setItem('wfc_auth_token', 'legacy-login');
    const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(true));
    const { result } = renderHook(() => useProjectDetailsData({ projectId: 'current-project' }));
    await waitFor(() => expect(result.current.project?.canEdit).toBe(true));
    const [, options] = transport.mock.calls[0];
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer legacy-login');
  });
});
