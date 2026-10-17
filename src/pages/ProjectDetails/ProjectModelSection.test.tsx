import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectModelVersion } from '@/api/projectModels';
import { ProjectModelSection } from './ProjectModelSection';
import { useProjectModelSelection } from './hooks/useProjectModelSelection';

vi.mock('./hooks/useProjectModelSelection', () => ({ useProjectModelSelection: vi.fn() }));
const projectId = '00000000-0000-4000-8000-000000000001';
const firstId = '00000000-0000-4000-8000-000000000002';
const secondId = '00000000-0000-4000-8000-000000000003';
const version = (id: string, health: ProjectModelVersion['health'] = 'healthy'): ProjectModelVersion => ({
  id, projectId, label: 'Aalborg', source: { name: 'model.nwd', bytes: 100, sha256: 'a'.repeat(64), identityBasis: 'observed-local-file' },
  preparedAt: '2026-01-01T00:00:00Z', importedAt: '2026-01-02T00:00:00Z', state: 'ready', health,
});
type ModelState = ReturnType<typeof useProjectModelSelection>;
let current: ModelState;
beforeEach(() => {
  vi.clearAllMocks();
  current = {
    snapshot: { versions: [version(firstId)], selection: { projectId, activeModelVersionId: null, selectionRevision: 0, updatedAt: '2026-01-01T00:00:00Z' } },
    draftId: null, loading: false, refreshing: false, saving: false, reconciling: false, stale: false,
    activeMissing: false, conflict: null, notice: null, error: null, canSave: false,
    changeDraft: vi.fn(), refresh: vi.fn(async () => {}), save: vi.fn(async () => {}),
    useLatestSelection: vi.fn(), confirmDraftAgainstLatest: vi.fn(),
  };
  vi.mocked(useProjectModelSelection).mockImplementation(() => current);
});
const view = (canEdit = true) => <FluentProvider theme={webLightTheme}>
  <ProjectModelSection projectId={projectId} token="current-login" canEdit={canEdit} />
</FluentProvider>;
const region = () => screen.getByRole('region', { name: '3D model' });

describe('project model section', () => {
  it('shows initial loading separately from an empty model list', () => {
    current = { ...current, snapshot: null, draftId: undefined, loading: true, stale: true };
    render(view());
    expect(screen.getByText('Loading 3D models...')).toBeInTheDocument();
    expect(screen.queryByText('No model selected')).not.toBeInTheDocument();
    expect(within(region()).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows no selection and empty metadata without silently choosing a model', () => {
    current.snapshot!.versions = [];
    render(view());
    expect(screen.getByText('No model selected')).toBeInTheDocument();
    expect(screen.getByText('No prepared models are available for this project.')).toBeInTheDocument();
    expect(current.changeDraft).not.toHaveBeenCalled();
    expect(current.save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps active version metadata and unavailable status visible to read-only users', () => {
    current.snapshot!.versions = [version(firstId, 'unavailable')];
    current.snapshot!.selection.activeModelVersionId = firstId;
    current.draftId = firstId;
    render(view(false));
    expect(screen.getByText('Aalborg')).toBeInTheDocument();
    expect(screen.getByText('Source: model.nwd')).toBeInTheDocument();
    expect(screen.getByText('Status: Unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(current.save).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('treats a missing active UUID as unavailable rather than null and offers Retry', () => {
    current.snapshot!.selection.activeModelVersionId = secondId;
    current.activeMissing = true;
    current.draftId = secondId;
    render(view());
    expect(screen.getByText(/selected model is missing/)).toBeInTheDocument();
    expect(screen.queryByText('No model selected')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(current.refresh).toHaveBeenCalledOnce();
  });

  it('uses model UUID values for same-label versions and requires an explicit Save', async () => {
    current.snapshot!.versions = [version(firstId), version(secondId)];
    const rendered = render(view());
    fireEvent.click(screen.getByRole('combobox', { name: 'Model version' }));
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(secondId) }));
    expect(current.changeDraft).toHaveBeenCalledExactlyOnceWith(secondId);
    expect(current.save).not.toHaveBeenCalled();
    current = { ...current, draftId: secondId, canSave: true };
    rendered.rerender(view());
    expect(screen.getByRole('combobox').textContent).toContain(secondId);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(current.save).toHaveBeenCalledOnce();
  });

  it('shows a duplicate-metadata version UUID in the closed selection and active summary', () => {
    current.snapshot!.versions = [version(firstId), version(secondId)];
    current.snapshot!.selection.activeModelVersionId = firstId;
    current.draftId = firstId;
    render(view());
    expect(screen.getByRole('combobox').textContent).toContain(firstId);
    expect(screen.getByText('Version: ' + firstId)).toBeInTheDocument();
  });

  it('makes No model an explicit null draft and leaves unavailable options disabled', async () => {
    current.snapshot!.versions = [version(firstId), version(secondId, 'unavailable')];
    current.snapshot!.selection.activeModelVersionId = firstId;
    current.draftId = firstId;
    render(view());
    fireEvent.click(screen.getByRole('combobox'));
    const unavailable = await screen.findByRole('option', { name: /Unavailable/ });
    expect(unavailable).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('option', { name: 'No model' }));
    expect(current.changeDraft).toHaveBeenCalledExactlyOnceWith(null);
    expect(current.save).not.toHaveBeenCalled();
  });

  it('reflects one pending save and reports success only from the hook', () => {
    current = { ...current, draftId: firstId, canSave: true };
    const rendered = render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(current.save).toHaveBeenCalledOnce();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    current = { ...current, saving: true, canSave: false };
    rendered.rerender(view());
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving model selection...');
  });

  it('shows stale failures and unknown-outcome reconciliation with explicit review actions', () => {
    current = { ...current, stale: true, error: 'The latest model data could not be loaded.' };
    const rendered = render(view());
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.getByText('The information shown may be out of date.')).toBeInTheDocument();
    expect(screen.getByText('No model selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(current.refresh).toHaveBeenCalledOnce();
    current = { ...current, stale: false, error: null, conflict: 'The save response could not be confirmed. Review the current selection.', reconciling: false };
    rendered.rerender(view());
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Use latest selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep my choice' }));
    expect(current.useLatestSelection).toHaveBeenCalledOnce();
    expect(current.confirmDraftAgainstLatest).toHaveBeenCalledOnce();
    expect(current.save).not.toHaveBeenCalled();
  });

  it('supports the Fluent keyboard menu and passes the exact login/project scope to the hook', async () => {
    const user = userEvent.setup();
    render(view());
    expect(useProjectModelSelection).toHaveBeenCalledWith({ projectId, token: 'current-login', canEdit: true });
    const dropdown = screen.getByRole('combobox', { name: 'Model version' });
    await user.tab();
    expect(dropdown).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(await screen.findByRole('listbox')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(current.save).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'missing'] as const)('disables review confirmation when the draft becomes %s', (kind) => {
    current = { ...current, draftId: secondId, conflict: 'The model selection changed elsewhere.' };
    if (kind === 'unavailable') current.snapshot!.versions.push(version(secondId, 'unavailable'));
    render(view());
    expect(screen.getByRole('button', { name: 'Keep my choice' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use latest selection' })).toBeEnabled();
    expect(current.confirmDraftAgainstLatest).not.toHaveBeenCalled();
  });
});
