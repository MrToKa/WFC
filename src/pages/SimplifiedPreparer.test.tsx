import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ token: 'fixture-wfc-token', user: { isAdmin: true }, open: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => mocks }));
vi.mock('@/api/preparer', () => ({ openPreparerSession: mocks.open }));
import { SimplifiedPreparer } from './SimplifiedPreparer';
const page = () => <FluentProvider theme={webLightTheme}><SimplifiedPreparer /></FluentProvider>;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  mocks.token = 'fixture-wfc-token'; mocks.user = { isAdmin: true }; mocks.open.mockReset().mockResolvedValue({ url: 'http://192.168.5.55:8083' });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('admin preparer entry', () => {
  it('opens a separate isolated tab with current account and leaves APS inputs in the preparer page', async () => {
    const target = { opener: window, closed: false, close: vi.fn(), location: { replace: vi.fn() } }; vi.spyOn(window, 'open').mockReturnValue(target as unknown as Window);
    render(page()); fireEvent.click(screen.getByRole('button', { name: 'Open model preparer' }));
    expect(target.opener).toBeNull(); expect(mocks.open).toHaveBeenCalledWith('fixture-wfc-token', expect.any(AbortSignal)); await waitFor(() => expect(target.location.replace).toHaveBeenCalledWith('http://192.168.5.55:8083'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(screen.getByText(/Manage your Autodesk connection/)).toBeInTheDocument();
  });
  it('provides a clear link if the browser blocks the new tab', async () => { vi.spyOn(window, 'open').mockReturnValue(null); render(page()); fireEvent.click(screen.getByRole('button', { name: 'Open model preparer' })); expect(await screen.findByRole('link', { name: 'continue to the model preparer' })).toHaveAttribute('href', 'http://192.168.5.55:8083'); });
  it('refuses engineer access even when mounted without the route guard', () => { mocks.user = { isAdmin: false }; render(page()); expect(screen.queryByRole('button', { name: 'Open model preparer' })).not.toBeInTheDocument(); expect(mocks.open).not.toHaveBeenCalled(); });
  it('closes the pending tab and explains setup failure without exposing credentials', async () => {
    const target = { opener: window, close: vi.fn() }; vi.spyOn(window, 'open').mockReturnValue(target as unknown as Window); mocks.open.mockRejectedValue(new Error('The model preparer is not configured.'));
    render(page()); fireEvent.click(screen.getByRole('button', { name: 'Open model preparer' })); expect(await screen.findByText('The model preparer is not configured.')).toBeInTheDocument(); expect(target.close).toHaveBeenCalled();
  });
  it('does not navigate a late handoff after the account changes', async () => {
    let resolve!: (value: { url: string }) => void; mocks.open.mockReturnValue(new Promise(value => { resolve = value; }));
    const target = { opener: window, closed: false, close: vi.fn(), location: { replace: vi.fn() } }; vi.spyOn(window, 'open').mockReturnValue(target as unknown as Window);
    const rendered = render(page()); fireEvent.click(screen.getByRole('button', { name: 'Open model preparer' })); mocks.token = 'new-login'; rendered.rerender(page());
    await act(async () => { resolve({ url: 'http://127.0.0.1:5193' }); }); expect(target.close).toHaveBeenCalled(); expect(target.location.replace).not.toHaveBeenCalled();
  });
});
