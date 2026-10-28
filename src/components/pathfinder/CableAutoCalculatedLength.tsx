import { Body1, Caption1 } from '@fluentui/react-components';
import { autoLengthViewSchema, emptyAutoLengthView, type AutoLengthView } from '../../../shared/pathfinderAutoLength';
import { formatNumeric } from '@/pages/ProjectDetails.utils';

type Props = { value: Partial<AutoLengthView>; compact?: boolean };
/** Display only. No tray estimate, Design fallback or write authority is inferred. */
export function CableAutoCalculatedLength({ value, compact = false }: Props) {
  const fields = {
    autoCalculatedLength: value.autoCalculatedLength,
    autoLengthStatus: value.autoLengthStatus,
    autoLengthCalculatedAt: value.autoLengthCalculatedAt,
    autoLengthBarrierStatus: value.autoLengthBarrierStatus,
    autoLengthMatchesLatestRequest: value.autoLengthMatchesLatestRequest,
  };
  const present = Object.values(fields).some(item => item !== undefined);
  const parsed = autoLengthViewSchema.safeParse(present ? fields : emptyAutoLengthView());
  const view: AutoLengthView = parsed.success ? parsed.data : { ...emptyAutoLengthView(), autoLengthStatus: 'unavailable' };
  const retained = view.autoCalculatedLength !== null;
  const stateMessage = {
    'not-calculated': 'No checked Path Finder length yet.',
    calculated: 'Checked Path Finder result. Read-only.',
    pending: retained ? 'Recalculating. Last successful length remains visible.' : 'Waiting for a checked Path Finder result.',
    blocked: retained ? 'Latest calculation is blocked. Last successful length remains visible.' : 'The latest calculation is blocked.',
    failed: retained ? 'Latest calculation failed. Last successful length remains visible.' : 'The latest calculation failed.',
    cancelled: retained ? 'Latest calculation was cancelled. Last successful length remains visible.' : 'The latest calculation was cancelled.',
    stale: retained ? 'Last successful length is outdated. Recalculate before using it.' : 'The calculation context is outdated. Recalculate.',
    unavailable: retained ? 'Latest calculation status is unavailable. Last successful length remains visible.' : 'Checked Path Finder length is unavailable.',
    'last-successful': 'Last successful checked Path Finder length. Recalculate after model or settings changes.',
  }[view.autoLengthStatus];
  return <section aria-label="Path Finder automatic length" style={{ display: 'flex', flexDirection: 'column', gap: compact ? 2 : 4 }}>
    <Body1>{formatNumeric(view.autoCalculatedLength)}</Body1>
    <Caption1>{stateMessage}</Caption1>
    {view.autoLengthCalculatedAt ? <Caption1>Calculated: <time dateTime={view.autoLengthCalculatedAt}>{view.autoLengthCalculatedAt}</time></Caption1> : null}
    {view.autoLengthBarrierStatus === 'bypassed' ? <Caption1>Calculated with Drill through the walls enabled.</Caption1> : null}
    {view.autoLengthBarrierStatus === 'no-barriers-declared' ? <Caption1>No barriers were declared for this calculation.</Caption1> : null}
    {!compact ? <Caption1>Routing and Design length follow the separate Save and Review → Apply decisions. Installed length is preserved.</Caption1> : null}
  </section>;
}
