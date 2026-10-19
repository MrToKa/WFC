import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRevisionAdmissions, fetchRevisionResultsPage, fetchRevisionResultDetail, RevisionResultsApiError,
  type RevisionResultsPage, type RevisionResultDetail,
} from '@/api/pathfinderRevisionResults';
import { revisionAdmissionsPageSchema, revisionResultsPageSchema, revisionResultDetailSchema } from '../../../../shared/pathfinderRevisionResults';
import { usePathfinderRevisionResults, type RevisionResultsAccess } from './usePathfinderRevisionResults';

vi.mock('@/api/pathfinderRevisionResults', async original => ({ ...(await original<typeof import('@/api/pathfinderRevisionResults')>()),
  fetchRevisionAdmissions: vi.fn(), fetchRevisionResultsPage: vi.fn(), fetchRevisionResultDetail: vi.fn() }));
const id = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const project = id(1), admission = id(2), cable = id(3), hash = 'a'.repeat(64);
function fixtures() {
  const admissions = revisionAdmissionsPageSchema.parse({ schemaVersion: 'wfc.pf.revision-admissions-page.v1', projectId: project,
    admissions: [{ id: admission, projectId: project, jobId: null, generation: '7', kind: 'automatic', inputSha256: hash, total: 2140, modelRef: null, createdAt: '2026-10-19T12:00:00Z' }], nextCursor: null });
  const page = revisionResultsPageSchema.parse({ schemaVersion: 'wfc.pf.revision-results-page.v1', projectId: project, admissionId: admission, rows: [{
    cableId: cable, baseline: { schemaVersion: 'wfc.pf.cable-revision-baseline.v1', currentCable: { id: cable, tag: 'Cable', fromLocation: 'A', toLocation: 'B', routing: '/OLD', designLength: '7.00000000000000000001', installLength: '6.50', cableWriteRevision: '8' }, lastAcceptedApply: null, acceptedMatchesCurrent: false },
    baselineHash: hash, status: 'locations_required', message: 'Resolve locations.', result: null, currentness: { state: 'current', reasonCodes: [] },
  }], nextAfterCableId: null });
  const detail = revisionResultDetailSchema.parse({ schemaVersion: 'wfc.pf.revision-result-detail.v1', projectId: project, admissionId: admission, row: page.rows[0], envelope: null, engineResult: null, dependencies: null });
  return { admissions, page, detail };
}
const access = (): RevisionResultsAccess => ({ projectId: project, loadedProjectId: project, token: 'current-token', accountId: id(4), isAdmin: true, active: true, contextKey: 'model-A', onAuthorityLost: vi.fn() });
beforeEach(() => {
  vi.resetAllMocks(); const f = fixtures();
  vi.mocked(fetchRevisionAdmissions).mockResolvedValue(f.admissions);
  vi.mocked(fetchRevisionResultsPage).mockResolvedValue(f.page);
  vi.mocked(fetchRevisionResultDetail).mockResolvedValue(f.detail);
});

