import { useId, useState } from 'react';
import { Button, Field, Input, makeStyles, tokens } from '@fluentui/react-components';
import { usePathFinderCableWorkflow, type PathFinderCableWorkflowAccess } from '@/hooks/usePathFinderCableWorkflow';
import { classifyCableWorkflow, type CableWorkflowRow } from '../../../shared/pathfinderCableWorkflow';
import type { CableWorkflowQuery } from '@/api/pathfinderCableWorkflow';
import type { CalculationAvailability } from '../../../shared/pathfinderCalculationAvailability';

type Filter = CableWorkflowQuery['filter'];
export type PathFinderNeedsRoutingListProps = Omit<PathFinderCableWorkflowAccess, 'query'> & {
  preferences: Pick<CableWorkflowQuery, 'secondaryDistanceMeters' | 'preferVerticalApproach'>;
  onPreview?: (row: CableWorkflowRow, anchor: HTMLElement) => void; onPreviewLeave?: () => void;
  onSelect: (row: CableWorkflowRow) => void; selectedCableId?: string | null; className?: string;
};
const labels = { 'needs-routing': 'Needs routing', calculating: 'Calculating', 'ready-for-review': 'Ready for review',
  'up-to-date': 'Updated', excluded: 'Excluded', blocked: 'Action required' } as const;
const reasons: Record<string, string> = {
  CABLE_CATEGORY_REQUIRED: 'Choose a supported cable category.', SETTINGS_REQUIRED: 'Complete the cable length settings in Project Details.',
  MODEL_REQUIRED: 'Choose and prepare the active 3D model.', CALCULATION_RESOURCE_LIMIT: 'The calculation reached a resource limit. Review the prepared network and retry.',
  CALCULATION_DEADLINE_EXCEEDED: 'The calculation timed out. Review the network and retry.', CALCULATION_FAILED: 'The calculation failed. Review its diagnostic details before retrying.',
  CALCULATION_CANCELLED: 'The calculation was cancelled. Start a new calculation when ready.', CALCULATION_QUEUED: 'This cable is waiting to be calculated.',
  CALCULATION_RUNNING: 'The route is being calculated.', CALCULATED_AWAITING_JOB_COMPLETION: 'This route was calculated; review becomes available after its job finishes.',
  CALCULATION_CURRENTNESS_UNAVAILABLE: 'The current result could not be verified. Refresh its diagnostics.', CALCULATION_STALE: 'The calculation inputs changed. A new calculation is needed.',
  NO_PATH: 'Both endpoints are available, but no route was found. Review the permitted trays and their connections.',
  LOCATIONS_REQUIRED: 'Resolve the missing or ambiguous From/To points.', CALCULATION_NOT_REQUESTED: 'Both endpoints are available. This cable has not been calculated.',
  AVAILABILITY_NOT_EVALUATED: 'Endpoint availability has not been checked. Prepare the current model and refresh.',
  PROPOSAL_NOT_REVIEWABLE: 'The result is not ready for review. Open the diagnostic details.',
  WORKFLOW_EVIDENCE_UNAVAILABLE: 'The diagnostic evidence could not be verified. Refresh this cable.',
  CALCULATION_ITEM_NOT_EVALUATED: 'This cable has not yet been evaluated by its calculation job.',
  CALCULATION_NOT_READY: 'The calculation is not ready. Review its diagnostic details.',
  AUTHORITY_EXPIRED: 'Calculation permission expired. Renew it using your administrator account.',
  AUTHORITY_REVOKED: 'Calculation permission was revoked. Review administrator access before retrying.',
};
function endpointReason(side: string, evidence: CalculationAvailability): string | null {
  if (evidence.pointAvailable) return null;
  switch (evidence.status) {
    case 'missing': return `${side} point was not found. Select its location in the model.`;
    case 'ambiguous': return `${side} matches more than one location. Select the intended object.`;
    case 'saved-binding-required': return `${side} needs a confirmed shared location.`;
    case 'object-unverified': return `${side} object could not be verified against the active model.`;
    case 'preparation-required': return `${side} needs a prepared current model.`;
    default: return `${side} point availability has not been evaluated.`;
  }
}
export function cableWorkflowReason(row: CableWorkflowRow): string {
  const decision = classifyCableWorkflow(row);
  if (decision.status === 'up-to-date') return 'The accepted route and design length match the current cable.';
  if (decision.status === 'ready-for-review') return 'A current calculation is ready for your review.';
  // Preserve an actual running/blocked outcome before suggesting endpoint work.
  const immediate = decision.reasonCodes.find(code => ['CABLE_CATEGORY_REQUIRED', 'SETTINGS_REQUIRED', 'MODEL_REQUIRED', 'CALCULATION_RESOURCE_LIMIT',
    'CALCULATION_DEADLINE_EXCEEDED', 'CALCULATION_FAILED', 'CALCULATION_CANCELLED', 'CALCULATION_QUEUED', 'CALCULATION_RUNNING'].includes(code));
  if (immediate) return reasons[immediate];
  const endpoint = [endpointReason('From', row.from), endpointReason('To', row.to)].filter(Boolean);
  if (endpoint.length) return endpoint.join(' ');
  return decision.reasonCodes.map(code => reasons[code]).find(Boolean) ?? 'This cable needs attention. Open its diagnostics to review the reason.';
}
const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, minWidth: 0 },
  controls: { display: 'flex', gap: tokens.spacingHorizontalS, flexWrap: 'wrap', alignItems: 'end' },
  list: { listStyleType: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  row: { border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium, padding: tokens.spacingHorizontalM,
    overflowWrap: 'anywhere', backgroundColor: tokens.colorNeutralBackground1 },
  tag: { justifyContent: 'flex-start', maxWidth: '100%', whiteSpace: 'normal', textAlign: 'left' },
  small: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  select: { padding: tokens.spacingHorizontalS, backgroundColor: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium },
});

