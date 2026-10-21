import { useEffect, useRef } from 'react';
import { Button, Caption1, Field, Select, Spinner, Textarea, makeStyles, tokens } from '@fluentui/react-components';
import { usePathfinderBarriers, type BarrierAuthoringOptions, type BarrierAuthoringState, type BarrierSelectedParent } from './hooks/usePathfinderBarriers';

export type PathFinderBarriersPanelProps = BarrierAuthoringOptions & { onStateChange?: (state: BarrierAuthoringState) => void };
const useStyles = makeStyles({
  panel: { display: 'grid', gap: '0.5rem', minWidth: 0, overflowWrap: 'anywhere', borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: '0.75rem' },
  heading: { margin: 0, fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  row: { display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' },
  list: { margin: 0, paddingLeft: '1.25rem', maxHeight: '18rem', overflowY: 'auto' },
  item: { marginBottom: '0.5rem' },
});
const kinds: BarrierSelectedParent['kind'][] = ['wall', 'partition', 'floor', 'ceiling'];
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
  const status = state.phase === 'unknown' ? 'Unknown command outcome — reconciliation required'
    : state.phase === 'partial' ? 'Capture incomplete — published set kept'
      : state.phase === 'refused' ? 'Operation refused — published set kept'
        : state.phase === 'stale' ? 'Scope changed — refresh required'
          : state.dirty ? 'Unpublished draft' : state.registry ? `Registry: ${state.registry.state}` : 'No current barrier registry loaded';
  return <section className={styles.panel} aria-label="Barriers">
    <h3 className={styles.heading}>Barriers</h3>
    <Caption1>Register walls, partitions, floors and ceilings. Actual triangle geometry retains existing openings; a bounding box is not treated as a solid wall.</Caption1>
    <Caption1>Select an object in Model Browser to inspect it and add it. The selected parent and all its descendant fragments are captured together.</Caption1>
    <div role="status">{status}</div>
    {state.dirty ? <Caption1>The published barrier set remains unchanged until this entire draft is captured and published successfully.</Caption1> : null}
    <Field label="Barrier type"><Select aria-label="Barrier type" value={state.kind} disabled={disabled} onChange={(_, data) => state.setKind(data.value as BarrierSelectedParent['kind'])}>
      {kinds.map(kind => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
    </Select></Field>
    <Button disabled={disabled} onClick={() => void state.addSelection()}>Add selected objects</Button>
    <Caption1>{state.draftParents.length} / 128 selected parent objects in this draft. Repeated objects are added once; overlapping parent geometry is qualified during publication.</Caption1>
    {state.draftParents.length ? <ul className={styles.list} aria-label="Selected barrier parents">{state.draftParents.map(parent => <li className={styles.item} key={parent.selectionId}>
      <div>{parent.name}</div><Caption1>{kindLabel(parent.kind)}</Caption1>
      <Button size="small" aria-label={`Remove ${parent.name}`} disabled={disabled} onClick={() => state.removeParent(parent.selectionId)}>Remove</Button>
    </li>)}</ul> : <Caption1>No barrier parents selected. This does not declare that the model has no barriers.</Caption1>}
    {geometry?.mode === 'explicit-empty' ? <Caption1>Published empty declaration: {geometry.reason}</Caption1> : null}
    {state.draftParents.length ? <Button appearance="primary" disabled={disabled} onClick={() => void state.save()}>Save barrier set</Button> : <>
      <Field label="Explicit empty reason"><Textarea aria-label="Explicit empty reason" value={state.emptyReason} maxLength={2048} disabled={disabled} onChange={(_, data) => state.setEmptyReason(data.value)} /></Field>
      <Button appearance="primary" disabled={disabled || !state.emptyReason.trim()} onClick={() => void state.save()}>Declare no barriers</Button>
      <Caption1>This explicitly registers an empty selected scope. It does not certify that the model contains no walls.</Caption1>
    </>}
    <div className={styles.row}>
      <Button disabled={state.busy || props.pf.busy} onClick={() => void state.refresh()}>Refresh barriers</Button>
      {state.busy ? <Button onClick={state.cancel}>Cancel</Button> : null}
      {state.pending ? <Button disabled={state.busy || props.pf.busy || !state.canAuthor} onClick={() => void state.retry()}>Retry saved command</Button> : null}
      {(state.pending || state.dirty) && state.phase !== 'unknown' ? <Button disabled={state.busy || props.pf.busy} onClick={state.discardPending}>{state.pending ? 'Discard saved command' : 'Discard draft and refresh'}</Button> : null}
    </div>
    {state.busy ? <Spinner size="tiny" label={state.phase === 'capturing' ? 'Capturing selected barrier geometry…' : state.phase === 'publishing' ? 'Publishing barrier set…' : 'Reading barriers…'} /> : null}
    {state.message ? <Caption1>{state.message}</Caption1> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.registry ? <details><summary>Barrier details</summary>
      <p>Revision {state.registry.registryRevision}. Active model {state.registry.scope.modelVersionId}. Frame {state.registry.scope.captureFrameId}.</p>
      {state.registry.snapshot ? <p>Published snapshot {state.registry.snapshot.snapshotId}.</p> : null}
      {geometry?.mode === 'mesh-set' ? <p>Published manifest: {geometry.fragments.length} fragments, {geometry.fragments.reduce((sum, fragment) => sum + fragment.vertices, 0)} vertices, {geometry.fragments.reduce((sum, fragment) => sum + fragment.triangles, 0)} triangles. Registered objects only.</p> : null}
      {state.draftParents.length ? <ul aria-label="Barrier object identities">{state.draftParents.map(parent => <li key={parent.selectionId}>{parent.name}: {parent.objectId}; current model identity.</li>)}</ul> : null}
      {state.registry.reasonCodes.length ? <ul aria-label="Barrier registry reasons">{state.registry.reasonCodes.map(reason => <li key={reason}>{reason.toLowerCase().replaceAll('_', ' ')}</li>)}</ul> : null}
    </details> : null}
    <Caption1>Check the barrier status recorded with each calculation. Registering a set does not check previously calculated routes.</Caption1>
  </section>;
}
