import { useEffect, useMemo, useState } from 'react';
import { getBarrierRegistry } from '@/api/pathfinderBarriers';
import type { CableEndpointEnd, CableEndpointReceipt } from '@/api/pathfinderCableEndpoints';
import { fetchPathFinderCableWorkflowDetail, type CableWorkflowRow } from '@/api/pathfinderCableWorkflow';
import { PathFinderCableRoutingPanel } from '@/components/pathfinder/PathFinderCableRoutingPanel';
import { requestFloatingCableWindow, type FloatingCableWindowRequest } from '@/hooks/useFloatingCablePanel';
import { usePathfinderLocationImpactProgress } from '@/hooks/usePathfinderLocationImpactProgress';
import { AUTOMATIC_PAIR_POLICY } from '../../../shared/pathfinderAutomaticPair';
import { createSupportedBarrierAdmissionIntent } from '../../../shared/pathfinderBarrierSupported';
import { isPathFinderCableEligible } from '../../../shared/pathfinderCableEligibility';
import { normalizeEndpointLocation, type EndpointCurrentScope } from '../../../shared/pathfinderEndpointBindings';
import type { LocationImpactCalculation } from '../../../shared/pathfinderLocationImpacts';
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
  const references = useMemo(() => {
    const names = new Map<string, Reference>();
    for (const cable of pf.data?.cables ?? []) {
      if (!isPathFinderCableEligible(cable.mto)) continue;
      for (const end of ['from', 'to'] as const) {
        const name = end === 'from' ? cable.fromLocation : cable.toLocation;
        if (!name?.trim()) continue;
        const key = normalizeEndpointLocation(name);
        if (!names.has(key)) names.set(key, { cableId: cable.id, end });
      }
    }
    return names;
  }, [pf.data?.cables]);

  const ready = active && writable && pf.viewerPhase === 'ready';
  useEffect(() => { if (!ready) { setTarget(null); setSavingTarget(null); } }, [ready]);
  const progress = usePathfinderLocationImpactProgress({ ...access, active: active && Boolean(impact),
    current: impact?.current ?? null, calculation: impact?.calculation ?? null, impactId: impact?.id ?? null,
    foregroundWindow: impact?.reportWindow });
  const receipt = progress.impact;
  useEffect(() => {
    if (receipt?.status === 'complete') onRoutesChanged();
  }, [receipt?.id, receipt?.status, onRoutesChanged]);

  if (!writable) return null;
  return <>
    <ModelLocationMatchPanel pf={pf} accountId={accountId} active={ready} refreshRevision={refreshRevision}
      locationReport={{
        editing: Boolean(target),
        switchingDisabled: saving,
        selectedName: target?.name,
        lastSavedName,
        canOpen: name => references.has(normalizeEndpointLocation(name)),
        onOpen: (name, anchor) => {
          if (!ready || saving || target?.name === name) return;
          const reference = references.get(normalizeEndpointLocation(name));
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
      automaticPairPolicy: calculation ? AUTOMATIC_PAIR_POLICY : null, readSelection: pf.readSelection, onSaved, onAuthorityLost: pf.refresh }}
    onShowLocation={pf.showLocation} onShowLocationPoint={pf.showLocationPoint}
    calculationBlockedReason={calculation ? null : 'Routing settings or barriers are unavailable. Check the current routing configuration in Path Finder and reopen this location.'} />;
}