describe('owned read-only revision-result pages', () => {
  it('never reads for non-admin, absent account or mismatched loaded project', async () => {
    const props = access(), view = renderHook(value => usePathfinderRevisionResults(value), { initialProps: { ...props, isAdmin: false } });
    expect(view.result.current.enabled).toBe(false); expect(fetchRevisionAdmissions).not.toHaveBeenCalled();
    view.rerender({ ...props, accountId: null }); expect(fetchRevisionAdmissions).not.toHaveBeenCalled();
    view.rerender({ ...props, loadedProjectId: id(5) }); expect(fetchRevisionAdmissions).not.toHaveBeenCalled();
    view.rerender(props); await waitFor(() => expect(view.result.current.page?.rows.length).toBe(1));
    expect(view.result.current.admission?.jobId).toBeNull(); expect(view.result.current.page?.rows[0].result).toBeNull();
  });
  it('pages beyond one thousand cables using stable server cursors and can return to the preceding page', async () => {
    const f = fixtures();
    vi.mocked(fetchRevisionResultsPage).mockImplementation(async (_project, _token, selected, input = {}) => {
      const offset = input.afterCableId ? Number(input.afterCableId.slice(-12)) - 1000 : 0;
      const rows = Array.from({ length: 100 }, (_, at) => { const cableId = id(1001 + offset + at); return { ...f.page.rows[0], cableId, baseline: { ...f.page.rows[0].baseline, currentCable: { ...f.page.rows[0].baseline.currentCable, id: cableId, tag: `C-${offset + at + 1}` } } }; });
      return revisionResultsPageSchema.parse({ ...f.page, admissionId: selected, rows, nextAfterCableId: rows.at(-1)!.cableId });
    });
    const view = renderHook(() => usePathfinderRevisionResults(access()));
    await waitFor(() => expect(view.result.current.page?.rows[0].cableId).toBe(id(1001)));
    for (let page = 1; page <= 11; page++) {
      act(() => view.result.current.nextPage());
      await waitFor(() => expect(view.result.current.page?.rows[0].cableId).toBe(id(1001 + page * 100)));
      expect(view.result.current.page?.rows).toHaveLength(100);
    }
    expect(view.result.current.admission?.id).toBe(admission);
    act(() => view.result.current.previousResultsPage());
    await waitFor(() => expect(view.result.current.page?.rows[0].cableId).toBe(id(2001)));
    expect(vi.mocked(fetchRevisionResultsPage).mock.calls.at(-1)?.[3]).toEqual({ afterCableId: id(2000) });
  });
  it('keeps the selected saved scope when refresh discovers a newer admission', async () => {
    const f = fixtures(), view = renderHook(() => usePathfinderRevisionResults(access()));
    await waitFor(() => expect(view.result.current.page).not.toBeNull());
    vi.mocked(fetchRevisionAdmissions).mockResolvedValueOnce({ ...f.admissions, admissions: [{ ...f.admissions.admissions[0], id: id(10), generation: '8' }, ...f.admissions.admissions] });
    act(() => view.result.current.refresh());
    await waitFor(() => expect(view.result.current.admissions[0].id).toBe(id(10)));
    expect(view.result.current.admission?.id).toBe(admission);
    expect(vi.mocked(fetchRevisionResultsPage).mock.calls.at(-1)?.[2]).toBe(admission);
  });
  it('pages the admission list independently without changing the selected cable scope', async () => {
    const f = fixtures(); vi.mocked(fetchRevisionAdmissions).mockResolvedValueOnce({ ...f.admissions, nextCursor: 'older_calculations' })
      .mockResolvedValueOnce({ ...f.admissions, admissions: [{ ...f.admissions.admissions[0], id: id(11), generation: '6' }] });
    const view = renderHook(() => usePathfinderRevisionResults(access()));
    await waitFor(() => expect(view.result.current.page).not.toBeNull());
    act(() => view.result.current.nextAdmissions()); await waitFor(() => expect(view.result.current.admissions[0].id).toBe(id(11)));
    expect(view.result.current.admission?.id).toBe(admission); expect(view.result.current.previousAdmissions).toBe(true);
    expect(vi.mocked(fetchRevisionAdmissions).mock.calls[1][2]).toEqual({ cursor: 'older_calculations' });
    act(() => view.result.current.previousAdmissionsPage()); await waitFor(() => expect(view.result.current.admissions[0].id).toBe(admission));
    expect(view.result.current.admission?.id).toBe(admission);
  });
  it.each([
    { token: 'different-login' }, { accountId: id(12) }, { isAdmin: false }, { active: false }, { contextKey: 'model-B' },
    { projectId: id(13), loadedProjectId: id(13) },
  ])('aborts and fences a late old detail after ownership changes: %j', async change => {
    const f = fixtures(), props = access(); let finish!: (detail: RevisionResultDetail) => void;
    vi.mocked(fetchRevisionResultDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(value => usePathfinderRevisionResults(value), { initialProps: props });
    await waitFor(() => expect(view.result.current.page).not.toBeNull());
    act(() => { void view.result.current.readDetail(cable); });
    const signal = vi.mocked(fetchRevisionResultDetail).mock.calls[0][4];
    view.rerender({ ...props, ...change }); expect(signal?.aborted).toBe(true); expect(view.result.current.detail).toBeNull();
    await act(async () => finish(f.detail)); expect(view.result.current.detail).toBeNull();
    expect(view.result.current.previousPage).toBe(false);
  });
  it('refuses a detail substituted for a different immutable baseline', async () => {
    const f = fixtures(); vi.mocked(fetchRevisionResultDetail).mockResolvedValueOnce({ ...f.detail, row: { ...f.detail.row, baselineHash: 'b'.repeat(64) } });
    const view = renderHook(() => usePathfinderRevisionResults(access()));
    await waitFor(() => expect(view.result.current.page).not.toBeNull()); act(() => { void view.result.current.readDetail(cable); });
    await waitFor(() => expect(view.result.current.error).toMatch(/immutable result no longer matches/));
    expect(view.result.current.detail).toBeNull(); expect(view.result.current.detailLoading).toBe(false);
  });
  it('stops reads and clears all data on server authority denial until the login changes', async () => {
    const props = access(); vi.mocked(fetchRevisionAdmissions).mockRejectedValueOnce(new RevisionResultsApiError('ADMIN_REQUIRED', 403, 'Denied'));
    const view = renderHook(value => usePathfinderRevisionResults(value), { initialProps: props });
    await waitFor(() => expect(props.onAuthorityLost).toHaveBeenCalledOnce()); expect(view.result.current.enabled).toBe(false);
    act(() => view.result.current.refresh()); expect(fetchRevisionAdmissions).toHaveBeenCalledTimes(1);
    expect(view.result.current.page).toBeNull(); expect(view.result.current.detail).toBeNull();
    view.rerender({ ...props, token: 'fresh-login' }); await waitFor(() => expect(view.result.current.page).not.toBeNull());
  });
  it('refuses a nonadvancing cable cursor and never reads a detail outside the current page', async () => {
    const f = fixtures(); vi.mocked(fetchRevisionResultsPage).mockResolvedValueOnce({ ...f.page, nextAfterCableId: id(99) } as RevisionResultsPage);
    const view = renderHook(() => usePathfinderRevisionResults(access()));
    await waitFor(() => expect(view.result.current.error).toMatch(/page cursor could not be verified/));
    expect(view.result.current.page).toBeNull(); expect(view.result.current.pageLoading).toBe(false);
    act(() => { void view.result.current.readDetail(id(90)); }); expect(fetchRevisionResultDetail).not.toHaveBeenCalled();
  });
});
