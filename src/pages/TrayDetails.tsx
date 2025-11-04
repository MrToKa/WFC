import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Body1,
  Button,
  Caption1,
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
import {
  TrayDetailsHeader,
  CablesTableSection,
  TrayInfoSection,
  TrayEditForm,
  SupportCalculationsSection,
  WeightCalculationsSection,
  GroundingCableControls,
  LoadCurveSection
} from './TrayDetails/components';
import {
  CABLE_CATEGORY_CONFIG,
  CABLE_CATEGORY_ORDER,
  DEFAULT_CATEGORY_SETTINGS,
  DEFAULT_CABLE_SPACING,
  type CableCategoryKey
} from './ProjectDetails/hooks/cableLayoutDefaults';
import {
  TrayDrawingService,
  type CableBundleMap,
  type CategoryLayoutConfig,
  determineCableDiameterGroup
} from './TrayDetails/trayDrawingService';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    width: '100%',
    margin: '0 auto',
    boxSizing: 'border-box',
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
  tableSection: {
    boxSizing: 'border-box'
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
    ...shorthands.padding('1.25rem'),
    width: '100%',
    maxWidth: '60rem',
    margin: '0 auto',
    boxSizing: 'border-box'
  },
  fullWidthSection: {
    maxWidth: 'none',
    width: 'calc(100% + 3rem)',
    marginLeft: '-1.5rem',
    marginRight: '-1.5rem'
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
  fieldTitle: {
    fontWeight: tokens.fontWeightSemibold
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
  },
  canvasSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1.25rem'),
    boxSizing: 'border-box'
  },
  canvasScroll: {
    width: '100%',
    overflowX: 'auto'
  },
  trayCanvas: {
    display: 'block',
    width: '100%',
    maxWidth: '100%',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1
  }
});

const matchCableCategory = (purpose: string | null): CableCategoryKey | null => {
  if (!purpose) {
    return null;
  }

  const normalized = purpose.trim().toLowerCase();
  if (normalized === '') {
    return null;
  }

  if (normalized.startsWith('mv') || normalized.includes('medium voltage')) {
    return 'mv';
  }

  if (normalized.includes('vfd')) {
    return 'vfd';
  }

  if (normalized.startsWith('power') || normalized.includes(' power')) {
    return 'power';
  }

  if (normalized.includes('control')) {
    return 'control';
  }

  return null;
};

