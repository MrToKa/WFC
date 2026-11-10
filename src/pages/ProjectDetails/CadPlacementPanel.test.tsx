import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadPlacementPanel } from './CadPlacementPanel';

const projectId = '00000000-0000-4000-8000-000000000001';
const modelVersionId = '00000000-0000-4000-8000-000000000002';
const designId = '00000000-0000-4000-8000-000000000003';
const catalogId = '00000000-0000-4000-8000-000000000004';
const instanceId = '00000000-0000-4000-8000-000000000005';

function mount(onShow: () => Promise<void>, onFocus = vi.fn().mockResolvedValue(undefined)) {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => ({ ok: true, json: async () =>
    input.endsWith('/designs') ? { designs: [{ id: designId, modelVersionId, activeModel: true, status: 'proposed' }] } :
    input.endsWith('/instances') ? { instances: [{ id: instanceId, catalogItemId: catalogId, partNumber: 'STRAIGHT-300',
      manufacturer: 'Niedax', revision: 1, xMm: 100, yMm: 200, zMm: 300, qx: 0, qy: 0, qz: 0, qw: 1 }] } :
    input.endsWith('/connections') ? { connections: [] } : { schemaVersion: 1, units: 'mm' },
  })));
  render(<FluentProvider theme={webLightTheme}>
    <CadPlacementPanel projectId={projectId} modelVersionId={modelVersionId} token="test-token"
      catalogue={[{ id: catalogId, partNumber: 'STRAIGHT-300', manufacturer: 'Niedax', originalFilename: 'custom.step',
        sourceSha256: 'a'.repeat(64), conversionStatus: 'ready', materialAssetId: catalogId, cadRevision: 1 }]}
      onPick={vi.fn()} onShow={onShow} onMove={vi.fn()} onFocus={onFocus} />
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
