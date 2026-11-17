import { Button, Caption1, Spinner } from '@fluentui/react-components';
import { ObstacleModelLink } from '@/components/pathfinder/ObstacleModelLink';
import { supportedBarrierExecutionSchema, type AnyBarrierExecution } from '../../../shared/pathfinderBarrierSupported';

type Props = { execution?: AnyBarrierExecution | null; loading?: boolean; error?: string | null; onRetry?: () => void };

/** Lists recorded findings only. Empty observations never imply full-model clearance. */
export function PathFinderObstacleList({ execution, loading = false, error, onRetry }: Props) {
  const parsed = execution ? supportedBarrierExecutionSchema.safeParse(execution) : null;
  const value = !loading && !error && parsed?.success ? parsed.data : null, report = value?.obstacleReport;
  const parents = new Map(report?.selectedParents.map(parent => [parent.selectionId, parent]) ?? []);
  const sorted = (ids: string[]) => ids.map(id => parents.get(id)!).sort((left, right) => left.dbId - right.dbId);
  const crossed = sorted(report?.crossedParentSelectionIds ?? []), blocking = sorted(report?.blockingParentSelectionIds ?? []);
  const complete = report?.status === 'complete', drilling = value?.context.binding.policy.drillThroughWalls;
  const routeChecked = Boolean(report && value?.proof && report.totalSegments > 0);
  const aggregate = report?.blockingAttribution === 'component-membership';
  const count = (length: number, checked = true) => report
    ? !checked && !length ? 'Not checked' : complete ? String(length) : `${length} detected`
    : 'Not recorded';
  const absent = loading ? 'Reading recorded obstacle findings…' : error ? 'Obstacle findings could not be read. Refresh the result to try again.'
    : parsed && !parsed.success ? 'The recorded obstacle evidence could not be read. Refresh the result and calculate again.'
      : value?.diagnostics.status === 'no-barriers-declared' ? 'No obstacles were registered for this calculation. No numbered findings were recorded.'
        : 'Numbered obstacle findings were not recorded for this result. Calculate again to identify crossings and blocked candidates.';
  const entries = (rows: typeof crossed) => <ul style={{ maxHeight: '12rem', overflowY: 'auto', overflowWrap: 'anywhere', paddingLeft: '1.25rem', margin: '0.375rem 0' }}>{rows.map(parent => <li key={parent.selectionId}>
    Obstacle <ObstacleModelLink dbId={parent.dbId} scope={value!.context.binding.scope} />{` · ${parent.name} (${parent.kind})`}
  </li>)}</ul>;
  return <section aria-label="Numbered obstacle findings" style={{ display: 'grid', gap: '0.5rem' }}>
    <h4 style={{ margin: 0 }}>Obstacles on this path</h4>
    {loading ? <Spinner size="tiny" label="Reading obstacle findings…" /> : null}
    {error ? <p role="alert">{error}</p> : null}
    {error && onRetry ? <Button size="small" disabled={loading} onClick={onRetry}>Retry obstacle list</Button> : null}
    <section aria-label="Crossed route obstacles">
      <h5 style={{ margin: '0 0 0.25rem' }}>Obstacles crossed by this route ({count(crossed.length, routeChecked)})</h5>
      {crossed.length ? <>{entries(crossed)}<Caption1>Crossings are recorded in the cable Remarks when this route is saved.</Caption1></>
        : !report ? <Caption1>{absent}</Caption1>
          : !routeChecked ? <Caption1>No final route was available for an intersection check.</Caption1>
            : complete ? <Caption1>No registered obstacles intersect this route.</Caption1>
              : <Caption1>No crossings were detected in the completed checks. The intersection check is incomplete.</Caption1>}
    </section>
    <section aria-label="Blocking candidate obstacles">
      <h5 style={{ margin: '0 0 0.25rem' }}>{aggregate ? 'Selected objects associated with blocking geometry' : 'Obstacles blocking checked routing candidates'} ({drilling && !blocking.length ? 'Not checked' : count(blocking.length)})</h5>
      {blocking.length ? <>{entries(blocking)}<Caption1>{aggregate
        ? 'The blocking geometry was built from these objects. The check cannot identify which individual object was touched. A successful route may avoid this geometry.'
        : 'These obstacles blocked checked candidates. A successful route may avoid them.'}</Caption1></>
        : drilling ? <Caption1>Routing candidates were not checked for blocking obstacles because Drill through the walls was enabled.</Caption1>
          : !report ? <Caption1>{absent}</Caption1>
            : complete ? <Caption1>No blocking obstacles were recorded in the checked routing candidates.</Caption1>
              : <Caption1>No blocking obstacles were recorded in the completed checks. Candidate obstacle identification is incomplete.</Caption1>}
    </section>
    {report && !complete ? <p role="status">Obstacle identification is {report.status}. Additional intersections may exist.</p> : null}
  </section>;
}
