import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutingsViewerTab } from './RoutingsViewerTab';
import { useRoutingsViewer } from './hooks/useRoutingsViewer';
import type { CadComponentsPanel } from './CadComponentsPanel';

vi.mock('./hooks/useRoutingsViewer', () => ({ useRoutingsViewer: vi.fn() }));
vi.mock('./hooks/useRoutingsViewerHeight', () => ({ useRoutingsViewerHeight: () => 560 }));
const cadCapture = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./CadComponentsPanel', () => ({ CadComponentsPanel: (props: ComponentProps<typeof CadComponentsPanel>) => {
  cadCapture.render(props);
  return <section aria-label="Tray drawing controls"><input aria-label="Tray name draft" defaultValue="" /></section>;
} }));
const projectId = '11111111-1111-4111-8111-111111111111';
const modelId = '22222222-2222-4222-8222-222222222222';
type State = ReturnType<typeof useRoutingsViewer>;
let current: State;
const props = { projectId, loadedProjectId: projectId, token: 'token-a', canDrawTrays: true };
const view = (overrides: Partial<ComponentProps<typeof RoutingsViewerTab>> = {}, dark = false) =>
  <FluentProvider theme={dark ? webDarkTheme : webLightTheme}><RoutingsViewerTab {...props} {...overrides} /></FluentProvider>;
beforeEach(() => {
  vi.clearAllMocks();
  current = {
    scope: { projectId, loadedProjectId: projectId, token: 'token-a' }, phase: 'ready', message: 'The model and its identifiers are ready.',
    lifecycleKey: 'test-lifecycle', model: { id: modelId, label: 'Current project model' } as NonNullable<State['model']>, canShow: true,
    retry: vi.fn(), showCadComponent: vi.fn(async () => {}),
    pickCadAnchor: vi.fn(async () => ({ objectId: 1, point: [1, 2, 3] as [number, number, number], derivation: 'picked-surface-point' as const })),
    moveCadComponent: vi.fn(async () => {}), setCadComponentProperties: vi.fn(async () => {}), setCadComponentColor: vi.fn(async () => {}),
    removeCadComponent: vi.fn(async () => {}), focusCadComponent: vi.fn(async () => {}),
  };
  vi.mocked(useRoutingsViewer).mockImplementation(() => current);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('Routings builder drawing controls', () => {
  it.each([false, true])('opens Draw trays directly with no obsolete route controls (dark: %s)', dark => {
    const refreshed = vi.fn();
    render(view({ onTraysChanged: refreshed }, dark));
    expect(screen.getByRole('heading', { name: 'Draw trays' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Tray drawing controls' })).toBeVisible();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByText('Manual routing')).toBeNull();
    expect(screen.queryByText('Cables')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Search cable tags' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Show route|Zoom to route|Clear|Show entire model/ })).toBeNull();
    expect(screen.queryByTestId('routing-result')).toBeNull();
    expect(cadCapture.render.mock.lastCall?.[0]).toMatchObject({ projectId, token: 'token-a', modelVersionId: modelId, ready: true,
      onShow: current.showCadComponent, onPick: current.pickCadAnchor, onMove: current.moveCadComponent,
      onFocus: current.focusCadComponent, onRemove: current.removeCadComponent, onColor: current.setCadComponentColor,
      onProperties: current.setCadComponentProperties, onTraysChanged: refreshed });
    expect(screen.getByTestId('routings-model-host')).toBeInTheDocument();
    expect(screen.getByText('Active model: Current project model')).toBeVisible();
  });
  it('preserves drafts while the same project rerenders, and resets them on account or project change', () => {
    const mounted = render(view()), host = screen.getByTestId('routings-model-host');
    fireEvent.change(screen.getByRole('textbox', { name: 'Tray name draft' }), { target: { value: 'Draft tray' } });
    mounted.rerender(view());
    expect(screen.getByRole('textbox', { name: 'Tray name draft' })).toHaveValue('Draft tray');
    mounted.rerender(view({ token: 'token-b' }));
    expect(screen.getByRole('textbox', { name: 'Tray name draft' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'Tray name draft' }), { target: { value: 'Another draft' } });
    mounted.rerender(view({ projectId: modelId, loadedProjectId: modelId, token: 'token-b' }));
    expect(screen.getByRole('textbox', { name: 'Tray name draft' })).toHaveValue('');
    expect(screen.getByTestId('routings-model-host')).toBe(host);
  });
  it.each(['disabled', 'read-only'] as const)('keeps the model viewer when drawing is %s', reason => {
    if (reason === 'disabled') vi.stubEnv('VITE_CAD_DESIGN_ENABLED', 'false');
    render(view({ canDrawTrays: reason !== 'read-only' }));
    expect(screen.getByTestId('routings-model-host')).toBeInTheDocument();
    expect(cadCapture.render).not.toHaveBeenCalled();
    expect(screen.getByText(reason === 'disabled' ? 'Tray drawing is disabled.' : 'You do not have permission to draw trays in this project.')).toBeVisible();
    expect(screen.queryByText('Manual routing')).toBeNull();
    expect(screen.queryByText('Cables')).toBeNull();
  });
  it('retires the drawing draft immediately when permission is lost', () => {
    const mounted = render(view());
    fireEvent.change(screen.getByRole('textbox', { name: 'Tray name draft' }), { target: { value: 'Old draft' } });
    mounted.rerender(view({ canDrawTrays: false }));
    expect(screen.queryByRole('region', { name: 'Tray drawing controls' })).toBeNull();
    mounted.rerender(view());
    expect(screen.getByRole('textbox', { name: 'Tray name draft' })).toHaveValue('');
  });
  it('shows loading and passes readiness to drawing without replacing the model host', () => {
    current = { ...current, phase: 'loading', canShow: false, message: 'Loading model' };
    const mounted = render(view()), host = screen.getByTestId('routings-model-host');
    expect(screen.getByText('Loading model')).toBeVisible();
    expect(cadCapture.render.mock.lastCall?.[0].ready).toBe(false);
    current = { ...current, phase: 'ready', canShow: true };
    mounted.rerender(view());
    expect(cadCapture.render.mock.lastCall?.[0].ready).toBe(true);
    expect(screen.getByTestId('routings-model-host')).toBe(host);
  });
  it('retries model failures and requires sign-in for expired access', () => {
    current = { ...current, phase: 'error', canShow: false, message: 'Model unavailable' };
    const mounted = render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(current.retry).toHaveBeenCalledOnce();
    current = { ...current, phase: 'login-required', message: 'Sign in again' };
    mounted.rerender(view());
    expect(screen.getByText('Sign in again')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
