import { ChangeLogTable } from '@/components/ChangeLogTable';
import { canEditProject, canExportChangeLogs, canReadCatalogs } from '@/utils/permissions';
import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Body1,
  Body2,
  Button,
  Caption1,
  Card,
  Combobox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Option,
  Spinner,
  Textarea,
  Title2,
  Title3,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';

import {
  ApiError,
  createCableTypeDefaultMaterial,
  deleteCableTypeDefaultMaterial,
  exportCableTypeDefaultMaterials,
  fetchCableTypeDetails,
  type CableTypeDefaultMaterial,
  type ProjectChangeLogEntry,
  type CableTypeDetails as CableTypeDetailsData,
  updateCableTypeDefaultMaterial,
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

import { useProjectDetailsData } from './ProjectDetails/hooks/useProjectDetailsData';
import { formatNumeric, parseNumberInput, toNullableString } from './ProjectDetails.utils';
import { downloadBlob } from './Materials/Materials.utils';

import { ChangeOrderMaterialDialog } from './ProjectDetails/ChangeOrderMaterialDialog';
import type { ChangeOrderSourceCatalog } from '@/api/client';

const DEFAULT_MATERIAL_CATEGORIES: ChangeOrderSourceCatalog[] = ['cable-installation-material'];

type DefaultMaterialFormState = {
  name: string;
  quantity: string;
  unit: string;
  remarks: string;
};

type DefaultMaterialFormErrors = Partial<Record<keyof DefaultMaterialFormState, string>> & {
  general?: string;
};

const emptyDefaultMaterialForm: DefaultMaterialFormState = {
  name: '',
  quantity: '',
  unit: '',
  remarks: '',
};

const DEFAULT_MATERIAL_UNITS = ['pcs', 'meters', 'pcs/m'] as const;

const normalizeDefaultMaterialUnit = (value: string | null | undefined): string => {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return '';
  }

  if (normalized === 'm' || normalized === 'meter' || normalized === 'meters') {
    return 'meters';
  }

  if (
    normalized === 'pc' ||
    normalized === 'pcs' ||
    normalized === 'piece' ||
    normalized === 'pieces'
  ) {
    return 'pcs';
  }

  if (
    normalized === 'pcs/m' ||
    normalized === 'pc/m' ||
    normalized === 'pcs per meter' ||
    normalized === 'pieces per meter'
  ) {
    return 'pcs/m';
  }

  return normalized;
};

const toDefaultMaterialFormState = (
  material: CableTypeDefaultMaterial,
): DefaultMaterialFormState => ({
  name: material.name,
  quantity: material.quantity !== null ? String(material.quantity) : '',
  unit: normalizeDefaultMaterialUnit(material.unit),
  remarks: material.remarks ?? '',
});

const buildDefaultMaterialInput = (
  values: DefaultMaterialFormState,
): {
  input: {
    name: string;
    quantity: number | null;
    unit: string | null;
    remarks: string | null;
  };
  errors: DefaultMaterialFormErrors;
} => {
  const errors: DefaultMaterialFormErrors = {};
  const name = values.name.trim();

  if (name === '') {
    errors.name = 'Name is required';
  }

  const quantityResult = parseNumberInput(values.quantity);

  if (quantityResult.error) {
    errors.quantity = quantityResult.error;
  }

  const unit = toNullableString(values.unit);

  if (quantityResult.numeric !== null && unit === null) {
    errors.unit = 'Unit is required when quantity is set';
  }

  if (quantityResult.numeric === null && unit !== null) {
    errors.quantity = 'Quantity is required when a unit is selected';
  }

  return {
    input: {
      name,
      quantity: quantityResult.numeric,
      unit,
      remarks: toNullableString(values.remarks),
    },
    errors,
  };
};

const sortDefaultMaterials = (items: CableTypeDefaultMaterial[]): CableTypeDefaultMaterial[] =>
  [...items].sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name, undefined, {
      sensitivity: 'base',
    });

    if (nameCompare !== 0) {
      return nameCompare;
    }

    return a.createdAt.localeCompare(b.createdAt);
  });

