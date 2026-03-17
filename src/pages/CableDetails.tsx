import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Body1,
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
  tokens
} from '@fluentui/react-components';

import {
  ApiError,
  createCableMaterial,
  deleteCableMaterial,
  fetchCableDetails,
  fetchMaterialCableInstallationMaterials,
  type CableDetails as CableDetailsData,
  type CableMaterial,
  type MaterialCableInstallationMaterial,
  updateCableMaterial
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

import { useProjectDetailsData } from './ProjectDetails/hooks/useProjectDetailsData';
import {
  formatNumeric,
  parseNumberInput,
  toNullableString
} from './ProjectDetails.utils';

type CableMaterialDialogMode = 'create' | 'edit';

type CableMaterialFormState = {
  name: string;
  quantity: string;
  unit: string;
  remarks: string;
};

type CableMaterialFormErrors = Partial<Record<keyof CableMaterialFormState, string>> & {
  general?: string;
};

const emptyCableMaterialForm: CableMaterialFormState = {
  name: '',
  quantity: '',
  unit: '',
  remarks: ''
};

const MATERIAL_UNITS = ['pcs', 'meters', 'pcs/m'] as const;

const normalizeMaterialUnit = (value: string | null | undefined): string => {
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

const toCableMaterialFormState = (
  material: Pick<CableMaterial, 'name' | 'quantity' | 'unit' | 'remarks'>
): CableMaterialFormState => ({
  name: material.name,
  quantity: material.quantity !== null ? String(material.quantity) : '',
  unit: normalizeMaterialUnit(material.unit),
  remarks: material.remarks ?? ''
});

const buildCableMaterialInput = (
  values: CableMaterialFormState
): {
  input: {
    name: string;
    quantity: number | null;
    unit: string | null;
    remarks: string | null;
  };
  errors: CableMaterialFormErrors;
} => {
  const errors: CableMaterialFormErrors = {};
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
      remarks: toNullableString(values.remarks)
    },
    errors
  };
};

const sortMaterials = <T extends { name: string; createdAt: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name, undefined, {
      sensitivity: 'base'
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

const formatOptionalDate = (value: string | null | undefined): string =>
  value ? value : '-';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

const useStyles = makeStyles({
  root: {
    display: 'grid',
    gap: '1.5rem',
    ...shorthands.padding('2rem', '1.5rem', '4rem')
  },
  header: {
    display: 'grid',
    gap: '0.75rem'
  },
  headerActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
    alignItems: 'center'
  },
  layout: {
    display: 'grid',
    gap: '1rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))'
  },
  card: {
    display: 'grid',
    gap: '0.75rem',
    alignContent: 'start'
  },
  cardGrid: {
    display: 'grid',
    gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))'
  },
  field: {
    display: 'grid',
    gap: '0.25rem'
  },
  label: {
    color: tokens.colorNeutralForeground3
  },
  fullWidthCard: {
    display: 'grid',
    gap: '1rem'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap'
  },
  sectionActions: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap'
  },
  tableContainer: {
    width: '100%',
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeadCell: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap'
  },
  tableCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: 'top',
    wordBreak: 'break-word'
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
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1rem')
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  },
  readOnlyNotice: {
    color: tokens.colorNeutralForeground3
  },
  dialogForm: {
    display: 'grid',
    gap: '0.75rem'
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    flexWrap: 'wrap'
  }
});

