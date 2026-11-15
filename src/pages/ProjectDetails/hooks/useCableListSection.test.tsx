import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent } from 'react';
import type { Cable } from '@/api/types/cable';
import { emptyRoutingControl } from '../../../../shared/cableRoutingControl';
const api = vi.hoisted(() => ({
  fetchCables: vi.fn(),
  fetchCableRows: vi.fn(),
  fetchRecalculationContext: vi.fn(),
  updateCable: vi.fn(),
  importCables: vi.fn(),
  fetchCableVersions: vi.fn(),
}));
vi.mock('@/api/client', () => ({
  ...api,
  ApiError: class extends Error {},
  createCable: vi.fn(),
  deleteCable: vi.fn(),
  exportCables: vi.fn(),
  getCablesTemplate: vi.fn(),
}));
vi.mock('@/api/pathfinderRecalculations', () => ({ fetchRecalculationContext: api.fetchRecalculationContext }));
import { useCableListSection } from './useCableListSection';
const cable = {
  id: 'cable',
  projectId: 'project',
  cableId: 1,
  tag: 'Cable 1',
  routing: '/AUTO',
  cableTypeId: 'type',
  cableWriteRevision: '15',
  routingControlRevision: '8',
  routingControl: emptyRoutingControl(),
  autoCalculatedRouting: '/AUTO',
} as Cable;
const summary = { inserted: 0, updated: 1, unchanged: 0, skipped: 0, blockedRouting: [] };
const digest = 'a'.repeat(64);
const upload = (name = 'cables.xlsx') =>
  ({
    target: { files: [new File(['workbook'], name)], value: name },
  }) as unknown as ChangeEvent<HTMLInputElement>;
