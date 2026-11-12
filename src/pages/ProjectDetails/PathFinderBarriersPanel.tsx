import { useEffect, useRef, useState } from 'react';
import { Button, Caption1, Field, Select, Spinner, Textarea, Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import { usePathfinderBarriers, type BarrierAuthoringOptions, type BarrierAuthoringState, type BarrierSelectedParent } from './hooks/usePathfinderBarriers';
import { BARRIER_LIMITS } from '../../../shared/pathfinderBarriers';

export type PathFinderBarriersPanelProps = BarrierAuthoringOptions & { onStateChange?: (state: BarrierAuthoringState) => void };
const useStyles = makeStyles({
  panel: { display: 'grid', gap: '0.5rem', minWidth: 0, overflowWrap: 'anywhere', borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: '0.75rem' },
  heading: { margin: 0, fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  row: { display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' },
  list: { margin: 0, paddingLeft: '1.25rem', maxHeight: '18rem', overflowY: 'auto' },
  item: { marginBottom: '0.5rem' },
});
const kinds: BarrierSelectedParent['kind'][] = ['wall', 'partition', 'floor', 'ceiling', 'obstacle'];
const kindLabel = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);

function BarrierObject({ parent, pf, current, disabled, displayBusy, shown, onShow, onHide, remove }: {
  parent: BarrierSelectedParent; pf: BarrierAuthoringOptions['pf']; current: boolean; disabled: boolean; displayBusy: boolean; shown: boolean; onHide: () => Promise<void>; onShow: (id: number) => Promise<boolean>; remove?: () => void;
}) {
  const [guid, setGuid] = useState<string | null | undefined>(undefined);
  const [showing, setShowing] = useState(false), [error, setError] = useState<string | null>(null);
  const reading = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const readGuid = async () => {
    if (!current || pf.busy || reading.current || guid) return;
    reading.current = true; setGuid(undefined);
    try { const value = await pf.readObjectGuid(parent.dbId); if (alive.current) setGuid(value); }
    catch { if (alive.current) setGuid(null); }
    finally { reading.current = false; }
  };
  const show = async () => {
    setShowing(true); setError(null);
    try { if (!await onShow(parent.dbId) && alive.current) setError('The object could not be shown. Check that the current model is loaded.'); }
    catch { if (alive.current) setError('The object could not be shown. Try again after the model finishes loading.'); }
    finally { if (alive.current) setShowing(false); }
  };
  return <>
    <Tooltip relationship="description" content={!current ? 'GUID unavailable for this model revision.' : guid === undefined ? 'Reading GUID…' : guid ? `GUID: ${guid}` : 'GUID is not available for this object.'}>
      <span tabIndex={0} onMouseEnter={() => void readGuid()} onFocus={() => void readGuid()}>{parent.name}</span>
    </Tooltip>
    <div><Caption1>{kindLabel(parent.kind)}</Caption1>{' '}
      <Button size="small" aria-label={`Show ${parent.name}`} disabled={!current || pf.busy || showing || displayBusy} onClick={() => void show()}>{showing ? 'Showing…' : 'Show'}</Button>{' '}
      {shown ? <><Button size="small" aria-label={`Hide ${parent.name}`} disabled={!current || pf.busy || displayBusy} onClick={() => void onHide()}>Hide</Button>{' '}</> : null}
      {remove ? <Button size="small" aria-label={`Remove ${parent.name}`} disabled={disabled} onClick={remove}>Remove</Button> : null}
    </div>
    {error ? <Caption1 role="alert">{error}</Caption1> : null}
  </>;
}

/** Unmount the authoring hook entirely when administrator access is lost. */
export function PathFinderBarriersPanel(props: PathFinderBarriersPanelProps) {
  return props.isAdmin ? <AdminBarriersPanel {...props} /> : null;
}
function AdminBarriersPanel(props: PathFinderBarriersPanelProps) {
  const state = usePathfinderBarriers(props), styles = useStyles();
  const callback = useRef(props.onStateChange); callback.current = props.onStateChange;
  useEffect(() => { callback.current?.({ registry: state.registry, dirty: state.dirty, pending: state.pending }); }, [state.registry, state.dirty, state.pending]);
  const [displayBusy, setDisplayBusy] = useState(false), [displayObject, setDisplayObject] = useState<number | null>(null), [displayError, setDisplayError] = useState<string | null>(null);
  const pendingDisplay = useRef<object | null>(null);
  const ownedDisplay = useRef<{ key: string; restore: () => Promise<boolean> } | null>(null);
  const frozen = state.busy || props.pf.busy || state.pending || displayBusy;
  const disabled = !state.canAuthor || frozen;
  const geometry = state.manifest?.geometry;
  const saved = state.saved;
  const active = props.pf.data?.activeModel;
  const objectScope = JSON.stringify([props.projectId, props.token, active, props.pf.preparationViewerGeneration]);
  const latestScope = useRef(objectScope); latestScope.current = objectScope;
  useEffect(() => {
    setDisplayBusy(false); setDisplayObject(null); setDisplayError(null);
    return () => {
      pendingDisplay.current = null;
      const owned = ownedDisplay.current;
      if (owned?.key === objectScope) { ownedDisplay.current = null; void owned.restore().catch(() => {}); }
    };
  }, [objectScope]);
  const showObject = async (dbId: number) => {
    if (!active?.modelVersionId || !active.contentFingerprint || props.pf.busy || pendingDisplay.current || props.pf.viewerPhase !== 'ready') return false;
    const key = objectScope, ticket = {}, scope = { modelVersionId: active.modelVersionId, contentFingerprint: active.contentFingerprint, selectionRevision: active.selectionRevision };
    pendingDisplay.current = ticket; setDisplayBusy(true); setDisplayError(null);
    ownedDisplay.current = { key, restore: () => props.pf.hideTray(scope) };
    const current = () => latestScope.current === key && pendingDisplay.current === ticket;
    try {
      const shown = await props.pf.showTray(scope, [dbId]);
      if (!current()) { if (shown) await props.pf.hideTray(scope); return false; }
      // Keep Hide available even after a partial appearance failure.
      setDisplayObject(dbId); return shown;
    } catch { if (current()) setDisplayObject(dbId); return false; }
    finally { if (current()) { pendingDisplay.current = null; setDisplayBusy(false); } }
  };
  const hideObject = async () => {
    const owned = ownedDisplay.current;
    if (!owned || pendingDisplay.current || props.pf.busy || owned.key !== objectScope) return;
    const ticket = {}; pendingDisplay.current = ticket; setDisplayBusy(true); setDisplayError(null);
    const current = () => latestScope.current === owned.key && pendingDisplay.current === ticket;
    try {
      if (await owned.restore()) { if (current()) { ownedDisplay.current = null; setDisplayObject(null); } }
      else if (current()) setDisplayError('The normal model view could not be restored. Try Hide again.');
    } catch { if (current()) setDisplayError('The normal model view could not be restored. Try Hide again.'); }
    finally { if (current()) { pendingDisplay.current = null; setDisplayBusy(false); } }
  };
  const isCurrentScope = (scope: NonNullable<typeof state.registry>['scope'] | undefined) => Boolean(scope && active
    && props.projectId === props.loadedProjectId && scope.projectId === props.projectId && props.pf.viewerPhase === 'ready'
    && scope.modelVersionId === active.modelVersionId && scope.selectionRevision === active.selectionRevision && scope.contentFingerprint === active.contentFingerprint);
  const selectionSaved = saved?.status === 'current' && state.registry?.state === 'ready'
    && state.registry.snapshot?.snapshotId === saved.manifest.snapshotId
    && !state.dirty && !state.pending && !state.busy && !state.error
    && (state.phase === 'ready' || state.phase === 'idle')
    && (state.draftParents.length > 0 || !state.emptyReason.trim());
  const saveLabel = state.phase === 'capturing' ? 'Capturing obstacles…'
    : state.phase === 'publishing' ? 'Saving barrier set…'
      : selectionSaved ? 'Barrier set saved' : 'Save barrier set';
  const status = state.phase === 'unknown' ? 'Unknown command outcome — reconciliation required'
    : state.phase === 'partial' ? 'Capture incomplete — published set kept'
      : state.phase === 'refused' ? 'Operation refused — published set kept'
        : state.phase === 'stale' ? 'Scope changed — refresh required'
          : saved?.status === 'recapture-required' ? 'Saved obstacles need recapture'
            : state.dirty ? 'Unpublished draft' : selectionSaved ? `Saved — ${state.draftParents.length} parent ${state.draftParents.length === 1 ? 'object' : 'objects'}, revision ${state.registry!.registryRevision}`
              : state.registry ? `Registry: ${state.registry.state}` : 'No current barrier registry loaded';
  return <section className={styles.panel} aria-label="Barriers">
    <h3 className={styles.heading}>Barriers</h3>
    {displayObject !== null ? <Button disabled={displayBusy || props.pf.busy} onClick={() => void hideObject()}>Hide</Button> : null}
    {displayError ? <Caption1 role="alert">{displayError}</Caption1> : null}
    <Caption1>Register walls, partitions, floors, ceilings and other obstacles. Choose Obstacle for pipes, tanks or mixed model groups.</Caption1>
    <Caption1>Existing openings are respected when present in qualified captured triangle geometry. A bounding box is not treated as a solid obstacle.</Caption1>
    <Caption1>Select an object in Model Browser to inspect it and add it. The selected parent and all its descendant fragments are captured together.</Caption1>
    <Caption1>Add selected objects creates an unsaved draft. Use Save barrier set to publish it; unsaved additions do not survive a browser refresh.</Caption1>
    <div role="status">{status}</div>
    <section aria-label="Saved obstacles">
      <h4 className={styles.heading}>Saved obstacles</h4>
      {saved ? <>
        <Caption1>{saved.status === 'current' ? 'The published selection matches the current model and frame.'
          : saved.status === 'recapture-required' ? 'This saved selection belongs to another model or frame. Select current objects and save a new capture; the old geometry is not ready for calculation.'
            : 'Last saved selection for reference. Current readiness is unavailable.'}</Caption1>
        {saved.manifest.selectedParents.length ? <ul className={styles.list} aria-label="Saved barrier parents">{saved.manifest.selectedParents.map(parent => <li className={styles.item} key={objectScope + parent.selectionId}>
          <BarrierObject parent={parent} pf={props.pf} displayBusy={displayBusy} shown={displayObject === parent.dbId} onHide={hideObject} onShow={showObject} current={isCurrentScope(saved.manifest.scope)} disabled={disabled} />
        </li>)}</ul> : saved.manifest.geometry.mode === 'explicit-empty' ? <Caption1>Published empty declaration: {saved.manifest.geometry.reason}</Caption1> : null}
        <details><summary>Saved selection scope</summary>
          <p>Snapshot {saved.manifest.snapshotId}. Model {saved.manifest.scope.modelVersionId}. Frame {saved.manifest.scope.captureFrameId}.</p>
        </details>
      </> : <Caption1>{state.phase === 'loading' ? 'Reading the saved barrier selection…'
        : state.error ? 'The saved barrier selection could not be verified. Refresh barriers to try again.'
          : 'No saved barrier set. Add selected objects and use Save barrier set to publish them.'}</Caption1>}
    </section>
    <h4 className={styles.heading}>{selectionSaved ? 'Current saved selection' : 'Current selection draft'}</h4>
    {state.dirty ? <Caption1>Unsaved changes. The published barrier set remains unchanged until this entire draft is captured and published successfully.</Caption1> : null}
    <Field label="Barrier type"><Select aria-label="Barrier type" value={state.kind} disabled={disabled} onChange={(_, data) => state.setKind(data.value as BarrierSelectedParent['kind'])}>
      {kinds.map(kind => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
    </Select></Field>
    <Button disabled={disabled} onClick={() => void state.addSelection()}>Add selected objects</Button>
    <Caption1>{state.draftParents.length} / {BARRIER_LIMITS.selectedParents} selected parent objects{selectionSaved ? '' : ' in this draft'}. Repeated objects are added once; overlapping parent geometry is qualified during publication.</Caption1>
    {state.draftParents.length ? <ul className={styles.list} aria-label="Selected barrier parents">{state.draftParents.map(parent => <li className={styles.item} key={objectScope + parent.selectionId}>
      <BarrierObject parent={parent} pf={props.pf} displayBusy={displayBusy} shown={displayObject === parent.dbId} onHide={hideObject} onShow={showObject} current={isCurrentScope(state.registry?.scope)} disabled={disabled} remove={() => state.removeParent(parent.selectionId)} />
    </li>)}</ul> : <Caption1>{state.registry ? 'No barrier parents selected. This does not declare that the model has no barriers.' : 'The current barrier selection is unavailable until the model frame can be verified.'}</Caption1>}
    {state.draftParents.length ? <Button appearance={selectionSaved ? 'secondary' : 'primary'} disabled={disabled || selectionSaved} onClick={() => void state.save()}>{saveLabel}</Button> : state.registry ? <>
      <Field label="Explicit empty reason"><Textarea aria-label="Explicit empty reason" value={state.emptyReason} maxLength={2048} disabled={disabled} onChange={(_, data) => state.setEmptyReason(data.value)} /></Field>
      <Button appearance={selectionSaved ? 'secondary' : 'primary'} disabled={disabled || selectionSaved || !state.emptyReason.trim()} onClick={() => void state.save()}>{selectionSaved ? 'Barrier set saved' : state.phase === 'publishing' ? 'Saving barrier set…' : 'Declare no barriers'}</Button>
      <Caption1>This explicitly registers an empty selected scope. It does not certify that the model contains no walls or other obstacles.</Caption1>
    </> : null}
    {selectionSaved ? <Caption1 aria-live="polite">{state.draftParents.length ? `${state.draftParents.length} selected ${state.draftParents.length === 1 ? 'object is' : 'objects are'} saved. Add or remove objects to change this set.` : 'The empty barrier declaration is saved.'}</Caption1> : null}
    <div className={styles.row}>
      <Button disabled={state.busy || props.pf.busy} onClick={() => void state.refresh()}>Refresh barriers</Button>
      {state.busy ? <Button onClick={state.cancel}>Cancel</Button> : null}
      {state.pending ? <Button disabled={!state.canRetry} onClick={() => void state.retry()}>Retry saved command</Button> : null}
      {state.pending ? <Button disabled={!state.canInspect} onClick={() => void state.inspect()}>Inspect saved outcome</Button> : null}
      {state.pending ? <Button disabled={!state.canClose} onClick={() => void state.close()}>Close this exact command</Button> : null}
      {(state.pending || state.dirty) && state.phase !== 'unknown' ? <Button disabled={!state.canDiscard} onClick={state.discardPending}>{state.pending ? 'Discard saved command' : 'Discard draft and refresh'}</Button> : null}
    </div>
    {state.pending ? <Caption1>Inspect checks the saved command without resubmitting it. Close stops only this exact command and keeps the published barriers. A new selection can be saved after its outcome and the current barrier set are confirmed.</Caption1> : null}
    {state.busy ? <Spinner size="tiny" label={state.phase === 'capturing' ? 'Capturing selected barrier geometry…' : state.phase === 'publishing' ? 'Publishing barrier set…' : 'Reading barriers…'} /> : null}
    {state.message ? <Caption1>{state.message}</Caption1> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.registry ? <details><summary>Barrier details</summary>
      <p>Revision {state.registry.registryRevision}. Active model {state.registry.scope.modelVersionId}. Frame {state.registry.scope.captureFrameId}.</p>
      {state.registry.snapshot ? <p>Published snapshot {state.registry.snapshot.snapshotId}.</p> : null}
      {geometry?.mode === 'mesh-set' ? <p>Published manifest: {geometry.fragments.length} fragments, {geometry.fragments.reduce((sum, fragment) => sum + fragment.vertices, 0)} vertices, {geometry.fragments.reduce((sum, fragment) => sum + fragment.triangles, 0)} triangles. Registered objects only.</p> : null}
      {state.draftParents.length ? <ul aria-label="Barrier object identities">{state.draftParents.map(parent => <li key={parent.selectionId}>{parent.name}: {parent.objectId}; draft identity to check against the current model before saving.</li>)}</ul> : null}
      {state.registry.reasonCodes.length ? <ul aria-label="Barrier registry reasons">{state.registry.reasonCodes.map(reason => <li key={reason}>{reason.toLowerCase().replaceAll('_', ' ')}</li>)}</ul> : null}
    </details> : null}
    <Caption1>Check the barrier status recorded with each calculation. Registering a set does not check previously calculated routes.</Caption1>
  </section>;
}
