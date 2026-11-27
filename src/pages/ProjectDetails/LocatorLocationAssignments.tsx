import { useEffect, useMemo, useRef, useState } from 'react';
import { getBarrierRegistry } from '@/api/pathfinderBarriers';
import { fetchCableEndpointContext, type CableEndpointEnd, type CableEndpointReceipt } from '@/api/pathfinderCableEndpoints';
import { fetchPathFinderCableWorkflowDetail, type CableWorkflowRow } from '@/api/pathfinderCableWorkflow';
import { PathFinderCableRoutingPanel } from '@/components/pathfinder/PathFinderCableRoutingPanel';
import { locationObjects, locationPoint } from '@/components/pathfinder/cableEndpointLocationDisplay';
import { requestFloatingCableWindow, type FloatingCableWindowRequest } from '@/hooks/useFloatingCablePanel';
import { usePathfinderLocationImpactProgress } from '@/hooks/usePathfinderLocationImpactProgress';
import { AUTOMATIC_PAIR_POLICY } from '../../../shared/pathfinderAutomaticPair';
import { createSupportedBarrierAdmissionIntent } from '../../../shared/pathfinderBarrierSupported';
import { isPathFinderCableEligible } from '../../../shared/pathfinderCableEligibility';
import { normalizeEndpointLocation, type EndpointCurrentScope } from '../../../shared/pathfinderEndpointBindings';
import type { LocationImpactCalculation } from '../../../shared/pathfinderLocationImpacts';
import type { ModelLocationMatchResult } from '../../../shared/pathfinderModelLocationMatch';
import { ModelLocationMatchPanel } from './ModelLocationMatchPanel';
import type { usePathFinder } from './hooks/usePathFinder';

type Props = {
  pf: ReturnType<typeof usePathFinder>;
  accountId: string;
  active: boolean;
  writable: boolean;
  secondaryDistanceMeters: number;
  onRoutesChanged: () => void;
};
type Reference = { cableId: string; end: CableEndpointEnd };
type Target = Reference & { name: string; anchor: HTMLButtonElement; popup: FloatingCableWindowRequest };
type Impact = { id: string; name: string; current: EndpointCurrentScope; calculation: LocationImpactCalculation; reportWindow: Window | null };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not open the location.';

