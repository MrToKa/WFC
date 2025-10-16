import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Tab,
  TabList,
  TabValue,
  Title3,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens
} from '@fluentui/react-components';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  ApiErrorPayload,
  CableImportSummary,
  CableType,
  CableTypeInput,
  Project,
  createCableType,
  deleteCableType,
  exportCableTypes,
  fetchCableTypes,
  fetchProject,
  importCableTypes,
  updateCableType
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    maxWidth: '80rem',
    width: '100%',
    margin: '0 auto',
    ...shorthands.padding('0', '0', '2rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  metadata: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
    gap: '0.75rem'
  },
  panel: {
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1rem')
  },
  tabList: {
    alignSelf: 'flex-start'
  },
  tabPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.75rem'
  },
  statusMessage: {
    padding: '0.5rem 0.75rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  },
  successText: {
    color: tokens.colorStatusSuccessForeground1
  },
  tableContainer: {
    width: '100%',
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    minWidth: '60rem',
    borderCollapse: 'collapse'
  },
  tableHeadCell: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
  },
  tableCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: 'top'
  },
  numericCell: {
    textAlign: 'right'
  },
  actionsCell: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  emptyState: {
    padding: '1rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: 'center'
  },
  hiddenInput: {
    display: 'none'
  },
  dialogForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    flexWrap: 'wrap'
  }
});

type ProjectDetailsTab = 'details' | 'cables';

type CableTypeFormState = {
  name: string;
  purpose: string;
  diameterMm: string;
  weightKgPerM: string;
};

type CableTypeFormErrors = Partial<Record<keyof CableTypeFormState, string>> & {
  general?: string;
};

const emptyCableTypeForm: CableTypeFormState = {
  name: '',
  purpose: '',
  diameterMm: '',
  weightKgPerM: ''
};

const toFormState = (cableType: CableType): CableTypeFormState => ({
  name: cableType.name,
  purpose: cableType.purpose ?? '',
  diameterMm: cableType.diameterMm !== null ? String(cableType.diameterMm) : '',
  weightKgPerM:
    cableType.weightKgPerM !== null ? String(cableType.weightKgPerM) : ''
});

const formatNumeric = (value: number | null): string =>
  value === null
    ? '—'
    : new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 3
      }).format(value);

const sanitizeFileSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

const parseCableApiErrors = (payload: ApiErrorPayload): CableTypeFormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors = Object.entries(payload.fieldErrors ?? {}).reduce<
    CableTypeFormErrors
  >((acc, [field, messages]) => {
    if (messages.length > 0 && field in emptyCableTypeForm) {
      acc[field as keyof CableTypeFormState] = messages[0];
    }
    return acc;
  }, {});

  const generalMessage = payload.formErrors?.[0];
  if (generalMessage) {
    fieldErrors.general = generalMessage;
  }

  return fieldErrors;
};