export const TrayDetails = () => {
  const styles = useStyles();
  const trayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trayDrawingServiceRef = useRef<TrayDrawingService | null>(null);
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

  const cableBundles: CableBundleMap = useMemo(() => {
    const bundles: CableBundleMap = {};

    for (const cable of nonGroundingCables) {
      const category = matchCableCategory(cable.purpose);
      if (!category) {
        continue;
      }

      const bundleKey = determineCableDiameterGroup(cable.diameterMm ?? null);

      if (!bundles[category]) {
        bundles[category] = {};
      }

      const bucket = bundles[category];
      if (!bucket[bundleKey]) {
        bucket[bundleKey] = [];
      }
      bucket[bundleKey].push(cable);
    }

    return bundles;
  }, [nonGroundingCables]);

  const projectCableSpacingMm = useMemo(() => {
    const spacing = project?.cableLayout?.cableSpacing;
    if (typeof spacing === 'number' && Number.isFinite(spacing) && spacing >= 0) {
      return spacing;
    }
    return DEFAULT_CABLE_SPACING;
  }, [project?.cableLayout?.cableSpacing]);

  const projectLayoutConfig = useMemo<CategoryLayoutConfig>(() => {
    const categories: CableCategoryKey[] = ['power', 'control', 'mv', 'vfd'];
    return categories.reduce<CategoryLayoutConfig>((acc, category) => {
      const defaults = DEFAULT_CATEGORY_SETTINGS[category];
      const layout = project?.cableLayout?.[category] ?? null;
      const trefoil =
        CABLE_CATEGORY_CONFIG[category].showTrefoil
          ? layout?.trefoil ?? defaults.trefoil
          : false;
      const trefoilSpacingBetweenBundles =
        CABLE_CATEGORY_CONFIG[category].allowTrefoilSpacing
          ? layout?.trefoilSpacingBetweenBundles ?? defaults.trefoilSpacingBetweenBundles
          : defaults.trefoilSpacingBetweenBundles;
      const applyPhaseRotation =
        CABLE_CATEGORY_CONFIG[category].allowPhaseRotation
          ? layout?.applyPhaseRotation ?? defaults.applyPhaseRotation
          : defaults.applyPhaseRotation;
      acc[category] = {
        maxRows: layout?.maxRows ?? defaults.maxRows,
        maxColumns: layout?.maxColumns ?? defaults.maxColumns,
        bundleSpacing: layout?.bundleSpacing ?? defaults.bundleSpacing,
        cableSpacing: projectCableSpacingMm,
        trefoil,
        trefoilSpacingBetweenBundles,
        applyPhaseRotation
      };
      return acc;
    }, {} as CategoryLayoutConfig);
  }, [project?.cableLayout, projectCableSpacingMm]);

  const drawTrayVisualization = useCallback(() => {
    const canvasElement = trayCanvasRef.current;
    if (!tray || !canvasElement) {
      return false;
    }

    if (!trayDrawingServiceRef.current) {
      trayDrawingServiceRef.current = new TrayDrawingService();
    }

    try {
      trayDrawingServiceRef.current.drawTrayLayout(
        canvasElement,
        tray,
        nonGroundingCables,
        cableBundles,
        6,
        projectCableSpacingMm,
        projectLayoutConfig
      );
      return true;
    } catch (error) {
      console.error('Failed to render tray visualization', error);
      return false;
    }
  }, [tray, nonGroundingCables, cableBundles, projectCableSpacingMm, projectLayoutConfig]);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 5;
    const timeouts: Array<ReturnType<typeof setTimeout>> = [];

    const scheduleAttempt = () => {
      if (cancelled || attempt >= maxAttempts) {
        return;
      }
      const delay = 150 * (attempt + 1);
      attempt += 1;
      const timeoutId = setTimeout(() => {
        if (!cancelled) {
          if (!drawTrayVisualization()) {
            scheduleAttempt();
          }
        }
      }, delay);
      timeouts.push(timeoutId);
    };

    if (!drawTrayVisualization()) {
      scheduleAttempt();
    }

    return () => {
      cancelled = true;
      for (const timeoutId of timeouts) {
        clearTimeout(timeoutId);
      }
    };
  }, [drawTrayVisualization]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        window.requestAnimationFrame(() => {
          void drawTrayVisualization();
        });
      }
    };

    const handleResize = () => {
      window.requestAnimationFrame(() => {
        void drawTrayVisualization();
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', handleResize);
    };
  }, [drawTrayVisualization]);

  const trayCableCategories = useMemo(() => {
    if (trayCables.length === 0) {
      return [];
    }

    const categories = new Set<CableCategoryKey>();

    for (const cable of trayCables) {
      const category = matchCableCategory(cable.purpose);
      if (category) {
        categories.add(category);
      }
    }

    return CABLE_CATEGORY_ORDER.filter((key) => categories.has(key));
  }, [trayCables]);

  const trayBundleDetails = useMemo(
    () =>
      trayCableCategories.map((key) => {
        const config = CABLE_CATEGORY_CONFIG[key];
        const defaults = DEFAULT_CATEGORY_SETTINGS[key];
        const layout = project?.cableLayout?.[key] ?? null;

        const maxRows = layout?.maxRows ?? defaults.maxRows;
        const maxColumns = layout?.maxColumns ?? defaults.maxColumns;
        const bundleSpacing = layout?.bundleSpacing ?? defaults.bundleSpacing;
        const trefoil = config.showTrefoil
          ? layout?.trefoil ?? defaults.trefoil
          : null;

        return {
          key,
          label: config.label,
          maxRows,
          maxColumns,
          bundleSpacing,
          trefoil
        };
      }),
    [project?.cableLayout, trayCableCategories]
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
      {isEditing ? (
        <TrayEditForm
          formValues={formValues}
          formErrors={formErrors}
          materialsError={materialsError}
          materialTrays={materialTrays}
          canUseMaterialDropdown={canUseMaterialDropdown}
          currentTypeHasMaterial={currentTypeHasMaterial}
          isLoadingMaterials={isLoadingMaterials}
          isSubmitting={isSubmitting}
          onFieldChange={handleFieldChange}
          onTypeSelect={handleTypeSelect}
          onSubmit={handleSubmit}
          onCancel={handleCancelEdit}
          styles={styles}
        />
      ) : (
        <TrayInfoSection
          tray={tray}
          weightDisplay={weightDisplay}
          numberFormatter={numberFormatter}
          styles={styles}
        />
      )}

      {/* Cables Section */}
      <CablesTableSection
        trayCables={nonGroundingCables}
        cablesError={cablesError}
        styles={styles}
        numberFormatter={numberFormatter}
      />

      {/* Support Calculations Section */}
      <SupportCalculationsSection
        supportSectionNeedsSupportData={supportSectionNeedsSupportData}
        materialSupportsLoading={materialSupportsLoading}
        supportDetailsError={supportDetailsError}
        supportDistanceMissing={supportDistanceMissing}
        trayLengthMissing={trayLengthMissing}
        supportTypeDisplay={supportTypeDisplay}
        supportLengthMm={supportLengthMm}
        supportCalculations={supportCalculations}
        formatSupportNumber={formatSupportNumber}
        numberFormatter={numberFormatter}
        styles={styles}
      />

      {/* Tray Own Weight Section */}
      <WeightCalculationsSection
        title="Tray own weight calculations"
        calculations={[
          { label: 'Tray weight load per meter [kg/m]', value: trayWeightLoadPerMeterKg },
          { label: 'Tray total own weight [kg]', value: trayTotalOwnWeightKg }
        ]}
        formatNumber={formatSupportNumber}
        styles={styles}
      />

      {/* Cables Weight Section */}
      <div className={styles.section}>
        <Caption1>Cables on tray weight calculations</Caption1>
        <GroundingCableControls
          includeGroundingCable={includeGroundingCable}
          groundingPreferenceSaving={groundingPreferenceSaving}
          projectCableTypesLoading={projectCableTypesLoading}
          projectCableTypesError={projectCableTypesError}
          groundingCableTypes={groundingCableTypes}
          selectedGroundingCableTypeId={selectedGroundingCableTypeId}
          selectedGroundingCableLabel={selectedGroundingCableLabel}
          groundingCableMissingWeight={groundingCableMissingWeight}
          onToggle={handleGroundingCableToggle}
          onTypeSelect={handleGroundingCableTypeSelect}
          formatCableTypeLabel={formatCableTypeLabel}
          styles={styles}
        />
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
      <WeightCalculationsSection
        title="Total weight calculations"
        calculations={[
          { label: 'Total weight load per meter [kg/m]', value: totalWeightLoadPerMeterKg },
          { label: 'Total weight [kg]', value: totalWeightKg }
        ]}
        formatNumber={formatSupportNumber}
        styles={styles}
      />

      {/* Load Curve Section */}
      <LoadCurveSection
        selectedMaterialTray={selectedMaterialTray}
        safetyFactorPercent={safetyFactorPercent}
        safetyFactorStatusMessage={safetyFactorStatusMessage}
        loadCurveError={loadCurveError}
        selectedLoadCurveId={selectedLoadCurveId}
        loadCurveLoadingId={loadCurveLoadingId}
        selectedLoadCurve={selectedLoadCurve}
        chartLoadCurvePoints={chartLoadCurvePoints}
        chartEvaluation={chartEvaluation}
        chartVerticalLines={chartVerticalLines}
        chartHorizontalLines={chartHorizontalLines}
        chartSummary={chartSummary}
        chartStatusColor={chartStatusColor}
        chartPointSpanDisplay={chartPointSpanDisplay}
        chartPointLoadDisplay={chartPointLoadDisplay}
        numberFormatter={numberFormatter}
        styles={styles}
      />

      <div className={styles.section}>
        <Caption1>Bundle configuration for cables on this tray</Caption1>
        {trayBundleDetails.length === 0 ? (
          <Body1 className={styles.emptyState}>
            {trayCables.length === 0
              ? 'There are no cables on this tray.'
              : 'Bundles configuration is not defined for the cables on this tray.'}
          </Body1>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {trayBundleDetails.map((detail) => (
              <Body1 key={detail.key} style={{ marginBottom: '0.25rem', fontWeight: 'normal' }}>
                {detail.label}<br />
                Current max rows - {numberFormatter.format(detail.maxRows)}{'    '}<br />
                Current max columns - {numberFormatter.format(detail.maxColumns)}{'    '}<br />
                Current space between bundles - {detail.bundleSpacing}{'    '}<br />
                Trefoil - {
                  detail.trefoil === null
                    ? 'Not applicable'
                    : detail.trefoil
                    ? 'Enabled'
                    : 'Disabled'
                }
              </Body1>
            ))}
          </div>
        )}
      </div>

      {/* Tray Canvas Section */}
      <div className={`${styles.section} ${styles.fullWidthSection} ${styles.canvasSection}`}>
        <Caption1>Tray laying concept visualization</Caption1>
        <div className={styles.canvasScroll}>
          <canvas ref={trayCanvasRef} className={styles.trayCanvas} />
        </div>
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