export function LocatorLocationAssignments({ pf, accountId, active, writable, secondaryDistanceMeters, onRoutesChanged }: Props) {
  const access = { ...pf.preparationAccess, accountId };
  const [target, setTarget] = useState<Target | null>(null);
  const [savingTarget, setSavingTarget] = useState<Target | null>(null);
  const saving = target !== null && target === savingTarget;
  const [lastSavedName, setLastSavedName] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [impact, setImpact] = useState<Impact | null>(null);
  const showRequest = useRef<AbortController | null>(null);
  const [showing, setShowing] = useState<string>();
  const [showMessage, setShowMessage] = useState<{ text: string; error: boolean }>();
  const references = useMemo(() => {
    const names = new Map<string, Reference>();
    const excluded = new Map<string, Reference>();
    for (const cable of pf.data?.cables ?? []) {
      const map = isPathFinderCableEligible(cable.mto) ? names : excluded;
      for (const end of ['from', 'to'] as const) {
        const name = end === 'from' ? cable.fromLocation : cable.toLocation;
        if (!name?.trim()) continue;
        const key = normalizeEndpointLocation(name);
        if (!map.has(key)) map.set(key, { cableId: cable.id, end });
      }
    }
    return { names, excluded };
  }, [pf.data?.cables]);

  const ready = active && writable && pf.viewerPhase === 'ready';
  useEffect(() => { if (!ready) { setTarget(null); setSavingTarget(null); } }, [ready]);
  const { projectId, loadedProjectId, token } = access;
  const model = pf.data?.activeModel;
  const { modelVersionId, selectionRevision, contentFingerprint } = model ?? {};
  useEffect(() => {
    setShowing(undefined);
    setShowMessage(undefined);
    return () => { showRequest.current?.abort(); showRequest.current = null; };
  }, [ready, accountId, projectId, loadedProjectId, token, modelVersionId, selectionRevision, contentFingerprint, pf.preparationViewerGeneration]);
  const progress = usePathfinderLocationImpactProgress({ ...access, active: active && Boolean(impact),
    current: impact?.current ?? null, calculation: impact?.calculation ?? null, impactId: impact?.id ?? null,
    foregroundWindow: impact?.reportWindow });
  const receipt = progress.impact;
  useEffect(() => {
    if (receipt?.status === 'complete') onRoutesChanged();
  }, [receipt?.id, receipt?.status, onRoutesChanged]);

  async function showAssignedLocation(item: ModelLocationMatchResult) {
    if (!ready || saving || showRequest.current) return;
    const unavailable = () => setShowMessage({ text: `Could not show ${item.name} in the current 3D model.`, error: true });
    const key = normalizeEndpointLocation(item.name);
    const reference = references.names.get(key) ?? references.excluded.get(key);
    if (!reference || !projectId || projectId !== loadedProjectId || !token || !modelVersionId || !selectionRevision || !contentFingerprint) {
      unavailable();
      return;
    }
    const scope = { modelVersionId, selectionRevision, contentFingerprint };
    const request = new AbortController();
    showRequest.current = request;
    setShowing(item.name);
    setShowMessage(undefined);
    try {
      const context = await fetchCableEndpointContext(projectId, token, reference.cableId, reference.end, request.signal);
      if (request.signal.aborted) return;
      const current = context.current;
      if (context.logicalKey !== key || !item.locationId || context.location?.id !== item.locationId
        || (context.head?.id ?? null) !== item.bindingId || current?.modelVersionId !== modelVersionId
        || current.selectionRevision !== selectionRevision || current.contentFingerprint !== contentFingerprint) {
        unavailable();
        return;
      }
      const saved = { context: { ...context, automaticSelection: null }, draft: null, enabled: true, error: null };
      const object = locationObjects(saved, scope);
      const point = object ? null : locationPoint(saved, scope);
      // Legacy assignments expose their model-local identity through PathFinder state.
      // Use it only after the live read confirms the same location and registry revision.
      const legacy = !context.head && pf.data?.registryRevision === context.registryRevision
        ? pf.data.locations.find(location => location.id === item.locationId)?.binding : null;
      let shown = false;
      if (object) {
        const surfacePoint = context.head?.derivation === 'picked-surface-point' ? context.head.pointProjectMetres : undefined;
        shown = await pf.showLocation(object.sdkObjectId, object.sdkObjectIds, surfacePoint);
      } else if (point) {
        shown = await pf.showLocationPoint(point.pointProjectMetres, point.current);
      } else if (legacy?.modelVersionId === modelVersionId) {
        const legacyId = legacy.objectId && /^dbid:[1-9][0-9]*$/.test(legacy.objectId) ? Number(legacy.objectId.slice(5)) : 0;
        if (legacyId > 0 && legacyId <= 2147483647) shown = await pf.showLocation(legacyId);
        else if (legacy.coordinateFrame === 'canonical-world-metres') shown = await pf.showLocationPoint(legacy.point, scope);
      }
      if (request.signal.aborted) return;
      if (shown) setShowMessage({ text: `Showing ${item.name} in 3D.`, error: false });
      else unavailable();
    } catch {
      if (!request.signal.aborted) unavailable();
    } finally {
      if (showRequest.current === request) { showRequest.current = null; setShowing(undefined); }
    }
  }

  if (!writable) return null;
  return <>
    <ModelLocationMatchPanel pf={pf} accountId={accountId} active={ready} refreshRevision={refreshRevision}
      locationReport={{
        editing: Boolean(target),
        switchingDisabled: saving,
        selectedName: target?.name,
        lastSavedName,
        showing,
        showMessage,
        onShow: item => void showAssignedLocation(item),
        canOpen: name => references.names.has(normalizeEndpointLocation(name)),
        onOpen: (name, anchor) => {
          if (!ready || saving || target?.name === name) return;
          const reference = references.names.get(normalizeEndpointLocation(name));
          if (reference) setTarget({ ...reference, name, anchor, popup: target?.popup ?? requestFloatingCableWindow({ title: name }) });
        },
      }} />
    {target && ready ? <LocationEditor key={target.popup.id} {...access} target={target} pf={pf}
      secondaryDistanceMeters={secondaryDistanceMeters} onClose={() => setTarget(null)}
      onLocationWriteChange={writing => setSavingTarget(current => writing ? target : current === target ? null : current)}
      onSaved={(saved, current, calculation) => {
        const name = saved.logicalName ?? target.name;
        setLastSavedName(name);
        setRefreshRevision(value => value + 1);
        pf.refresh();
        if (saved.locationImpact && current && calculation) {
          const reportDocument = target.anchor.ownerDocument;
          setImpact({ id: saved.locationImpact.id, name, current, calculation,
            reportWindow: reportDocument === document ? null : reportDocument.defaultView });
        }
      }} /> : null}
    {impact ? <section aria-label="Affected cable recalculation">
      <h3>Affected cable recalculation</h3>
      <p role="status">{impact.name} · {receipt
        ? `${receipt.status} · ${receipt.completed} of ${receipt.total} processed · ${receipt.blockedCables} blocked`
        : 'Recalculation requested.'}</p>
      {receipt?.reasonCodes.length ? <p>{receipt.reasonCodes.join(', ')}</p> : null}
      {progress.error ? <p role="alert">{progress.error}</p> : null}
    </section> : null}
  </>;
}

