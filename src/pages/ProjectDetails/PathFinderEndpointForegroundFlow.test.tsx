import { createHash, webcrypto } from 'node:crypto';
import { useCallback, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderResults, type PathFinderWorkflowDisplay } from './PathFinderResults';
import type { usePathFinder } from './hooks/usePathFinder';
import { parsePathFinderProposal } from '@/api/pathfinder';
import { fetchPathFinderCableWorkflowDetail } from '@/api/pathfinderCableWorkflow';
import { fetchCableEndpointContext } from '@/api/pathfinderCableEndpoints';
import { proposalEndpointObjectIds, type PathFinderEndpointForegroundContexts } from './pathFinderEndpointVisibility';
import { PathFinderCableRoutingPanel } from '@/components/pathfinder/PathFinderCableRoutingPanel';
import { useCableEndpointPairSelection } from '@/hooks/useCableEndpointPairSelection';
import { endpointBindingFixture, endpointIds as ids } from '@/test/endpointBindingFixtures';
import { barrierCalculationFixture } from '@/test/pathfinderBarrierFixtures';
import { canonicalPurposeJson } from '../../../shared/pathfinderPurposePolicy';
import { endpointBindingContentHashInput } from '../../../shared/pathfinderEndpointBindings';
import { cableEndpointContextHashInput, cableEndpointContextSchema } from '../../../shared/pathfinderCableEndpoints';
import { cableWorkflowRowSchema } from '../../../shared/pathfinderCableWorkflow';
import { cableWorkflowDetailSchema, cableWorkflowDetailQuerySchema, cableWorkflowDetailQueryHashInput } from '../../../shared/pathfinderCableWorkflowQueries';
import { revisionResultEnvelopeSchema } from '../../../shared/pathfinderRevisionResults';

// Endpoint HTTP, hashing, schemas and the resolver remain real. Only the
// independent calculation-proof read and unrelated history UI are controlled.
vi.mock('@/api/pathfinderCableWorkflow', () => ({ fetchPathFinderCableWorkflowDetail: vi.fn() }));
vi.mock('./PathFinderRecalculationPanel', () => ({ PathFinderRecalculationPanel: () => null }));
vi.mock('./PathFinderRevisionResults', () => ({ PathFinderRevisionResults: () => null }));

const key = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const id = (n: number) => n === 1 ? ids.project : n === 8 ? ids.model : n === 90 ? ids.frame : key(n);
const hash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const busy = () => json({ schemaVersion: 'wfc.pf.cable-endpoint-error.v1', code: 'WORKFLOW_DATABASE_BUSY', message: 'Synthetic concurrent project read.', outcome: 'unknown' }, 503);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

