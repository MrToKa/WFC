import { Button, Caption1, Spinner } from '@fluentui/react-components';
import type { usePathfinderBatchReview } from './hooks/usePathfinderBatchReview';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';

export type BatchReviewController = ReturnType<typeof usePathfinderBatchReview>;

/** Selection is not approval. Both review and the subsequent writes are explicit. */
export function PathFinderBatchReview({ batch, disabled, disabledReason }: { batch: BatchReviewController; disabled: boolean; disabledReason?: string | null }) {
  const styles = useRoutingsViewerStyles();
  return <section aria-label="Batch review and Apply" className={styles.result}>
    <h3>Review selected cables</h3>
    <Caption1>Choose a completed calculation below, select ready cables across its pages, inspect their routes, endpoints and lengths, then confirm review and Apply.</Caption1>
    <p>{batch.counts.total} selected records; {batch.counts.reviewed} reviewed; {batch.counts.applied} applied; {batch.counts.blocked} blocked.</p>
    {disabledReason ? <p role="status">{disabledReason}</p> : !batch.entries.length ? <p role="status">No cables selected. Use the checkboxes or Select ready cables on this page below. Selection does not change cable values.</p> : null}
    {batch.entries.length ? <div style={{ maxHeight: '24rem', overflow: 'auto' }}>
      <ul aria-label="Selected proposal review" style={{ paddingLeft: '1.25rem' }}>{batch.entries.map(entry => <li key={entry.proposalId}>
        <strong>{entry.tag}</strong> — {entry.status}; design length {entry.designLength} m
        <details><summary>Route to review</summary><p style={{ overflowWrap: 'anywhere' }}>{entry.routeText}</p></details>
        {entry.message ? <p>{entry.message}</p> : null}
        <Button size="small" disabled={disabled || batch.busy || entry.status === 'applied'} onClick={() => batch.select({ proposalId: entry.proposalId,
          proposalHash: entry.proposalHash, revisionResultHash: entry.revisionResultHash, cableId: entry.cableId,
          cableWriteRevision: entry.cableWriteRevision, tag: entry.tag, routeText: entry.routeText, designLength: entry.designLength }, false)}>Remove {entry.tag}</Button>
      </li>)}</ul>
    </div> : null}
    <Caption1>Confirming review approves the exact selected proposals. Apply then updates routing and design length together for each cable. Installed length is preserved. A batch can stop after partial success; confirmed writes are retained.</Caption1>
    <div className={styles.actions}>
      <Button disabled={disabled || batch.busy || !batch.canReview} onClick={() => void batch.confirmReview()}>Confirm review for selected cables</Button>
      <Button appearance="primary" disabled={disabled || batch.busy || !batch.canApply} onClick={() => void batch.applyReviewed()}>Apply reviewed selection</Button>
      <Button disabled={batch.busy || !batch.entries.some(entry => entry.status !== 'applied')} onClick={batch.clearSelection}>Clear selection</Button>
      {batch.busy ? <Button onClick={batch.cancel}>Stop after current cable</Button> : null}
    </div>
    {batch.busy ? <Spinner size="tiny" label="Processing selected proposals one at a time…" /> : null}
    {batch.error ? <p role="alert">{batch.error}</p> : null}
    {batch.message ? <p role="status">{batch.message}</p> : null}
  </section>;
}