/** Read-only foundation. Clicking a tag reports an owned row; it never calculates or saves. */
export function PathFinderNeedsRoutingList(props: PathFinderNeedsRoutingListProps) {
  if (!props.isAdmin || !props.accountId || !props.token || !props.projectId || props.projectId !== props.loadedProjectId || !props.active) return null;
  const owner = JSON.stringify([props.projectId, props.loadedProjectId, props.accountId, props.token]);
  return <OwnedCableWorkflowList key={owner} {...props} />;
}
function OwnedCableWorkflowList(props: PathFinderNeedsRoutingListProps) {
  const styles = useStyles(), [filter, setFilter] = useState<Filter>('needs-routing'), [searchDraft, setSearchDraft] = useState(''), [search, setSearch] = useState('');
  const filterId = useId();
  const workflow = usePathFinderCableWorkflow({ ...props, query: { ...props.preferences, filter, search, limit: 100 } });
  const page = workflow.page;
  return <section className={`${styles.root}${props.className ? ` ${props.className}` : ''}`} aria-label="Cable routing diagnostics" aria-busy={workflow.busy}>
    <h3>Path Finder cables</h3>
    <form className={styles.controls} onSubmit={event => { event.preventDefault(); setSearch(searchDraft); }}>
      <Field label={{ children: 'Cable state', htmlFor: filterId }}><select id={filterId} className={styles.select} value={filter} onChange={event => setFilter(event.target.value as Filter)}>
        <option value="needs-routing">Needs routing</option><option value="calculating">Calculating</option><option value="ready-for-review">Ready for review</option>
        <option value="up-to-date">Updated</option><option value="all">All non-MV cables</option>
      </select></Field>
      <Field label="Search tags, From or To"><Input value={searchDraft} maxLength={256} onChange={(_, data) => setSearchDraft(data.value)} /></Field>
      <Button type="submit">Search cables</Button><Button type="button" disabled={!workflow.enabled || workflow.busy} onClick={workflow.refresh}>Refresh cables</Button>
    </form>
    <p className={styles.small}>MV cables are excluded. Selecting a cable opens its workflow without changing cable values.</p>
    <p className={styles.small}>Each page shows live observations. Refresh to update earlier pages as calculations progress.</p>
    {workflow.loading ? <p role="status">Loading cable diagnostics…</p> : null}
    {workflow.error ? <p role="alert">{workflow.error}</p> : null}
    {page ? <>
      <p role="status">{page.rows.length} matching {page.rows.length === 1 ? 'cable' : 'cables'} on this page; {page.scannedCount} checked.
        {page.nextCursor !== null ? ' More cables remain to be checked.' : ' End of this scan.'}</p>
      {!page.rows.length ? <p>{page.nextCursor !== null
        ? 'No matches in this checked portion. Continue to check the remaining cables.'
        : workflow.hasPrevious ? 'No matches in this final portion. Previous pages may contain matches.'
          : 'No cables match this filter in the completed scan.'}</p> : null}
      <ul className={styles.list} aria-label="Matching cables">{page.rows.map(row => {
        const decision = classifyCableWorkflow(row);
        return <li className={styles.row} key={row.cable.id}>
          <Button className={styles.tag} appearance={props.selectedCableId === row.cable.id ? 'primary' : 'subtle'}
            aria-pressed={props.selectedCableId === row.cable.id} aria-haspopup="dialog" aria-keyshortcuts="Alt+Enter"
            disabled={workflow.busy || !workflow.enabled} onClick={() => props.onSelect(row)}
            onPointerEnter={event => props.onPreview?.(row, event.currentTarget)} onPointerLeave={props.onPreviewLeave}
            onFocus={event => props.onPreview?.(row, event.currentTarget)} onBlur={props.onPreviewLeave}
            onKeyDown={event => { if (event.altKey && event.key === 'Enter') { event.preventDefault(); props.onSelect(row); } }}>
            {row.cable.tag ?? 'Untagged cable'}
          </Button>
          <p>From: {row.cable.fromLocation ?? 'No location name'}<br />To: {row.cable.toLocation ?? 'No location name'}</p>
          <p><strong>{labels[decision.status]}</strong> — {cableWorkflowReason(row)}</p>
          {decision.reasonCodes.length ? <details><summary>Technical details</summary><ul>{decision.reasonCodes.map(code => <li key={code}><code>{code}</code></li>)}</ul></details> : null}
        </li>;
      })}</ul>
      <div className={styles.controls}><Button disabled={workflow.busy || !workflow.hasPrevious || !workflow.enabled} onClick={workflow.previousPage}>Previous page</Button>
        <Button disabled={workflow.busy || page.nextCursor === null || !workflow.enabled} onClick={workflow.nextPage}>Continue scan</Button></div>
    </> : null}
  </section>;
}
