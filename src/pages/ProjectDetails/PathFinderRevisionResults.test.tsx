import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderRevisionResults, type PathFinderRevisionResultsProps } from './PathFinderRevisionResults';
import { usePathfinderRevisionResults } from './hooks/usePathfinderRevisionResults';
import { revisionAdmissionsPageSchema, revisionResultsPageSchema, revisionResultDetailSchema } from '../../../shared/pathfinderRevisionResults';
import { lengthLedgerSchema } from '../../../shared/pathfinderLengthLedger';

vi.mock('./hooks/usePathfinderRevisionResults', () => ({ usePathfinderRevisionResults: vi.fn() }));
const id = (value: number) => `30000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const hash = (value: string) => value.repeat(64);
function fixtures() {
  const model = { id: id(10), selectionRevision: '4', contentFingerprint: hash('a') };
  const ledger = lengthLedgerSchema.parse({ schemaVersion: 'wfc.pf.length-components.v1', formulaVersion: 'pathfinder-45c24bf5', settingsRevision: '9',
    raw: { lengthMeters: 10.25, fromDistanceMeters: 2.25, toDistanceMeters: 0 }, rawLengthDecimalMeters: '10.25',
    from: { requiresSecondary: true, removedApproachMeters: '2.25' }, to: { requiresSecondary: false, removedApproachMeters: '0' },
    settings: { secondaryTrayLengthMeters: '3', endConnectionLengthMeters: '1', additionalBendingPercent: '1.5' },
    secondaryEnds: 1, replacementMeters: '3', beforeClampMeters: '8', clampAdjustmentMeters: '0', afterClampMeters: '8',
    beforePercentageMeters: '12', bendingIncrementMeters: '0.18', unroundedMeters: '12.18', ceilingIncrementMeters: '0.82', designLengthMeters: '13', gapAccounting: 'already-in-raw-geometry' });
  const admissions = revisionAdmissionsPageSchema.parse({ schemaVersion: 'wfc.pf.revision-admissions-page.v1', projectId: id(1),
    admissions: [{ id: id(2), projectId: id(1), jobId: id(3), generation: '7', kind: 'automatic', inputSha256: hash('b'), total: 2140, modelRef: model, createdAt: '2026-10-19T12:00:00Z' }], nextCursor: 'older' });
  const page = revisionResultsPageSchema.parse({ schemaVersion: 'wfc.pf.revision-results-page.v1', projectId: id(1), admissionId: id(2), rows: [{
    cableId: id(4), baseline: { schemaVersion: 'wfc.pf.cable-revision-baseline.v1', currentCable: { id: id(4), tag: 'C-001', fromLocation: 'Panel A', toLocation: 'Motor B', routing: '/CURRENT', designLength: '12.00000000000000000001', installLength: '9.2500', cableWriteRevision: '8' },
      lastAcceptedApply: { receiptId: id(5), proposalId: id(6), proposalHash: hash('c'), dependencyHash: hash('d'), engineResultSha256: hash('e'), revisionResultSha256: null, modelRef: { ...model, id: id(11) }, routeText: '/HISTORICAL', rawLengthMeters: 8.5, designLengthMeters: '10', unroundedMeters: '9.5', ledgerHash: null, appliedAt: '2026-10-18T12:00:00Z', afterCableWriteRevision: '6', afterRouting: '/HISTORICAL', afterDesignLength: '10' }, acceptedMatchesCurrent: false },
    baselineHash: hash('f'), status: 'calculated', message: 'Calculated proposal.', result: { calculationMode: 'calculate', newModel: model, routeText: '/NEW', rawLengthMeters: 10.25, designLengthMeters: '13', unroundedMeters: '12.18',
      delta: { rawLengthMeters: null, designLengthMeters: '0.99999999999999999999', unroundedMeters: null, baseline: 'current-values' }, reasonCodes: ['PROJECT_SETTINGS_CHANGED'],
      proposalId: id(7), proposalHash: hash('1'), revisionResultSha256: hash('2'), engineResultSha256: hash('3'), ledgerHash: hash('4'), dependencyHash: hash('5') }, currentness: { state: 'current', reasonCodes: [] },
  }], nextAfterCableId: id(4) });
  const row = page.rows[0], summary = row.result!;
  const detail = revisionResultDetailSchema.parse({ schemaVersion: 'wfc.pf.revision-result-detail.v1', projectId: id(1), admissionId: id(2), row,
    envelope: { schemaVersion: 'wfc.pf.cable-revision-result.v1', id: id(8), projectId: id(1), admissionId: id(2), jobId: id(3), cableId: id(4), proposalId: id(7),
      proposalHash: summary.proposalHash, baselineHash: row.baselineHash, dependencyHash: summary.dependencyHash, engineResultSha256: summary.engineResultSha256, ledgerHash: summary.ledgerHash,
      oldModel: { ...model, id: id(11) }, summary: { calculationMode: summary.calculationMode, newModel: summary.newModel, routeText: summary.routeText, rawLengthMeters: summary.rawLengthMeters, designLengthMeters: summary.designLengthMeters, unroundedMeters: summary.unroundedMeters, delta: summary.delta, reasonCodes: summary.reasonCodes },
      comparisonRef: null, observedEvents: [{ generation: '7', domain: 'settings', reason: 'PROJECT_SETTINGS_CHANGED', sourceRevisionSha256: null }], lengthLedger: ledger, physicalChangeProven: false, createdAt: '2026-10-19T12:01:00Z', revisionResultSha256: summary.revisionResultSha256 },
    engineResult: { route: { connectionGapCount: 1, connectionGapLengthMeters: 0.25 } }, dependencies: null });
  return { admissions, page, detail };
}
const props = (): PathFinderRevisionResultsProps => ({ projectId: id(1), loadedProjectId: id(1), accountId: id(9), token: 'current-token', isAdmin: true, active: true, contextKey: 'model-A', onOpenProposal: vi.fn() });
function setup() {
  const f = fixtures();
  const state: ReturnType<typeof usePathfinderRevisionResults> = { identity: 'test-owned-scope', admissions: f.admissions.admissions, nextAdmissionsCursor: f.admissions.nextCursor, admission: f.admissions.admissions[0], page: f.page, detail: f.detail,
    admissionsLoading: false, pageLoading: false, detailLoading: false, error: null, previousAdmissions: false, previousPage: true, enabled: true,
    refresh: vi.fn(), readDetail: vi.fn().mockResolvedValue(undefined), selectAdmission: vi.fn(), nextAdmissions: vi.fn(), previousAdmissionsPage: vi.fn(), nextPage: vi.fn(), previousResultsPage: vi.fn() };
  vi.mocked(usePathfinderRevisionResults).mockReturnValue(state); return { f, state };
}
beforeEach(() => vi.clearAllMocks());

describe('administrator cable revision inspection', () => {
  it('selects exact ready page rows while excluding MV, stale and blocked cables', () => {
    const { f, state } = setup(), p = props(), row = f.page.rows[0];
    const rows = [row, { ...row, cableId: id(40), baseline: { ...row.baseline, currentCable: { ...row.baseline.currentCable, id: id(40), tag: 'MV-TEST' } } },
      { ...row, cableId: id(41), baseline: { ...row.baseline, currentCable: { ...row.baseline.currentCable, id: id(41), tag: 'STALE-TEST' } }, currentness: { state: 'changed' as const, reasonCodes: ['CABLE_EDITED'] } }];
    vi.mocked(usePathfinderRevisionResults).mockReturnValue({ ...state, page: { ...f.page, rows } });
    const batch = { entries: [], busy: false, select: vi.fn(), clearSelection: vi.fn() } as unknown as NonNullable<PathFinderRevisionResultsProps['batch']>;
    const cables = rows.map((item, index) => ({ id: item.cableId, mto: index === 1 ? 'MV' : 'Control' })) as PathFinderRevisionResultsProps['cables'];
    render(<PathFinderRevisionResults {...p} batch={batch} cables={cables} />);
    expect(screen.getByRole('checkbox', { name: 'Select MV-TEST for review' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Select STALE-TEST for review' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select ready cables on this page' }));
    expect(batch.select).toHaveBeenCalledTimes(1); expect(batch.select).toHaveBeenCalledWith(expect.objectContaining({ proposalId: row.result!.proposalId, proposalHash: row.result!.proposalHash,
      revisionResultHash: row.result!.revisionResultSha256, cableId: row.cableId, cableWriteRevision: '8', routeText: '/NEW', designLength: '13' }), true);
    expect(batch.clearSelection).not.toHaveBeenCalled();
  });
  it('does not select partial outputs from a cancelled calculation', () => {
    const { f } = setup(), row = f.page.rows[0];
    const batch = { entries: [], busy: false, select: vi.fn(), clearSelection: vi.fn() } as unknown as NonNullable<PathFinderRevisionResultsProps['batch']>;
    render(<PathFinderRevisionResults {...props()} batch={batch}
      cables={[{ id: row.cableId, mto: 'Control' }] as PathFinderRevisionResultsProps['cables']}
      jobs={[{ id: f.admissions.admissions[0].jobId, status: 'cancelled', cancelRequested: true }] as PathFinderRevisionResultsProps['jobs']} />);
    expect(screen.getByRole('checkbox', { name: 'Select C-001 for review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select ready cables on this page' })).toBeDisabled();
    expect(batch.select).not.toHaveBeenCalled();
  });
  it('separates edited current cable values from historical accepted geometry and preserves exact server decimal text', () => {
    setup(); const p = props(); render(<PathFinderRevisionResults {...p} />);
    const current = screen.getByRole('region', { name: 'Current cable at admission' });
    expect(current).toHaveTextContent('Geometric length: Unavailable'); expect(current).toHaveTextContent('12.00000000000000000001 m'); expect(current).toHaveTextContent('9.2500 m');
    const historical = screen.getByRole('region', { name: 'Last accepted Path Finder result' });
    expect(historical).toHaveTextContent('does not describe the current cable geometry'); expect(historical).toHaveTextContent('8.5 m');
    const calculated = screen.getByRole('region', { name: 'New calculated result' });
    expect(calculated).toHaveTextContent('Geometry delta: Unavailable'); expect(calculated).toHaveTextContent('+0.99999999999999999999 m');
    expect(screen.getByText(/Project observations are context/)).toBeVisible(); expect(p.onOpenProposal).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Confirm.*review|Apply reviewed/ })).toBeNull();
  });
  it('shows the recorded ledger, SECONDARY removal/replacement and already-included gaps without deriving a length', () => {
    setup(); render(<PathFinderRevisionResults {...props()} />);
    const ledger = screen.getByRole('region', { name: 'Exact length components' });
    expect(within(ledger).getByText('C# decimal geometric length')).toBeVisible();
    expect(within(ledger).getByText('Removed From approach')).toBeVisible(); expect(within(ledger).getAllByText('2.25 m')).toHaveLength(2);
    expect(within(ledger).getByText('SECONDARY replacement')).toBeVisible(); expect(within(ledger).getByText('0.82 m')).toBeVisible();
    expect(ledger).toHaveTextContent('Connection gaps are already included in raw geometry and are not added again.');
    expect(ledger).toHaveTextContent('Recorded gaps: 1; total 0.25 m.');
  });
  it('keeps blocked no-job generations visible with unavailable output and no invented old result', () => {
    const { f, state } = setup();
    const row = { ...f.page.rows[0], baseline: { ...f.page.rows[0].baseline, lastAcceptedApply: null }, status: 'locations_required', message: 'Resolve the shared location.', result: null };
    const detail = revisionResultDetailSchema.parse({ ...f.detail, row, envelope: null, engineResult: null, dependencies: null });
    vi.mocked(usePathfinderRevisionResults).mockReturnValue({ ...state, admission: { ...state.admission!, jobId: null }, page: { ...f.page, rows: [row] }, detail });
    render(<PathFinderRevisionResults {...props()} />);
    expect(screen.getByText(/This blocked generation has no calculation job/)).toBeVisible();
    expect(screen.getByRole('table', { name: 'Cable revision result page' })).toHaveTextContent('New design: Unavailable');
    expect(screen.getByText(/No linked accepted result/)).toBeVisible(); expect(screen.getByText(/No calculated output is available/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open exact proposal in Viewer' })).toBeDisabled();
    expect(screen.getByText(/Exact length components are unavailable/)).toBeVisible();
  });
  it('delegates paging and one exact proposal ID without creating Review or Apply actions', async () => {
    const { state } = setup(), p = props(); render(<PathFinderRevisionResults {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next cable page' })); expect(state.nextPage).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Previous cable page' })); expect(state.previousResultsPage).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'More calculations' })); expect(state.nextAdmissions).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect C-001' })); expect(state.readDetail).toHaveBeenCalledWith(id(4));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' })));
    expect(p.onOpenProposal).toHaveBeenCalledOnce(); expect(p.onOpenProposal).toHaveBeenCalledWith(id(7));
  });
  it('keeps currentness warnings visible, permits protected inspection, and disables actions while inactive or busy', () => {
    const { f, state } = setup(); vi.mocked(usePathfinderRevisionResults).mockReturnValue({ ...state, detail: { ...f.detail, row: { ...f.detail.row, currentness: { state: 'changed', reasonCodes: ['CABLE_CHANGED'] } } } });
    const p = props(), view = render(<PathFinderRevisionResults {...p} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Currentness: changed'); expect(screen.getByRole('button', { name: 'Open exact proposal in Viewer' })).toBeEnabled();
    view.rerender(<PathFinderRevisionResults {...p} active={false} />); expect(screen.getByRole('button', { name: 'Open exact proposal in Viewer' })).toBeDisabled();
    view.rerender(<PathFinderRevisionResults {...p} busy />); expect(screen.getByRole('button', { name: 'Next cable page' })).toBeDisabled();
    expect(p.onOpenProposal).not.toHaveBeenCalled();
  });
  it('does not expose inspection data or actions to a denied or mismatched account', () => {
    setup(); const p = props(), view = render(<PathFinderRevisionResults {...p} isAdmin={false} />);
    expect(screen.queryByRole('region', { name: 'Cable revision results' })).toBeNull();
    view.rerender(<PathFinderRevisionResults {...p} accountId={null} />); expect(screen.queryByText('C-001')).toBeNull();
    view.rerender(<PathFinderRevisionResults {...p} loadedProjectId={id(40)} />); expect(screen.queryByRole('region', { name: 'Cable revision results' })).toBeNull();
  });
  it('fences a late failed proposal opening after ownership changes', async () => {
    const { state } = setup(), p = props(); let reject!: (reason: Error) => void;
    p.onOpenProposal = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const view = render(<PathFinderRevisionResults {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    vi.mocked(usePathfinderRevisionResults).mockReturnValue({ ...state, detail: null, page: null, admission: null });
    view.rerender(<PathFinderRevisionResults {...p} token="new-login" />);
    await act(async () => reject(new Error('old account private details')));
    expect(screen.queryByText(/could not be opened/)).toBeNull(); expect(screen.queryByText(/private details/)).toBeNull();
  });
});