function mount(active = false) {
  const showToast = vi.fn();
  const props = {
    active,
    projectId: 'project',
    project: { id: 'project', projectNumber: 'P1' },
    token: 'token',
    showToast,
  };
  return {
    ...renderHook((input = props) => useCableListSection(input), { initialProps: props }),
    showToast,
    props,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.fetchCables.mockResolvedValue({ cables: [cable] });
  api.fetchCableRows.mockImplementation((projectId: string) => api.fetchCables(projectId));
  api.updateCable.mockResolvedValue({ cable });
  api.fetchCableVersions.mockResolvedValue({ versions: [] });
});
describe('cable routing review and inline submission', () => {
  it('does not clear a used automatic route when its empty manual editor is left unchanged', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.cables).toHaveLength(1));
    act(() => result.current.handleCableDraftChange(cable.id, 'routing', ''));
    await act(() => result.current.handleCableTextFieldBlur(cable, 'routing'));
    expect(api.updateCable).not.toHaveBeenCalled();
  });
  it('protects an explicitly entered manual route even when it equals the current automatic route', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.cables).toHaveLength(1));
    act(() => result.current.handleCableDraftChange(cable.id, 'routing', '/AUTO'));
    await act(() => result.current.handleCableTextFieldBlur(cable, 'routing'));
    expect(api.updateCable).toHaveBeenCalledWith('token', 'project', 'cable', {
      routing: '/AUTO',
      manualRoutingProtected: true,
      expectedCableWriteRevision: '15',
      expectedRoutingControlRevision: '8',
    });
  });
  it('clears manual protection with the route, carrying both revision fences', async () => {
    const manual = {
      ...cable,
      routingControl: { ...emptyRoutingControl(), manualRouting: '/M', manualProtected: true },
    };
    api.fetchCables.mockResolvedValue({ cables: [manual] });
    const { result } = mount();
    await waitFor(() => expect(result.current.cables).toHaveLength(1));
    act(() => result.current.handleCableDraftChange(cable.id, 'routing', ''));
    await act(() => result.current.handleCableTextFieldBlur(manual, 'routing'));
    expect(api.updateCable).toHaveBeenCalledWith(
      'token',
      'project',
      'cable',
      expect.objectContaining({ routing: '', manualRoutingProtected: false }),
    );
  });
  it('uploads for preview only, then commits exactly the reviewed file and revision', async () => {
    api.importCables
      .mockResolvedValueOnce({ preview: true, revisionDigest: digest, summary, cables: [] })
      .mockResolvedValueOnce({ summary, cables: [cable] });
    const { result } = mount();
    await act(() => result.current.handleImportCables(upload()));
    expect(api.importCables.mock.calls[0][3]).toEqual({ preview: true, protectRouting: false });
    expect(result.current.cableImportDialog.state).toMatchObject({ completed: false, summary });
    act(() => result.current.cableImportDialog.onCommit());
    await waitFor(() => expect(result.current.cableImportDialog.state.completed).toBe(true));
    expect(api.importCables.mock.calls[1][3]).toEqual({
      protectRouting: false,
      expectedRevisionDigest: digest,
    });
    act(() => result.current.cableImportDialog.onCommit());
    expect(api.importCables).toHaveBeenCalledTimes(2);
  });
  it('requires a new preview after changing protection and ignores older preview responses', async () => {
    let resolve!: (value: unknown) => void;
    api.importCables.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    api.importCables.mockResolvedValueOnce({
      preview: true,
      revisionDigest: digest,
      summary: { ...summary, updated: 2 },
      cables: [],
    });
    const { result } = mount();
    let first!: Promise<void>;
    act(() => {
      first = result.current.handleImportCables(upload());
    });
    act(() => result.current.cableImportDialog.onProtectChange(true));
    await waitFor(() => expect(result.current.cableImportDialog.state.loading).toBe(false));
    await act(async () => {
      resolve({ preview: true, revisionDigest: 'b'.repeat(64), summary, cables: [] });
      await first;
    });
    expect(result.current.cableImportDialog.state).toMatchObject({
      protectRouting: true,
      summary: { updated: 2 },
    });
  });
  it('does not commit an unverifiable preview or a preview from another project', async () => {
    api.importCables.mockResolvedValue({ summary, cables: [] });
    const { result, rerender, props } = mount();
    await act(() => result.current.handleImportCables(upload()));
    expect(result.current.cableImportDialog.state.error).toMatch(/could not be verified/);
    act(() => result.current.cableImportDialog.onCommit());
    expect(api.importCables).toHaveBeenCalledTimes(1);
    await act(async () => {
      rerender({ ...props, projectId: 'other', project: { id: 'other', projectNumber: 'P2' } });
    });
    act(() => result.current.cableImportDialog.onCommit());
    expect(api.importCables).toHaveBeenCalledTimes(1);
  });
  it('keeps every blocked tag and all reasons in the completed report and toaster', async () => {
    const blocked = {
      ...summary,
      blockedRouting: [
        { cableId: 1, tag: 'WG-1', reasons: ['PULL_DATE_RECORDED', 'CONNECTED_TO_RECORDED'] },
      ],
    };
    api.importCables
      .mockResolvedValueOnce({
        preview: true,
        revisionDigest: digest,
        summary: blocked,
        cables: [],
      })
      .mockResolvedValueOnce({ summary: blocked, cables: [cable] });
    const { result, showToast } = mount();
    await act(() => result.current.handleImportCables(upload()));
    act(() => result.current.cableImportDialog.onCommit());
    await waitFor(() => expect(result.current.cableImportDialog.state.completed).toBe(true));
    const toast = showToast.mock.calls.at(-1)![0];
    expect(toast).toMatchObject({ intent: 'warning', action: { label: 'View all' } });
    expect(toast.body).toContain('WG-1');
    expect(toast.body).toContain('Pull date');
    expect(toast.body).toContain('Connected To');
    act(() => result.current.cableImportDialog.onClose());
    act(() => toast.action.onClick());
    expect(result.current.cableImportDialog.state).toMatchObject({ open: true, summary: blocked });
  });
});