export const CableDetails = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { projectId, cableId } = useParams<{
    projectId: string;
    cableId: string;
  }>();
  const { token } = useAuth();
  const { showToast } = useToast();

  const canManageMaterials = Boolean(token);
  const { project, projectLoading, projectError } = useProjectDetailsData({ projectId });

  const [details, setDetails] = useState<CableDetailsData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [availableMaterials, setAvailableMaterials] = useState<
    MaterialCableInstallationMaterial[]
  >([]);
  const [availableMaterialsLoading, setAvailableMaterialsLoading] = useState<boolean>(true);
  const [availableMaterialsError, setAvailableMaterialsError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [dialogMode, setDialogMode] = useState<CableMaterialDialogMode>('create');
  const [dialogValues, setDialogValues] =
    useState<CableMaterialFormState>(emptyCableMaterialForm);
  const [dialogErrors, setDialogErrors] = useState<CableMaterialFormErrors>({});
  const [dialogSubmitting, setDialogSubmitting] = useState<boolean>(false);
  const [editingCableMaterialId, setEditingCableMaterialId] = useState<string | null>(null);
  const [pendingCableMaterialId, setPendingCableMaterialId] = useState<string | null>(null);

  const loadDetails = useCallback(async () => {
    if (!projectId || !cableId) {
      setError('Cable identifier is missing.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchCableDetails(projectId, cableId);
      setDetails({
        ...response,
        cableMaterials: sortMaterials(response.cableMaterials)
      });
    } catch (err) {
      console.error('Failed to load cable details', err);
      if (err instanceof ApiError && err.status === 404) {
        setError('Cable not found.');
      } else {
        setError('Failed to load cable details.');
      }
      setDetails(null);
    } finally {
      setIsLoading(false);
    }
  }, [cableId, projectId]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    let active = true;

    const loadAvailableMaterials = async () => {
      setAvailableMaterialsLoading(true);
      setAvailableMaterialsError(null);

      try {
        const response = await fetchMaterialCableInstallationMaterials();

        if (!active) {
          return;
        }

        setAvailableMaterials(response.cableInstallationMaterials);
      } catch (err) {
        console.error('Failed to load cable installation materials for cable materials', err);

        if (!active) {
          return;
        }

        setAvailableMaterials([]);
        setAvailableMaterialsError(
          err instanceof ApiError ? err.message : 'Failed to load cable installation materials.'
        );
      } finally {
        if (active) {
          setAvailableMaterialsLoading(false);
        }
      }
    };

    void loadAvailableMaterials();

    return () => {
      active = false;
    };
  }, []);

  const handleDialogFieldChange =
    (field: keyof CableMaterialFormState) =>
    (_event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, data: { value: string }) => {
      setDialogValues((previous) => ({ ...previous, [field]: data.value }));
      setDialogErrors((previous) => ({ ...previous, [field]: undefined, general: undefined }));
    };

  const handleMaterialNameSelect = useCallback(
    (_event: unknown, data: { optionValue?: string }) => {
      setDialogValues((previous) => ({
        ...previous,
        name: data.optionValue ?? ''
      }));
      setDialogErrors((previous) => ({ ...previous, name: undefined, general: undefined }));
    },
    []
  );

  const handleMaterialUnitSelect = useCallback(
    (_event: unknown, data: { optionValue?: string }) => {
      setDialogValues((previous) => ({
        ...previous,
        unit: data.optionValue ?? ''
      }));
      setDialogErrors((previous) => ({
        ...previous,
        quantity: undefined,
        unit: undefined,
        general: undefined
      }));
    },
    []
  );

  const resetDialog = useCallback(() => {
    setDialogOpen(false);
    setDialogMode('create');
    setDialogValues(emptyCableMaterialForm);
    setDialogErrors({});
    setDialogSubmitting(false);
    setEditingCableMaterialId(null);
  }, []);

  const openCreateDialog = useCallback(() => {
    if (!availableMaterialsLoading && availableMaterials.length === 0) {
      showToast({
        intent: 'error',
        title: 'No cable installation materials available',
        body:
          availableMaterialsError ??
          'Add cable installation materials in Materials before assigning them here.'
      });
      return;
    }

    setDialogMode('create');
    setDialogValues(emptyCableMaterialForm);
    setDialogErrors({});
    setDialogOpen(true);
    setEditingCableMaterialId(null);
  }, [
    availableMaterials.length,
    availableMaterialsError,
    availableMaterialsLoading,
    showToast
  ]);

  const openEditDialog = useCallback((material: CableMaterial) => {
    setDialogMode('edit');
    setDialogValues(toCableMaterialFormState(material));
    setDialogErrors({});
    setDialogOpen(true);
    setEditingCableMaterialId(material.id);
  }, []);

  const handleDialogSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!projectId || !cableId || !token) {
      setDialogErrors({
        general: 'You need to be signed in to manage cable materials.'
      });
      return;
    }

    const { input, errors } = buildCableMaterialInput(dialogValues);

    if (Object.keys(errors).length > 0) {
      setDialogErrors(errors);
      return;
    }

    setDialogSubmitting(true);
    setDialogErrors({});

    try {
      if (dialogMode === 'create') {
        const response = await createCableMaterial(token, projectId, cableId, input);

        setDetails((previous) =>
          previous
            ? {
                ...previous,
                cableMaterials: sortMaterials([
                  ...previous.cableMaterials,
                  response.cableMaterial
                ])
              }
            : previous
        );
        showToast({ intent: 'success', title: 'Cable material added' });
      } else if (editingCableMaterialId) {
        const response = await updateCableMaterial(
          token,
          projectId,
          cableId,
          editingCableMaterialId,
          input
        );

        setDetails((previous) =>
          previous
            ? {
                ...previous,
                cableMaterials: sortMaterials(
                  previous.cableMaterials.map((item) =>
                    item.id === editingCableMaterialId ? response.cableMaterial : item
                  )
                )
              }
            : previous
        );
        showToast({ intent: 'success', title: 'Cable material updated' });
      }

      resetDialog();
    } catch (err) {
      console.error('Failed to save cable material', err);
      if (err instanceof ApiError) {
        if (typeof err.payload === 'string') {
          setDialogErrors({ general: err.payload });
        } else {
          setDialogErrors({
            name: err.payload.fieldErrors?.name?.[0],
            quantity: err.payload.fieldErrors?.quantity?.[0],
            unit: err.payload.fieldErrors?.unit?.[0],
            remarks: err.payload.fieldErrors?.remarks?.[0],
            general: err.payload.formErrors?.[0]
          });
        }
        showToast({
          intent: 'error',
          title: 'Failed to save cable material',
          body: err.message
        });
      } else {
        const message = 'Failed to save cable material. Please try again.';
        setDialogErrors({ general: message });
        showToast({
          intent: 'error',
          title: 'Failed to save cable material',
          body: message
        });
      }
    } finally {
      setDialogSubmitting(false);
    }
  };

  const handleDeleteCableMaterial = useCallback(
    async (material: CableMaterial) => {
      if (!projectId || !cableId || !token) {
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: 'You need to be signed in to delete cable materials.'
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete cable material "${material.name}"? This action cannot be undone.`
      );

      if (!confirmed) {
        return;
      }

      setPendingCableMaterialId(material.id);

      try {
        await deleteCableMaterial(token, projectId, cableId, material.id);
        setDetails((previous) =>
          previous
            ? {
                ...previous,
                cableMaterials: previous.cableMaterials.filter((item) => item.id !== material.id)
              }
            : previous
        );
        showToast({ intent: 'success', title: 'Cable material deleted' });
      } catch (err) {
        console.error('Failed to delete cable material', err);
        showToast({
          intent: 'error',
          title: 'Failed to delete cable material',
          body: err instanceof ApiError ? err.message : undefined
        });
      } finally {
        setPendingCableMaterialId(null);
      }
    },
    [cableId, projectId, showToast, token]
  );

  const pageTitle = details
    ? `Cable ${details.cable.cableId}${details.cable.tag ? ` - ${details.cable.tag}` : ''}`
    : 'Cable details';

  const updatedAt = useMemo(() => {
    if (!details) {
      return null;
    }

    return `Last updated ${dateFormatter.format(new Date(details.cable.updatedAt))}`;
  }, [details]);

  const availableMaterialNames = useMemo(
    () => availableMaterials.map((material) => material.type),
    [availableMaterials]
  );

  const resolvedMaterialNames = useMemo(() => {
    if (!dialogValues.name) {
      return availableMaterialNames;
    }

    return availableMaterialNames.includes(dialogValues.name)
      ? availableMaterialNames
      : [dialogValues.name, ...availableMaterialNames];
  }, [availableMaterialNames, dialogValues.name]);

  const sourceMaterialDetails = details?.materialCableType;

  if (projectLoading || isLoading) {
    return (
      <section className={styles.root} aria-labelledby="cable-details-heading">
        <Spinner label="Loading cable..." />
      </section>
    );
  }

  if (projectError || error || !details || !projectId) {
    return (
      <section className={styles.root} aria-labelledby="cable-details-heading">
        <div className={styles.header}>
          <Title2 id="cable-details-heading">Cable details</Title2>
          <Body1 className={styles.errorText}>
            {projectError ?? error ?? 'Cable not available.'}
          </Body1>
          <div className={styles.headerActions}>
            <Button
              appearance="primary"
              onClick={() => navigate(projectId ? `/projects/${projectId}?tab=cable-list` : '/')}
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
    <section className={styles.root} aria-labelledby="cable-details-heading">
      <div className={styles.header}>
        <div className={styles.headerActions}>
          <Button
            appearance="secondary"
            onClick={() => navigate(`/projects/${projectId}?tab=cable-list`)}
          >
            Back to project
          </Button>
          <Button
            appearance="secondary"
            onClick={() => navigate(`/projects/${projectId}/cable-types/${details.cable.cableTypeId}`)}
          >
            Open cable type
          </Button>
          <Button onClick={() => void loadDetails()}>Refresh</Button>
        </div>
        <Title2 id="cable-details-heading">{pageTitle}</Title2>
        {project ? (
          <Body1>
            Project: {project.projectNumber} - {project.name}
          </Body1>
        ) : null}
        {updatedAt ? <Caption1>{updatedAt}</Caption1> : null}
      </div>

      <div className={styles.layout}>
        <Card appearance="outline" className={styles.card}>
          <Title3>Cable</Title3>
          <div className={styles.cardGrid}>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Cable ID</Caption1>
              <Body1>{details.cable.cableId}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Tag</Caption1>
              <Body1>{formatOptionalText(details.cable.tag)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Type</Caption1>
              <Body1>{details.cable.typeName}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Purpose</Caption1>
              <Body1>{formatOptionalText(details.cable.purpose)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Diameter [mm]</Caption1>
              <Body1>{formatNumeric(details.cable.diameterMm)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Weight [kg/m]</Caption1>
              <Body1>{formatNumeric(details.cable.weightKgPerM)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>From location</Caption1>
              <Body1>{formatOptionalText(details.cable.fromLocation)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>To location</Caption1>
              <Body1>{formatOptionalText(details.cable.toLocation)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Routing</Caption1>
              <Body1>{formatOptionalText(details.cable.routing)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Design length [m]</Caption1>
              <Body1>{formatNumeric(details.cable.designLength)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Install length [m]</Caption1>
              <Body1>{formatNumeric(details.cable.installLength)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Pull date</Caption1>
              <Body1>{formatOptionalDate(details.cable.pullDate)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Connected from</Caption1>
              <Body1>{formatOptionalDate(details.cable.connectedFrom)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Connected to</Caption1>
              <Body1>{formatOptionalDate(details.cable.connectedTo)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>Tested</Caption1>
              <Body1>{formatOptionalDate(details.cable.tested)}</Body1>
            </div>
          </div>
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
            <Title3>Cable materials</Title3>
            <Caption1 className={styles.readOnlyNotice}>
              This table is initialized from the cable type defaults when the cable is created or
              when its type changes. You can add, edit, or remove materials here without changing
              the cable type.
            </Caption1>
          </div>
          <div className={styles.sectionActions}>
            {canManageMaterials ? (
              <Button
                appearance="primary"
                onClick={openCreateDialog}
                disabled={availableMaterialsLoading}
              >
                Add cable material
              </Button>
            ) : null}
          </div>
        </div>

        {details.cableMaterials.length === 0 ? (
          <div className={styles.emptyState}>
            <Body1>
              {canManageMaterials
                ? 'No cable materials added yet. Use the button above to create the first one.'
                : 'No cable materials have been added for this cable.'}
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
                  {canManageMaterials ? <th className={styles.tableHeadCell}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {details.cableMaterials.map((material) => {
                  const isBusy = pendingCableMaterialId === material.id;

                  return (
                    <tr key={material.id}>
                      <td className={styles.tableCell}>{material.name}</td>
                      <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                        {formatNumeric(material.quantity)}
                      </td>
                      <td className={styles.tableCell}>
                        {formatOptionalText(normalizeMaterialUnit(material.unit))}
                      </td>
                      <td className={styles.tableCell}>{formatOptionalText(material.remarks)}</td>
                      {canManageMaterials ? (
                        <td className={mergeClasses(styles.tableCell, styles.actionsCell)}>
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
                            onClick={() => void handleDeleteCableMaterial(material)}
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
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(_, data) => {
          if (!data.open) {
            resetDialog();
          }
        }}
      >
        <DialogSurface>
          <form className={styles.dialogForm} onSubmit={(event) => void handleDialogSubmit(event)}>
            <DialogBody>
              <DialogTitle>
                {dialogMode === 'create' ? 'Add cable material' : 'Edit cable material'}
              </DialogTitle>
              <DialogContent>
                <Field
                  label="Material"
                  required
                  validationState={dialogErrors.name ? 'error' : undefined}
                  validationMessage={dialogErrors.name}
                >
                  <Combobox
                    placeholder={
                      resolvedMaterialNames.length > 0
                        ? 'Select cable installation material'
                        : 'No cable installation materials available'
                    }
                    selectedOptions={dialogValues.name ? [dialogValues.name] : []}
                    value={dialogValues.name || undefined}
                    onOptionSelect={handleMaterialNameSelect}
                    freeform={false}
                    disabled={resolvedMaterialNames.length === 0}
                  >
                    {resolvedMaterialNames.map((materialName) => (
                      <Option key={materialName} value={materialName}>
                        {materialName}
                      </Option>
                    ))}
                  </Combobox>
                </Field>
                <Field
                  label="Quantity"
                  validationState={dialogErrors.quantity ? 'error' : undefined}
                  validationMessage={dialogErrors.quantity}
                >
                  <Input
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
                    value={dialogValues.unit || undefined}
                    onOptionSelect={handleMaterialUnitSelect}
                    freeform={false}
                  >
                    {MATERIAL_UNITS.map((unitOption) => (
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
                  {dialogSubmitting
                    ? 'Saving...'
                    : dialogMode === 'create'
                      ? 'Add material'
                      : 'Save changes'}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </section>
  );
};