export const ProjectDetails = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { user, token } = useAuth();

  const isAdmin = Boolean(user?.isAdmin);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<ProjectDetailsTab>('details');

  const [cableTypes, setCableTypes] = useState<CableType[]>([]);
  const [cableTypesLoading, setCableTypesLoading] = useState<boolean>(true);
  const [cableTypesRefreshing, setCableTypesRefreshing] =
    useState<boolean>(false);
  const [cableTypesError, setCableTypesError] = useState<string | null>(null);
  const [cableActionMessage, setCableActionMessage] = useState<string | null>(
    null
  );
  const [cableActionError, setCableActionError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [pendingCableTypeId, setPendingCableTypeId] = useState<string | null>(
    null
  );

  const [isCableDialogOpen, setCableDialogOpen] = useState<boolean>(false);
  const [cableDialogMode, setCableDialogMode] = useState<'create' | 'edit'>(
    'create'
  );
  const [cableDialogValues, setCableDialogValues] =
    useState<CableTypeFormState>(emptyCableTypeForm);
  const [cableDialogErrors, setCableDialogErrors] =
    useState<CableTypeFormErrors>({});
  const [cableDialogSubmitting, setCableDialogSubmitting] =
    useState<boolean>(false);
  const [editingCableTypeId, setEditingCableTypeId] = useState<string | null>(
    null
  );

  useEffect(() => {
    const loadProject = async () => {
      if (!projectId) {
        setError('Project not found.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchProject(projectId);
        setProject(response.project);
      } catch (err) {
        console.error('Failed to load project', err);
        const message =
          err instanceof ApiError
            ? err.status === 404
              ? 'Project not found.'
              : err.message
            : 'Failed to load project.';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadProject();
  }, [projectId]);

  const loadCableTypes = useCallback(
    async (showSpinner: boolean) => {
      if (!projectId) {
        return;
      }

      if (showSpinner) {
        setCableTypesLoading(true);
      } else {
        setCableTypesRefreshing(true);
      }

      setCableTypesError(null);

      try {
        const response = await fetchCableTypes(projectId);
        setCableTypes(response.cableTypes);
      } catch (err) {
        console.error('Failed to load cable types', err);
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setCableTypes([]);
            setCableTypesError(
              'Cable types endpoint is unavailable. Ensure the server is running the latest version.'
            );
          } else {
            setCableTypesError(err.message);
          }
        } else {
          setCableTypesError('Failed to load cable types.');
        }
      } finally {
        setCableTypesLoading(false);
        setCableTypesRefreshing(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    if (!projectId) {
      return;
    }
    void loadCableTypes(true);
  }, [projectId, loadCableTypes]);

  const formattedDates = useMemo(() => {
    if (!project) {
      return null;
    }

    const format = (value: string) =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(value));

    return {
      created: format(project.createdAt),
      updated: format(project.updatedAt)
    };
  }, [project]);

  const handleTabSelect = useCallback(
    (_event: unknown, data: { value: TabValue }) => {
      setSelectedTab(data.value as ProjectDetailsTab);
    },
    []
  );

  const handleCableDialogFieldChange =
    (field: keyof CableTypeFormState) =>
    (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
      setCableDialogValues((previous) => ({
        ...previous,
        [field]: data.value
      }));
    };

  const resetCableDialog = useCallback(() => {
    setCableDialogOpen(false);
    setCableDialogErrors({});
    setCableDialogValues(emptyCableTypeForm);
    setCableDialogSubmitting(false);
    setEditingCableTypeId(null);
  }, []);

  const openCreateCableDialog = useCallback(() => {
    setCableDialogMode('create');
    setCableDialogValues(emptyCableTypeForm);
    setCableDialogErrors({});
    setCableDialogOpen(true);
    setEditingCableTypeId(null);
  }, []);

  const openEditCableDialog = useCallback((cableType: CableType) => {
    setCableDialogMode('edit');
    setCableDialogValues(toFormState(cableType));
    setCableDialogErrors({});
    setCableDialogOpen(true);
    setEditingCableTypeId(cableType.id);
  }, []);

  const parseNumberInput = (value: string): { numeric: number | null; error?: string } => {
    const trimmed = value.trim();
    if (trimmed === '') {
      return { numeric: null };
    }
    const normalized = trimmed.replace(',', '.');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return { numeric: null, error: 'Enter a valid number' };
    }
    if (parsed < 0) {
      return { numeric: null, error: 'Value must be positive' };
    }
    return { numeric: parsed };
  };

  const buildCableInput = (values: CableTypeFormState) => {
    const errors: CableTypeFormErrors = {};

    const name = values.name.trim();
    if (name === '') {
      errors.name = 'Name is required';
    }

    const diameterResult = parseNumberInput(values.diameterMm);
    if (diameterResult.error) {
      errors.diameterMm = diameterResult.error;
    }

    const weightResult = parseNumberInput(values.weightKgPerM);
    if (weightResult.error) {
      errors.weightKgPerM = weightResult.error;
    }

    const input: CableTypeInput = {
      name,
      purpose: (() => {
        const trimmed = values.purpose.trim();
        return trimmed === '' ? null : trimmed;
      })(),
      diameterMm: diameterResult.numeric,
      weightKgPerM: weightResult.numeric
    };

    return { input, errors };
  };

  const handleSubmitCableDialog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!project || !token) {
      setCableDialogErrors({
        general: 'You need to be signed in as an admin to manage cable types.'
      });
      return;
    }

    const { input, errors } = buildCableInput(cableDialogValues);

    if (Object.keys(errors).length > 0) {
      setCableDialogErrors(errors);
      return;
    }

    setCableDialogSubmitting(true);
    setCableDialogErrors({});
    setCableActionMessage(null);
    setCableActionError(null);

    try {
      if (cableDialogMode === 'create') {
        const response = await createCableType(token, project.id, input);
        setCableTypes((previous) =>
          [...previous, response.cableType].sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          )
        );
        setCableActionMessage('Cable type created.');
      } else if (editingCableTypeId) {
        const response = await updateCableType(
          token,
          project.id,
          editingCableTypeId,
          input
        );
        setCableTypes((previous) =>
          previous
            .map((item) =>
              item.id === editingCableTypeId ? response.cableType : item
            )
            .sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
            )
        );
        setCableActionMessage('Cable type updated.');
      }
      resetCableDialog();
    } catch (err) {
      console.error('Save cable type failed', err);
      if (err instanceof ApiError) {
        setCableDialogErrors(parseCableApiErrors(err.payload));
      } else {
        setCableDialogErrors({
          general: 'Failed to save cable type. Please try again.'
        });
      }
    } finally {
      setCableDialogSubmitting(false);
    }
  };

  const handleDeleteCableType = async (cableType: CableType) => {
    if (!project || !token) {
      setCableActionError(
        'You need to be signed in as an admin to delete cable types.'
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete cable type "${cableType.name}"? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setPendingCableTypeId(cableType.id);
    setCableActionError(null);
    setCableActionMessage(null);

    try {
      await deleteCableType(token, project.id, cableType.id);
      setCableTypes((previous) =>
        previous.filter((item) => item.id !== cableType.id)
      );
      setCableActionMessage('Cable type deleted.');
    } catch (err) {
      console.error('Delete cable type failed', err);
      setCableActionError(
        err instanceof ApiError
          ? err.message
          : 'Failed to delete cable type.'
      );
    } finally {
      setPendingCableTypeId(null);
    }
  };

  const handleImportCableTypes = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    event.target.value = '';

    if (!project || !token) {
      setCableActionError(
        'You need to be signed in as an admin to import cable types.'
      );
      return;
    }

    setIsImporting(true);
    setCableActionError(null);
    setCableActionMessage(null);

    try {
      const response = await importCableTypes(token, project.id, file);
      setCableTypes(response.cableTypes);

      const summary: CableImportSummary = response.summary;
      setCableActionMessage(
        `Import complete: ${summary.inserted} added, ${summary.updated} updated, ${summary.skipped} skipped.`
      );
    } catch (err) {
      console.error('Import cable types failed', err);
      if (err instanceof ApiError && err.status === 404) {
        setCableActionError(
          'Cable type import endpoint not found. Please restart the API server after updating it.'
        );
      } else {
        setCableActionError(
          err instanceof ApiError
            ? err.message
            : 'Failed to import cable types.'
        );
      }
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportCableTypes = async () => {
    if (!project || !token) {
      setCableActionError(
        'You need to be signed in as an admin to export cable types.'
      );
      return;
    }

    setIsExporting(true);
    setCableActionError(null);
    setCableActionMessage(null);

    try {
      const blob = await exportCableTypes(token, project.id);
      const link = document.createElement('a');
      const url = window.URL.createObjectURL(blob);
      const fileName = `${sanitizeFileSegment(
        project.projectNumber
      )}-cables.xlsx`;

      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setCableActionMessage('Cable types exported.');
    } catch (err) {
      console.error('Export cable types failed', err);
      if (err instanceof ApiError && err.status === 404) {
        setCableActionError(
          'Cable type export endpoint not found. Please restart the API server after updating it.'
        );
      } else {
        setCableActionError(
          err instanceof ApiError
            ? err.message
            : 'Failed to export cable types.'
        );
      }
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return (
      <section className={styles.root}>
        <Spinner label="Loading project..." />
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.root}>
        <Body1 className={styles.errorText}>{error}</Body1>
        <Button onClick={() => navigate('/', { replace: true })}>
          Back to projects
        </Button>
      </section>
    );
  }

  if (!project) {
    return (
      <section className={styles.root}>
        <Body1>Project not available.</Body1>
        <Button onClick={() => navigate('/', { replace: true })}>
          Back to projects
        </Button>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="project-details-heading">
      <div className={styles.header}>
        <Title3 id="project-details-heading">
          {project.projectNumber} &mdash; {project.name}
        </Title3>
        <Body1>Customer: {project.customer}</Body1>
      </div>

      <TabList
        className={styles.tabList}
        selectedValue={selectedTab}
        onTabSelect={handleTabSelect}
        aria-label="Project sections"
      >
        <Tab value="details">Details</Tab>
        <Tab value="cables">Cable types</Tab>
      </TabList>

      {selectedTab === 'details' ? (
        <div className={styles.tabPanel}>
          {formattedDates ? (
            <div className={styles.metadata}>
              <div className={styles.panel}>
                <Caption1>Created</Caption1>
                <Body1>{formattedDates.created}</Body1>
              </div>
              <div className={styles.panel}>
                <Caption1>Last updated</Caption1>
                <Body1>{formattedDates.updated}</Body1>
              </div>
            </div>
          ) : null}

          <div className={styles.panel}>
            <Caption1>Description</Caption1>
            <Body1>
              {project.description
                ? project.description
                : 'No description provided.'}
            </Body1>
          </div>
        </div>
      ) : (
        <div className={styles.tabPanel}>
          <div className={styles.actionsRow}>
            <Button
              onClick={() => void loadCableTypes(false)}
              disabled={cableTypesRefreshing}
            >
              {cableTypesRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
            {isAdmin ? (
              <>
                <Button appearance="primary" onClick={openCreateCableDialog}>
                  Add cable type
                </Button>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                >
                  {isImporting ? 'Importing…' : 'Import from Excel'}
                </Button>
                <Button
                  appearance="secondary"
                  onClick={() => void handleExportCableTypes()}
                  disabled={isExporting}
                >
                  {isExporting ? 'Exporting…' : 'Export to Excel'}
                </Button>
                <input
                  ref={fileInputRef}
                  className={styles.hiddenInput}
                  type="file"
                  accept=".xlsx"
                  onChange={handleImportCableTypes}
                />
              </>
            ) : null}
          </div>

          {cableActionMessage ? (
            <Body1
              className={mergeClasses(styles.statusMessage, styles.successText)}
            >
              {cableActionMessage}
            </Body1>
          ) : null}
          {cableActionError ? (
            <Body1
              className={mergeClasses(styles.statusMessage, styles.errorText)}
            >
              {cableActionError}
            </Body1>
          ) : null}
          {cableTypesError ? (
            <Body1
              className={mergeClasses(styles.statusMessage, styles.errorText)}
            >
              {cableTypesError}
            </Body1>
          ) : null}

          {cableTypesLoading ? (
            <Spinner label="Loading cable types..." />
          ) : cableTypes.length === 0 ? (
            <div className={styles.emptyState}>
              <Caption1>No cable types found</Caption1>
              <Body1>
                {isAdmin
                  ? 'Use the buttons above to add or import cable types for this project.'
                  : 'There are no cable types recorded for this project yet.'}
              </Body1>
            </div>
          ) : (
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.tableHeadCell}>Type</th>
                    <th className={styles.tableHeadCell}>Purpose</th>
                    <th
                      className={mergeClasses(
                        styles.tableHeadCell,
                        styles.numericCell
                      )}
                    >
                      Diameter (mm)
                    </th>
                    <th
                      className={mergeClasses(
                        styles.tableHeadCell,
                        styles.numericCell
                      )}
                    >
                      Weight (kg/m)
                    </th>
                    {isAdmin ? (
                      <th className={styles.tableHeadCell}>Actions</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {cableTypes.map((cableType) => {
                    const isBusy = pendingCableTypeId === cableType.id;
                    return (
                      <tr key={cableType.id}>
                        <td className={styles.tableCell}>{cableType.name}</td>
                        <td className={styles.tableCell}>
                          {cableType.purpose ?? '—'}
                        </td>
                        <td
                          className={mergeClasses(
                            styles.tableCell,
                            styles.numericCell
                          )}
                        >
                          {formatNumeric(cableType.diameterMm)}
                        </td>
                        <td
                          className={mergeClasses(
                            styles.tableCell,
                            styles.numericCell
                          )}
                        >
                          {formatNumeric(cableType.weightKgPerM)}
                        </td>
                        {isAdmin ? (
                          <td
                            className={mergeClasses(
                              styles.tableCell,
                              styles.actionsCell
                            )}
                          >
                            <Button
                              size="small"
                              onClick={() => openEditCableDialog(cableType)}
                              disabled={isBusy}
                            >
                              Edit
                            </Button>
                            <Button
                              size="small"
                              appearance="secondary"
                              onClick={() => void handleDeleteCableType(cableType)}
                              disabled={isBusy}
                            >
                              Delete
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Button appearance="secondary" onClick={() => navigate(-1)}>
        Back
      </Button>

      <Dialog
        open={isCableDialogOpen}
        onOpenChange={(_, data) => {
          if (!data.open) {
            resetCableDialog();
          }
        }}
      >
        <DialogSurface>
          <form className={styles.dialogForm} onSubmit={handleSubmitCableDialog}>
            <DialogBody>
              <DialogTitle>
                {cableDialogMode === 'create'
                  ? 'Add cable type'
                  : 'Edit cable type'}
              </DialogTitle>
              <DialogContent>
                <Field
                  label="Name"
                  required
                  validationState={
                    cableDialogErrors.name ? 'error' : undefined
                  }
                  validationMessage={cableDialogErrors.name}
                >
                  <Input
                    value={cableDialogValues.name}
                    onChange={handleCableDialogFieldChange('name')}
                    required
                  />
                </Field>
                <Field
                  label="Purpose"
                  validationState={
                    cableDialogErrors.purpose ? 'error' : undefined
                  }
                  validationMessage={cableDialogErrors.purpose}
                >
                  <Input
                    value={cableDialogValues.purpose}
                    onChange={handleCableDialogFieldChange('purpose')}
                  />
                </Field>
                <Field
                  label="Diameter (mm)"
                  validationState={
                    cableDialogErrors.diameterMm ? 'error' : undefined
                  }
                  validationMessage={cableDialogErrors.diameterMm}
                >
                  <Input
                    value={cableDialogValues.diameterMm}
                    onChange={handleCableDialogFieldChange('diameterMm')}
                    inputMode="decimal"
                  />
                </Field>
                <Field
                  label="Weight (kg/m)"
                  validationState={
                    cableDialogErrors.weightKgPerM ? 'error' : undefined
                  }
                  validationMessage={cableDialogErrors.weightKgPerM}
                >
                  <Input
                    value={cableDialogValues.weightKgPerM}
                    onChange={handleCableDialogFieldChange('weightKgPerM')}
                    inputMode="decimal"
                  />
                </Field>
                {cableDialogErrors.general ? (
                  <Body1 className={styles.errorText}>
                    {cableDialogErrors.general}
                  </Body1>
                ) : null}
              </DialogContent>
              <DialogActions className={styles.dialogActions}>
                <Button
                  type="button"
                  onClick={resetCableDialog}
                  disabled={cableDialogSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={cableDialogSubmitting}
                >
                  {cableDialogSubmitting
                    ? 'Saving...'
                    : cableDialogMode === 'create'
                      ? 'Add'
                      : 'Save'}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </section>
  );
};