const formatOptionalText = (value: string | null | undefined): string => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : '-';
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const useStyles = makeStyles({
  root: {
    display: 'grid',
    minWidth: 0,
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: '1.5rem',
    ...shorthands.padding('2rem', '1.5rem', '4rem'),
  },
  header: {
    display: 'grid',
    gap: '0.75rem',
  },
  headerActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
    alignItems: 'center',
  },
  layout: {
    display: 'grid',
    gap: '1rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
  },
  card: {
    display: 'grid',
    minWidth: 0,
    overflowWrap: 'anywhere',
    gap: '0.75rem',
    alignContent: 'start',
  },
  cardGrid: {
    display: 'grid',
    gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))',
  },
  field: {
    display: 'grid',
    gap: '0.25rem',
  },
  label: {
    color: tokens.colorNeutralForeground3,
  },
  fullWidthCard: {
    display: 'grid',
    minWidth: 0,
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: '1rem',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  sectionActions: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  tableContainer: {
    width: '100%',
    minWidth: 0,
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tableHeadCell: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap',
  },
  tableCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: 'top',
    wordBreak: 'break-word',
  },
  numericCell: {
    textAlign: 'right',
  },
  actionsCell: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
  },
  emptyState: {
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1rem'),
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1,
  },
  readOnlyNotice: {
    color: tokens.colorNeutralForeground3,
  },
  dialogForm: {
    display: 'grid',
    gap: '0.75rem',
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    flexWrap: 'wrap',
  },
});

