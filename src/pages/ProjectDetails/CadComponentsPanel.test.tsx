import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CadComponentsPanel } from './CadComponentsPanel';

vi.mock('./CadPlacementPanel', () => ({ CadPlacementPanel: () => <div>Placement controls</div> }));
const projectId = '00000000-0000-4000-8000-000000000001';
const modelId = '00000000-0000-4000-8000-000000000002';
const componentId = '00000000-0000-4000-8000-000000000003';
const assetId = '00000000-0000-4000-8000-000000000004';
const oldAssetId = '00000000-0000-4000-8000-000000000005';
const fetchMock = vi.fn();
const view = (ready = true) => <FluentProvider theme={webLightTheme}>
  <CadComponentsPanel projectId={projectId} token="test-token" modelVersionId={modelId} ready={ready}
    onPick={vi.fn()} onShow={vi.fn()} onMove={vi.fn()} />
</FluentProvider>;
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ok: true, json: async () => ({}) };
    if (input.endsWith('/catalog')) return { ok: true, json: async () => ({ items: [] }) };
    if (input.endsWith('/cad-assets')) return { ok: true, json: async () => ({ assets: [
      { id: assetId, componentId, revision: 2, originalFilename: 'tee.step', active: true },
      { id: oldAssetId, componentId, revision: 1, originalFilename: 'tee-old.step', active: false },
    ] }) };
    return { ok: true, json: async () => ({ components: [
      { id: componentId, familyName: 'Ladder 300', manufacturer: 'Niedax', partNumber: 'TEE-300', componentKind: 'tee' },
    ] }) };
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Routings builder shared Materials picker', () => {
  it('lists family, component type and independent SKU without offering a project upload', async () => {
    render(view());
    expect(await screen.findByRole('option', { name: /Niedax · Ladder 300 · tee · TEE-300/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('STEP source file')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/materials/components'), expect.objectContaining({
      headers: { Authorization: 'Bearer test-token' },
    }));
  });

  it('selects the active revision and sends only its immutable asset ID', async () => {
    render(view());
    await screen.findByRole('option', { name: /TEE-300/ });
    fireEvent.change(screen.getByLabelText('Materials component'), { target: { value: componentId } });
    const old = await screen.findByRole('option', { name: /Revision 1/ });
    expect(old).toBeDisabled();
    expect(screen.getByLabelText('STEP revision')).toHaveValue(assetId);
    fireEvent.click(screen.getByRole('button', { name: 'Use selected revision' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/projects/${projectId}/cad-design/catalog`),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ assetId }) })));
    expect(await screen.findByText(/Existing instances keep their saved revision/)).toBeInTheDocument();
  });

  it('requires an active model before reading or selecting catalogue entries', () => {
    render(view(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Use selected revision' })).toBeDisabled();
  });

  it('ignores selection completion after the active project model is closed', async () => {
    const rendered = render(view());
    await screen.findByRole('option', { name: /TEE-300/ });
    fireEvent.change(screen.getByLabelText('Materials component'), { target: { value: componentId } });
    await screen.findByRole('option', { name: /Revision 2/ });
    let finish!: (response: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    fetchMock.mockImplementationOnce(() => pending);
    fireEvent.click(screen.getByRole('button', { name: 'Use selected revision' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const calls = fetchMock.mock.calls.length;
    rendered.rerender(view(false));
    await act(async () => { finish({ ok: true }); await pending; });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(screen.queryByText(/Existing instances keep their saved revision/)).not.toBeInTheDocument();
  });

  it('keeps selection disabled and explains a component with no STEP asset', async () => {
    fetchMock.mockImplementation(async (input: string) => ({ ok: true, json: async () =>
      input.endsWith('/catalog') ? { items: [] } : input.endsWith('/cad-assets') ? { assets: [] } : { components: [
        { id: componentId, familyName: 'Ladder 300', manufacturer: 'Niedax', partNumber: 'TEE-300', componentKind: 'tee' },
      ] } }));
    render(view());
    await screen.findByRole('option', { name: /TEE-300/ });
    fireEvent.change(screen.getByLabelText('Materials component'), { target: { value: componentId } });
    expect(await screen.findByText(/This component has no STEP revision/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use selected revision' })).toBeDisabled();
  });
});
