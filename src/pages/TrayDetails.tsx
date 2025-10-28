import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Body1,
  Button,
  Caption1,
  Checkbox,
  Dropdown,
  Field,
  Input,
  Option,
  Spinner,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';
import type { CheckboxOnChangeData } from '@fluentui/react-components';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  deleteTray,
  updateTray
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { LoadCurveChart } from './Materials/components/LoadCurveChart';

// Import refactored modules
import {
  useTrayData,
  useMaterialData,
  useMaterialSupports,
  useLoadCurveData,
  useTrayCalculations,
  useGroundingCable,
  useLoadCurveEvaluation,
  useProjectCableTypes
} from './TrayDetails/hooks';
import {
  toTrayFormState,
  parseNumberInput,
  buildTrayInput,
  formatDimensionValue,
  formatWeightValue
} from './TrayDetails/TrayDetails.utils';
import { TrayFormState, TrayFormErrors } from './TrayDetails/TrayDetails.types';
import { TrayDetailsHeader } from './TrayDetails/components/TrayDetailsHeader';
import { CablesTableSection } from './TrayDetails/components/CablesTableSection';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    maxWidth: '60rem',
    width: '100%',
    margin: '0 auto',
    ...shorthands.padding('2rem', '1.5rem', '4rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  tableWrapper: {
    width: '100%',
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: '28rem'
  },
  tableHeadCell: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap',
    fontWeight: tokens.fontWeightSemibold
  },
  tableCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: 'top'
  },
  section: {
    display: 'grid',
    gap: '0.75rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1.25rem')
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
    gap: '0.75rem'
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  emptyState: {
    padding: '0.5rem 0'
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  },
  chartWrapper: {
    width: '100%',
    overflowX: 'auto'
  },
  chartCanvas: {
    minWidth: '32rem'
  },
  chartMeta: {
    display: 'grid',
    gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))'
  },
  chartStatus: {
    fontWeight: tokens.fontWeightSemibold
  }
});

