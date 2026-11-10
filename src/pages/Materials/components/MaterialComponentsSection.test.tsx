import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaterialComponentsSection } from './MaterialComponentsSection';

const family = { id: 'family-1', manufacturer: 'Niedax', name: 'Ladder 300 x 60' };
const straight = {
  id: 'straight-1',
  familyId: family.id,
  familyName: family.name,
  manufacturer: family.manufacturer,
  partNumber: 'KL-300',
  componentKind: 'straight',
  name: 'Straight ladder',
  materialTrayId: 'tray-1',
  latestAssetId: null,
  latestRevision: null,
};
const bend = {
  ...straight,
  id: 'bend-1',
  partNumber: 'KLBK-300',
  componentKind: 'bend',
  name: '90 degree bend',
  materialTrayId: null,
};
const fetchMock = vi.fn();
const renderSection = (isAdmin = true, materialTrayId?: string) =>
  render(
    <MemoryRouter>
      <FluentProvider theme={webLightTheme}>
        <MaterialComponentsSection
          token="catalogue-token"
          isAdmin={isAdmin}
          materialTrayId={materialTrayId}
        />
      </FluentProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
    const data = url.endsWith('/families')
      ? { families: [family] }
      : url.endsWith('/cad-assets')
        ? { assets: [] }
        : options.method === 'POST'
          ? { component: bend }
          : { components: [straight, bend] };
    return { ok: true, json: async () => data };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Materials components', () => {
  it('opens the tray-linked canonical component without offering other SKUs or catalogue creation', async () => {
    const otherTray = {
      ...straight,
      id: 'other-straight',
      partNumber: 'KL-600',
      materialTrayId: 'tray-2',
    };
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith('/families')
          ? { families: [family] }
          : url.endsWith('/cad-assets')
            ? { assets: [] }
            : { components: [bend, otherTray, straight] },
    }));
    renderSection(true, 'tray-1');
    expect(await screen.findByText('KL-300 — STEP revisions')).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/components\/straight-1\/cad-assets$/),
        expect.any(Object),
      ),
    );
    expect(screen.getByLabelText('Component STEP file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add STEP file' })).toBeDisabled();
    expect(screen.queryByLabelText('Catalogue components')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Filter product family')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Find component')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add component' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add product family' })).not.toBeInTheDocument();
    expect(screen.queryByText(/KLBK-300/)).not.toBeInTheDocument();
    expect(screen.queryByText(/KL-600/)).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => /\/(bend-1|other-straight)\/cad-assets$/.test(url)),
    ).toBe(false);
  });

  it('uploads a tray replacement to its canonical component and retains both STEP revisions', async () => {
    const oldAsset = {
      id: 'old',
      revision: 1,
      originalFilename: 'straight-v1.step',
      sourceSha256: 'a'.repeat(64),
      sourceBytes: 200,
      active: true,
    };
    const newAsset = {
      id: 'new',
      revision: 2,
      originalFilename: 'straight-v2.step',
      sourceSha256: 'b'.repeat(64),
      sourceBytes: 300,
      active: true,
    };
    let uploaded = false;
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (url.endsWith('/families'))
        return { ok: true, json: async () => ({ families: [family] }) };
      if (!url.endsWith('/cad-assets'))
        return { ok: true, json: async () => ({ components: [bend, straight] }) };
      if (options.method === 'POST') {
        uploaded = true;
        return { ok: true, json: async () => ({ id: newAsset.id, meshReady: true }) };
      }
      return {
        ok: true,
        json: async () => ({
          assets: uploaded ? [{ ...oldAsset, active: false }, newAsset] : [oldAsset],
        }),
      };
    });
    renderSection(true, 'tray-1');
    await screen.findByRole('button', { name: 'Download revision 1' });
    const replacement = new File(['replacement STEP'], 'straight-v2.step');
    fireEvent.change(screen.getByLabelText('Component STEP file'), {
      target: { files: [replacement] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload replacement STEP' }));
    expect(await screen.findByRole('button', { name: 'Download revision 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download revision 1' })).toBeInTheDocument();
    expect(screen.getByText(/Revision 1 · straight-v1.step/)).toBeInTheDocument();
    expect(screen.getByText(/Revision 2 \(current\) · straight-v2.step/)).toBeInTheDocument();
    expect(
      await screen.findByText(
        'STEP revision saved. Existing project placements keep their pinned revision.',
      ),
    ).toBeInTheDocument();
    const writes = fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toMatch(/\/components\/straight-1\/cad-assets$/);
    expect(writes[0][1].headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer catalogue-token' }),
    );
    expect((writes[0][1].body as FormData).get('file')).toBe(replacement);
  });

  it('shows tray STEP history to non-admins without any upload or creation forms', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith('/families')
          ? { families: [family] }
          : url.endsWith('/cad-assets')
            ? {
                assets: [
                  {
                    id: 'old',
                    revision: 1,
                    originalFilename: 'straight.step',
                    sourceSha256: 'a'.repeat(64),
                    sourceBytes: 200,
                    active: true,
                  },
                ],
              }
            : { components: [bend, straight] },
    }));
    renderSection(false, 'tray-1');
    expect(await screen.findByRole('button', { name: 'Download revision 1' })).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Component STEP file')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload STEP revision' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Upload replacement STEP' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add STEP file' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add component' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('reports a missing tray mapping explicitly without falling back to another component', async () => {
    renderSection(true, 'unmapped-tray');
    expect(
      await screen.findByText(
        'The linked catalogue component is unavailable. Refresh and try again.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Component STEP file')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Component STEP revisions')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Catalogue components')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/cad-assets'))).toBe(false);
  });

  it('keeps the new revision when an older history request completes late', async () => {
    let finishOldHistory!: (response: unknown) => void;
    let historyReads = 0;
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (url.endsWith('/families'))
        return { ok: true, json: async () => ({ families: [family] }) };
      if (!url.endsWith('/cad-assets'))
        return { ok: true, json: async () => ({ components: [straight, bend] }) };
      if (options.method === 'POST')
        return { ok: true, json: async () => ({ id: 'new', meshReady: true }) };
      historyReads += 1;
      if (historyReads === 1)
        return new Promise((resolve) => {
          finishOldHistory = resolve;
        });
      return {
        ok: true,
        json: async () => ({
          assets: [
            {
              id: 'new',
              revision: 2,
              originalFilename: 'bend.step',
              sourceSha256: 'b'.repeat(64),
              sourceBytes: 100,
              active: true,
            },
          ],
        }),
      };
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /KLBK-300 · 90 degree bend/ }));
    await waitFor(() => expect(historyReads).toBe(1));
    fireEvent.change(screen.getByLabelText('Component STEP file'), {
      target: { files: [new File(['STEP'], 'bend.step')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload STEP revision' }));
    expect(await screen.findByRole('button', { name: 'Download revision 2' })).toBeInTheDocument();
    finishOldHistory({ ok: true, json: async () => ({ assets: [] }) });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Download revision 2' })).toBeInTheDocument(),
    );
  });
  it('creates a fitting with an independent part number and family, without reusing a straight tray ID', async () => {
    renderSection();
    await screen.findByRole('button', { name: /KL-300 · Straight ladder/ });
    fireEvent.change(screen.getByLabelText('Product family'), { target: { value: family.id } });
    fireEvent.change(screen.getByLabelText('Component type'), { target: { value: 'bend' } });
    fireEvent.change(screen.getByLabelText('Component part number'), {
      target: { value: 'KLBK-300' },
    });
    fireEvent.change(screen.getByLabelText('Component name'), {
      target: { value: '90 degree bend' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add component' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/materials\/components$/),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            familyId: family.id,
            partNumber: 'KLBK-300',
            componentKind: 'bend',
            name: '90 degree bend',
          }),
          headers: expect.objectContaining({ Authorization: 'Bearer catalogue-token' }),
        }),
      ),
    );
    expect(
      await screen.findByText('Component saved with its own part number.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open straight tray/ })).not.toBeInTheDocument();
  });

  it('rejects oversized files before sending a STEP upload', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /KLBK-300 · 90 degree bend/ }));
    const file = new File(['STEP'], 'bend.step');
    Object.defineProperty(file, 'size', { value: 8 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText('Component STEP file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload STEP revision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Select a non-empty STEP file up to 8 MiB.',
    );
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(
      0,
    );
  });

  it('lets readers inspect previous revisions and the original straight material without write controls', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith('/families')
          ? { families: [family] }
          : url.endsWith('/cad-assets')
            ? {
                assets: [
                  {
                    id: 'old',
                    revision: 1,
                    originalFilename: 'straight-v1.step',
                    sourceSha256: 'a'.repeat(64),
                    sourceBytes: 200,
                    active: false,
                  },
                  {
                    id: 'new',
                    revision: 2,
                    originalFilename: 'straight-v2.step',
                    sourceSha256: 'b'.repeat(64),
                    sourceBytes: 300,
                    active: true,
                  },
                ],
              }
            : { components: [straight] },
    }));
    renderSection(false);
    fireEvent.click(await screen.findByRole('button', { name: /KL-300 · Straight ladder/ }));
    expect(await screen.findByRole('button', { name: 'Download revision 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download revision 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open straight tray/ })).toHaveAttribute(
      'href',
      '/materials/trays/tray-1',
    );
    expect(screen.queryByRole('button', { name: 'Add component' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Component STEP file')).not.toBeInTheDocument();
  });
});
