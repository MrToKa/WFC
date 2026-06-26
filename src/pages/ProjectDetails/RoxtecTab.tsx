import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Spinner,
  Subtitle2,
  Textarea
} from '@fluentui/react-components';
import { useNavigate } from 'react-router-dom';

import {
  createRoxtecEntry,
  deleteRoxtecEntry,
  fetchRoxtecEntries,
  updateRoxtecEntry
} from '@/api/roxtec';
import type { RoxtecEntry } from '@/api/types';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';

type RoxtecDraft = Omit<
  RoxtecEntry,
  'projectId' | 'createdAt' | 'updatedAt' | 'description'
> & {
  description: string;
};

type RoxtecDialogMode = 'create' | 'edit';

const emptyDraft: RoxtecDraft = {
  id: 0,
  revision: '',
  tag: '',
  type: '',
  description: ''
};

type RoxtecTabProps = {
  styles: ProjectDetailsStyles;
  projectId: string | undefined;
  token: string | null;
};

export const RoxtecTab = ({ styles, projectId, token }: RoxtecTabProps) => {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<RoxtecEntry[]>([]);
  const [draft, setDraft] = useState<RoxtecDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<RoxtecDialogMode>('create');
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [filterText, setFilterText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const canManageRoxtec = Boolean(token);

  const loadEntries = useCallback(async () => {
    if (!projectId) {
      setEntries([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetchRoxtecEntries(projectId);
      setEntries(response.entries);
    } catch (loadError) {
      console.error('Failed to load Roxtec entries', loadError);
      setError('Failed to load Roxtec entries.');
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const nextRoxtecId = useMemo(() => {
    const maxId = entries.reduce((max, entry) => Math.max(max, entry.id), 0);
    return maxId + 1;
  }, [entries]);

  const openCreateDialog = useCallback(() => {
    setDraft({
      ...emptyDraft,
      id: nextRoxtecId
    });
    setDialogMode('create');
    setEditingEntryId(null);
    setError(null);
    setIsDialogOpen(true);
  }, [nextRoxtecId]);

  const openEditDialog = useCallback((entry: RoxtecEntry) => {
    setDraft({
      id: entry.id,
      revision: entry.revision,
      tag: entry.tag,
      type: entry.type,
      description: entry.description ?? ''
    });
    setDialogMode('edit');
    setEditingEntryId(entry.id);
    setError(null);
    setIsDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setIsDialogOpen(false);
    setError(null);
    setEditingEntryId(null);
    setDialogMode('create');
  }, []);

  const updateDraft = useCallback(
    (field: keyof RoxtecDraft, value: string) => {
      setDraft((previous) => ({
        ...previous,
        [field]: value
      }));
      if (error) {
        setError(null);
      }
    },
    [error]
  );

  const handleSaveEntry = useCallback(async () => {
    if (!projectId) {
      setError('Project ID is missing.');
      return;
    }

    if (!token) {
      setError('Sign-in required.');
      return;
    }

    const nextId = draft.id;
    const nextRevision = draft.revision.trim();
    const nextTag = draft.tag.trim();
    const nextType = draft.type.trim();
    const nextDescription = draft.description.trim();

    if (!Number.isInteger(nextId) || nextId < 1 || !nextRevision || !nextTag || !nextType) {
      setError('Rev., Tag, and Type are required.');
      return;
    }

    setIsSaving(true);

    try {
      if (dialogMode === 'edit' && editingEntryId !== null) {
        await updateRoxtecEntry(token, projectId, editingEntryId, {
          revision: nextRevision,
          tag: nextTag,
          type: nextType,
          description: nextDescription || null
        });
      } else {
        await createRoxtecEntry(token, projectId, {
          revision: nextRevision,
          tag: nextTag,
          type: nextType,
          description: nextDescription || null
        });
      }

      await loadEntries();
      setDraft(emptyDraft);
      setError(null);
      setIsDialogOpen(false);
      setEditingEntryId(null);
      setDialogMode('create');
    } catch (saveError) {
      console.error('Failed to save Roxtec entry', saveError);
      setError('Failed to save Roxtec entry.');
    } finally {
      setIsSaving(false);
    }
  }, [dialogMode, draft, editingEntryId, loadEntries, projectId, token]);

  const handleDeleteEntry = useCallback(
    async (entryId: number) => {
      if (!projectId || !token) {
        return;
      }

      setIsSaving(true);

      try {
        await deleteRoxtecEntry(token, projectId, entryId);
        await loadEntries();
      } catch (deleteError) {
        console.error('Failed to delete Roxtec entry', deleteError);
        setError('Failed to delete Roxtec entry.');
      } finally {
        setIsSaving(false);
      }
    },
    [loadEntries, projectId, token]
  );

  const handleOpenDetails = useCallback(
    (entryId: number) => {
      if (!projectId) {
        return;
      }

      navigate(`/projects/${projectId}/roxtec/${entryId}`);
    },
    [navigate, projectId]
  );

  const filteredEntries = useMemo(() => {
    const normalizedFilter = filterText.trim().toLowerCase();

    if (!normalizedFilter) {
      return entries;
    }

    return entries.filter((entry) => {
      const searchable = [
        String(entry.id),
        entry.revision,
        entry.tag,
        entry.type,
        entry.description ?? ''
      ]
        .join(' ')
        .toLowerCase();

      return searchable.includes(normalizedFilter);
    });
  }, [entries, filterText]);

  return (
    <div className={styles.tabPanel} role="tabpanel" aria-label="Roxtec">
      <div className={styles.panel}>
        <div className={styles.actionsRow}>
          <div>
            <Subtitle2>Roxtec</Subtitle2>
            <Body1>Add Roxtec entries to build the table.</Body1>
          </div>
          <Button onClick={() => void loadEntries()} disabled={isLoading || isSaving}>
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </Button>
          {canManageRoxtec ? (
            <Button appearance="primary" onClick={openCreateDialog} disabled={isSaving}>
              Add Roxtec
            </Button>
          ) : null}
        </div>

        <div className={styles.filtersRow}>
          <Input
            value={filterText}
            onChange={(_, data) => setFilterText(data.value)}
            placeholder="Filter Roxtec entries"
            aria-label="Filter Roxtec entries"
          />
        </div>

        <Caption1>
          {filteredEntries.length} of {entries.length} entries
        </Caption1>

        <Dialog
          open={isDialogOpen}
          onOpenChange={(_, data) => {
            if (!data.open) {
              closeDialog();
            }
          }}
        >
          <DialogSurface>
            <form
              className={styles.dialogForm}
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveEntry();
              }}
            >
              <DialogBody>
                <DialogTitle>
                  {dialogMode === 'create' ? 'Add Roxtec' : 'Edit Roxtec'}
                </DialogTitle>
                <DialogContent>
                  <Field label="ID">
                    <Input value={String(draft.id)} readOnly />
                  </Field>
                  <Field label="Rev." required>
                    <Input
                      value={draft.revision}
                      onChange={(_, data) => updateDraft('revision', data.value)}
                    />
                  </Field>
                  <Field label="Tag" required>
                    <Input
                      value={draft.tag}
                      onChange={(_, data) => updateDraft('tag', data.value)}
                    />
                  </Field>
                  <Field label="Type" required>
                    <Input
                      value={draft.type}
                      onChange={(_, data) => updateDraft('type', data.value)}
                    />
                  </Field>
                  <Field label="Description">
                    <Textarea
                      value={draft.description}
                      onChange={(_, data) => updateDraft('description', data.value)}
                      resize="vertical"
                      rows={3}
                    />
                  </Field>
                  {error ? <Body1 className={styles.errorText}>{error}</Body1> : null}
                </DialogContent>
                <DialogActions className={styles.dialogActions}>
                  <Button
                    type="button"
                    appearance="secondary"
                    onClick={closeDialog}
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" appearance="primary" disabled={isSaving}>
                    {dialogMode === 'create' ? 'Add Roxtec' : 'Save changes'}
                  </Button>
                </DialogActions>
              </DialogBody>
            </form>
          </DialogSurface>
        </Dialog>

        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>ID</th>
                <th className={styles.tableHeadCell}>Rev.</th>
                <th className={styles.tableHeadCell}>Tag</th>
                <th className={styles.tableHeadCell}>Type</th>
                <th className={styles.tableHeadCell}>Description</th>
                <th className={styles.tableHeadCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className={styles.tableCell} colSpan={6}>
                    <Spinner label="Loading Roxtec entries..." />
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td className={styles.tableCell} colSpan={6}>
                    <Body1>No Roxtec entries yet.</Body1>
                  </td>
                </tr>
              ) : filteredEntries.length === 0 ? (
                <tr>
                  <td className={styles.tableCell} colSpan={6}>
                    <Body1>No Roxtec entries match the current filter.</Body1>
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className={styles.tableCell}>{entry.id}</td>
                    <td className={styles.tableCell}>{entry.revision}</td>
                    <td className={styles.tableCell}>{entry.tag}</td>
                    <td className={styles.tableCell}>{entry.type}</td>
                    <td className={styles.tableCell}>{entry.description || '-'}</td>
                    <td className={styles.tableCell}>
                      <div className={styles.actionsCell}>
                        <Button appearance="secondary" onClick={() => handleOpenDetails(entry.id)}>
                          Details
                        </Button>
                        {canManageRoxtec ? (
                          <>
                            <Button appearance="secondary" onClick={() => openEditDialog(entry)}>
                              Edit
                            </Button>
                            <Button
                              appearance="subtle"
                              onClick={() => void handleDeleteEntry(entry.id)}
                            >
                              Delete
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