export const TrayDetails = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { projectId, trayId } = useParams<{ projectId: string; trayId: string }>();
  const { user, token } = useAuth();
  const { showToast } = useToast();

  const isAdmin = Boolean(user?.isAdmin);

  // Use custom hooks for data management
  const {
    project,
    tray,
    trays,
    trayCables,
    cablesError,
    isLoading,
    error,
    setTray,
    setTrays
  } = useTrayData(projectId, trayId);

  const { materialTrays, isLoadingMaterials, materialsError, findMaterialTrayByType } =
    useMaterialData();

  const { materialSupportsById, materialSupportsLoading, materialSupportsError, materialSupportsLoaded } =
    useMaterialSupports();

  const { projectCableTypes, projectCableTypesLoading, projectCableTypesError } =
    useProjectCableTypes(projectId);

  // Form state
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [formValues, setFormValues] = useState<TrayFormState>({
    name: '',
    type: '',
    purpose: '',
    widthMm: '',
    heightMm: '',
    lengthMm: '',
    weightKgPerM: ''
  });
  const [formErrors, setFormErrors] = useState<TrayFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Initialize form when tray loads
  useEffect(() => {
    if (tray) {
      setFormValues(toTrayFormState(tray));
      setIsEditing(false);
      setFormErrors({});
    }
  }, [tray]);

  // Material tray selection
  const selectedMaterialTray = useMemo(
    () => findMaterialTrayByType(formValues.type),
    [findMaterialTrayByType, formValues.type]
  );

  const selectedLoadCurveId = selectedMaterialTray?.loadCurveId ?? null;
  const { selectedLoadCurve, loadCurveLoadingId, loadCurveError } =
    useLoadCurveData(selectedLoadCurveId);

  // Auto-update form fields when material tray changes
  useEffect(() => {
    if (!selectedMaterialTray) {
      setFormValues((previous) => {
        if (previous.weightKgPerM === '') {
          return previous;
        }
        return { ...previous, weightKgPerM: '' };
      });
      return;
    }

    setFormValues((previous) => {
      const nextWeight = formatWeightValue(selectedMaterialTray.weightKgPerM);
      const nextWidth = formatDimensionValue(selectedMaterialTray.widthMm);
      const nextHeight = formatDimensionValue(selectedMaterialTray.heightMm);

      let changed = false;
      const nextState: TrayFormState = { ...previous };

      if (previous.weightKgPerM !== nextWeight) {
        nextState.weightKgPerM = nextWeight;
        changed = true;
      }

      if (isEditing) {
        if (previous.widthMm !== nextWidth) {
          nextState.widthMm = nextWidth;
          changed = true;
        }
        if (previous.heightMm !== nextHeight) {
          nextState.heightMm = nextHeight;
          changed = true;
        }
      }

      return changed ? nextState : previous;
    });
  }, [selectedMaterialTray, isEditing]);

  // Grounding cable logic
  const groundingHook = useGroundingCable(
    projectId,
    trayId,
    projectCableTypes,
    token,
    showToast,
    setTray,
    setTrays
  );

  const {
    groundingCableTypes,
    includeGroundingCable,
    selectedGroundingCableTypeId,
    selectedGroundingCableType,
    groundingCableWeightKgPerM,
    currentGroundingPreference,
    groundingPreferenceSaving,
    setGroundingSelectionsByTrayId,
    persistGroundingPreference
  } = groundingHook;

  // Initialize grounding selection when tray loads
  useEffect(() => {
    if (tray) {
      setGroundingSelectionsByTrayId((previous) => ({
        ...previous,
        [tray.id]: {
          include: tray.includeGroundingCable,
          typeId: tray.groundingCableTypeId
        }
      }));
    }
  }, [tray, setGroundingSelectionsByTrayId]);

  // Auto-select fallback grounding cable type if needed
  useEffect(() => {
    if (!trayId || !includeGroundingCable || groundingPreferenceSaving) {
      return;
    }

    const hasCurrentSelection =
      selectedGroundingCableTypeId !== null &&
      groundingCableTypes.some((type) => type.id === selectedGroundingCableTypeId);

    if (hasCurrentSelection) {
      return;
    }

    const fallbackTypeId = groundingCableTypes[0]?.id ?? null;
    if (fallbackTypeId === null) {
      return;
    }

    const nextPreference = {
      include: true,
      typeId: fallbackTypeId
    };

    setGroundingSelectionsByTrayId((previous) => ({
      ...previous,
      [trayId]: nextPreference
    }));

    void persistGroundingPreference(currentGroundingPreference, nextPreference);
  }, [
    trayId,
    includeGroundingCable,
    selectedGroundingCableTypeId,
    groundingCableTypes,
    currentGroundingPreference,
    groundingPreferenceSaving,
    persistGroundingPreference,
    setGroundingSelectionsByTrayId
  ]);

  // Calculate tray weight
  const trayWeightPerMeterKg = useMemo(() => {
    if (formValues.weightKgPerM.trim() !== '') {
      const { numeric } = parseNumberInput(formValues.weightKgPerM);
      if (numeric !== null) {
        return numeric;
      }
    }

    if (
      selectedMaterialTray?.weightKgPerM !== null &&
      selectedMaterialTray?.weightKgPerM !== undefined &&
      !Number.isNaN(selectedMaterialTray.weightKgPerM)
    ) {
      return selectedMaterialTray.weightKgPerM;
    }

    return null;
  }, [formValues.weightKgPerM, selectedMaterialTray]);

  // All calculations using custom hook
  const calculations = useTrayCalculations(
    project,
    tray,
    trayCables,
    materialSupportsById,
    trayWeightPerMeterKg,
    groundingCableWeightKgPerM
  );

  const {
    supportOverride,
    overrideSupport,
    supportCalculations,
    nonGroundingCables,
    cablesWeightLoadPerMeterKg,
    trayWeightLoadPerMeterKg,
    trayTotalOwnWeightKg,
    cablesTotalWeightKg,
    totalWeightLoadPerMeterKg,
    totalWeightKg,
    totalWeightLoadPerMeterKn
  } = calculations;

  // Safety factor calculations
  const safetyFactorPercent = project?.trayLoadSafetyFactor ?? null;
  const safetyFactorMissing = project !== null && project.trayLoadSafetyFactor === null;
  const safetyFactorHasError =
    project !== null && safetyFactorPercent !== null && safetyFactorPercent < 0;
  const safetyFactorMultiplier =
    safetyFactorHasError || safetyFactorPercent === null
      ? null
      : 1 + safetyFactorPercent / 100;
  const safetyFactorStatusMessage = (() => {
    if (safetyFactorHasError) {
      return 'Safety factor must be zero or greater.';
    }
    if (safetyFactorMissing) {
      return 'Set a safety factor in Project details to evaluate the load curve.';
    }
    return null;
  })();
  const safetyFactorBlocking = safetyFactorHasError || safetyFactorMissing;

  const safetyAdjustedLoadKnPerM = useMemo(() => {
    if (totalWeightLoadPerMeterKn === null || safetyFactorMultiplier === null) {
      return null;
    }
    return totalWeightLoadPerMeterKn * safetyFactorMultiplier;
  }, [totalWeightLoadPerMeterKn, safetyFactorMultiplier]);

  // Load curve evaluation
  const chartSpanMeters = supportCalculations.distanceMeters;
  const chartLoadCurvePoints = selectedLoadCurve?.points ?? [];
  const chartEvaluation = useLoadCurveEvaluation(
    selectedLoadCurveId,
    selectedLoadCurve,
    chartSpanMeters,
    safetyAdjustedLoadKnPerM,
    safetyFactorMultiplier,
    safetyFactorStatusMessage
  );

  // Navigation
  const { previousTray, nextTray } = useMemo(() => {
    if (!tray) {
      return { previousTray: null, nextTray: null };
    }

    const currentIndex = trays.findIndex((item) => item.id === tray.id);
    if (currentIndex === -1) {
      return { previousTray: null, nextTray: null };
    }

    return {
      previousTray: currentIndex > 0 ? trays[currentIndex - 1] : null,
      nextTray: currentIndex < trays.length - 1 ? trays[currentIndex + 1] : null
    };
  }, [tray, trays]);

  const handleNavigateTray = useCallback(
    (targetTrayId: string) => {
      if (!projectId) {
        return;
      }
      navigate(`/projects/${projectId}/trays/${targetTrayId}`);
    },
    [navigate, projectId]
  );

  const handlePrevTray = () => {
    if (previousTray) {
      handleNavigateTray(previousTray.id);
    }
  };

  const handleNextTray = () => {
    if (nextTray) {
      handleNavigateTray(nextTray.id);
    }
  };

  // Formatters
  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 3
      }),
    []
  );

  const formatCableTypeLabel = useCallback(
    (type: typeof projectCableTypes[0]) => {
      const baseName = type.name?.trim() || 'Unnamed cable type';
      const tag = type.tag?.trim();
      const weight = type.weightKgPerM;
      const weightDisplay =
        weight !== null && !Number.isNaN(weight)
          ? `${numberFormatter.format(weight)} kg/m`
          : null;

      return [baseName, tag ? `(${tag})` : null, weightDisplay ? `- ${weightDisplay}` : null]
        .filter(Boolean)
        .join(' ');
    },
    [numberFormatter]
  );

  const formatSupportNumber = useCallback(
    (value: number | null) =>
      value === null || Number.isNaN(value) ? '-' : numberFormatter.format(value),
    [numberFormatter]
  );

  // Form handlers
  const handleFieldChange =
    (field: keyof TrayFormState) =>
    (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
      setFormValues((previous) => ({
        ...previous,
        [field]: data.value
      }));
    };

  const handleTypeSelect = useCallback(
    (_event: unknown, data: { optionValue?: string }) => {
      const nextType = data.optionValue ?? '';
      const material = nextType ? findMaterialTrayByType(nextType) : null;

      setFormValues((previous) => {
        const nextState: TrayFormState = {
          ...previous,
          type: nextType
        };

        if (material) {
          nextState.widthMm = formatDimensionValue(material.widthMm);
          nextState.heightMm = formatDimensionValue(material.heightMm);
          nextState.weightKgPerM = formatWeightValue(material.weightKgPerM);
        } else {
          nextState.weightKgPerM = '';
        }

        return nextState;
      });

      setFormErrors((previous) => ({
        ...previous,
        type: undefined,
        widthMm: undefined,
        heightMm: undefined
      }));
    },
    [findMaterialTrayByType]
  );

  const handleGroundingCableToggle = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, data: CheckboxOnChangeData) => {
      if (!trayId || groundingPreferenceSaving) {
        return;
      }

      const nextInclude = data.checked === true || data.checked === 'mixed';

      if (nextInclude && groundingCableTypes.length === 0) {
        showToast({
          intent: 'warning',
          title: 'No grounding cable types available',
          body: 'Add a grounding cable type to the project before enabling this option.'
        });
        return;
      }

      const previousPreference = currentGroundingPreference;
      let nextTypeId = previousPreference?.typeId ?? null;

      if (nextInclude) {
        if (!nextTypeId || !groundingCableTypes.some((type) => type.id === nextTypeId)) {
          nextTypeId = groundingCableTypes[0]?.id ?? null;
        }
      }

      const nextPreference = {
        include: nextInclude,
        typeId: nextTypeId
      };

      if (
        previousPreference &&
        previousPreference.include === nextPreference.include &&
        previousPreference.typeId === nextPreference.typeId
      ) {
        return;
      }

      setGroundingSelectionsByTrayId((previous) => ({
        ...previous,
        [trayId]: nextPreference
      }));

      void persistGroundingPreference(previousPreference, nextPreference);
    },
    [
      trayId,
      groundingPreferenceSaving,
      groundingCableTypes,
      currentGroundingPreference,
      persistGroundingPreference,
      showToast,
      setGroundingSelectionsByTrayId
    ]
  );

  const handleGroundingCableTypeSelect = useCallback(
    (_event: unknown, data: { optionValue?: string }) => {
      if (!trayId || groundingPreferenceSaving) {
        return;
      }

      const nextTypeId = data.optionValue ?? null;
      if (!nextTypeId || !groundingCableTypes.some((type) => type.id === nextTypeId)) {
        return;
      }

      const previousPreference = currentGroundingPreference;
      const nextPreference = {
        include: true,
        typeId: nextTypeId
      };

      if (
        previousPreference &&
        previousPreference.include === nextPreference.include &&
        previousPreference.typeId === nextPreference.typeId
      ) {
        return;
      }

      setGroundingSelectionsByTrayId((previous) => ({
        ...previous,
        [trayId]: nextPreference
      }));

      void persistGroundingPreference(previousPreference, nextPreference);
    },
    [
      trayId,
      groundingPreferenceSaving,
      groundingCableTypes,
      currentGroundingPreference,
      persistGroundingPreference,
      setGroundingSelectionsByTrayId
    ]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!project || !tray || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to update trays.'
      });
      return;
    }

    const { input, errors } = buildTrayInput(formValues);

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);

    try {
      const response = await updateTray(token, project.id, tray.id, input);
      setTray(response.tray);
      setTrays((previous) => {
        const hasTray = previous.some((item) => item.id === response.tray.id);
        return hasTray
          ? previous.map((item) =>
              item.id === response.tray.id ? response.tray : item
            )
          : [...previous, response.tray];
      });
      setFormValues(toTrayFormState(response.tray));
      setIsEditing(false);
      showToast({ intent: 'success', title: 'Tray updated' });
    } catch (err) {
      console.error('Update tray failed', err);
      showToast({
        intent: 'error',
        title: 'Failed to update tray',
        body: err instanceof ApiError ? err.message : undefined
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = useCallback(async () => {
    if (!project || !tray || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to delete trays.'
      });
      return;
    }

    const confirmed = window.confirm(
      `Delete tray "${tray.name}"? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);

    try {
      await deleteTray(token, project.id, tray.id);
      showToast({ intent: 'success', title: 'Tray deleted' });
      navigate(`/projects/${project.id}?tab=trays`);
    } catch (err) {
      console.error('Delete tray failed', err);
      showToast({
        intent: 'error',
        title: 'Failed to delete tray',
        body: err instanceof ApiError ? err.message : undefined
      });
      setIsDeleting(false);
    }
  }, [project, tray, token, navigate, showToast]);

  const handleCancelEdit = () => {
    if (tray) {
      setFormValues(toTrayFormState(tray));
    }
    setFormErrors({});
    setIsEditing(false);
  };

  // UI state calculations
  const selectedGroundingCableLabel = useMemo(
    () =>
      selectedGroundingCableType
        ? formatCableTypeLabel(selectedGroundingCableType)
        : undefined,
    [selectedGroundingCableType, formatCableTypeLabel]
  );

  const hasGroundingCableWeightData = groundingCableWeightKgPerM !== null;
  const groundingCableMissingWeight =
    includeGroundingCable && selectedGroundingCableType !== null && !hasGroundingCableWeightData;

  const supportIdToLoad = supportOverride?.supportId ?? null;
  const supportSectionNeedsSupportData = Boolean(supportOverride?.supportId);
  const supportDistanceMissing = supportCalculations.distanceMeters === null;
  const trayLengthMissing =
    supportCalculations.lengthMeters === null || supportCalculations.lengthMeters <= 0;
  const supportDetailsMissing =
    supportSectionNeedsSupportData &&
    materialSupportsLoaded &&
    !materialSupportsLoading &&
    supportIdToLoad !== null &&
    !overrideSupport;
  const supportDetailsError = supportDetailsMissing
    ? 'Selected support details were not found.'
    : materialSupportsError;

  const supportTypeDisplay = overrideSupport?.type ?? supportOverride?.supportType ?? null;
  const supportLengthMm = overrideSupport?.lengthMm ?? null;

  const canUseMaterialDropdown = !isLoadingMaterials && materialTrays.length > 0;
  const weightDisplay =
    formValues.weightKgPerM !== ''
      ? formValues.weightKgPerM
      : formatWeightValue(selectedMaterialTray?.weightKgPerM) || '-';
  const currentTypeHasMaterial = Boolean(
    formValues.type && findMaterialTrayByType(formValues.type)
  );

  // Chart visualization data
  const chartStatusColor =
    safetyFactorBlocking
      ? tokens.colorStatusDangerForeground1
      : chartEvaluation.status === 'ok'
      ? tokens.colorPaletteGreenForeground1
      : chartEvaluation.status === 'too-short'
      ? tokens.colorPaletteMarigoldForeground2
      : chartEvaluation.status === 'no-curve' ||
        chartEvaluation.status === 'loading' ||
        chartEvaluation.status === 'awaiting-data' ||
        chartEvaluation.status === 'no-points'
      ? tokens.colorNeutralForeground3
      : tokens.colorPaletteRedForeground1;

  const chartPointSpanDisplay =
    chartSpanMeters !== null ? numberFormatter.format(chartSpanMeters) : '-';
  const chartPointLoadDisplay =
    safetyAdjustedLoadKnPerM !== null ? numberFormatter.format(safetyAdjustedLoadKnPerM) : '-';

  const chartVerticalLines = useMemo(() => {
    const highlight = chartEvaluation.limitHighlight;
    if (!highlight) {
      return null;
    }

    const lineColor =
      highlight.type === 'min'
        ? tokens.colorPaletteMarigoldForeground2
        : tokens.colorPaletteDarkOrangeForeground1;

    return [
      {
        span: highlight.span,
        toLoad: highlight.load,
        color: lineColor
      }
    ];
  }, [chartEvaluation.limitHighlight]);

  const chartHorizontalLines = useMemo(() => {
    if (chartSpanMeters === null || chartEvaluation.allowableLoadAtSpan === null) {
      return null;
    }

    return [
      {
        load: chartEvaluation.allowableLoadAtSpan,
        toSpan: chartSpanMeters,
        color: tokens.colorPaletteRedForeground1,
        label: 'Load limit at span'
      }
    ];
  }, [chartEvaluation.allowableLoadAtSpan, chartSpanMeters]);

  const chartSummary = useMemo(() => {
    const highlight = chartEvaluation.limitHighlight;
    if (!highlight) {
      return { text: null, color: undefined as string | undefined };
    }

    const spanText =
      highlight.span !== null && !Number.isNaN(highlight.span)
        ? numberFormatter.format(highlight.span)
        : null;

    const color =
      highlight.type === 'min'
        ? tokens.colorPaletteMarigoldForeground2
        : tokens.colorPaletteDarkOrangeForeground1;

    const text = spanText ? `${highlight.label}: ${spanText} m` : highlight.label;
    return { text, color };
  }, [chartEvaluation.limitHighlight, numberFormatter]);

  // Loading and error states
  if (isLoading) {
    return (
      <section className={styles.root}>
        <Spinner label="Loading tray..." />
      </section>
    );
  }

  if (error || !tray || !projectId || !trayId) {
    return (
      <section className={styles.root}>
        <Body1 className={styles.errorText}>{error ?? 'Tray not available.'}</Body1>
        <Button onClick={() => navigate(-1)}>Back</Button>
      </section>
    );
  }

  return (
    <section className={styles.root}>
      <TrayDetailsHeader
        tray={tray}
        project={project}
        previousTray={previousTray}
        nextTray={nextTray}
        isAdmin={isAdmin}
        isEditing={isEditing}
        isDeleting={isDeleting}
        onNavigateTray={handleNavigateTray}
        onBack={() => navigate(`/projects/${projectId}?tab=trays`)}
        onEdit={() => setIsEditing(true)}
        onDelete={() => void handleDelete()}
        styles={styles}
      />

      {/* Tray Details Section */}
      <div className={styles.section}>
        <Caption1>Tray details</Caption1>
        {isEditing ? (
          <form className={styles.grid} onSubmit={handleSubmit}>
            {materialsError ? (
              <Body1 className={styles.errorText}>{materialsError}</Body1>
            ) : null}
            <Field
              label="Name"
              required
              validationState={formErrors.name ? 'error' : undefined}
              validationMessage={formErrors.name}
            >
              <Input
                value={formValues.name}
                onChange={handleFieldChange('name')}
                required
              />
            </Field>
            <Field
              label="Type"
              validationState={formErrors.type ? 'error' : undefined}
              validationMessage={formErrors.type}
            >
              {canUseMaterialDropdown ? (
                <Dropdown
                  placeholder="Select tray type"
                  selectedOptions={formValues.type ? [formValues.type] : []}
                  value={formValues.type || undefined}
                  onOptionSelect={handleTypeSelect}
                >
                  {materialTrays.map((material) => (
                    <Option key={material.id} value={material.type}>
                      {material.type}
                    </Option>
                  ))}
                  {!currentTypeHasMaterial && formValues.type ? (
                    <Option key="custom" value={formValues.type}>{formValues.type}</Option>
                  ) : null}
                </Dropdown>
              ) : (
                <Input
                  value={formValues.type}
                  onChange={handleFieldChange('type')}
                  placeholder={isLoadingMaterials ? 'Loading types...' : undefined}
                  readOnly={isLoadingMaterials}
                />
              )}
            </Field>
            <Field
              label="Purpose"
              validationState={formErrors.purpose ? 'error' : undefined}
              validationMessage={formErrors.purpose}
            >
              <Input
                value={formValues.purpose}
                onChange={handleFieldChange('purpose')}
              />
            </Field>
            <Field
              label="Width [mm]"
              validationState={formErrors.widthMm ? 'error' : undefined}
              validationMessage={formErrors.widthMm}
            >
              <Input value={formValues.widthMm} readOnly />
            </Field>
            <Field
              label="Height [mm]"
              validationState={formErrors.heightMm ? 'error' : undefined}
              validationMessage={formErrors.heightMm}
            >
              <Input value={formValues.heightMm} readOnly />
            </Field>
            <Field label="Weight [kg/m]">
              <Input value={formValues.weightKgPerM} readOnly />
            </Field>
            <Field
              label="Length [mm]"
              validationState={formErrors.lengthMm ? 'error' : undefined}
              validationMessage={formErrors.lengthMm}
            >
              <Input
                value={formValues.lengthMm}
                onChange={handleFieldChange('lengthMm')}
              />
            </Field>
            <div className={styles.actions}>
              <Button
                type="button"
                appearance="secondary"
                onClick={handleCancelEdit}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button appearance="primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </form>
        ) : (
          <div className={styles.grid}>
            <div className={styles.field}>
              <Caption1>Name</Caption1>
              <Body1>{tray.name}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Type</Caption1>
              <Body1>{tray.type ?? '-'}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Purpose</Caption1>
              <Body1>{tray.purpose ?? '-'}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Width [mm]</Caption1>
              <Body1>
                {tray.widthMm !== null ? numberFormatter.format(tray.widthMm) : '-'}
              </Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Height [mm]</Caption1>
              <Body1>
                {tray.heightMm !== null ? numberFormatter.format(tray.heightMm) : '-'}
              </Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Weight [kg/m]</Caption1>
              <Body1>{weightDisplay}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Length [mm]</Caption1>
              <Body1>
                {tray.lengthMm !== null ? numberFormatter.format(tray.lengthMm) : '-'}
              </Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Created</Caption1>
              <Body1>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                }).format(new Date(tray.createdAt))}
              </Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Updated</Caption1>
              <Body1>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                }).format(new Date(tray.updatedAt))}
              </Body1>
            </div>
          </div>
        )}
      </div>

      {/* Cables Section */}
      <CablesTableSection
        trayCables={nonGroundingCables}
        cablesError={cablesError}
        styles={styles}
        numberFormatter={numberFormatter}
      />

      {/* Support Calculations Section */}
      <div className={styles.section}>
        <Caption1>Supports weight calculations</Caption1>
        {supportSectionNeedsSupportData && materialSupportsLoading ? (
          <Spinner label="Loading support details..." />
        ) : null}
        {supportSectionNeedsSupportData && supportDetailsError ? (
          <Body1 className={styles.errorText}>{supportDetailsError}</Body1>
        ) : null}
        {supportDistanceMissing || trayLengthMissing ? (
          <Body1 className={styles.emptyState}>
            {supportDistanceMissing && trayLengthMissing
              ? 'Tray length and support distance are required for calculations.'
              : supportDistanceMissing
              ? 'Support distance is not configured for this tray.'
              : 'Tray length is not specified for this tray.'}
          </Body1>
        ) : null}
        <div className={styles.grid}>
          <div className={styles.field}>
            <Caption1>Support type</Caption1>
            <Body1>{supportTypeDisplay ?? '-'}</Body1>
          </div>
          <div className={styles.field}>
            <Caption1>Support length [mm]</Caption1>
            <Body1>
              {supportLengthMm !== null ? numberFormatter.format(supportLengthMm) : '-'}
            </Body1>
          </div>
          <div className={styles.field}>
            <Caption1>Supports count</Caption1>
            <Body1>{formatSupportNumber(supportCalculations.supportsCount)}</Body1>
          </div>
          <div className={styles.field}>
            <Caption1>Weight per piece [kg]</Caption1>
            <Body1>{formatSupportNumber(supportCalculations.weightPerPieceKg)}</Body1>
          </div>
          <div className={styles.field}>
            <Caption1>Supports total weight [kg]</Caption1>
            <Body1>{formatSupportNumber(supportCalculations.totalWeightKg)}</Body1>
          </div>
          <div className={styles.field}>
            <Caption1>Supports weight load per meter [kg/m]</Caption1>
            <Body1>{formatSupportNumber(supportCalculations.weightPerMeterKg)}</Body1>
          </div>
        </div>
      </div>

      {/* Tray Own Weight Section */}
      <div className={styles.section}>
        <Caption1>Tray own weight calculations</Caption1>
        <div className={styles.grid}>
          <div className={styles.field}>
            <Caption1>Tray weight load per meter [kg/m]</Caption1>
            <Body1>{formatSupportNumber(trayWeightLoadPerMeterKg)}</Body1>
          </div>
          <div className={styles.field}>
            <Caption1>Tray total own weight [kg]</Caption1>
            <Body1>{formatSupportNumber(trayTotalOwnWeightKg)}</Body1>
          </div>
        </div>
      </div>

      {/* Cables Weight Section */}
      <div className={styles.section}>
        <Caption1>Cables on tray weight calculations</Caption1>
        <div className={styles.field}>
          <Checkbox
            label="Add grounding cable"
            checked={includeGroundingCable}
            onChange={handleGroundingCableToggle}
            disabled={groundingPreferenceSaving}
          />
          {includeGroundingCable && projectCableTypesLoading ? (
            <Spinner label="Loading cable types..." />
          ) : null}
          {includeGroundingCable && projectCableTypesError ? (
            <Body1 className={styles.errorText}>{projectCableTypesError}</Body1>
          ) : null}
          {includeGroundingCable &&
          !projectCableTypesLoading &&
          !projectCableTypesError &&
          groundingCableTypes.length === 0 ? (
            <Body1 className={styles.emptyState}>
              No grounding cable types available for this project.
            </Body1>
          ) : null}
        </div>
        {includeGroundingCable &&
        !projectCableTypesLoading &&
        !projectCableTypesError &&
        groundingCableTypes.length > 0 ? (
          <div className={styles.field}>
            <Field
              label="Grounding cable type"
              validationState={groundingCableMissingWeight ? 'error' : undefined}
              validationMessage={
                groundingCableMissingWeight
                  ? 'Selected cable type does not include weight data. It will not affect calculations.'
                  : undefined
              }
            >
              <Dropdown
                placeholder="Select cable type"
                selectedOptions={
                  selectedGroundingCableTypeId ? [selectedGroundingCableTypeId] : []
                }
                value={selectedGroundingCableLabel}
                onOptionSelect={handleGroundingCableTypeSelect}
                disabled={groundingPreferenceSaving}
              >
                {groundingCableTypes.map((type) => (
                  <Option key={type.id} value={type.id}>
                    {formatCableTypeLabel(type)}
                  </Option>
                ))}
              </Dropdown>
            </Field>
          </div>
        ) : null}
        {cablesWeightLoadPerMeterKg === null ? (
          <Body1 className={styles.emptyState}>
            No cables with weight data available for calculations.
          </Body1>
        ) : null}
        <div className={styles.grid}>
          <div className={styles.field}>
            <Caption1>Cables weight load per meter [kg/m]</Caption1>
            <Body1>{formatSupportNumber(cablesWeightLoadPerMeterKg)}</Body1>
          </div>
          <div className={styles.field}>
            <Caption1>Total weight on the tray [kg]</Caption1>
            <Body1>{formatSupportNumber(cablesTotalWeightKg)}</Body1>
          </div>
        </div>
      </div>

      {/* Total Weight Section */}
      <div className={styles.section}>
        <Caption1>Total weight calculations</Caption1>
        <div className={styles.grid}>
          <div className={styles.field}>
            <Caption1>Total weight load per meter [kg/m]</Caption1>
            <Body1>{formatSupportNumber(totalWeightLoadPerMeterKg)}</Body1>
          </div>
          <div className={styles.field}>
            <Caption1>Total weight [kg]</Caption1>
            <Body1>{formatSupportNumber(totalWeightKg)}</Body1>
          </div>
        </div>
      </div>

      {/* Load Curve Section */}
      <div className={styles.section}>
        <Caption1>Tray load curve</Caption1>
        <div className={styles.grid}>
          <div className={styles.field}>
            <Caption1>Assigned load curve</Caption1>
            <Body1>{selectedMaterialTray?.loadCurveName ?? 'Not assigned'}</Body1>
          </div>
          <div className={styles.field}>
            <Caption1>Safety factor [%]</Caption1>
            <Body1>
              {safetyFactorPercent !== null
                ? numberFormatter.format(safetyFactorPercent)
                : project
                ? 'Not set'
                : '-'}
            </Body1>
          </div>
        </div>
        {safetyFactorStatusMessage ? (
          <Body1 className={styles.errorText}>{safetyFactorStatusMessage}</Body1>
        ) : null}
        {loadCurveError ? (
          <Body1 className={styles.errorText}>{loadCurveError}</Body1>
        ) : null}
        {selectedLoadCurveId === null ? (
          <Body1 className={styles.emptyState}>
            Assign a load curve to this tray type to visualise support limits.
          </Body1>
        ) : loadCurveLoadingId === selectedLoadCurveId ? (
          <Spinner label="Loading load curve..." />
        ) : selectedLoadCurve === null ? (
          <Body1 className={styles.emptyState}>
            Unable to display load curve data. Try refreshing the page.
          </Body1>
        ) : chartLoadCurvePoints.length === 0 ? (
          <Body1 className={styles.emptyState}>
            The assigned load curve has no data points.
          </Body1>
        ) : (
          <>
            <div className={styles.chartWrapper}>
              <LoadCurveChart
                points={chartLoadCurvePoints}
                className={styles.chartCanvas}
                marker={chartEvaluation.marker}
                limitHighlight={chartEvaluation.limitHighlight}
                verticalLines={chartVerticalLines}
                horizontalLines={chartHorizontalLines}
                summaryText={chartSummary.text}
                summaryColor={chartSummary.color}
              />
            </div>
            <Body1 className={styles.chartStatus} style={{ color: chartStatusColor }}>
              {chartEvaluation.message}
            </Body1>
            <div className={styles.chartMeta}>
              <div className={styles.field}>
                <Caption1>Calculated point span [m]</Caption1>
                <Body1>{chartPointSpanDisplay}</Body1>
              </div>
              <div className={styles.field}>
                <Caption1>Calculated point load [kN/m]</Caption1>
                <Body1>{chartPointLoadDisplay}</Body1>
              </div>
              {chartEvaluation.limitHighlight ? (
                <div className={styles.field}>
                  <Caption1>{chartEvaluation.limitHighlight.label} [m]</Caption1>
                  <Body1>
                    {numberFormatter.format(chartEvaluation.limitHighlight.span)}
                  </Body1>
                </div>
              ) : null}
              {chartEvaluation.allowableLoadAtSpan !== null ? (
                <div className={styles.field}>
                  <Caption1>Allowable load at span [kN/m]</Caption1>
                  <Body1>{numberFormatter.format(chartEvaluation.allowableLoadAtSpan)}</Body1>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* Navigation Footer */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '2rem' }}>
        <Button appearance="secondary" onClick={handlePrevTray} disabled={!previousTray}>
          Previous tray
        </Button>
        <Button appearance="secondary" onClick={handleNextTray} disabled={!nextTray}>
          Next tray
        </Button>
      </div>
    </section>
  );
};