function fixture() {
  const base = endpointBindingFixture(), current = { ...base.context.current!, contentFingerprint: 'a'.repeat(64) };
  const context = (end: 'from' | 'to', sdkObjectId: number) => {
    const head = { ...structuredClone(base.binding), id: key(end === 'from' ? 101 : 102), locationId: key(end === 'from' ? 21 : 22),
      bindingRevision: end === 'from' ? '42' : '5', locationRegistryRevision: '3',
      pointProjectMetres: (end === 'from' ? [9, 2, 3] : [3, 2, 1]) as [number, number, number], supersedesBindingId: end === 'from' ? key(201) : null };
    head.contentSha256 = hash(endpointBindingContentHashInput(head));
    const value = cableEndpointContextSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-context.v1', projectId: ids.project,
      cableId: key(4), end, cableWriteRevision: '10', logicalName: end.toUpperCase(), logicalKey: end.toUpperCase(), mto: 'Control',
      canBind: true, reasonCodes: [], registryRevision: '3', location: { id: head.locationId, revision: head.locationRevision, name: end.toUpperCase(), aliases: [] },
      head, current, confirmedDisplaySelection: { source: 'confirmed-display-only', mode: 'fixed-world', sdkObjectId,
        name: `/Synthetic ${end}`, pointProjectMetres: head.pointProjectMetres, current, bindingId: head.id,
        bindingContentSha256: head.contentSha256, commandSha256: 'd'.repeat(64) }, contextSha256: '0'.repeat(64) });
    value.contextSha256 = hash(cableEndpointContextHashInput(value)); return value;
  };
  const contexts = { from: context('from', 88), to: context('to', 99) };
  const points = [contexts.from.head!.pointProjectMetres, contexts.to.head!.pointProjectMetres] as [number, number, number][];
  const facts = barrierCalculationFixture(id, false, points), now = '2026-10-26T00:00:00Z';
  const envelope = revisionResultEnvelopeSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-result.v1', id: key(80), projectId: ids.project,
    admissionId: key(81), jobId: key(7), cableId: key(4), proposalId: key(3), proposalHash: 'a'.repeat(64), baselineHash: 'd'.repeat(64),
    dependencyHash: 'c'.repeat(64), engineResultSha256: 'e'.repeat(64), ledgerHash: null, oldModel: null,
    summary: { calculationMode: 'calculate', newModel: null, routeText: '/NEW', rawLengthMeters: 7, designLengthMeters: '7', unroundedMeters: '7',
      delta: { rawLengthMeters: null, designLengthMeters: null, unroundedMeters: null, baseline: 'current-values' }, reasonCodes: [] },
    comparisonRef: null, observedEvents: [], lengthLedger: null, physicalChangeProven: false, createdAt: now, revisionResultSha256: 'b'.repeat(64) });
  const bound = (end: 'from' | 'to') => {
    const head = contexts[end].head!;
    return { locationId: head.locationId, locationRevision: head.locationRevision, bindingRevision: head.bindingRevision,
      point: head.pointProjectMetres, bindingId: head.id, bindingContentSha256: head.contentSha256, mode: head.mode,
      captureFrameId: head.captureFrameId, qualifiedProjectFrameId: head.qualifiedProjectFrameId, aggregateId: head.aggregateId,
      projectionSha256: head.projectionSha256, sourceObjectRevisionId: null, migrationDecisionId: null };
  };
  const proposal = parsePathFinderProposal({ schemaVersion: 'wfc.pf.proposal.v2', id: key(3), projectId: ids.project, jobId: key(7), cableId: key(4),
    status: 'calculated', proposalHash: 'a'.repeat(64), revisionResultHash: envelope.revisionResultSha256, revisionBaselineHash: envelope.baselineHash,
    revisionResult: envelope, cableWriteRevision: '9', stale: true, canApply: false, synthetic: true, engineeringAccepted: false,
    acceptanceScope: 'not-accepted', compatibilityIssue: null, message: 'Synthetic post-Save result.', engineeringMessage: 'No engineering acceptance.',
    createdAt: now, routingPreferences: facts.preferences, barriers: facts.barriers,
    provenance: { dependencyVersion: 'pathfinder.dependencies.v8', dependencyHash: 'c'.repeat(64), engineIdentity: facts.engineIdentity, automatic: null,
      endpointSources: { from: 'confirmed-shared-location', to: 'confirmed-shared-location' } },
    design: { lengthBeforePercentageMeters: '7', unroundedLengthMeters: '7', designLengthMeters: '7' },
    route: { success: true, message: 'Synthetic exact route.', routeCodes: ['/NEW'], segmentIds: ['dbid:23'], objectIds: ['dbid:23'], points,
      lengthMeters: 7, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false,
      connectionGapCount: 0, connectionGapLengthMeters: 0, routeText: '/NEW' },
    dependencies: { schemaVersion: 'pathfinder.dependencies.v8', projectId: ids.project,
      model: { id: ids.model, selectionRevision: current.selectionRevision, contentFingerprint: current.contentFingerprint },
      artifact: { id: ids.artifact, sha256: current.projectionSha256 }, preparation: { aggregateId: ids.aggregate, captureFrameId: ids.frame,
        projectionSha256: current.projectionSha256 }, from: bound('from'), to: bound('to') } });
  const available = { status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false,
    candidateObjectIds: [], reasonCode: null, engineeringAccepted: false };
  const row = cableWorkflowRowSchema.parse({ projectId: ids.project, mto: 'Control', cable: { id: key(4), tag: 'Synthetic Save cable',
    fromLocation: 'FROM', toLocation: 'TO', routing: '/NEW', designLength: '7', installLength: '9', cableWriteRevision: '10' }, from: available, to: available,
    calculation: { jobId: key(7), jobStatus: 'complete', itemState: 'complete', outcome: 'calculated', reasonCodes: [], errorCode: null,
      currentness: 'current', proposalId: key(3), proposalHash: proposal.proposalHash, reviewable: false, acceptedMatchesCurrent: true,
      automaticUpdate: { status: 'written', receiptId: key(30), reasonCode: null } } });
  const parent = { id: key(7), projectId: ids.project, status: 'complete', total: 13, completed: 13, cancelRequested: false, failure: null,
    attempts: 1, createdAt: now, updatedAt: now };
  const state = { schemaVersion: 1, projectId: ids.project, registryRevision: '3', activeModel: { modelVersionId: ids.model,
    selectionRevision: current.selectionRevision, contentFingerprint: current.contentFingerprint },
    settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '0' },
    artifacts: [{ id: ids.artifact, modelVersionId: ids.model, snapshotSha256: current.projectionSha256 }], locations: [],
    cables: [{ ...row.cable, mto: row.mto }], jobs: [parent], proposals: [] };
  const pf = { data: state, preparationAccess: { projectId: ids.project, loadedProjectId: ids.project, token: 'synthetic-current-token', isAdmin: true },
    preparationViewerGeneration: 1, viewerPhase: 'ready', busy: false, readProposal: vi.fn(async () => proposal), readJob: vi.fn(async () => parent),
    showPath: vi.fn(async () => 'shown'), clear: vi.fn(), refresh: vi.fn(), action: vi.fn(), calculate: vi.fn(), reviewProposal: vi.fn() };
  const live = cableWorkflowDetailSchema.parse({ schemaVersion: 'wfc.pf.cable-workflow-detail.v1', projectId: ids.project, cableId: key(4),
    querySha256: hash(cableWorkflowDetailQueryHashInput(cableWorkflowDetailQuerySchema.parse(facts.preferences))), contextSha256: 'f'.repeat(64), row });
  return { contexts, proposal, row, parent, state, pf, live, preferences: facts.preferences };
}
type Fixture = ReturnType<typeof fixture>;
function transport(f: Fixture, mode: 'valid' | 'authority' | 'busy' | 'bad-hash' = 'valid', holdRetry = false) {
  const requests: { end: 'from' | 'to'; attempt: number; proofFinished: boolean }[] = [], counts = { from: 0, to: 0 };
  const retryGate = deferred<void>(); let proofFinished = false, firstPeerAborted = false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input), match = url.match(/\/cable-endpoints\/[^/]+\/(from|to)$/);
    if (!match || options?.method !== 'GET') throw new Error(`Unexpected transport: ${url}`);
    const end = match[1] as 'from' | 'to', attempt = ++counts[end]; requests.push({ end, attempt, proofFinished });
    if (attempt === 1) {
      if (end === 'from') return busy();
      return await new Promise<Response>((_resolve, reject) => {
        const abort = () => { firstPeerAborted = true; reject(options!.signal!.reason); };
        if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    if (mode === 'busy') return busy();
    if (holdRetry) await retryGate.promise;
    if (mode === 'authority') return json(null, 403);
    const context = structuredClone(f.contexts[end]);
    if (mode === 'bad-hash') context.contextSha256 = '0'.repeat(64);
    return json(context);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requests, counts, fetchMock, get firstPeerAborted() { return firstPeerAborted; },
    finishProof: () => { proofFinished = true; }, releaseRetry: () => retryGate.resolve() };
}
function savedResult(f: Fixture, changed: (value: PathFinderWorkflowDisplay) => void) {
  const props = { pf: f.pf as unknown as ReturnType<typeof usePathFinder>, selectedCableId: key(4), accountId: ids.actor,
    options: f.preferences, onWorkflowDisplayChange: changed };
  const view = render(<PathFinderResults {...props} workflowSelection={null} />);
  view.rerender(<PathFinderResults {...props} workflowSelection={f.row} />);
  return { view, props };
}
function popupForeground(f: Fixture): PathFinderEndpointForegroundContexts {
  return { projectId: ids.project, accountId: ids.actor, token: 'synthetic-current-token', cableId: key(4),
    ...f.state.activeModel, modelVersionId: ids.model,
    preparationKey: JSON.stringify([f.pf.preparationViewerGeneration, f.state.artifacts.map(item => [item.id, item.snapshotSha256])]),
    ...f.contexts };
}
/** Actual popup + pair/endpoint hooks produce the already SHA-verified contexts. */
function PopupForegroundFlow({ f, popup, hide = false, requestId = 1, changed }: { f: Fixture; popup: boolean; hide?: boolean; requestId?: number;
  changed: (value: PathFinderWorkflowDisplay) => void }) {
  const [contexts, setContexts] = useState<PathFinderEndpointForegroundContexts | null>(null);
  const [denied, setDenied] = useState(false);
  const receive = useCallback((value: PathFinderEndpointForegroundContexts | null) => setContexts(value), []);
  const authorityLost = useCallback(() => { setDenied(true); f.pf.refresh(); }, [f]);
  const owner = popupForeground(f);
  const pf = denied ? { ...f.pf, preparationAccess: { ...f.pf.preparationAccess, isAdmin: false } } : f.pf;
  return <>
    <output data-testid="popup-foreground-ready">{contexts ? 'ready' : 'waiting'}</output>
    <PathFinderResults pf={pf as unknown as ReturnType<typeof usePathFinder>} selectedCableId={key(4)} workflowSelection={f.row}
      accountId={ids.actor} options={f.preferences} onWorkflowDisplayChange={changed} endpointForegroundContexts={contexts}
      workflowDisplayRequest={{ cableId: key(4), requestId, action: hide ? 'hide' : 'show' }} />
    {popup ? <PathFinderCableRoutingPanel cable={f.row} open onClose={() => undefined} pathReady access={{
      projectId: ids.project, loadedProjectId: ids.project, accountId: ids.actor, token: owner.token, isAdmin: !denied, active: true,
      model: f.state.activeModel, preparationKey: owner.preparationKey, calculation: null, initialFill: null,
      readSelection: async () => null, onAuthorityLost: authorityLost,
    }} onEndpointForegroundContexts={receive} /> : null}
  </>;
}
function exhaustedThenPopupTransport(f: Fixture, popupStatus = 200) {
  const counts = { from: 0, to: 0 }, gate = deferred<void>(); let popup = false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const match = String(input).match(/\/cable-endpoints\/[^/]+\/(from|to)$/);
    if (!match || options?.method !== 'GET') throw new Error(`Unexpected transport: ${String(input)}`);
    const end = match[1] as 'from' | 'to'; counts[end]++;
    if (!popup) return busy();
    await gate.promise; return json(popupStatus === 200 ? f.contexts[end] : null, popupStatus);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { counts, fetchMock, startPopup: () => { popup = true; }, release: () => gate.resolve() };
}
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto); vi.mocked(fetchPathFinderCableWorkflowDetail).mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); sessionStorage.clear(); });