type EditorProps = ReturnType<typeof usePathFinder>['preparationAccess'] & {
  accountId: string; target: Target; pf: Props['pf']; secondaryDistanceMeters: number; onClose: () => void;
  onLocationWriteChange: (writing: boolean) => void;
  onSaved: (receipt: CableEndpointReceipt, current?: EndpointCurrentScope, calculation?: LocationImpactCalculation | null) => void;
};

function LocationEditor({ target, pf, accountId, projectId, loadedProjectId, token, isAdmin, secondaryDistanceMeters, onClose,
  onLocationWriteChange, onSaved }: EditorProps) {
  const [result, setResult] = useState<{ target: Target } & (
    { row: CableWorkflowRow; calculation: LocationImpactCalculation | null; error?: never } |
    { row?: never; calculation?: never; error: string }
  )>();
  const model = pf.data?.activeModel;
  const modelVersionId = model?.modelVersionId ?? null;
  const selectionRevision = model?.selectionRevision;
  const contentFingerprint = model?.contentFingerprint;
  useEffect(() => {
    const child = target.popup.window;
    return () => { if (child && !child.closed) child.close(); };
  }, [target.popup]);
  useEffect(() => {
    if (!projectId || !token || !modelVersionId) return;
    const controller = new AbortController();
    const signal = controller.signal;
    setResult(undefined);
    const settings = { secondaryDistanceMeters, preferVerticalApproach: true };
    void Promise.all([
      fetchPathFinderCableWorkflowDetail(projectId, token, target.cableId, settings, signal),
      getBarrierRegistry(projectId, token, signal).catch(() => null),
    ]).then(([detail, registry]) => {
      if (signal.aborted) return;
      const name = target.end === 'from' ? detail.row.cable.fromLocation : detail.row.cable.toLocation;
      if (!name || normalizeEndpointLocation(name) !== normalizeEndpointLocation(target.name)) {
        throw new Error('This cable endpoint changed. Close the editor and run Assign from/to locations again.');
      }
      const barrierRouting = registry?.scope.projectId === projectId && registry.scope.modelVersionId === modelVersionId
        && registry.scope.selectionRevision === selectionRevision && registry.scope.contentFingerprint === contentFingerprint
        ? createSupportedBarrierAdmissionIntent(registry, false) : null;
      setResult({ target, row: detail.row, calculation: barrierRouting
        ? { preferences: { ...settings, barrierRouting }, timeoutMilliseconds: 120000 } : null });
    }).catch(error => {
      if (signal.aborted) return;
      setResult({ target, error: errorText(error) });
    });
    return () => controller.abort();
  }, [projectId, token, modelVersionId, selectionRevision, contentFingerprint, secondaryDistanceMeters, target]);

  const state = result?.target === target ? result : undefined;
  const calculation = state?.calculation ?? null;
  const popupModel = modelVersionId && selectionRevision && contentFingerprint
    ? { modelVersionId, selectionRevision, contentFingerprint } : null;
  return <PathFinderCableRoutingPanel cable={state?.row ?? null} open anchor={target.anchor} requestedPopup={target.popup} onClose={onClose}
    locationLoadError={state?.error} onLocationWriteChange={onLocationWriteChange}
    access={{ projectId, loadedProjectId, accountId, token, isAdmin, active: true, model: popupModel,
      preparationKey: JSON.stringify([pf.preparationViewerGeneration, pf.data?.artifacts.map(item => [item.id, item.snapshotSha256])]),
      locationTarget: { name: target.name, end: target.end }, calculation, initialFill: null,
      automaticPairPolicy: calculation ? AUTOMATIC_PAIR_POLICY : null, readSelection: pf.readSelection,
      pickEndpointPoint: (signal, sdkObjectId) => pf.pickPoint({ signal, sdkObjectId }),
      onSaved, onAuthorityLost: pf.refresh }}
    onShowLocation={pf.showLocation} onShowLocationPoint={pf.showLocationPoint} onHideLocation={pf.hideLocation}
    calculationBlockedReason={calculation ? null : 'Routing settings or barriers are unavailable. Check the current routing configuration in Path Finder and reopen this location.'} />;
}