export const CableTypeDetails = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { projectId, cableTypeId } = useParams<{
    projectId: string;
    cableTypeId: string;
  }>();
  const { user, token } = useAuth();
  const { showToast } = useToast();

  const { project, projectLoading, projectError } = useProjectDetailsData({ projectId });
  const canEdit = canEditProject(user, project, projectId);
  const canExport = Boolean(token && (canReadCatalogs(user) || user?.role === 'technician'));

  const [details, setDetails] = useState<CableTypeDetailsData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const quantityInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (dialogOpen) quantityInputRef.current?.focus({ preventScroll: true });
  }, [dialogOpen]);
  const [catalogDialogOpen, setCatalogDialogOpen] = useState(false);
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [dialogValues, setDialogValues] =
    useState<DefaultMaterialFormState>(emptyDefaultMaterialForm);
  const [dialogErrors, setDialogErrors] = useState<DefaultMaterialFormErrors>({});
  const [dialogSubmitting, setDialogSubmitting] = useState<boolean>(false);
  const [editingDefaultMaterialId, setEditingDefaultMaterialId] = useState<string | null>(null);
  const [pendingDefaultMaterialId, setPendingDefaultMaterialId] = useState<string | null>(null);
  const [isExportingDefaultMaterials, setIsExportingDefaultMaterials] = useState<boolean>(false);

  const detailsRequestId = useRef(0);

  const loadDetails = useCallback(async () => {
    const requestId = ++detailsRequestId.current;
    if (!projectId || !cableTypeId) {
      setError('Cable type identifier is missing.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchCableTypeDetails(projectId, cableTypeId);
      if (requestId !== detailsRequestId.current) return;
      setDetails({
        ...response,
        defaultMaterials: sortDefaultMaterials(response.defaultMaterials),
      });
    } catch (err) {
      if (requestId !== detailsRequestId.current) return;
      console.error('Failed to load cable type details', err);
      if (err instanceof ApiError && err.status === 404) {
        setError('Cable type not found.');
      } else {
        setError('Failed to load cable type details.');
      }
      setDetails(null);
    } finally {
      if (requestId === detailsRequestId.current) setIsLoading(false);
    }
  }, [cableTypeId, projectId]);

  useEffect(() => {
    setDetails(null);
    void loadDetails();
    return () => {
      detailsRequestId.current += 1;
    };
  }, [loadDetails]);

  const handleDialogFieldChange =
    (field: keyof DefaultMaterialFormState) =>
    (_event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, data: { value: string }) => {
      setDialogValues((previous) => ({ ...previous, [field]: data.value }));
      setDialogErrors((previous) => ({ ...previous, [field]: undefined, general: undefined }));
    };

  const handleDefaultMaterialUnitSelect = useCallback(
    (_event: unknown, data: { optionValue?: string }) => {
      setDialogValues((previous) => ({
        ...previous,
        unit: data.optionValue ?? '',
      }));
      setDialogErrors((previous) => ({
        ...previous,
        quantity: undefined,
        unit: undefined,
        general: undefined,
      }));
    },
    [],
  );

  const resetDialog = useCallback(() => {
    setDialogOpen(false);
    setDialogValues(emptyDefaultMaterialForm);
    setDialogErrors({});
    setDialogSubmitting(false);
    setEditingDefaultMaterialId(null);
  }, []);

  const applyDefaultMaterialChange = useCallback(
    (
      changedCableTypeId: string,
      updateMaterials: (materials: CableTypeDefaultMaterial[]) => CableTypeDefaultMaterial[],
      changeLogEntry: ProjectChangeLogEntry | null,
    ) => {
      setDetails((previous) => {
        if (!previous || previous.cableType.id !== changedCableTypeId) return previous;
        const changeLog = previous.cableType.changeLog ?? [];
        return {
          ...previous,
          defaultMaterials: sortDefaultMaterials(updateMaterials(previous.defaultMaterials)),
          cableType: {
            ...previous.cableType,
            changeLog:
              changeLogEntry && !changeLog.some((entry) => entry.id === changeLogEntry.id)
                ? [...changeLog, changeLogEntry]
                : changeLog,
          },
        };
      });
    },
    [],
  );

  const handleAddCatalogMaterial = async (choice: { id: string }) => {
    if (!projectId || !cableTypeId || !token || !canEdit) return;
    setAddingMaterial(true);
    try {
      const response = await createCableTypeDefaultMaterial(token, projectId, cableTypeId, {
        sourceMaterialId: choice.id,
      });
      applyDefaultMaterialChange(
        cableTypeId,
        (materials) => [...materials, response.defaultMaterial],
        response.changeLogEntry,
      );
      setCatalogDialogOpen(false);
      openEditDialog(response.defaultMaterial);
      showToast({ intent: 'success', title: 'Default material added' });
    } catch (err) {
      showToast({
        intent: 'error',
        title: 'Failed to add default material',
        body: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setAddingMaterial(false);
    }
  };

  const openEditDialog = useCallback((material: CableTypeDefaultMaterial) => {
    setDialogValues(toDefaultMaterialFormState(material));
    setDialogErrors({});
    setDialogOpen(true);
    setEditingDefaultMaterialId(material.id);
  }, []);

  const handleDialogSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!projectId || !cableTypeId || !token || !canEdit) {
      setDialogErrors({
        general: 'You need to be signed in as an admin to manage default materials.',
      });
      return;
    }

    const { input, errors } = buildDefaultMaterialInput(dialogValues);

    if (Object.keys(errors).length > 0) {
      setDialogErrors(errors);
      return;
    }

    setDialogSubmitting(true);
    setDialogErrors({});

    try {
      if (editingDefaultMaterialId) {
        const response = await updateCableTypeDefaultMaterial(
          token,
          projectId,
          cableTypeId,
          editingDefaultMaterialId,
          { quantity: input.quantity, unit: input.unit, remarks: input.remarks },
        );

        applyDefaultMaterialChange(
          cableTypeId,
          (materials) =>
            materials.map((item) =>
              item.id === editingDefaultMaterialId ? response.defaultMaterial : item,
            ),
          response.changeLogEntry,
        );
        showToast({ intent: 'success', title: 'Default material updated' });
      }

      resetDialog();
    } catch (err) {
      console.error('Failed to save default material', err);
      if (err instanceof ApiError) {
        if (typeof err.payload === 'string') {
          setDialogErrors({ general: err.payload });
        } else {
          setDialogErrors({
            name: err.payload.fieldErrors?.name?.[0],
            quantity: err.payload.fieldErrors?.quantity?.[0],
            unit: err.payload.fieldErrors?.unit?.[0],
            remarks: err.payload.fieldErrors?.remarks?.[0],
            general: err.payload.formErrors?.[0],
          });
        }
        showToast({
          intent: 'error',
          title: 'Failed to save default material',
          body: err.message,
        });
      } else {
        const message = 'Failed to save default material. Please try again.';
        setDialogErrors({ general: message });
        showToast({
          intent: 'error',
          title: 'Failed to save default material',
          body: message,
        });
      }
    } finally {
      setDialogSubmitting(false);
    }
  };

  const handleDeleteDefaultMaterial = useCallback(
    async (material: CableTypeDefaultMaterial) => {
      if (!projectId || !cableTypeId || !token || !canEdit) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to delete default materials.',
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete default material "${material.name}"? This action cannot be undone.`,
      );

      if (!confirmed) {
        return;
      }

      setPendingDefaultMaterialId(material.id);

      try {
        const response = await deleteCableTypeDefaultMaterial(
          token,
          projectId,
          cableTypeId,
          material.id,
        );
        applyDefaultMaterialChange(
          cableTypeId,
          (materials) => materials.filter((item) => item.id !== material.id),
          response.changeLogEntry,
        );
        showToast({ intent: 'success', title: 'Default material deleted' });
      } catch (err) {
        console.error('Failed to delete default material', err);
        showToast({
          intent: 'error',
          title: 'Failed to delete default material',
          body: err instanceof ApiError ? err.message : undefined,
        });
      } finally {
        setPendingDefaultMaterialId(null);
      }
    },
    [applyDefaultMaterialChange, cableTypeId, canEdit, projectId, showToast, token],
  );

  const handleExportDefaultMaterials = useCallback(async () => {
    if (!details || !projectId || !cableTypeId || !token || !canExport) {
      showToast({
        intent: 'error',
        title: 'Export access required',
        body: 'You need to be signed in with export access to export default materials.',
      });
      return;
    }

    setIsExportingDefaultMaterials(true);

    try {
      const blob = await exportCableTypeDefaultMaterials(token, projectId, cableTypeId);

      downloadBlob(blob, 'CablesAdditionalDefaultMaterials.xlsx');

      showToast({ intent: 'success', title: 'Default materials exported' });
    } catch (err) {
      console.error('Failed to export default materials', err);

      if (err instanceof ApiError && err.status === 404) {
        showToast({
          intent: 'error',
          title: 'Export endpoint unavailable',
          body: 'Please restart the API server after updating it.',
        });
      } else {
        showToast({
          intent: 'error',
          title: 'Failed to export default materials',
          body: err instanceof ApiError ? err.message : undefined,
        });
      }
    } finally {
      setIsExportingDefaultMaterials(false);
    }
  }, [cableTypeId, details, canExport, projectId, showToast, token]);

  const pageTitle = details ? `Cable type - ${details.cableType.name}` : 'Cable type details';

  const updatedAt = useMemo(() => {
    if (!details) {
      return null;
    }

    return `Last updated ${dateFormatter.format(new Date(details.cableType.updatedAt))}`;
  }, [details]);

  const sourceMaterialDetails = details?.materialCableType;

  if (projectLoading || isLoading) {
    return (
      <section className={styles.root} aria-labelledby="cable-type-details-heading">
        <Spinner label="Loading cable type..." />
      </section>
    );
  }

  if (projectError || error || !details || !projectId) {
    return (
      <section className={styles.root} aria-labelledby="cable-type-details-heading">
        <div className={styles.header}>
          <Title2 id="cable-type-details-heading">Cable type details</Title2>
          <Body1 className={styles.errorText}>
            {projectError ?? error ?? 'Cable type not available.'}
          </Body1>
          <div className={styles.headerActions}>
            <Button
              appearance="primary"
              onClick={() => navigate(projectId ? `/projects/${projectId}?tab=cables` : '/')}
            >
              Back to project
            </Button>
            <Button onClick={() => void loadDetails()}>Retry</Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="cable-type-details-heading">
      <div className={styles.header}>
        <div className={styles.headerActions}>
          <Button
            appearance="secondary"
            onClick={() => navigate(`/projects/${projectId}?tab=cables`)}
          >
            Back to project
          </Button>
          <Button onClick={() => void loadDetails()}>Refresh</Button>
        </div>
        <Title2 id="cable-type-details-heading">{pageTitle}</Title2>
        {project ? (
          <Body1>
            Project: {project.projectNumber} - {project.name}
          </Body1>
        ) : null}
        {updatedAt ? <Caption1>{updatedAt}</Caption1> : null}
      </div>

      <div className={styles.layout}>
        <Card appearance="outline" className={styles.card}>
          <Title3>Project cable type</Title3>
          <Caption1 className={styles.readOnlyNotice}>
            Used by {details.cableCount} {details.cableCount === 1 ? 'cable' : 'cables'} in this
            project.
          </Caption1>
          <div className={styles.cardGrid}>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Type</Caption1>
              <Body1>{details.cableType.name}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Purpose</Caption1>
              <Body1>{formatOptionalText(details.cableType.purpose)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Diameter [mm]</Caption1>
              <Body1>{formatNumeric(details.cableType.diameterMm)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Weight [kg/m]</Caption1>
              <Body1>{formatNumeric(details.cableType.weightKgPerM)}</Body1>
            </div>
          </div>
          <Body2 className={styles.readOnlyNotice}>
            Project cable type values are sourced from Materials.
          </Body2>
        </Card>

        <Card appearance="outline" className={styles.card}>
          <Title3>Materials source</Title3>
          {sourceMaterialDetails ? (
            <div className={styles.cardGrid}>
              <div className={styles.field}>
                <Caption1 className={styles.label}>Material</Caption1>
                <Body1>{formatOptionalText(sourceMaterialDetails.material)}</Body1>
              </div>
              <div className={styles.field}>
                <Caption1 className={styles.label}>Manufacturer</Caption1>
                <Body1>{formatOptionalText(sourceMaterialDetails.manufacturer)}</Body1>
              </div>
              <div className={styles.field}>
                <Caption1 className={styles.label}>Part No.</Caption1>
                <Body1>{formatOptionalText(sourceMaterialDetails.partNo)}</Body1>
              </div>
              <div className={styles.field}>
                <Caption1 className={styles.label}>Description</Caption1>
                <Body1>{formatOptionalText(sourceMaterialDetails.description)}</Body1>
              </div>
              <div className={styles.field}>
                <Caption1 className={styles.label}>Remarks</Caption1>
                <Body1>{formatOptionalText(sourceMaterialDetails.remarks)}</Body1>
              </div>
            </div>
          ) : (
            <Body1 className={styles.readOnlyNotice}>
              The source material cable type is no longer available in Materials.
            </Body1>
          )}
        </Card>
      </div>

      <Card appearance="outline" className={styles.fullWidthCard}>
        <div className={styles.sectionHeader}>
          <div>
            <Title3>Additional default materials</Title3>
            <Caption1 className={styles.readOnlyNotice}>
              Select existing Cable installation materials from the catalog, then edit their
              quantity, unit and remarks for this cable type.
            </Caption1>
          </div>
          <div className={styles.sectionActions}>
            {canExport ? (
              <Button
                appearance="secondary"
                onClick={() => void handleExportDefaultMaterials()}
                disabled={isExportingDefaultMaterials}
              >
                {isExportingDefaultMaterials ? 'Exporting...' : 'Export to Excel'}
              </Button>
            ) : null}
            {canEdit ? (
              <Button appearance="primary" onClick={() => setCatalogDialogOpen(true)}>
                Add default material
              </Button>
            ) : null}
          </div>
        </div>

        {details.defaultMaterials.length === 0 ? (
          <div className={styles.emptyState}>
            <Body1>
              {canEdit
                ? 'No default materials added yet. Use the button above to create the first one.'
                : 'No default materials have been added for this cable type.'}
            </Body1>
          </div>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.tableHeadCell}>Material</th>
                  <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                    Quantity
                  </th>
                  <th className={styles.tableHeadCell}>Unit</th>
                  <th className={styles.tableHeadCell}>Remarks</th>
                  <th className={styles.tableHeadCell}>Source</th>
                  {canEdit ? <th className={styles.tableHeadCell}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {details.defaultMaterials.map((material) => {
                  const isBusy = pendingDefaultMaterialId === material.id;

                  return (
                    <tr key={material.id}>
                      <td className={styles.tableCell}>{material.name}</td>
                      <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                        {formatNumeric(material.quantity)}
                      </td>
                      <td className={styles.tableCell}>
                        {formatOptionalText(normalizeDefaultMaterialUnit(material.unit))}
                      </td>
                      <td className={styles.tableCell}>{formatOptionalText(material.remarks)}</td>
                      <td className={styles.tableCell}>
                        {material.sourceKind === 'standard-material'
                          ? 'Inherited from Materials'
                          : 'Project default'}
                      </td>
                      {canEdit ? (
                        <td className={styles.tableCell}>
                          <div className={styles.actionsCell}>
                            <Button
                              size="small"
                              onClick={() => openEditDialog(material)}
                              disabled={isBusy}
                            >
                              Edit
                            </Button>
                            <Button
                              size="small"
                              appearance="secondary"
                              onClick={() => void handleDeleteDefaultMaterial(material)}
                              disabled={isBusy}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Accordion collapsible defaultOpenItems={[]} key={details.cableType.id}>
        <AccordionItem value="change-tracker" className={styles.fullWidthCard}>
          <AccordionHeader>Change tracker</AccordionHeader>
          <AccordionPanel>
            <ChangeLogTable
              entries={details.cableType.changeLog}
              label="Change tracker"
              fileName={`cable-type-${details.cableType.name}-change-log`}
              canExport={canExportChangeLogs(user, token)}
            />
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

      <ChangeOrderMaterialDialog
        open={catalogDialogOpen}
        adding={addingMaterial}
        documentName="cable type default materials"
        categories={DEFAULT_MATERIAL_CATEGORIES}
        doubleWidth
        onDismiss={() => !addingMaterial && setCatalogDialogOpen(false)}
        onSelect={handleAddCatalogMaterial}
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(_, data) => {
          if (!data.open) {
            resetDialog();
          }
        }}
      >
        <DialogSurface style={{ width: '1200px', maxWidth: 'calc(100vw - 32px)' }}>
          <form className={styles.dialogForm} onSubmit={(event) => void handleDialogSubmit(event)}>
            <DialogBody>
              <DialogTitle>Edit default material</DialogTitle>
              <DialogContent>
                <Field
                  label="Material"
                  validationState={dialogErrors.name ? 'error' : undefined}
                  validationMessage={dialogErrors.name}
                >
                  <Input value={dialogValues.name} readOnly />
                </Field>
                <Field
                  label="Quantity"
                  validationState={dialogErrors.quantity ? 'error' : undefined}
                  validationMessage={dialogErrors.quantity}
                >
                  <Input
                    ref={quantityInputRef}
                    value={dialogValues.quantity}
                    onChange={handleDialogFieldChange('quantity')}
                    inputMode="decimal"
                  />
                </Field>
                <Field
                  label="Unit"
                  validationState={dialogErrors.unit ? 'error' : undefined}
                  validationMessage={dialogErrors.unit}
                >
                  <Combobox
                    placeholder="Select unit"
                    selectedOptions={dialogValues.unit ? [dialogValues.unit] : []}
                    value={dialogValues.unit}
                    onOptionSelect={handleDefaultMaterialUnitSelect}
                    freeform={false}
                  >
                    {DEFAULT_MATERIAL_UNITS.map((unitOption) => (
                      <Option key={unitOption} value={unitOption}>
                        {unitOption}
                      </Option>
                    ))}
                  </Combobox>
                </Field>
                <Field
                  label="Remarks"
                  validationState={dialogErrors.remarks ? 'error' : undefined}
                  validationMessage={dialogErrors.remarks}
                >
                  <Textarea
                    value={dialogValues.remarks}
                    onChange={handleDialogFieldChange('remarks')}
                    rows={4}
                  />
                </Field>
                {dialogErrors.general ? (
                  <Body1 className={styles.errorText}>{dialogErrors.general}</Body1>
                ) : null}
              </DialogContent>
              <DialogActions className={styles.dialogActions}>
                <Button type="button" onClick={resetDialog} disabled={dialogSubmitting}>
                  Cancel
                </Button>
                <Button type="submit" appearance="primary" disabled={dialogSubmitting}>
                  {dialogSubmitting ? 'Saving...' : 'Save changes'}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </section>
  );
};
