import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadPlacementPanel } from './CadPlacementPanel';

const projectId = '00000000-0000-4000-8000-000000000001';
const modelVersionId = '00000000-0000-4000-8000-000000000002';
const designId = '00000000-0000-4000-8000-000000000003';
const catalogId = '00000000-0000-4000-8000-000000000004';
const instanceId = '00000000-0000-4000-8000-000000000005';

function mount(onShow: () => Promise<void>, onFocus = vi.fn().mockResolvedValue(undefined), onRemove?: (id: string) => Promise<void>, deleteStatus = 204) {
  let deleted = false;
  vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
    if (options?.method === 'DELETE') {
      if (deleteStatus === 204) deleted = true;
      return { ok: deleteStatus === 204, status: deleteStatus, json: async () => ({ code: 'STALE_INSTANCE' }) };
    }
    return { ok: true, json: async () =>
    input.endsWith('/designs') ? { designs: [{ id: designId, modelVersionId, activeModel: true, status: 'proposed' }] } :
    input.endsWith('/instances') ? { instances: deleted ? [] : [{ id: instanceId, catalogItemId: catalogId, partNumber: 'STRAIGHT-300',
      manufacturer: 'Niedax', revision: 1, xMm: 100, yMm: 200, zMm: 300, qx: 0, qy: 0, qz: 0, qw: 1 }] } :
    input.endsWith('/connections') ? { connections: onRemove && !deleted ? [{ id: 'link', sourceInstanceId: instanceId, targetInstanceId: 'other' }] : [] } : { schemaVersion: 1, units: 'mm' },
  }; }));
  render(<FluentProvider theme={webLightTheme}>
    <CadPlacementPanel projectId={projectId} modelVersionId={modelVersionId} token="test-token"
      catalogue={[{ id: catalogId, partNumber: 'STRAIGHT-300', manufacturer: 'Niedax', originalFilename: 'custom.step',
        sourceSha256: 'a'.repeat(64), conversionStatus: 'ready', materialAssetId: catalogId, cadRevision: 1 }]}
      onPick={vi.fn()} onShow={onShow} onMove={vi.fn()} onFocus={onFocus} onRemove={onRemove} />
  </FluentProvider>);
  return onFocus;
}
afterEach(() => vi.unstubAllGlobals());

describe('saved CAD component focus', () => {
  it('waits for the display acknowledgement and focuses only the selected saved component UUID', async () => {
    let complete!: () => void;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    const onShow = vi.fn(() => pending);
    const onFocus = mount(onShow);
    const focus = screen.getByRole('button', { name: 'Zoom to selected component' });
    expect(focus).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: /Niedax STRAIGHT-300 — X/ }));
    await waitFor(() => expect(onShow).toHaveBeenCalledOnce());
    expect(focus).toBeDisabled();
    await act(async () => { complete(); await pending; });
    await waitFor(() => expect(focus).toBeEnabled());
    expect(screen.getByText('1 of 1 saved components ready in 3D')).toBeInTheDocument();
    fireEvent.click(focus);
    await waitFor(() => expect(onFocus).toHaveBeenCalledWith(instanceId));
    expect(await screen.findByText('Camera focused on the selected saved component.')).toBeInTheDocument();
  });

  it('keeps focus disabled when the saved mesh fails to display', async () => {
    mount(vi.fn().mockRejectedValue(new Error('Mesh unavailable')));
    fireEvent.click(await screen.findByRole('button', { name: /Niedax STRAIGHT-300 — X/ }));
    expect(await screen.findByText('3D rendering: Mesh unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom to selected component' })).toBeDisabled();
    expect(screen.getByText('0 of 1 saved components ready in 3D')).toBeInTheDocument();
  });
});

describe('removing a proposed CAD component', () => {
  const choose = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /Niedax STRAIGHT-300 — X/ }));
    const button = screen.getByRole('button', { name: 'Remove selected component' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toHaveTextContent('STRAIGHT-300');
  };
  it('requires selection and confirmation, and Cancel leaves the proposal untouched', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    mount(vi.fn().mockResolvedValue(undefined), undefined, onRemove);
    expect(screen.getByRole('button', { name: 'Remove selected component' })).toBeDisabled();
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText('Saved component instances: 1; saved connector relationships: 1')).toBeInTheDocument();
  });
  it('deletes only the selected revision, clears the scene and relationships, and prevents repeat deletion', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    mount(vi.fn().mockResolvedValue(undefined), undefined, onRemove);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Remove component' }));
    expect(await screen.findByText('Component and its connector relationships removed from this proposal.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/designs/${designId}/instances/${instanceId}`),
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ expectedRevision: 1 }) }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(instanceId);
    expect(screen.getByText('Saved component instances: 0; saved connector relationships: 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove selected component' })).toBeDisabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('keeps the saved part and its scene when optimistic concurrency rejects the delete', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    mount(vi.fn().mockResolvedValue(undefined), undefined, onRemove, 409);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Remove component' }));
    expect(await screen.findByText('This component changed. Select it again before removing it.')).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText('Saved component instances: 1; saved connector relationships: 1')).toBeInTheDocument();
  });
  it('reports scene cleanup failure without restoring a successfully deleted server part', async () => {
    mount(vi.fn().mockResolvedValue(undefined), undefined, vi.fn().mockRejectedValue(new Error('Viewer unavailable')));
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Remove component' }));
    expect(await screen.findByText('Component removed from the proposal. Reload the 3D view to clear its remaining display.')).toBeInTheDocument();
    expect(screen.getByText('Saved component instances: 0; saved connector relationships: 0')).toBeInTheDocument();
  });
});
