import { Caption1 } from '@fluentui/react-components';
import { compareCableValues, type CableComparisonInput } from '../../../shared/pathfinderCableComparison';

export type PathFinderCableComparisonProps = { input: CableComparisonInput | null; className?: string };
const stored = (value: string | null) => value === null ? 'NULL — no stored value' : value === '' ? 'Empty string — a defined stored value' : value;
function RouteValue({ value }: { value: string | null }) {
  return <>{value !== null && value !== '' && !value.trim() ? <p>Whitespace only; exact text is retained below.</p> : null}
    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }}>{stored(value)}</pre></>;
}
/** Read-only old/new comparison. This component never creates a review or write authorization. */
export function PathFinderCableComparison({ input, className }: PathFinderCableComparisonProps) {
  const comparison = compareCableValues(input), value = comparison.input, route = comparison.routing;
  if (!value || !route || !comparison.length) return <section className={className} aria-label="Current and proposed cable values">
    <h4>Current and proposed cable values</h4><p role="alert">Current cable values or their exact proposal references are unavailable. Refresh this cable before comparing or applying a result.</p>
  </section>;
  const before = value.current.cable, after = value.proposal, initial = comparison.initialFill;
  return <section className={className} aria-label="Current and proposed cable values" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <h4>Current and proposed cable values</h4>
    <Caption1>This is a read-only comparison. Existing or partially populated values require explicit Review and Apply. Installed length is preserved.</Caption1>
    {comparison.state === 'stale' ? <p role="alert">The current cable revision differs from this proposal. Refresh or recalculate before reviewing or applying it.</p> : null}
    <section aria-label="Current cable values"><h5>Current cable values</h5>
      <Caption1>Live cable read; revision {before.cableWriteRevision}.</Caption1>
      <p>Design length: {stored(before.designLength)}{before.designLength === null || before.designLength === '' ? '' : ' m'}</p>
      <p>Installed length: {stored(before.installLength)}{before.installLength === null ? '' : ' m'}</p>
      <RouteValue value={before.routing} />
    </section>
    <section aria-label="Proposed cable values"><h5>Proposed cable values</h5>
      <Caption1>Calculated from cable revision {after.cableWriteRevision}.</Caption1>
      <p>Design length: {stored(after.designLength)}{after.designLength === null || after.designLength === '' ? '' : ' m'}</p>
      <RouteValue value={after.routing} />
    </section>
    <p>Design length delta: {comparison.length.deltaMeters === null ? 'Unavailable — both values must be recorded valid decimals.'
      : `${comparison.length.deltaMeters !== '0' && !comparison.length.deltaMeters.startsWith('-') ? '+' : ''}${comparison.length.deltaMeters} m`}</p>
    {initial?.mode === 'initial-fill-candidate' ? <p>Both current fields are empty. This is only a candidate for initial fill; a separate current administrator mandate and server checks are required.</p>
      : initial?.mode === 'manual-review' ? <p>Existing or partial cable values are retained until explicit human Review and Apply.</p>
        : <p>This cable is not eligible for automatic initial fill.</p>}
    <section aria-label="Ordered route changes"><h5>Ordered route changes</h5>
      {route.state === 'not-compared' ? <p role="status">The ordered difference exceeds the comparison work limit. Exact old and new route text remains above without truncation.</p>
        : route.state === 'missing' ? <p>One route is NULL. No existing route or ordered difference is assumed.</p>
          : route.state === 'unchanged' ? <p>Exact route text is unchanged.</p>
            : route.state === 'format-only' ? <p>The ordered occurrences are unchanged; exact route formatting differs.</p>
              : <><p>{route.added.length} added; {route.removed.length} removed; {route.reordered.length} reordered occurrences.</p>
                <ul aria-label="Route occurrence changes" style={{ maxHeight: '20rem', overflowY: 'auto' }}>
                  {route.added.map(item => <li key={`add-${item.index}`}>Added {item.text} at new position {item.index + 1}.</li>)}
                  {route.removed.map(item => <li key={`remove-${item.index}`}>Removed {item.text} from old position {item.index + 1}.</li>)}
                  {route.reordered.map(item => <li key={`move-${item.beforeIndex}`}>Reordered {item.text}: old position {item.beforeIndex + 1} → new position {item.afterIndex + 1}.</li>)}
                </ul></>}
      <Caption1>Order, repeated identifiers and SECONDARY are retained. Occurrence alignment is deterministic; it does not prove that a physical tray moved.</Caption1>
    </section>
    {value.admissionBaseline ? <details><summary>Values at calculation admission</summary>
      <p>This frozen baseline is historical and is separate from the live current cable read above.</p>
      <Caption1>Admission {value.admissionBaseline.admissionId}; baseline {value.admissionBaseline.baselineHash}; cable revision {value.admissionBaseline.cable.cableWriteRevision}.</Caption1>
      <p>Design length: {stored(value.admissionBaseline.cable.designLength)}</p><RouteValue value={value.admissionBaseline.cable.routing} />
    </details> : null}
    <details><summary>Comparison provenance</summary><p>Read context: {value.current.contextSha256}</p><p>Exact proposal: {after.proposalId}</p><p>Proposal hash: {after.proposalHash}</p>
      <p>Immutable result: {after.revisionResultHash ?? 'Unavailable for this historical result'}</p>
      <Caption1>No old geometric length is inferred from stored design length. This display does not establish engineering acceptance.</Caption1>
    </details>
  </section>;
}
