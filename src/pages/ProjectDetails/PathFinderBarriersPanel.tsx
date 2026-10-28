import { useEffect, useRef } from 'react';
import { Button, Caption1, Field, Select, Spinner, Textarea, makeStyles, tokens } from '@fluentui/react-components';
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

/** Unmount the authoring hook entirely when administrator access is lost. */
export function PathFinderBarriersPanel(props: PathFinderBarriersPanelProps) {
  return props.isAdmin ? <AdminBarriersPanel {...props} /> : null;
}
function AdminBarriersPanel(props: PathFinderBarriersPanelProps) {
  const state = usePathfinderBarriers(props), styles = useStyles();
  const callback = useRef(props.onStateChange); callback.current = props.onStateChange;
  useEffect(() => { callback.current?.({ registry: state.registry, dirty: state.dirty, pending: state.pending }); }, [state.registry, state.dirty, state.pending]);
  const frozen = state.busy || props.pf.busy || state.pending;
  const disabled = !state.canAuthor || frozen;
  const geometry = state.manifest?.geometry;
  const saved = state.saved;
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
            : 'Last saved selection for reference. Current readiness is unavailable; prepare or refresh the model before changing this set.'}</Caption1>
        {saved.manifest.selectedParents.length ? <ul className={styles.list} aria-label="Saved barrier parents">{saved.manifest.selectedParents.map(parent => <li className={styles.item} key={parent.selectionId}>
          <div>{parent.name}</div><Caption1>{kindLabel(parent.kind)}</Caption1>
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
    {state.draftParents.length ? <ul className={styles.list} aria-label="Selected barrier parents">{state.draftParents.map(parent => <li className={styles.item} key={parent.selectionId}>
      <div>{parent.name}</div><Caption1>{kindLabel(parent.kind)}</Caption1>
      <Button size="small" aria-label={`Remove ${parent.name}`} disabled={disabled} onClick={() => state.removeParent(parent.selectionId)}>Remove</Button>
    </li>)}</ul> : <Caption1>No barrier parents selected. This does not declare that the model has no barriers.</Caption1>}
    {state.draftParents.length ? <Button appearance={selectionSaved ? 'secondary' : 'primary'} disabled={disabled || selectionSaved} onClick={() => void state.save()}>{saveLabel}</Button> : <>
      <Field label="Explicit empty reason"><Textarea aria-label="Explicit empty reason" value={state.emptyReason} maxLength={2048} disabled={disabled} onChange={(_, data) => state.setEmptyReason(data.value)} /></Field>
      <Button appearance={selectionSaved ? 'secondary' : 'primary'} disabled={disabled || selectionSaved || !state.emptyReason.trim()} onClick={() => void state.save()}>{selectionSaved ? 'Barrier set saved' : state.phase === 'publishing' ? 'Saving barrier set…' : 'Declare no barriers'}</Button>
      <Caption1>This explicitly registers an empty selected scope. It does not certify that the model contains no walls or other obstacles.</Caption1>
    </>}
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
