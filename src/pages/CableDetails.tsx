import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
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
  tokens,
} from '@fluentui/react-components';

import {
  ApiError,
  createCableMaterial,
  deleteCableMaterial,
  fetchCables,
  fetchCableDetails,
  fetchCableVersions,
  fetchMaterialCableInstallationMaterials,
  syncCableBaseMaterials,
  type Cable,
  type CableDetails as CableDetailsData,
  type CableMaterial,
  type CableVersion,
  type CableTypeDefaultMaterial,
  type MaterialCableInstallationMaterial,
  updateCableMaterial,
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

import { useProjectDetailsData } from './ProjectDetails/hooks/useProjectDetailsData';
import {
  diffCableVersions,
  formatCableVersionTimestamp,
  formatCableVersionUser,
} from './ProjectDetails/cableVersionUtils';
import { formatNumeric, parseNumberInput, toNullableString } from './ProjectDetails.utils';

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

type MaterialComparable = {
  name: string;
  quantity: number | null;
  unit: string | null;
  remarks: string | null;
};

const emptyCableMaterialForm: CableMaterialFormState = {
  name: '',
  quantity: '',
  unit: '',
  remarks: '',
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
  material: Pick<CableMaterial, 'name' | 'quantity' | 'unit' | 'remarks'>,
): CableMaterialFormState => ({
  name: material.name,
  quantity: material.quantity !== null ? String(material.quantity) : '',
  unit: normalizeMaterialUnit(material.unit),
  remarks: material.remarks ?? '',
});

const buildCableMaterialInput = (
  values: CableMaterialFormState,
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
      remarks: toNullableString(values.remarks),
    },
    errors,
  };
};

const sortMaterials = <T extends { name: string; createdAt: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name, undefined, {
      sensitivity: 'base',
    });

    if (nameCompare !== 0) {
      return nameCompare;
    }

    return a.createdAt.localeCompare(b.createdAt);
  });

const normalizeComparableMaterialText = (value: string | null | undefined): string =>
  value?.trim().replace(/\s+/g, ' ').toLowerCase() ?? '';

const buildCableMaterialComparisonKey = (material: MaterialComparable): string =>
  [
    normalizeComparableMaterialText(material.name),
    material.quantity === null ? '' : String(material.quantity),
    normalizeComparableMaterialText(material.unit),
    normalizeComparableMaterialText(material.remarks),
  ].join('||');

const formatCableMaterialSource = (source: 'default' | 'manual'): string =>
  source === 'default' ? 'Default' : 'Manual';

const formatCableMaterialSyncSummary = (summary: {
  added: number;
  updated: number;
  removed: number;
}): string | undefined => {
  const parts: string[] = [];

  if (summary.added > 0) {
    parts.push(`${summary.added} added`);
  }

  if (summary.updated > 0) {
    parts.push(`${summary.updated} updated`);
  }

  if (summary.removed > 0) {
    parts.push(`${summary.removed} removed`);
  }

  return parts.length > 0 ? parts.join(', ') : undefined;
};

const formatOptionalText = (value: string | null | undefined): string => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : '-';
};

const formatCableVersionOption = (version: CableVersion): string => {
  const revisionPart = version.revision?.trim() ? ` - ${version.revision.trim()}` : '';
  return `v${version.versionNumber}${revisionPart} (${formatCableVersionTimestamp(
    version.changedAt,
  )})`;
};