describe('live automatic business-row refresh', () => {
  const blank = { ...cable, routing: null, designLength: null, manualRouteLengthStatus: 'not-calculated' } as Cable;
  const saved = { ...blank, routing: '/B002/B003/SECONDARY', designLength: 122, autoCalculatedLength: 122, cableWriteRevision: '16' } as Cable;
  const context = (status = 'calculating', savedCount = 0) => ({ projectId: 'project', enabled: true, paused: false, status,
    controlRevision: '5', desiredGeneration: '7', jobId: 'job', completed: savedCount,
    authority: { expiresAt: new Date(Date.now() + 600000).toISOString() }, progress: { saved: savedCount, processed: savedCount, saving: status === 'complete' ? 0 : 1 } });
  const flush = () => act(async () => {});
  const tick = (ms = 2000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  beforeEach(() => { vi.useFakeTimers(); api.fetchCables.mockResolvedValue({ cables: [blank] });
    api.fetchCableRows.mockResolvedValue({ cables: [blank] }); api.fetchRecalculationContext.mockResolvedValue(context()); });
  afterEach(() => vi.useRealTimers());

  it('updates actual Routing, Auto length and Design as saves progress, drains once complete and never reloads the whole list', async () => {
    api.fetchRecalculationContext.mockResolvedValueOnce(context()).mockResolvedValue(context('complete', 1));
    api.fetchCableRows.mockResolvedValueOnce({ cables: [blank] }).mockResolvedValue({ cables: [saved] });
    const { result } = mount(true); await flush(); expect(result.current.cables[0].routing).toBeNull();
    await tick(); expect(result.current.cables[0]).toMatchObject({ routing: saved.routing, designLength: 122, autoCalculatedLength: 122 });
    await tick(20000); const reads = api.fetchRecalculationContext.mock.calls.length;
    await tick(20000); expect(api.fetchRecalculationContext).toHaveBeenCalledTimes(reads);
    expect(api.fetchCables).toHaveBeenCalledTimes(1);
    expect(api.fetchCableRows.mock.calls.every(call => JSON.stringify(call) === JSON.stringify(['project', ['cable']]))).toBe(true);
    expect(api.updateCable).not.toHaveBeenCalled(); expect(api.importCables).not.toHaveBeenCalled();
  });
  it('backs off a row GET503, retains old values, and retries the same visible read', async () => {
    api.fetchCableRows.mockRejectedValueOnce(Object.assign(new Error('Busy'), { status: 503 })).mockResolvedValue({ cables: [saved] });
    const { result } = mount(true); await flush(); expect(result.current.cables[0].routing).toBeNull();
    await tick(3999); expect(api.fetchCableRows).toHaveBeenCalledTimes(1);
    await tick(1); expect(result.current.cables[0].routing).toBe(saved.routing); expect(api.fetchCables).toHaveBeenCalledTimes(1);
  });
  it('refreshes a newly filtered visible cable after the job finished, retaining the rest of the cached project list', async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ ...blank, id: `row-${i + 1}`, cableId: i + 1, tag: i === 10 ? 'Target 11' : `Cable ${i + 1}` }));
    api.fetchCables.mockResolvedValue({ cables: rows });
    api.fetchRecalculationContext.mockResolvedValueOnce(context()).mockResolvedValue(context('complete', 1));
    api.fetchCableRows.mockResolvedValueOnce({ cables: rows.slice(0, 10) }).mockImplementation((_project, ids: string[]) =>
      Promise.resolve({ cables: rows.filter(row => ids.includes(row.id)).map(row => ({ ...saved, id: row.id, cableId: row.cableId, tag: row.tag })) }));
    const { result } = mount(true); await flush(); await tick(8000);
    expect(result.current.cables.find(row => row.id === 'row-11')?.routing).toBeNull();
    act(() => result.current.setFilterText('Target')); await flush();
    expect(result.current.filterText).toBe('Target'); expect(result.current.pagedCables[0]).toMatchObject({ id: 'row-11', routing: saved.routing, designLength: 122 });
    expect(api.fetchCableRows.mock.calls.at(-1)).toEqual(['project', ['row-11']]); expect(api.fetchCables).toHaveBeenCalledTimes(1);
  });
  it('discards an automatic row response from the previous project', async () => {
    let finish!: (value: { cables: Cable[] }) => void;
    api.fetchCableRows.mockImplementationOnce(() => new Promise(done => { finish = done; }));
    const { result, rerender, props } = mount(true); await flush();
    const other = { ...blank, id: 'other-row', projectId: 'other', routing: '/OTHER' };
    api.fetchCables.mockResolvedValue({ cables: [other] });
    api.fetchRecalculationContext.mockResolvedValue({ ...context('disabled'), enabled: false, projectId: 'other', jobId: null });
    await act(async () => rerender({ ...props, projectId: 'other', project: { id: 'other', projectNumber: 'P2' } }));
    await act(async () => finish({ cables: [saved] })); expect(result.current.cables).toEqual([other]);
  });
  it('rejects older business revisions even when automatic progress says saved', async () => {
    api.fetchRecalculationContext.mockResolvedValueOnce(context()).mockResolvedValue(context('complete', 1));
    api.fetchCableRows.mockResolvedValueOnce({ cables: [{ ...saved, cableWriteRevision: '14' }] }).mockResolvedValue({ cables: [saved] });
    const { result } = mount(true); await flush(); expect(result.current.cables[0].routing).toBeNull();
    await tick(); expect(result.current.cables[0].routing).toBe(saved.routing);
  });
  it('does not overwrite an inline edit with an automatic row response already in flight', async () => {
    let finish!: (value: { cables: Cable[] }) => void;
    api.fetchCableRows.mockImplementationOnce(() => new Promise(done => { finish = done; }));
    const { result } = mount(true); await flush();
    act(() => { result.current.setInlineEditingEnabled(true); result.current.handleCableDraftChange('cable', 'delivery', 'Unsaved'); });
    await act(async () => finish({ cables: [saved] }));
    expect(result.current.cables[0].routing).toBeNull(); expect(result.current.cableDrafts.cable.delivery).toBe('Unsaved');
  });
  it.each(['calculating', 'complete'])('resumes the filtered only-row read after Cancel when the job is %s', async status => {
    const { result } = mount(true); await flush();
    act(() => result.current.setFilterText('Cable 1')); await flush();
    act(() => result.current.openEditCableDialog(result.current.cables[0]));
    act(() => result.current.cableDialog.handleFieldChange('delivery')({} as ChangeEvent<HTMLInputElement>, { value: 'Unsaved delivery' }));
    const readsBeforeCancel = api.fetchCableRows.mock.calls.length;
    api.fetchRecalculationContext.mockResolvedValue(context(status, 1));
    api.fetchCableRows.mockResolvedValue({ cables: [{ ...saved, delivery: null }] });
    await tick(10000);
    expect(api.fetchCableRows).toHaveBeenCalledTimes(readsBeforeCancel);
    expect(result.current.cableDialog.values.delivery).toBe('Unsaved delivery');
    expect(result.current.cables[0].routing).toBeNull();
    act(() => result.current.cableDialog.reset()); await flush();
    expect(result.current.cableDialog.open).toBe(false); expect(result.current.filterText).toBe('Cable 1');
    expect(result.current.pagedCables[0]).toMatchObject({ routing: saved.routing, designLength: 122, autoCalculatedLength: 122, delivery: null });
    expect(api.fetchCables).toHaveBeenCalledTimes(1); expect(api.updateCable).not.toHaveBeenCalled();
  });
  it('resumes reading when the only dirty inline row is discarded after the job completes', async () => {
    const { result } = mount(true); await flush();
    act(() => { result.current.setInlineEditingEnabled(true); result.current.handleCableDraftChange('cable', 'delivery', 'Unsaved'); });
    api.fetchRecalculationContext.mockResolvedValue(context('complete', 1));
    api.fetchCableRows.mockResolvedValue({ cables: [{ ...saved, delivery: null }] });
    await tick(10000); expect(result.current.cables[0].routing).toBeNull();
    act(() => result.current.setInlineEditingEnabled(false)); await flush();
    expect(result.current.cables[0]).toMatchObject({ routing: saved.routing, designLength: 122, delivery: null });
    expect(result.current.cableDrafts.cable.delivery).toBe(''); expect(api.updateCable).not.toHaveBeenCalled();
  });
  it.each(['paused', 'expired', 'blocked'])('stops reading inactive %s calculations instead of looping missing-input rows', async reason => {
    const value = context(reason === 'expired' ? 'calculating' : reason);
    if (reason === 'paused') value.paused = true;
    if (reason === 'expired') value.authority.expiresAt = new Date(Date.now() - 1000).toISOString();
    api.fetchRecalculationContext.mockResolvedValue(value);
    mount(true); await flush(); await tick(120000); expect(api.fetchRecalculationContext).toHaveBeenCalledTimes(1);
  });
  it('does not observe calculation status while the Cable list is inactive', async () => {
    mount(false); await flush(); await tick(120000); expect(api.fetchRecalculationContext).not.toHaveBeenCalled();
  });
  it.each([{ status: 403 }, { code: 'INVALID_RESPONSE', status: null }])('stops denied or unverifiable status reads without a toast or retry: %j', async failure => {
    api.fetchRecalculationContext.mockRejectedValue(Object.assign(new Error('Denied'), failure));
    const { showToast } = mount(true); await flush(); await tick(120000);
    expect(api.fetchRecalculationContext).toHaveBeenCalledTimes(1); expect(api.fetchCableRows).not.toHaveBeenCalled(); expect(showToast).not.toHaveBeenCalled();
  });
  it('observes a live administrator job belonging to another login without requesting new authority', async () => {
    api.fetchRecalculationContext.mockResolvedValue({ ...context(), authority: { ...context().authority, currentLogin: false } });
    api.fetchCableRows.mockResolvedValue({ cables: [saved] });
    const { result } = mount(true); await flush(); expect(result.current.cables[0].routing).toBe(saved.routing);
    expect(api.updateCable).not.toHaveBeenCalled();
  });
});

