import { useId } from 'react';
import {
  Body1, Button, Caption1, Dropdown, Field, Option, Spinner, makeStyles, tokens,
} from '@fluentui/react-components';
import type { ProjectModelVersion } from '@/api/projectModels';
import { useProjectModelSelection } from './hooks/useProjectModelSelection';

const useStyles = makeStyles({
  heading: { margin: 0, fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  controls: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' },
  field: { flex: '1 1 22rem', minWidth: 0, '& .fui-Dropdown': { minWidth: 0, width: '100%' } },
  metadata: { display: 'flex', flexDirection: 'column', gap: '0.25rem', overflowWrap: 'anywhere' },
  error: { color: tokens.colorStatusDangerForeground1 },
  warning: { color: tokens.colorNeutralForeground2 },
});

const NONE = '__no_model__';
const dateLabel = (value: string): string => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'Date unavailable';
};
const statusLabel = (version: ProjectModelVersion): string => version.health === 'healthy'
  ? 'Available' : version.health === 'unavailable' ? 'Unavailable' : 'Not verified';
const optionLabel = (version: ProjectModelVersion): string =>
  `${version.label} — ${version.source.name} — ${dateLabel(version.importedAt ?? version.preparedAt)}`;

type Props = { projectId: string | null; token: string | null; canEdit: boolean; className?: string };

export function ProjectModelSection({ projectId, token, canEdit, className }: Props) {
  const styles = useStyles();
  const headingId = useId();
  const state = useProjectModelSelection({ projectId, token, canEdit });
  const snapshot = state.snapshot;
  const activeId = snapshot?.selection.activeModelVersionId;
  const active = snapshot?.versions.find(version => version.id === activeId);
  const draft = snapshot?.versions.find(version => version.id === state.draftId);
  const pending = state.loading || state.refreshing || state.saving || state.reconciling;
  const editable = Boolean(canEdit && projectId && token);
  const labelCounts = new Map<string, number>();
  for (const version of snapshot?.versions ?? []) {
    const label = optionLabel(version);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const displayLabel = (version: ProjectModelVersion): string => {
    const label = optionLabel(version);
    return `${label}${(labelCounts.get(label) ?? 0) > 1 ? ` — Version ${version.id}` : ''}`;
  };
  const draftLabel = state.draftId === undefined ? '' : state.draftId === null
    ? 'No model' : draft ? `${displayLabel(draft)}${draft.health === 'healthy' ? '' : ` (${statusLabel(draft)})`}` : 'Selection unavailable';
  const canKeepDraft = state.draftId === null || Boolean(draft && draft.state === 'ready' && draft.health === 'healthy');

  return <section className={className} aria-labelledby={headingId}>
    <h3 id={headingId} className={styles.heading}>3D model</h3>
    {!projectId || !token ? <Body1>Project model information is unavailable. Sign in to view it.</Body1> : <>
      {state.loading && !snapshot ? <Spinner size="tiny" label="Loading 3D models..." /> : null}
      {snapshot ? <div className={styles.metadata}>
        <Caption1>Active model</Caption1>
        {activeId === null ? <Body1>No model selected</Body1> : active ? <>
          <Body1>{active.label}</Body1>
          {(labelCounts.get(optionLabel(active)) ?? 0) > 1 ? <Caption1>Version: {active.id}</Caption1> : null}
          <Caption1>Source: {active.source.name}</Caption1>
          <Caption1>Prepared: {dateLabel(active.preparedAt)}</Caption1>
          {active.importedAt ? <Caption1>Imported: {dateLabel(active.importedAt)}</Caption1> : null}
          <Body1>Status: {statusLabel(active)}</Body1>
        </> : <Body1 role="alert" className={styles.error}>The selected model is missing from the project model list. Refresh to check its availability.</Body1>}
        {snapshot.versions.length === 0 ? <Body1>No prepared models are available for this project.</Body1> : null}
      </div> : null}
      {state.refreshing ? <Spinner size="tiny" label="Refreshing 3D model information..." /> : null}
      {state.saving ? <Body1 role="status">Saving model selection...</Body1> : null}
      {state.reconciling ? <Body1 role="status">Checking the current server selection...</Body1> : null}
      {state.stale && snapshot ? <Body1 className={styles.warning}>The information shown may be out of date.</Body1> : null}
      {state.error ? <Body1 role="alert" className={styles.error}>{state.error}</Body1> : null}
      {state.notice ? <Body1 role="status">{state.notice}</Body1> : null}
      {state.conflict ? <div role="alert" className={styles.metadata}>
        <Body1>{state.conflict}</Body1>
        {editable ? <div className={styles.controls}>
          <Button disabled={pending || !snapshot || state.stale || state.activeMissing} onClick={state.useLatestSelection}>Use latest selection</Button>
          <Button disabled={pending || !snapshot || state.stale || state.activeMissing || !canKeepDraft} onClick={state.confirmDraftAgainstLatest}>Keep my choice</Button>
        </div> : null}
      </div> : null}
      {(state.error || state.stale || state.activeMissing) ? <Button disabled={pending} onClick={() => void state.refresh()}>Retry</Button> : null}
      {editable ? <div className={styles.controls}>
        <Field className={styles.field} label="Model version">
          <Dropdown
            placeholder="Select a model"
            selectedOptions={state.draftId === undefined ? [] : [state.draftId ?? NONE]}
            value={draftLabel}
            disabled={pending || !snapshot || state.stale || state.activeMissing}
            onOptionSelect={(_, data) => {
              if (data.optionValue) state.changeDraft(data.optionValue === NONE ? null : data.optionValue);
            }}
          >
            <Option value={NONE}>No model</Option>
            {snapshot?.versions.map(version => {
              const label = `${displayLabel(version)}${version.health === 'healthy' ? '' : ` (${statusLabel(version)})`}`;
              return <Option key={version.id} value={version.id} text={label} disabled={version.health !== 'healthy'}>{label}</Option>;
            })}
          </Dropdown>
        </Field>
        <Button appearance="primary" disabled={!state.canSave || pending} onClick={() => void state.save()}>{state.saving ? 'Saving...' : 'Save'}</Button>
      </div> : <Caption1>Read-only project access. Model selection cannot be changed.</Caption1>}
    </>}
  </section>;
}