const formatCableVersionChange = (version: CableVersion): string =>
  `${version.changeType === 'create' ? 'Created' : 'Updated'} via ${
    version.changeSource === 'import' ? 'import' : 'manual save'
  }`;

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
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  },
  card: {
    display: 'grid',
    gap: '0.75rem',
    alignContent: 'start',
  },
  cardGrid: {
    display: 'grid',
    gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
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
    gap: '1rem',
  },
  accordionPanelContent: {
    display: 'grid',
    gap: '1rem',
    ...shorthands.padding('0.25rem', 0, 0),
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
  compareControls: {
    display: 'grid',
    gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
  },
  compareSummary: {
    display: 'grid',
    gap: '0.75rem',
  },
  tableContainer: {
    width: '100%',
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
  const [cableVersions, setCableVersions] = useState<CableVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState<boolean>(true);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [comparedVersionId, setComparedVersionId] = useState<string | null>(null);
  const [projectCables, setProjectCables] = useState<Cable[]>([]);
  const [availableMaterials, setAvailableMaterials] = useState<MaterialCableInstallationMaterial[]>(
    [],
  );
  const [availableMaterialsLoading, setAvailableMaterialsLoading] = useState<boolean>(true);
  const [availableMaterialsError, setAvailableMaterialsError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [dialogMode, setDialogMode] = useState<CableMaterialDialogMode>('create');
  const [dialogValues, setDialogValues] = useState<CableMaterialFormState>(emptyCableMaterialForm);
  const [dialogErrors, setDialogErrors] = useState<CableMaterialFormErrors>({});
  const [dialogSubmitting, setDialogSubmitting] = useState<boolean>(false);
  const [editingCableMaterialId, setEditingCableMaterialId] = useState<string | null>(null);
  const [pendingCableMaterialId, setPendingCableMaterialId] = useState<string | null>(null);
  const [syncingBaseMaterials, setSyncingBaseMaterials] = useState<boolean>(false);

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
        cableMaterials: sortMaterials(response.cableMaterials),
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

  const loadVersions = useCallback(async () => {
    if (!projectId || !cableId) {
      setVersionsError('Cable identifier is missing.');
      setVersionsLoading(false);
      return;
    }

    setVersionsLoading(true);
    setVersionsError(null);

    try {
      const response = await fetchCableVersions(projectId, cableId);
      setCableVersions(response.versions);
    } catch (err) {
      console.error('Failed to load cable revisions', err);
      if (err instanceof ApiError && err.status === 404) {
        setVersionsError('Cable revisions are not available.');
      } else {
        setVersionsError('Failed to load cable revisions.');
      }
      setCableVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }, [cableId, projectId]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    if (!projectId) {
      setProjectCables([]);
      return;
    }

    let active = true;

    const loadProjectCables = async () => {
      try {
        const response = await fetchCables(projectId);

        if (!active) {
          return;
        }

        setProjectCables([...response.cables].sort((a, b) => a.cableId - b.cableId));
      } catch (err) {
        console.error('Failed to load cable navigation list', err);

        if (!active) {
          return;
        }

        setProjectCables([]);
      }
    };

    void loadProjectCables();

    return () => {
      active = false;
    };
  }, [projectId]);

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
          err instanceof ApiError ? err.message : 'Failed to load cable installation materials.',
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

  useEffect(() => {
    if (cableVersions.length === 0) {
      setSelectedVersionId(null);
      setComparedVersionId(null);
      return;
    }

    setSelectedVersionId((previous) =>
      previous && cableVersions.some((version) => version.id === previous)
        ? previous
        : cableVersions[0].id,
    );
  }, [cableVersions]);

  useEffect(() => {
    if (cableVersions.length === 0) {
      setComparedVersionId(null);
      return;
    }

    const selectedId = selectedVersionId ?? cableVersions[0]?.id ?? null;

    setComparedVersionId((previous) => {
      if (
        previous &&
        previous !== selectedId &&
        cableVersions.some((version) => version.id === previous)
      ) {
        return previous;
      }

      return cableVersions.find((version) => version.id !== selectedId)?.id ?? null;
    });
  }, [cableVersions, selectedVersionId]);

  const selectedVersion = useMemo(
    () =>
      selectedVersionId
        ? cableVersions.find((version) => version.id === selectedVersionId) ?? null
        : null,
    [cableVersions, selectedVersionId],
  );

  const comparedVersion = useMemo(
    () =>
      comparedVersionId && comparedVersionId !== selectedVersionId
        ? cableVersions.find((version) => version.id === comparedVersionId) ?? null
        : null,
    [cableVersions, comparedVersionId, selectedVersionId],
  );

  const comparedVersionDiffs = useMemo(
    () => (selectedVersion ? diffCableVersions(selectedVersion, comparedVersion) : []),
    [comparedVersion, selectedVersion],
  );

  const handleSelectedVersionChange = useCallback(
    (_event: unknown, data: { optionValue?: string }) => {
      const nextVersionId = data.optionValue ?? null;
      setSelectedVersionId(nextVersionId);

      if (!nextVersionId || comparedVersionId !== nextVersionId) {
        return;
      }

      const fallbackVersionId =
        cableVersions.find((version) => version.id !== nextVersionId)?.id ?? null;
      setComparedVersionId(fallbackVersionId);
    },
    [cableVersions, comparedVersionId],
  );

  const handleComparedVersionChange = useCallback(
    (_event: unknown, data: { optionValue?: string }) => {
      const nextVersionId = data.optionValue ?? null;
      setComparedVersionId(nextVersionId);
    },
    [],
  );

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
        name: data.optionValue ?? '',
      }));
      setDialogErrors((previous) => ({ ...previous, name: undefined, general: undefined }));
    },
    [],
  );

  const handleMaterialUnitSelect = useCallback(
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
          'Add cable installation materials in Materials before assigning them here.',
      });
      return;
    }

    setDialogMode('create');
    setDialogValues(emptyCableMaterialForm);
    setDialogErrors({});
    setDialogOpen(true);
    setEditingCableMaterialId(null);
  }, [availableMaterials.length, availableMaterialsError, availableMaterialsLoading, showToast]);

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
        general: 'You need to be signed in to manage cable materials.',
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
                cableMaterials: sortMaterials([...previous.cableMaterials, response.cableMaterial]),
              }
            : previous,
        );
        showToast({ intent: 'success', title: 'Cable material added' });
      } else if (editingCableMaterialId) {
        const response = await updateCableMaterial(
          token,
          projectId,
          cableId,
          editingCableMaterialId,
          input,
        );

        setDetails((previous) =>
          previous
            ? {
                ...previous,
                cableMaterials: sortMaterials(
                  previous.cableMaterials.map((item) =>
                    item.id === editingCableMaterialId ? response.cableMaterial : item,
                  ),
                ),
              }
            : previous,
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
            general: err.payload.formErrors?.[0],
          });
        }
        showToast({
          intent: 'error',
          title: 'Failed to save cable material',
          body: err.message,
        });
      } else {
        const message = 'Failed to save cable material. Please try again.';
        setDialogErrors({ general: message });
        showToast({
          intent: 'error',
          title: 'Failed to save cable material',
          body: message,
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
          body: 'You need to be signed in to delete cable materials.',
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete cable material "${material.name}"? This action cannot be undone.`,
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
                cableMaterials: previous.cableMaterials.filter((item) => item.id !== material.id),
              }
            : previous,
        );
        showToast({ intent: 'success', title: 'Cable material deleted' });
      } catch (err) {
        console.error('Failed to delete cable material', err);
        showToast({
          intent: 'error',
          title: 'Failed to delete cable material',
          body: err instanceof ApiError ? err.message : undefined,
        });
      } finally {
        setPendingCableMaterialId(null);
      }
    },
    [cableId, projectId, showToast, token],
  );

  const handleUpdateBaseMaterials = useCallback(async () => {
    if (!projectId || !cableId || !token) {
      showToast({
        intent: 'error',
        title: 'Sign-in required',
        body: 'You need to be signed in to reload base materials.',
      });
      return;
    }

    setSyncingBaseMaterials(true);

    try {
      const response = await syncCableBaseMaterials(token, projectId, cableId);

      setDetails((previous) =>
        previous
          ? {
              ...previous,
              cableTypeDefaultMaterials: sortMaterials(response.cableTypeDefaultMaterials),
              cableMaterials: sortMaterials(response.cableMaterials),
            }
          : previous,
      );

      if (response.summary.hasChanges) {
        showToast({
          intent: 'success',
          title: 'Base materials reloaded',
          body: formatCableMaterialSyncSummary(response.summary),
        });
      } else {
        showToast({
          intent: 'info',
          title: 'Base materials already up to date',
        });
      }
    } catch (err) {
      console.error('Failed to sync cable base materials', err);
      showToast({
        intent: 'error',
        title: 'Failed to reload base materials',
        body: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setSyncingBaseMaterials(false);
    }
  }, [cableId, projectId, showToast, token]);

  const handleRefresh = useCallback(() => {
    void loadDetails();
    void loadVersions();
  }, [loadDetails, loadVersions]);

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
    [availableMaterials],
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
  const resolvedCableMaterialSources = useMemo(() => {
    const sourceById = new Map<string, 'default' | 'manual'>();

    if (!details) {
      return sourceById;
    }

    const defaultMaterialsById = new Map<string, CableTypeDefaultMaterial>(
      details.cableTypeDefaultMaterials.map((material) => [material.id, material]),
    );
    const claimedDefaultMaterialIds = new Set<string>();

    for (const material of details.cableMaterials) {
      if (
        material.source === 'default' &&
        material.cableTypeDefaultMaterialId &&
        defaultMaterialsById.has(material.cableTypeDefaultMaterialId)
      ) {
        claimedDefaultMaterialIds.add(material.cableTypeDefaultMaterialId);
      }
    }

    const remainingDefaultMaterialsByKey = new Map<string, CableTypeDefaultMaterial[]>();

    for (const material of details.cableTypeDefaultMaterials) {
      if (claimedDefaultMaterialIds.has(material.id)) {
        continue;
      }

      const key = buildCableMaterialComparisonKey(material);
      const existing = remainingDefaultMaterialsByKey.get(key);

      if (existing) {
        existing.push(material);
      } else {
        remainingDefaultMaterialsByKey.set(key, [material]);
      }
    }

    for (const material of details.cableMaterials) {
      if (material.source === 'default' || material.source === 'manual') {
        sourceById.set(material.id, material.source);
        continue;
      }

      const key = buildCableMaterialComparisonKey(material);
      const candidates = remainingDefaultMaterialsByKey.get(key);

      if (candidates && candidates.length > 0) {
        candidates.shift();
        sourceById.set(material.id, 'default');
      } else {
        sourceById.set(material.id, 'manual');
      }
    }

    return sourceById;
  }, [details]);
  const currentCableIndex = useMemo(
    () => (details ? projectCables.findIndex((cable) => cable.id === details.cable.id) : -1),
    [details, projectCables],
  );
  const previousCable = currentCableIndex > 0 ? projectCables[currentCableIndex - 1] : null;
  const nextCable =
    currentCableIndex >= 0 && currentCableIndex < projectCables.length - 1
      ? projectCables[currentCableIndex + 1]
      : null;

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
            <Button onClick={handleRefresh}>Retry</Button>
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
            disabled={!previousCable}
            onClick={() =>
              previousCable
                ? navigate(`/projects/${projectId}/cables/${previousCable.id}`)
                : undefined
            }
          >
            Previous
          </Button>
          <Button
            appearance="secondary"
            disabled={!nextCable}
            onClick={() =>
              nextCable ? navigate(`/projects/${projectId}/cables/${nextCable.id}`) : undefined
            }
          >
            Next
          </Button>
          <Button
            appearance="secondary"
            onClick={() =>
              navigate(`/projects/${projectId}/cable-types/${details.cable.cableTypeId}`)
            }
          >
            Open cable type
          </Button>
          <Button onClick={handleRefresh}>Refresh</Button>
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
              <Caption1 className={styles.label}>Revision</Caption1>
              <Body1>{formatOptionalText(details.cable.revision)}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1 className={styles.label}>MTO</Caption1>
              <Body1>{formatOptionalText(details.cable.mto)}</Body1>
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
              Base materials come from the cable type&apos;s additional default materials. Use
              Reload base materials to refresh default rows from the cable type while keeping manual
              rows on this cable.
            </Caption1>
          </div>
          <div className={styles.sectionActions}>
            {canManageMaterials ? (
              <Button
                appearance="secondary"
                onClick={() => void handleUpdateBaseMaterials()}
                disabled={syncingBaseMaterials}
              >
                {syncingBaseMaterials ? 'Reloading...' : 'Reload base materials'}
              </Button>
            ) : null}
            {canManageMaterials ? (
              <Button
                appearance="primary"
                onClick={openCreateDialog}
                disabled={availableMaterialsLoading || syncingBaseMaterials}
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
                  <th className={styles.tableHeadCell}>Source</th>
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
                  const materialSource = resolvedCableMaterialSources.get(material.id) ?? 'manual';

                  return (
                    <tr key={material.id}>
                      <td className={styles.tableCell}>{material.name}</td>
                      <td className={styles.tableCell}>
                        {formatCableMaterialSource(materialSource)}
                      </td>
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
                            disabled={isBusy || syncingBaseMaterials}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            appearance="secondary"
                            onClick={() => void handleDeleteCableMaterial(material)}
                            disabled={isBusy || syncingBaseMaterials}
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

      <Card appearance="outline" className={styles.fullWidthCard}>
        <Accordion collapsible>
          <AccordionItem value="revisions">
            <AccordionHeader>Revisions</AccordionHeader>
            <AccordionPanel>
              <div className={styles.accordionPanelContent}>
                <div className={styles.sectionHeader}>
                  <Caption1 className={styles.readOnlyNotice}>
                    Compare saved cable field snapshots across revisions.
                  </Caption1>
                  <div className={styles.sectionActions}>
                    <Button
                      appearance="secondary"
                      onClick={() => void loadVersions()}
                      disabled={versionsLoading}
                    >
                      {versionsLoading ? 'Loading...' : 'Reload revisions'}
                    </Button>
                  </div>
                </div>

                {versionsLoading ? (
                  <Spinner label="Loading cable revisions..." />
                ) : versionsError ? (
                  <Body1 className={styles.errorText}>{versionsError}</Body1>
                ) : cableVersions.length === 0 ? (
                  <div className={styles.emptyState}>
                    <Body1>No saved revisions for this cable yet.</Body1>
                  </div>
                ) : (
                  <>
                    <div className={styles.compareControls}>
                      <Field label="Selected revision">
                        <Combobox
                          selectedOptions={selectedVersion ? [selectedVersion.id] : []}
                          value={selectedVersion ? formatCableVersionOption(selectedVersion) : undefined}
                          onOptionSelect={handleSelectedVersionChange}
                          freeform={false}
                        >
                          {cableVersions.map((version) => (
                            <Option key={version.id} value={version.id}>
                              {formatCableVersionOption(version)}
                            </Option>
                          ))}
                        </Combobox>
                      </Field>
                      <Field label="Compare against">
                        <Combobox
                          placeholder="Select a revision to compare"
                          selectedOptions={comparedVersion ? [comparedVersion.id] : []}
                          value={comparedVersion ? formatCableVersionOption(comparedVersion) : undefined}
                          onOptionSelect={handleComparedVersionChange}
                          freeform={false}
                        >
                          {cableVersions.map((version) => (
                            <Option key={version.id} value={version.id}>
                              {formatCableVersionOption(version)}
                            </Option>
                          ))}
                        </Combobox>
                      </Field>
                    </div>

                    {selectedVersion ? (
                      <div className={styles.compareSummary}>
                        <div className={styles.cardGrid}>
                          <div className={styles.field}>
                            <Caption1 className={styles.label}>Selected</Caption1>
                            <Body1>
                              v{selectedVersion.versionNumber}
                              {selectedVersion.revision ? ` - ${selectedVersion.revision}` : ''}
                            </Body1>
                          </div>
                          <div className={styles.field}>
                            <Caption1 className={styles.label}>Selected change</Caption1>
                            <Body1>{formatCableVersionChange(selectedVersion)}</Body1>
                          </div>
                          <div className={styles.field}>
                            <Caption1 className={styles.label}>Selected changed by</Caption1>
                            <Body1>{formatCableVersionUser(selectedVersion)}</Body1>
                          </div>
                          <div className={styles.field}>
                            <Caption1 className={styles.label}>Selected changed at</Caption1>
                            <Body1>{formatCableVersionTimestamp(selectedVersion.changedAt)}</Body1>
                          </div>
                          <div className={styles.field}>
                            <Caption1 className={styles.label}>Compared</Caption1>
                            <Body1>
                              {comparedVersion
                                ? `v${comparedVersion.versionNumber}${
                                    comparedVersion.revision ? ` - ${comparedVersion.revision}` : ''
                                  }`
                                : '-'}
                            </Body1>
                          </div>
                          <div className={styles.field}>
                            <Caption1 className={styles.label}>Compared changed by</Caption1>
                            <Body1>
                              {comparedVersion ? formatCableVersionUser(comparedVersion) : '-'}
                            </Body1>
                          </div>
                          <div className={styles.field}>
                            <Caption1 className={styles.label}>Compared changed at</Caption1>
                            <Body1>
                              {comparedVersion
                                ? formatCableVersionTimestamp(comparedVersion.changedAt)
                                : '-'}
                            </Body1>
                          </div>
                        </div>

                        {!comparedVersion ? (
                          <Caption1 className={styles.readOnlyNotice}>
                            Select another revision to compare against the selected one.
                          </Caption1>
                        ) : comparedVersionDiffs.length === 0 ? (
                          <Caption1 className={styles.readOnlyNotice}>
                            No tracked field differences between these revisions.
                          </Caption1>
                        ) : (
                          <div className={styles.tableContainer}>
                            <table className={styles.table}>
                              <thead>
                                <tr>
                                  <th className={styles.tableHeadCell}>Field</th>
                                  <th className={styles.tableHeadCell}>
                                    v{selectedVersion.versionNumber}
                                  </th>
                                  <th className={styles.tableHeadCell}>
                                    v{comparedVersion.versionNumber}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {comparedVersionDiffs.map((change) => (
                                  <tr key={change.label}>
                                    <td className={styles.tableCell}>{change.label}</td>
                                    <td className={styles.tableCell}>{change.nextValue}</td>
                                    <td className={styles.tableCell}>{change.previousValue}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ) : null}

                    <div className={styles.tableContainer}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.tableHeadCell}>Version</th>
                            <th className={styles.tableHeadCell}>Revision</th>
                            <th className={styles.tableHeadCell}>Change</th>
                            <th className={styles.tableHeadCell}>Changed by</th>
                            <th className={styles.tableHeadCell}>Changed at</th>
                            <th className={styles.tableHeadCell}>Field changes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cableVersions.map((version, index) => {
                            const previousVersion = cableVersions[index + 1] ?? null;
                            const fieldChanges = diffCableVersions(version, previousVersion);

                            return (
                              <tr key={version.id}>
                                <td className={styles.tableCell}>v{version.versionNumber}</td>
                                <td className={styles.tableCell}>{version.revision ?? '-'}</td>
                                <td className={styles.tableCell}>{formatCableVersionChange(version)}</td>
                                <td className={styles.tableCell}>{formatCableVersionUser(version)}</td>
                                <td className={styles.tableCell}>
                                  {formatCableVersionTimestamp(version.changedAt)}
                                </td>
                                <td className={styles.tableCell}>
                                  {previousVersion === null ? (
                                    <Caption1>Initial snapshot</Caption1>
                                  ) : fieldChanges.length === 0 ? (
                                    <Caption1>No tracked field changes</Caption1>
                                  ) : (
                                    fieldChanges.map((change) => (
                                      <div key={change.label}>
                                        <strong>{change.label}:</strong> {change.previousValue} to{' '}
                                        {change.nextValue}
                                      </div>
                                    ))
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
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