describe('visible manual calculation read refresh', () => {
  const pending: Cable = {
    ...cable,
    tag: 'Cable 1',
    designLength: 13,
    delivery: null,
    mto: null,
    manualRouteLength: 7,
    manualRouteLengthStatus: 'pending',
    routing: '/MANUAL',
    routingControl: { ...emptyRoutingControl(), manualRouting: '/MANUAL', manualProtected: true },
  };
  const completed = (row = pending): Cable => ({
    ...row,
    designLength: 21,
    manualRouteLength: 21,
    manualRouteLengthStatus: 'calculated',
    cableWriteRevision: '16',
  });
  const flush = () => act(async () => {});
  const tick = (milliseconds = 2000) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  const deferred = () => {
    let resolve!: (value: { cables: Cable[] }) => void;
    return {
      promise: new Promise<{ cables: Cable[] }>((done) => {
        resolve = done;
      }),
      resolve: (value: { cables: Cable[] }) => resolve(value),
    };
  };
  beforeEach(() => {
    vi.useFakeTimers();
    api.fetchCables.mockResolvedValue({ cables: [pending] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes only visible eligible rows to Design 21 while preserving page, filters and another dirty draft', async () => {
    const rows = Array.from(
      { length: 12 },
      (_, index): Cable => ({
        ...pending,
        id: `cable-${index + 1}`,
        cableId: index + 1,
        tag: `Cable ${index + 1}`,
        manualRouteLengthStatus: index === 10 ? 'pending' : index === 11 ? 'stale' : 'calculated',
        routingDiagnostics: index === 11 ? ['MANUAL_CALCULATION_AUTHORITY_REQUIRED'] : [],
      }),
    );
    api.fetchCables
      .mockResolvedValueOnce({ cables: rows })
      .mockResolvedValue({
        cables: rows.map((row) =>
          row.cableId === 11 ? completed(row) : { ...row, designLength: 99 },
        ),
      });
    const { result } = mount();
    await flush();
    act(() => {
      result.current.setInlineEditingEnabled(true);
      result.current.handleCableDraftChange('cable-1', 'tag', 'Unsaved tag');
      result.current.setFilterCriteria('tag');
      result.current.setFilterText('Cable');
    });
    act(() => result.current.goToPage(2));
    await tick();
    expect(result.current.cablesPage).toBe(2);
    expect(result.current.filterText).toBe('Cable');
    expect(result.current.filterCriteria).toBe('tag');
    expect(result.current.pagedCables.find((row) => row.cableId === 11)?.designLength).toBe(21);
    expect(result.current.cables.find((row) => row.cableId === 1)?.designLength).toBe(13);
    expect(result.current.cables.find((row) => row.cableId === 12)?.designLength).toBe(13);
    expect(result.current.cableDrafts['cable-1'].tag).toBe('Unsaved tag');
    expect(result.current.cableDrafts['cable-11'].designLength).toBe('21');
    await tick(10000);
    expect(api.fetchCables).toHaveBeenCalledTimes(2);
    expect(api.updateCable).not.toHaveBeenCalled();
    expect(api.importCables).not.toHaveBeenCalled();
  });

  it.each([
    ['cableWriteRevision', '14'],
    ['routingControlRevision', '7'],
  ] as const)(
    'ignores an older %s response and keeps reading until the current Design result arrives',
    async (field, revision) => {
      api.fetchCables
        .mockResolvedValueOnce({ cables: [pending] })
        .mockResolvedValueOnce({ cables: [{ ...completed(), [field]: revision }] })
        .mockResolvedValue({ cables: [completed()] });
      const { result } = mount();
      await flush();
      await tick();
      expect(result.current.cables[0]).toMatchObject({
        designLength: 13,
        manualRouteLengthStatus: 'pending',
      });
      await tick();
      expect(result.current.cables[0]).toMatchObject({
        designLength: 21,
        cableWriteRevision: '16',
      });
      expect(api.fetchCables).toHaveBeenCalledTimes(3);
    },
  );

  it('discards a read already in flight when the user starts a dirty inline edit', async () => {
    const read = deferred();
    api.fetchCables.mockResolvedValueOnce({ cables: [pending] }).mockReturnValueOnce(read.promise);
    const { result } = mount();
    await flush();
    await tick();
    act(() => {
      result.current.setInlineEditingEnabled(true);
      result.current.handleCableDraftChange(pending.id, 'delivery', 'Unsaved delivery');
    });
    await act(async () => {
      read.resolve({ cables: [completed()] });
    });
    expect(result.current.cables[0].designLength).toBe(13);
    expect(result.current.cableDrafts[pending.id].delivery).toBe('Unsaved delivery');
    await tick(10000);
    expect(api.fetchCables).toHaveBeenCalledTimes(2);
  });

  it('discards a previous project read after switching projects', async () => {
    const read = deferred(),
      other = { ...completed(), projectId: 'other', id: 'other-cable', designLength: 8 };
    api.fetchCables
      .mockResolvedValueOnce({ cables: [pending] })
      .mockReturnValueOnce(read.promise)
      .mockResolvedValue({ cables: [other] });
    const { result, rerender, props } = mount();
    await flush();
    await tick();
    await act(async () =>
      rerender({ ...props, projectId: 'other', project: { id: 'other', projectNumber: 'P2' } }),
    );
    await act(async () => read.resolve({ cables: [completed()] }));
    expect(result.current.cables).toEqual([other]);
    expect(api.fetchCables.mock.calls.at(-1)).toEqual(['other']);
  });

  it('discards a previous login read and starts a separate read for the new login', async () => {
    const read = deferred();
    api.fetchCables
      .mockResolvedValueOnce({ cables: [pending] })
      .mockReturnValueOnce(read.promise)
      .mockResolvedValue({ cables: [completed()] });
    const { result, rerender, props } = mount();
    await flush();
    await tick();
    await act(async () => rerender({ ...props, token: 'other-token' }));
    await act(async () => read.resolve({ cables: [{ ...completed(), designLength: 99 }] }));
    expect(result.current.cables[0].designLength).toBe(13);
    await tick();
    expect(result.current.cables[0].designLength).toBe(21);
    expect(api.fetchCables).toHaveBeenCalledTimes(3);
  });

  it('does not refresh legacy pending or stale rows that require calculation authority', async () => {
    api.fetchCables.mockResolvedValue({
      cables: ['pending', 'stale'].map((status, index) => ({
        ...pending,
        id: `legacy-${index}`,
        manualRouteLengthStatus: status,
        routingDiagnostics: ['MANUAL_CALCULATION_AUTHORITY_REQUIRED'],
      })),
    });
    mount();
    await flush();
    await tick(120000);
    expect(api.fetchCables).toHaveBeenCalledTimes(1);
  });

  it('stops after thirty bounded reads without submitting another calculation', async () => {
    mount();
    await flush();
    await tick(62000);
    expect(api.fetchCables).toHaveBeenCalledTimes(31);
    await tick(120000);
    expect(api.fetchCables).toHaveBeenCalledTimes(31);
    expect(api.updateCable).not.toHaveBeenCalled();
    expect(api.importCables).not.toHaveBeenCalled();
  });

  it('discards an in-flight result while an inline user write is pending', async () => {
    const read = deferred();
    let finishWrite!: (value: { cable: Cable }) => void;
    api.fetchCables.mockResolvedValueOnce({ cables: [pending] }).mockReturnValueOnce(read.promise);
    api.updateCable.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finishWrite = done;
        }),
    );
    const { result } = mount();
    await flush();
    await tick();
    let write!: Promise<void>;
    act(() => {
      write = result.current.handleInlineMtoChange(pending, 'LV');
    });
    await act(async () => read.resolve({ cables: [completed()] }));
    expect(result.current.cables[0].designLength).toBe(13);
    await act(async () => {
      finishWrite({ cable: { ...pending, mto: 'LV', cableWriteRevision: '17' } });
      await write;
    });
    expect(result.current.cables[0]).toMatchObject({
      designLength: 13,
      mto: 'LV',
      cableWriteRevision: '17',
    });
  });
});
