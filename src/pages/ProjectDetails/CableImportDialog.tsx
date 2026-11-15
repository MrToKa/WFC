import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner } from '@fluentui/react-components';
import { describeRoutingImportConflict, type CableRoutingImportSummary } from '../../../shared/cableRoutingImport';

export type CableImportDialogState = { open: boolean; fileName: string; protectRouting: boolean; loading: boolean; committing: boolean;
  summary: CableRoutingImportSummary | null; error: string | null; completed: boolean };
type Props = { state: CableImportDialogState; onProtectChange: (checked: boolean) => void; onCommit: () => void; onClose: () => void };
export function CableImportDialog({ state, onProtectChange, onCommit, onClose }: Props) {
  const summary = state.summary, conflicts = summary?.blockedRouting ?? [];
  return <Dialog open={state.open} onOpenChange={(_, data) => { if (!data.open && !state.committing) onClose(); }}>
    <DialogSurface><DialogBody>
      <DialogTitle>{state.completed ? 'Cable import results' : 'Review cable import'}</DialogTitle>
      <DialogContent>
        <p>{state.fileName}</p>
        {!state.completed ? <>
          <Checkbox label="Protect routes from this import as manually assigned" checked={state.protectRouting}
            disabled={state.committing} onChange={(_, data) => onProtectChange(Boolean(data.checked))} />
          <p>With protection enabled, a blank Routing cell clears the manual route unless execution protection prevents it. With protection disabled, a blank Routing cell leaves the route unchanged.</p>
          <p>Recorded execution protects existing routes. Conflicting route changes are skipped; other permitted updates and other cables can still be imported.</p>
        </> : null}
        {state.loading || state.committing ? <Spinner size="tiny" label={state.committing ? 'Importing cables…' : 'Checking workbook changes…'} /> : null}
        {state.error ? <p role="alert">{state.error}</p> : null}
        {summary ? <section aria-label="Cable import summary">
          <p>{state.completed ? 'Imported' : 'Planned'}: {summary.inserted} new, {summary.updated} updated, {summary.unchanged ?? 0} unchanged, {summary.skipped} skipped.</p>
          <p>Manual route protections: {summary.routesProtected ?? 0}. Manual routes cleared: {summary.routesCleared ?? 0}. New execution protections: {summary.executionLocksAdded ?? 0}.</p>
          {conflicts.length ? <><p role="status">Routes retained for {conflicts.length} cables because of execution protection:</p>
            <div style={{ maxHeight: 240, overflowY: 'auto' }}><ul>{conflicts.map(item => <li key={item.cableId}>{describeRoutingImportConflict(item)}</li>)}</ul></div>
          </> : null}
        </section> : null}
      </DialogContent>
      <DialogActions>
        <Button disabled={state.committing} onClick={onClose}>{state.completed ? 'Close' : 'Cancel'}</Button>
        {!state.completed ? <Button appearance="primary" disabled={!summary || state.loading || state.committing || Boolean(state.error)} onClick={onCommit}>Import reviewed changes</Button> : null}
      </DialogActions>
    </DialogBody></DialogSurface>
  </Dialog>;
}