describe('post-Save endpoint foreground over verified HTTP contexts', () => {
  it('recovers an already visible route from the real popup pair after all three separate foreground lookups failed', async () => {
    expect(vi.isMockFunction(useCableEndpointPairSelection)).toBe(false);
    expect(vi.isMockFunction(proposalEndpointObjectIds)).toBe(false); expect(vi.isMockFunction(fetchCableEndpointContext)).toBe(false);
    const f = fixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), wire = exhaustedThenPopupTransport(f);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(f.live);
    const view = render(<PopupForegroundFlow f={f} popup={false} changed={changed} />);
    await waitFor(() => expect(wire.counts).toEqual({ from: 3, to: 3 }), { timeout: 3000 });
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: true }));
    expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: key(3), points: f.proposal.route!.points, objectIds: [23] });
    wire.startPopup(); view.rerender(<PopupForegroundFlow f={f} popup changed={changed} />);
    await waitFor(() => expect(wire.counts).toEqual({ from: 4, to: 4 }));
    wire.release();
    await waitFor(() => expect(f.pf.showPath).toHaveBeenLastCalledWith({ pathId: key(3), points: f.proposal.route!.points, objectIds: [23, 88, 99] }));
    expect(f.pf.showPath).toHaveBeenCalledTimes(2); expect(wire.fetchMock).toHaveBeenCalledTimes(8);
    expect((screen.getByLabelText('From assigned model object') as HTMLTextAreaElement).value).toContain('/Synthetic from');
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.readJob).toHaveBeenCalledOnce();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
  });
  it('caches later real popup foreground while hidden and includes both objects on the next Show without re-reading', async () => {
    const f = fixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), wire = exhaustedThenPopupTransport(f);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(f.live);
    const view = render(<PopupForegroundFlow f={f} popup={false} changed={changed} />);
    await waitFor(() => expect(wire.counts).toEqual({ from: 3, to: 3 }), { timeout: 3000 });
    wire.startPopup(); view.rerender(<PopupForegroundFlow f={f} popup hide requestId={2} changed={changed} />);
    await waitFor(() => expect(wire.counts).toEqual({ from: 4, to: 4 })); wire.release();
    await waitFor(() => expect((screen.getByLabelText('From assigned model object') as HTMLTextAreaElement).value).toContain('/Synthetic from'));
    expect(f.pf.showPath).toHaveBeenCalledTimes(1); expect(changed.mock.calls.at(-1)?.[0].visible).toBe(false);
    // A real popup Show request is independent of its successful metadata reads.
    const calls = wire.fetchMock.mock.calls.length;
    view.rerender(<PopupForegroundFlow f={f} popup requestId={3} changed={changed} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenLastCalledWith({ pathId: key(3), points: f.proposal.route!.points, objectIds: [23, 88, 99] }));
    expect(f.pf.showPath).toHaveBeenCalledTimes(2);
    expect(wire.fetchMock).toHaveBeenCalledTimes(calls);
  });
  it('includes popup evidence which arrives before the exact route proof commits in the first Show payload', async () => {
    const f = fixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), wire = exhaustedThenPopupTransport(f), proof = deferred<typeof f.live>();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockReturnValue(proof.promise);
    const view = render(<PopupForegroundFlow f={f} popup={false} changed={changed} />);
    await waitFor(() => expect(wire.counts).toEqual({ from: 1, to: 1 }));
    wire.startPopup(); view.rerender(<PopupForegroundFlow f={f} popup changed={changed} />); wire.release();
    await waitFor(() => expect((screen.getByLabelText('From assigned model object') as HTMLTextAreaElement).value).toContain('/Synthetic from'));
    await waitFor(() => expect(screen.getByTestId('popup-foreground-ready')).toHaveTextContent('ready'));
    expect(f.pf.showPath).not.toHaveBeenCalled(); await act(async () => proof.resolve(f.live));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: key(3), points: f.proposal.route!.points, objectIds: [23, 88, 99] }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    expect(wire.fetchMock).toHaveBeenCalledTimes(4); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
  });
  it('never strips popup foreground when an older successful HTTP lookup later returns no display objects', async () => {
    const f = fixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), oldLookup = deferred<void>();
    let popup = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const match = String(input).match(/\/cable-endpoints\/[^/]+\/(from|to)$/);
      if (!match || options?.method !== 'GET') throw new Error('Unexpected transport');
      const end = match[1] as 'from' | 'to', context = structuredClone(f.contexts[end]);
      if (!popup) { await oldLookup.promise; context.confirmedDisplaySelection = null; context.contextSha256 = hash(cableEndpointContextHashInput(context)); }
      return json(context);
    });
    vi.stubGlobal('fetch', fetchMock); vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(f.live);
    const view = render(<PopupForegroundFlow f={f} popup={false} changed={changed} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: key(3), points: f.proposal.route!.points, objectIds: [23] }));
    popup = true; view.rerender(<PopupForegroundFlow f={f} popup changed={changed} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenLastCalledWith({ pathId: key(3), points: f.proposal.route!.points, objectIds: [23, 88, 99] }));
    await act(async () => oldLookup.resolve());
    expect(f.pf.showPath).toHaveBeenCalledTimes(2); expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.refresh).not.toHaveBeenCalled();
  });
  it.each([401, 403])('does not revive foreground when the real popup context reader reports lost authority (%i)', async status => {
    const f = fixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), wire = exhaustedThenPopupTransport(f, status);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(f.live);
    const view = render(<PopupForegroundFlow f={f} popup={false} changed={changed} />);
    await waitFor(() => expect(wire.counts).toEqual({ from: 3, to: 3 }), { timeout: 3000 });
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].visible).toBe(true));
    wire.startPopup(); view.rerender(<PopupForegroundFlow f={f} popup changed={changed} />); wire.release();
    await waitFor(() => expect(f.pf.refresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false }));
    expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: key(3), points: f.proposal.route!.points, objectIds: [23] });
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('ignores popup context owners from another login, project, cable, model or preparation', async () => {
    const f = fixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), wire = exhaustedThenPopupTransport(f);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(f.live);
    const { view, props } = savedResult(f, changed), request = { cableId: key(4), requestId: 1, action: 'show' as const };
    await waitFor(() => expect(wire.counts).toEqual({ from: 3, to: 3 }), { timeout: 3000 });
    view.rerender(<PathFinderResults {...props} workflowSelection={f.row} workflowDisplayRequest={request} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    const contexts = popupForeground(f);
    for (const field of ['accountId', 'projectId', 'token', 'cableId', 'modelVersionId', 'selectionRevision', 'contentFingerprint', 'preparationKey'] as const) {
      view.rerender(<PathFinderResults {...props} workflowSelection={f.row} workflowDisplayRequest={request}
        endpointForegroundContexts={{ ...contexts, [field]: 'different-owner' }} />);
    }
    expect(f.pf.showPath).toHaveBeenCalledOnce();
    view.rerender(<PathFinderResults {...props} workflowSelection={f.row} workflowDisplayRequest={request} endpointForegroundContexts={contexts} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenLastCalledWith({ pathId: key(3), points: f.proposal.route!.points, objectIds: [23, 88, 99] }));
    expect(wire.fetchMock).toHaveBeenCalledTimes(6); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
  });
  it('recovers both saved objects after a transient lock refusal only after the new automatic-write route proof settles', async () => {
    expect(vi.isMockFunction(proposalEndpointObjectIds)).toBe(false); expect(vi.isMockFunction(fetchCableEndpointContext)).toBe(false);
    const f = fixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), proof = deferred<typeof f.live>();
    const wire = transport(f, 'valid', true);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockReturnValue(proof.promise);
    const { view, props } = savedResult(f, changed);
    await waitFor(() => expect(wire.firstPeerAborted).toBe(true));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(wire.requests).toHaveLength(2); expect(f.pf.showPath).not.toHaveBeenCalled();
    wire.finishProof(); await act(async () => proof.resolve(f.live));
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, routing: '/NEW', designLength: '7' }));
    view.rerender(<PathFinderResults {...props} workflowSelection={f.row} workflowDisplayRequest={{ cableId: key(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledWith({ pathId: key(3), points: f.proposal.route!.points, objectIds: [23] }));
    await waitFor(() => expect(wire.requests).toHaveLength(4));
    expect(wire.requests.slice(2).every(request => request.proofFinished)).toBe(true);
    wire.releaseRetry();
    await waitFor(() => expect(f.pf.showPath).toHaveBeenLastCalledWith({ pathId: key(3), points: f.proposal.route!.points, objectIds: [23, 88, 99] }));
    expect(f.pf.showPath).toHaveBeenCalledTimes(2);
    expect(f.proposal.cableWriteRevision).toBe('9'); expect(f.row.cable.cableWriteRevision).toBe('10');
    expect(f.contexts.from.head!.bindingRevision).toBe('42');
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.readJob).toHaveBeenCalledOnce();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
  });
  it('immediately clears a visible route when a real endpoint retry reports lost authority', async () => {
    const f = fixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), wire = transport(f, 'authority', true);
    wire.finishProof(); vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(f.live);
    const { view, props } = savedResult(f, changed);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    view.rerender(<PathFinderResults {...props} workflowSelection={f.row} workflowDisplayRequest={{ cableId: key(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: key(3), points: f.proposal.route!.points, objectIds: [23] }));
    await waitFor(() => expect(wire.requests.length).toBeGreaterThanOrEqual(4));
    wire.releaseRetry();
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false }));
    expect(wire.counts.from).toBe(2); expect(wire.counts.to).toBe(2);
    expect(f.pf.clear).toHaveBeenCalledOnce(); expect(f.pf.showPath).toHaveBeenCalledOnce(); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
    expect(f.pf.refresh).toHaveBeenCalledOnce();
  });
  it('retains the real endpoint client context hash guard after a transient HTTP refusal', async () => {
    expect(vi.isMockFunction(fetchCableEndpointContext)).toBe(false);
    const f = fixture(), wire = transport(f, 'bad-hash'); wire.finishProof();
    await expect(fetchCableEndpointContext(ids.project, 'synthetic-current-token', key(4), 'from')).rejects.toMatchObject({ status: 503 });
    await expect(fetchCableEndpointContext(ids.project, 'synthetic-current-token', key(4), 'from')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: null });
    expect(wire.counts).toEqual({ from: 2, to: 0 });
  });
  it('bounds ordinary HTTP refusals without blocking the exact route or submitting another calculation', async () => {
    const f = fixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), wire = transport(f, 'busy');
    wire.finishProof(); vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(f.live);
    const { view, props } = savedResult(f, changed);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    view.rerender(<PathFinderResults {...props} workflowSelection={f.row} workflowDisplayRequest={{ cableId: key(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(wire.requests).toHaveLength(6), { timeout: 3000 });
    expect(wire.counts).toEqual({ from: 3, to: 3 });
    expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: key(3), points: f.proposal.route!.points, objectIds: [23] });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.calculate).not.toHaveBeenCalled();
    expect(f.pf.refresh).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
});
