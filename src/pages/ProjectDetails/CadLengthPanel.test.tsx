import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadPlacementPanel } from './CadPlacementPanel';

const projectId = '00000000-0000-4000-8000-000000000001';
const modelVersionId = '00000000-0000-4000-8000-000000000002';
const designId = '00000000-0000-4000-8000-000000000003';
const catalogId = '00000000-0000-4000-8000-000000000004';
const instanceId = '00000000-0000-4000-8000-000000000005';
const row = { id: instanceId, catalogItemId: catalogId, partNumber: 'STRAIGHT-300', manufacturer: 'Niedax',
  revision: 1, xMm: 100, yMm: 200, zMm: 300, qx: 0, qy: 0, qz: 0, qw: 1, lengthMm: 1500 };

function mount(existing = false, connected = false, kind = 'straight') {
  let rows = existing ? [{ ...row }] : [];
  const request = vi.fn(async (input: string, options?: RequestInit) => {
    if (options?.method === 'POST' && input.endsWith('/instances')) {
      const body = JSON.parse(String(options.body)); rows = [{ ...row, lengthMm: body.lengthMm }];
      return { ok: true, json: async () => ({ id: instanceId, revision: 1 }) };
    }
    if (options?.method === 'PATCH') {
      const body = JSON.parse(String(options.body)); rows = [{ ...row, revision: 2, lengthMm: body.lengthMm }];
      return { ok: true, json: async () => ({ id: instanceId, revision: 2 }) };
    }
    return { ok: true, json: async () => input.endsWith('/designs')
      ? { designs: [{ id: designId, modelVersionId, activeModel: true, status: 'proposed' }] }
      : input.endsWith('/instances') ? { instances: rows }
        : input.endsWith('/connections') ? { connections: connected ? [{ id: 'link', sourceInstanceId: instanceId, targetInstanceId: 'other' }] : [] }
          : { schemaVersion: 1, units: 'mm', length: rows[0]?.lengthMm } };
  });
  vi.stubGlobal('fetch', request);
  const onShow = vi.fn().mockResolvedValue(undefined);
  render(<FluentProvider theme={webLightTheme}><CadPlacementPanel projectId={projectId} modelVersionId={modelVersionId}
    token="test-token" catalogue={[{ id: catalogId, partNumber: 'STRAIGHT-300', manufacturer: 'Niedax',
      originalFilename: 'NDX_KL_60-303_F_MED_214.step', sourceSha256: 'd381a3f4a09559e99119e3e591137f73780d16bf832019f93b20627adc5609cd',
      componentKind: kind, conversionStatus: 'ready', materialAssetId: catalogId }]}
    onPick={vi.fn()} onShow={onShow} onMove={vi.fn()} /></FluentProvider>);
  return { request, onShow };
}
afterEach(() => vi.unstubAllGlobals());

describe('straight component length', () => {
  it('saves a 1500 mm new instance and reads its cut mesh instead of the full stock mesh', async () => {
    const { request, onShow } = mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Catalogue component' }), { target: { value: catalogId } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Length (mm)' }), { target: { value: '1500' } });
    expect(screen.getByRole('option', { name: 'End end-face (Z=1500)' })).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form', { name: 'Save component position' }));
    await waitFor(() => expect(onShow).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/instances'), expect.objectContaining({
      method: 'POST', body: expect.stringContaining('"lengthMm":1500'),
    }));
    expect(request).toHaveBeenCalledWith(expect.stringContaining(`/designs/${designId}/instances/${instanceId}/mesh`), expect.anything());
  });
  it('restores the saved length and replaces rendered geometry when it changes', async () => {
    const { request, onShow } = mount(true);
    fireEvent.click(await screen.findByRole('button', { name: /STRAIGHT-300 · 1500 mm — X/ }));
    expect(screen.getByRole('spinbutton', { name: 'Length (mm)' })).toHaveValue(1500);
    await waitFor(() => expect(onShow).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Length (mm)' }), { target: { value: '1000' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Save component position' }));
    await waitFor(() => expect(onShow).toHaveBeenCalledTimes(2));
    expect(request).toHaveBeenCalledWith(expect.stringContaining(`/instances/${instanceId}`), expect.objectContaining({
      method: 'PATCH', body: expect.stringContaining('"lengthMm":1000'),
    }));
  });
  it('refuses stock extension and keeps connected or fitting lengths locked', async () => {
    const { request } = mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Catalogue component' }), { target: { value: catalogId } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Length (mm)' }), { target: { value: '7000' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Save component position' }));
    expect(await screen.findByText('Enter a length from 1 to 6000 mm.')).toBeInTheDocument();
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
  it('requires disconnection before editing a connected saved length', async () => {
    mount(true, true);
    fireEvent.click(await screen.findByRole('button', { name: /STRAIGHT-300 · 1500 mm — X/ }));
    expect(screen.getByRole('spinbutton', { name: 'Length (mm)' })).toBeDisabled();
    expect(screen.getByText('Disconnect this component before changing its length.')).toBeInTheDocument();
  });
  it('does not offer straight cutting for a fitting even if its STEP bytes match', () => {
    mount(false, false, 'bend');
    fireEvent.change(screen.getByRole('combobox', { name: 'Catalogue component' }), { target: { value: catalogId } });
    expect(screen.getByRole('spinbutton', { name: 'Length (mm)' })).toBeDisabled();
  });
});
