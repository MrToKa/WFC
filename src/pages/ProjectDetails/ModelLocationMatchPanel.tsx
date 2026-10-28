import { useEffect, useState } from 'react';
import { Button, Caption1, Spinner } from '@fluentui/react-components';
import type { usePathFinder } from './hooks/usePathFinder';
import { useModelLocationMatch } from './hooks/useModelLocationMatch';

type Props = { pf: ReturnType<typeof usePathFinder>; accountId: string | null; active: boolean; onChanged?: () => void; onBusyChange?: (busy: boolean) => void };
export function ModelLocationMatchPanel(props: Props) {
  const match = useModelLocationMatch(props);
  const [shown, setShown] = useState(128);
  useEffect(() => { props.onBusyChange?.(match.busy); return () => props.onBusyChange?.(false); }, [match.busy, props.onBusyChange]);
  useEffect(() => { setShown(128); }, [match.owner, match.complete]);
  const problems = match.results.filter(item => !['assigned', 'preserved'].includes(item.status));
  const counts = { assigned: 0, preserved: 0, missing: 0, ambiguous: 0, unavailable: 0 };
  for (const item of match.results) counts[item.status]++;
  if (!match.allowed) return null;
  return <section aria-label="Find and assign model locations" style={{ marginBlock: 12 }}>
    <h3>From/To locations</h3>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBlock: 8 }}>
      <Button appearance="primary" disabled={!match.canStart} onClick={() => void match.start()}>Find and assign From/To</Button>
      {match.busy ? <Button onClick={match.cancel}>Cancel finding locations</Button> : null}
      {match.pending ? <Button disabled={match.busy || !props.active || !match.storageReady} onClick={() => void match.retry()}>Retry saved location assignment</Button> : null}
    </div>
    {match.busy ? <Spinner size="tiny" label={match.progress ?? 'Finding project From/To locations…'} /> : null}
    {match.error ? <p role="alert">{match.error}</p> : null}
    {match.notice ? <p role="status">{match.notice}</p> : null}
    {!match.busy && match.progress && !match.complete ? <Caption1>Last progress: {match.progress}</Caption1> : null}
    {match.totalNames > 0 ? <p role="status">
      {match.results.length} of {match.totalNames} names processed. Assigned: {counts.assigned}; kept: {counts.preserved}; not found: {counts.missing}; multiple matches: {counts.ambiguous}; unavailable or hidden: {counts.unavailable}.
    </p> : null}
    {problems.length ? <details><summary>Locations that need attention ({problems.length})</summary>
      <ul>{problems.slice(0, shown).map(item => <li key={item.name}>{item.name}: {item.status === 'missing' ? 'not found' : item.status === 'ambiguous' ? `multiple matching objects (${item.candidateObjectIds.length})` : 'the matching object is hidden or has no usable location'}.</li>)}</ul>
      {shown < problems.length ? <Button onClick={() => setShown(value => value + 128)}>Show more locations</Button> : null}
    </details> : null}
  </section>;
}
