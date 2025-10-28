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
  Title3,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';
import type { CheckboxOnChangeData } from '@fluentui/react-components';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  Cable,
  Project,
  CableType,
  Tray,
  TrayInput,
  MaterialTray,
  MaterialSupport,
  MaterialLoadCurve,
  fetchProject,
  fetchCables,
  fetchTrays,
  fetchCableTypes,
  fetchTray,
  deleteTray,
  updateTray,
  fetchAllMaterialTrays,
  fetchMaterialSupports,
  fetchMaterialLoadCurve
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { LoadCurveChart } from './Materials/components/LoadCurveChart';

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

type TrayFormState = {
  name: string;
  type: string;
  purpose: string;
  widthMm: string;
  heightMm: string;
  lengthMm: string;
  weightKgPerM: string;
};

type TrayFormErrors = Partial<Record<keyof TrayFormState, string>>;

type SupportCalculationResult = {
  lengthMeters: number | null;
  distanceMeters: number | null;
  supportsCount: number | null;
  weightPerPieceKg: number | null;
  totalWeightKg: number | null;
  weightPerMeterKg: number | null;
};

type LoadCurveChartStatus =
  | 'no-curve'
  | 'loading'
  | 'awaiting-data'
  | 'no-points'
  | 'ok'
  | 'too-long'
  | 'too-short'
  | 'load-too-high';

const toTrayFormState = (tray: Tray): TrayFormState => ({
  name: tray.name,
  type: tray.type ?? '',
  purpose: tray.purpose ?? '',
  widthMm: tray.widthMm !== null ? String(tray.widthMm) : '',
  heightMm: tray.heightMm !== null ? String(tray.heightMm) : '',
  lengthMm: tray.lengthMm !== null ? String(tray.lengthMm) : '',
  weightKgPerM: ''
});

const parseNumberInput = (value: string): { numeric: number | null; error?: string } => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { numeric: null };
  }
  const normalised = trimmed.replace(',', '.');
  const parsed = Number(normalised);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { numeric: null, error: 'Enter a valid non-negative number' };
  }
  return { numeric: parsed };
};

const KN_PER_KG = 9.80665 / 1000;
const FLOAT_TOLERANCE = 1e-6;

const toNullableString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const routingContainsTray = (routing: string | null, trayName: string): boolean => {
  if (!routing) {
    return false;
  }

  const target = trayName.trim().toLowerCase();
  if (!target) {
    return false;
  }

  return routing
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .some((segment) => segment === target);
};

const filterCablesByTray = (cables: Cable[], trayName: string): Cable[] =>
  cables.filter((cable) => routingContainsTray(cable.routing, trayName));

const isGroundingPurpose = (purpose: string | null): boolean =>
  purpose !== null && purpose.trim().toLowerCase() === 'grounding';

export const TrayDetails = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { projectId, trayId } = useParams<{ projectId: string; trayId: string }>();
  const { user, token } = useAuth();
  const { showToast } = useToast();

  const isAdmin = Boolean(user?.isAdmin);

  const [project, setProject] = useState<Project | null>(null);
  const [tray, setTray] = useState<Tray | null>(null);
  const [trays, setTrays] = useState<Tray[]>([]);
  const [trayCables, setTrayCables] = useState<Cable[]>([]);
  const [projectCableTypes, setProjectCableTypes] = useState<CableType[]>([]);
  const [projectCableTypesLoading, setProjectCableTypesLoading] = useState<boolean>(false);
  const [projectCableTypesError, setProjectCableTypesError] = useState<string | null>(null);
  type GroundingSelection = { include: boolean; typeId: string | null };
  const [groundingSelectionsByTrayId, setGroundingSelectionsByTrayId] = useState<
    Record<string, GroundingSelection>
  >({});
  const [groundingPreferenceSaving, setGroundingPreferenceSaving] = useState<boolean>(false);
  const [cablesError, setCablesError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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

  const [materialTrays, setMaterialTrays] = useState<MaterialTray[]>([]);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState<boolean>(false);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [materialSupportsById, setMaterialSupportsById] = useState<Record<string, MaterialSupport>>({});
  const [materialSupportsLoading, setMaterialSupportsLoading] = useState<boolean>(false);
  const [materialSupportsError, setMaterialSupportsError] = useState<string | null>(null);
  const [materialSupportsLoaded, setMaterialSupportsLoaded] = useState<boolean>(false);
  const [loadCurvesById, setLoadCurvesById] = useState<Record<string, MaterialLoadCurve>>({});
  const [loadCurveLoadingId, setLoadCurveLoadingId] = useState<string | null>(null);
  const [loadCurveError, setLoadCurveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadSupports = async () => {
      setMaterialSupportsLoading(true);
      setMaterialSupportsError(null);

      try {
        const loaded: MaterialSupport[] = [];
        let page = 1;
        const PAGE_SIZE = 100;

        while (true) {
          const { supports: pageSupports, pagination } = await fetchMaterialSupports({
            page,
            pageSize: PAGE_SIZE
          });

          loaded.push(...pageSupports);

          if (!pagination || pagination.totalPages === 0 || page >= pagination.totalPages) {
            break;
          }

          page += 1;
        }

        if (!cancelled) {
          setMaterialSupportsById((previous) => {
            const next = { ...previous };
            loaded.forEach((support) => {
              next[support.id] = support;
            });
            return next;
          });
          setMaterialSupportsLoaded(true);
        }
      } catch (error) {
        console.error('Failed to load supports', error);
        if (!cancelled) {
          setMaterialSupportsError('Failed to load support details.');
          setMaterialSupportsLoaded(true);
        }
      } finally {
        if (!cancelled) {
          setMaterialSupportsLoading(false);
        }
      }
    };

    void loadSupports();

    return () => {
      cancelled = true;
    };
  }, []);

  const sortTrays = useCallback(
    (items: Tray[]) =>
      [...items].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      ),
    []
  );

  useEffect(() => {
    const loadMaterialTrays = async () => {
      setIsLoadingMaterials(true);
      setMaterialsError(null);
      try {
        const result = await fetchAllMaterialTrays();
        const sorted = [...result.trays].sort((a, b) =>
          a.type.localeCompare(b.type, undefined, { sensitivity: 'base' })
        );
        setMaterialTrays(sorted);
      } catch (err) {
        console.error('Fetch material trays failed', err);
        setMaterialsError('Failed to load tray types. Width, height, and weight cannot be updated automatically.');
      } finally {
        setIsLoadingMaterials(false);
      }
    };

    void loadMaterialTrays();
  }, []);

  useEffect(() => {
    if (!projectId) {
      setProjectCableTypes([]);
      setProjectCableTypesError(null);
      setProjectCableTypesLoading(false);
      return;
    }

    let cancelled = false;

    const loadCableTypes = async () => {
      setProjectCableTypesLoading(true);
      setProjectCableTypesError(null);

      try {
        const response = await fetchCableTypes(projectId);
        const sorted = [...response.cableTypes].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        );

        if (!cancelled) {
          setProjectCableTypes(sorted);
        }
      } catch (err) {
        console.error('Failed to load project cable types', err);
        if (!cancelled) {
          setProjectCableTypes([]);
          setProjectCableTypesError('Failed to load project cable types.');
        }
      } finally {
        if (!cancelled) {
          setProjectCableTypesLoading(false);
        }
      }
    };

    void loadCableTypes();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    setGroundingSelectionsByTrayId((previous) =>
      Object.keys(previous).length > 0 ? {} : previous
    );
  }, [projectId]);

  const currentGroundingPreference =
    trayId && groundingSelectionsByTrayId[trayId]
      ? groundingSelectionsByTrayId[trayId]
      : null;

  const includeGroundingCable = currentGroundingPreference?.include ?? false;
  const selectedGroundingCableTypeId = currentGroundingPreference?.typeId ?? null;

  const groundingCableTypes = useMemo(
    () =>
      projectCableTypes.filter((type) => {
        const purpose = type.purpose?.trim().toLowerCase();
        return purpose === 'grounding';
      }),
    [projectCableTypes]
  );

  const persistGroundingPreference = useCallback(
    async (
      previousPreference: GroundingSelection | null,
      nextPreference: GroundingSelection
    ) => {
      if (!trayId) {
        return;
      }

      if (!projectId || !token) {
        setGroundingSelectionsByTrayId((previous) => {
          if (!previousPreference) {
            const { [trayId]: _omit, ...rest } = previous;
            return rest;
          }
          return {
            ...previous,
            [trayId]: previousPreference
          };
        });
        if (!token) {
          return;
        }
        showToast({
          intent: 'error',
          title: 'Unable to save grounding cable setting',
          body: 'Missing project information.'
        });
        return;
      }

      setGroundingPreferenceSaving(true);

      try {
        const response = await updateTray(token, projectId, trayId, {
          includeGroundingCable: nextPreference.include,
          groundingCableTypeId: nextPreference.typeId ?? null
        });

        setTray(response.tray);
        setTrays((previous) => {
          const hasTray = previous.some((item) => item.id === response.tray.id);
          if (!hasTray) {
            return previous;
          }
          return previous.map((item) =>
            item.id === response.tray.id ? response.tray : item
          );
        });
        setGroundingSelectionsByTrayId((previous) => ({
          ...previous,
          [trayId]: {
            include: response.tray.includeGroundingCable,
            typeId: response.tray.groundingCableTypeId
          }
        }));
      } catch (error) {
        console.error('Failed to save grounding cable preference', error);
        setGroundingSelectionsByTrayId((previous) => {
          if (!previousPreference) {
            const { [trayId]: _omit, ...rest } = previous;
            return rest;
          }
          return {
            ...previous,
            [trayId]: previousPreference
          };
        });
        showToast({
          intent: 'error',
          title: 'Failed to save grounding cable setting',
          body: 'Please try again.'
        });
      } finally {
        setGroundingPreferenceSaving(false);
      }
    },
    [projectId, trayId, token, showToast, updateTray]
  );

  useEffect(() => {
    if (!trayId || !includeGroundingCable) {
      return;
    }

    if (groundingPreferenceSaving) {
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

    const nextPreference: GroundingSelection = {
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
    persistGroundingPreference
  ]);

  const formatDimensionValue = useCallback(
    (value: number | null | undefined) =>
      value === null || value === undefined || Number.isNaN(value) ? '' : String(value),
    []
  );

  const formatWeightValue = useCallback(
    (value: number | null | undefined) =>
      value === null || value === undefined || Number.isNaN(value) ? '' : value.toFixed(3),
    []
  );

  const findMaterialTrayByType = useCallback(
    (type: string) => {
      const normalised = type.trim().toLowerCase();
      if (!normalised) {
        return null;
      }
      return (
        materialTrays.find(
          (item) => item.type.trim().toLowerCase() === normalised
        ) ?? null
      );
    },
    [materialTrays]
  );

  const selectedMaterialTray = useMemo(
    () => findMaterialTrayByType(formValues.type),
    [findMaterialTrayByType, formValues.type]
  );

  const selectedLoadCurveId = selectedMaterialTray?.loadCurveId ?? null;
  const selectedLoadCurve =
    selectedLoadCurveId && loadCurvesById[selectedLoadCurveId]
      ? loadCurvesById[selectedLoadCurveId]
      : null;

  useEffect(() => {
    if (!selectedLoadCurveId) {
      setLoadCurveLoadingId(null);
      setLoadCurveError(null);
      return;
    }

    if (loadCurvesById[selectedLoadCurveId]) {
      setLoadCurveLoadingId(null);
      return;
    }

    let cancelled = false;
    setLoadCurveLoadingId(selectedLoadCurveId);
    setLoadCurveError(null);

    const load = async () => {
      try {
        const response = await fetchMaterialLoadCurve(selectedLoadCurveId);
        if (!cancelled) {
          setLoadCurvesById((previous) => ({
            ...previous,
            [selectedLoadCurveId]: response.loadCurve
          }));
        }
      } catch (err) {
        console.error('Failed to load material load curve', err);
        if (!cancelled) {
          setLoadCurveError('Failed to load tray load curve.');
        }
      } finally {
        if (!cancelled) {
          setLoadCurveLoadingId(null);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [selectedLoadCurveId, loadCurvesById]);

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
  }, [
    selectedMaterialTray,
    isEditing,
    formatDimensionValue,
    formatWeightValue
  ]);

  useEffect(() => {
    const load = async () => {
      if (!projectId || !trayId) {
        setError('Tray not found.');
        setTrayCables([]);
        setTrays([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      setTrayCables([]);
      setCablesError(null);

      try {
        const [projectResponse, trayResponse] = await Promise.all([
          fetchProject(projectId),
          fetchTray(projectId, trayId)
        ]);

        setProject(projectResponse.project);
        setTray(trayResponse.tray);
        setFormValues(toTrayFormState(trayResponse.tray));
        setGroundingSelectionsByTrayId((previous) => ({
          ...previous,
          [trayResponse.tray.id]: {
            include: trayResponse.tray.includeGroundingCable,
            typeId: trayResponse.tray.groundingCableTypeId
          }
        }));
        setIsEditing(false);
        setFormErrors({});

        try {
          const cablesResponse = await fetchCables(projectId);
          setTrayCables(
            filterCablesByTray(cablesResponse.cables, trayResponse.tray.name)
          );
        } catch (cableError) {
          console.error('Failed to load tray cables', cableError);
          setCablesError('Failed to load cables for this tray.');
        }
      } catch (err) {
        console.error('Failed to load tray details', err);
        if (err instanceof ApiError && err.status === 404) {
          setError('Tray not found.');
        } else {
          setError('Failed to load tray details.');
        }
        setTrayCables([]);
        setTrays([]);
        setIsLoading(false);
        return;
      }

      try {
        const traysResponse = await fetchTrays(projectId);
        setTrays(sortTrays(traysResponse.trays));
      } catch (err) {
        console.error('Failed to load trays for navigation', err);
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [projectId, trayId, sortTrays]);

  const pageTitle = useMemo(() => {
    if (!tray) {
      return 'Tray details';
    }
    return `Tray - ${tray.name}`;
  }, [tray]);

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
      nextTray:
        currentIndex < trays.length - 1 ? trays[currentIndex + 1] : null
    };
  }, [tray, trays]);

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 3
      }),
    []
  );

  const formatCableTypeLabel = useCallback(
    (type: CableType) => {
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

  const nonGroundingCables = useMemo(
    () => trayCables.filter((cable) => !isGroundingPurpose(cable.purpose)),
    [trayCables]
  );

  const cablesForWeightCalculation = useMemo(() => {
    return nonGroundingCables.filter((cable) => {
      const weight = cable.weightKgPerM;
      return weight !== null && !Number.isNaN(weight);
    });
  }, [nonGroundingCables]);

  const selectedGroundingCableType = useMemo(() => {
    if (!selectedGroundingCableTypeId) {
      return null;
    }

    return (
      groundingCableTypes.find((type) => type.id === selectedGroundingCableTypeId) ?? null
    );
  }, [groundingCableTypes, selectedGroundingCableTypeId]);

  const selectedGroundingCableLabel = useMemo(
    () =>
      selectedGroundingCableType
        ? formatCableTypeLabel(selectedGroundingCableType)
        : undefined,
    [selectedGroundingCableType, formatCableTypeLabel]
  );

  const groundingCableWeightKgPerM = useMemo(() => {
    if (!includeGroundingCable || !selectedGroundingCableType) {
      return null;
    }

    const weight = selectedGroundingCableType.weightKgPerM;
    return weight !== null && !Number.isNaN(weight) ? weight : null;
  }, [includeGroundingCable, selectedGroundingCableType]);

  const cablesWeightLoadPerMeterKg = useMemo(() => {
    let total = 0;
    let hasWeightData = false;

    for (const cable of cablesForWeightCalculation) {
      const weight = cable.weightKgPerM;
      if (weight !== null && !Number.isNaN(weight)) {
        total += weight;
        hasWeightData = true;
      }
    }

    if (groundingCableWeightKgPerM !== null) {
      total += groundingCableWeightKgPerM;
      hasWeightData = true;
    }

    return hasWeightData ? total : null;
  }, [cablesForWeightCalculation, groundingCableWeightKgPerM]);

  const hasGroundingCableWeightData = groundingCableWeightKgPerM !== null;
  const groundingCableMissingWeight =
    includeGroundingCable && selectedGroundingCableType !== null && !hasGroundingCableWeightData;

  const supportOverride = useMemo(() => {
    if (!project || !tray || !tray.type) {
      return null;
    }
    return project.supportDistanceOverrides[tray.type] ?? null;
  }, [project, tray]);

  const supportIdToLoad = supportOverride?.supportId ?? null;

  const overrideSupport =
    supportIdToLoad && materialSupportsById[supportIdToLoad]
      ? materialSupportsById[supportIdToLoad]
      : null;

  const supportCalculations = useMemo<SupportCalculationResult>(() => {
    const lengthMeters =
      tray && tray.lengthMm !== null && tray.lengthMm > 0
        ? tray.lengthMm / 1000
        : null;

    const overrideDistance =
      supportOverride && supportOverride.distance !== null
        ? supportOverride.distance
        : null;

    let distanceMeters =
      overrideDistance ??
      (project && project.supportDistance !== null ? project.supportDistance : null);

    if (
      (distanceMeters === null || distanceMeters === undefined || distanceMeters <= 0) &&
      tray?.type
    ) {
      if (tray.type.trim().toLowerCase() === 'kl 100.603 f') {
        distanceMeters = 2;
      }
    }

    if (distanceMeters !== null && distanceMeters <= 0) {
      distanceMeters = null;
    }

    const weightPerPieceOverride =
      overrideSupport && overrideSupport.weightKg !== null
        ? overrideSupport.weightKg
        : null;

    const weightPerPieceKg =
      weightPerPieceOverride !== null
        ? weightPerPieceOverride
        : project && project.supportWeight !== null
        ? project.supportWeight
        : null;

    if (lengthMeters === null || lengthMeters <= 0 || distanceMeters === null) {
      return {
        lengthMeters,
        distanceMeters,
        supportsCount: null,
        weightPerPieceKg,
        totalWeightKg: null,
        weightPerMeterKg: null
      };
    }

    const baseSegments = Math.floor(lengthMeters / distanceMeters);
    let supportsCount = Math.max(2, baseSegments + 1);
    const remainder = lengthMeters - baseSegments * distanceMeters;

    if (baseSegments >= 1 && remainder > distanceMeters * 0.2) {
      supportsCount += 1;
    }

    const totalWeightKg =
      weightPerPieceKg !== null ? supportsCount * weightPerPieceKg : null;

    const weightPerMeterKg =
      totalWeightKg !== null && lengthMeters > 0
        ? totalWeightKg / lengthMeters
        : null;

    return {
      lengthMeters,
      distanceMeters,
      supportsCount,
      weightPerPieceKg,
      totalWeightKg,
      weightPerMeterKg
    };
  }, [project, tray, supportOverride, overrideSupport]);

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

  const supportWeightPerMeterKg = supportCalculations.weightPerMeterKg;
  const trayLengthMeters = supportCalculations.lengthMeters;

  const trayWeightLoadPerMeterKg = useMemo(() => {
    if (trayWeightPerMeterKg === null || supportWeightPerMeterKg === null) {
      return null;
    }

    return trayWeightPerMeterKg + supportWeightPerMeterKg;
  }, [trayWeightPerMeterKg, supportWeightPerMeterKg]);

  const trayTotalOwnWeightKg = useMemo(() => {
    if (
      trayWeightLoadPerMeterKg === null ||
      trayLengthMeters === null ||
      trayLengthMeters <= 0
    ) {
      return null;
    }

    return trayWeightLoadPerMeterKg * trayLengthMeters;
  }, [trayWeightLoadPerMeterKg, trayLengthMeters]);

  const cablesTotalWeightKg = useMemo(() => {
    if (
      cablesWeightLoadPerMeterKg === null ||
      trayLengthMeters === null ||
      trayLengthMeters <= 0
    ) {
      return null;
    }

    return cablesWeightLoadPerMeterKg * trayLengthMeters;
  }, [cablesWeightLoadPerMeterKg, trayLengthMeters]);

  const totalWeightLoadPerMeterKg = useMemo(() => {
    if (trayWeightLoadPerMeterKg === null || cablesWeightLoadPerMeterKg === null) {
      return null;
    }

    return trayWeightLoadPerMeterKg + cablesWeightLoadPerMeterKg;
  }, [trayWeightLoadPerMeterKg, cablesWeightLoadPerMeterKg]);

  const totalWeightKg = useMemo(() => {
    if (trayTotalOwnWeightKg === null || cablesTotalWeightKg === null) {
      return null;
    }

    return trayTotalOwnWeightKg + cablesTotalWeightKg;
  }, [trayTotalOwnWeightKg, cablesTotalWeightKg]);

  const safetyFactorPercent = project?.trayLoadSafetyFactor ?? null;
  const safetyFactorMissing =
    project !== null && project.trayLoadSafetyFactor === null;
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

  const totalWeightLoadPerMeterKn = useMemo(() => {
    if (totalWeightLoadPerMeterKg === null) {
      return null;
    }
    return totalWeightLoadPerMeterKg * KN_PER_KG;
  }, [totalWeightLoadPerMeterKg]);

  const safetyAdjustedLoadKnPerM = useMemo(() => {
    if (totalWeightLoadPerMeterKn === null || safetyFactorMultiplier === null) {
      return null;
    }
    return totalWeightLoadPerMeterKn * safetyFactorMultiplier;
  }, [totalWeightLoadPerMeterKn, safetyFactorMultiplier]);

  const chartSpanMeters = supportCalculations.distanceMeters;
  const chartLoadCurvePoints = selectedLoadCurve?.points ?? [];

  const chartEvaluation = useMemo(() => {
    if (!selectedLoadCurveId) {
      return {
        status: 'no-curve' as LoadCurveChartStatus,
        message: 'The selected tray type is not linked to a load curve.',
        marker: null,
        limitHighlight: null,
        minSpan: null,
        maxSpan: null,
        allowableLoadAtSpan: null
      };
    }

    if (!selectedLoadCurve) {
      return {
        status: 'loading' as LoadCurveChartStatus,
        message: 'Loading load curve...',
        marker: null,
        limitHighlight: null,
        minSpan: null,
        maxSpan: null,
        allowableLoadAtSpan: null
      };
    }

    if (chartLoadCurvePoints.length === 0) {
      return {
        status: 'no-points' as LoadCurveChartStatus,
        message: 'The assigned load curve has no data points.',
        marker: null,
        limitHighlight: null,
        minSpan: null,
        maxSpan: null,
        allowableLoadAtSpan: null
      };
    }

    const sortedPoints = [...chartLoadCurvePoints].sort((a, b) => a.spanM - b.spanM);
    const minSpan = sortedPoints[0].spanM;
    const maxSpan = sortedPoints[sortedPoints.length - 1].spanM;
    const maxLoad = sortedPoints.reduce(
      (currentMax, point) => Math.max(currentMax, point.loadKnPerM),
      Number.NEGATIVE_INFINITY
    );

    const computeLoadAtSpan = (span: number): number | null => {
      if (span <= sortedPoints[0].spanM + FLOAT_TOLERANCE) {
        return sortedPoints[0].loadKnPerM;
      }

      for (let index = 1; index < sortedPoints.length; index += 1) {
        const previous = sortedPoints[index - 1];
        const current = sortedPoints[index];

        if (span <= current.spanM + FLOAT_TOLERANCE) {
          const spanDelta = current.spanM - previous.spanM;
          if (Math.abs(spanDelta) <= FLOAT_TOLERANCE) {
            return current.loadKnPerM;
          }
          const ratio = (span - previous.spanM) / spanDelta;
          return previous.loadKnPerM + ratio * (current.loadKnPerM - previous.loadKnPerM);
        }
      }

      return sortedPoints[sortedPoints.length - 1].loadKnPerM;
    };

    const computeMaxSpanForLoad = (
      targetLoad: number
    ): { span: number; load: number } | null => {
      if (targetLoad > maxLoad + FLOAT_TOLERANCE) {
        return { span: minSpan, load: sortedPoints[0].loadKnPerM };
      }

      for (let index = 1; index < sortedPoints.length; index += 1) {
        const previous = sortedPoints[index - 1];
        const current = sortedPoints[index];
        const prevLoad = previous.loadKnPerM;
        const currLoad = current.loadKnPerM;

        const crosses =
          (prevLoad >= targetLoad && currLoad <= targetLoad) ||
          (prevLoad <= targetLoad && currLoad >= targetLoad);

        if (!crosses) {
          continue;
        }

        const loadDelta = currLoad - prevLoad;
        if (Math.abs(loadDelta) <= FLOAT_TOLERANCE) {
          return { span: current.spanM, load: currLoad };
        }

        const ratio = (targetLoad - prevLoad) / loadDelta;
        const span = previous.spanM + ratio * (current.spanM - previous.spanM);
        return { span, load: targetLoad };
      }

      return { span: maxSpan, load: sortedPoints[sortedPoints.length - 1].loadKnPerM };
    };

    if (safetyFactorMultiplier === null) {
      return {
        status: 'awaiting-data' as LoadCurveChartStatus,
        message:
          safetyFactorStatusMessage ??
          'Set a safety factor in Project details to evaluate the load curve.',
        marker: null,
        limitHighlight: null,
        minSpan,
        maxSpan,
        allowableLoadAtSpan: null
      };
    }

    if (chartSpanMeters === null || safetyAdjustedLoadKnPerM === null) {
      return {
        status: 'awaiting-data' as LoadCurveChartStatus,
        message: 'Provide tray weight and support spacing data to plot the point.',
        marker: null,
        limitHighlight: null,
        minSpan,
        maxSpan,
        allowableLoadAtSpan: null
      };
    }

    const maxSpanForLoad = computeMaxSpanForLoad(safetyAdjustedLoadKnPerM);
    const allowableLoadAtSpan = computeLoadAtSpan(chartSpanMeters);

    let status: LoadCurveChartStatus = 'ok';
    let message = 'Support spacing is within the load curve limits.';
    let highlight: { span: number; load: number; type: 'min' | 'max'; label: string } | null =
      maxSpanForLoad
        ? {
            span: maxSpanForLoad.span,
            load: maxSpanForLoad.load,
            type: 'max',
            label: 'Max allowable span'
          }
        : null;

    if (safetyAdjustedLoadKnPerM > maxLoad + FLOAT_TOLERANCE) {
      status = 'load-too-high';
      message = 'Calculated load exceeds the maximum load defined by the curve.';
      highlight = {
        span: minSpan,
        load: sortedPoints[0].loadKnPerM,
        type: 'max',
        label: 'Max allowable span'
      };
    } else if (chartSpanMeters < minSpan - FLOAT_TOLERANCE) {
      status = 'too-short';
      message = 'Support spacing is below the minimum span covered by the curve.';
      highlight = {
        span: minSpan,
        load: sortedPoints[0].loadKnPerM,
        type: 'min',
        label: 'Min allowable span'
      };
    } else if (maxSpanForLoad && chartSpanMeters > maxSpanForLoad.span + FLOAT_TOLERANCE) {
      status = 'too-long';
      message = 'Support spacing exceeds the allowable span for the calculated load.';
      highlight = {
        span: maxSpanForLoad.span,
        load: maxSpanForLoad.load,
        type: 'max',
        label: 'Max allowable span'
      };
    }

    const markerColor =
      status === 'ok'
        ? tokens.colorPaletteGreenForeground1
        : status === 'too-short'
        ? tokens.colorPaletteMarigoldForeground2
        : tokens.colorPaletteRedForeground1;

    const marker =
      chartSpanMeters !== null && safetyAdjustedLoadKnPerM !== null
        ? {
            span: chartSpanMeters,
            load: safetyAdjustedLoadKnPerM,
            color: markerColor,
            label: 'Calculated point'
          }
        : null;

    return {
      status,
      message,
      marker,
      limitHighlight: highlight,
      minSpan,
      maxSpan,
      
      allowableLoadAtSpan
    };
  }, [
    selectedLoadCurveId,
    selectedLoadCurve,
    chartLoadCurvePoints,
    chartSpanMeters,
    safetyAdjustedLoadKnPerM,
    safetyFactorMultiplier,
    safetyFactorStatusMessage
  ]);

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
  }, [chartEvaluation.allowableLoadAtSpan, chartEvaluation.marker, chartSpanMeters]);

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

  const formatSupportNumber = useCallback(
    (value: number | null) =>
      value === null || Number.isNaN(value) ? '-' : numberFormatter.format(value),
    [numberFormatter]
  );

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

  const handleNavigateTray = useCallback(
    (targetTrayId: string) => {
      if (!projectId) {
        return;
      }

      navigate(`/projects/${projectId}/trays/${targetTrayId}`);
    },
    [navigate, projectId]
  );

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
    [
      findMaterialTrayByType,
      formatDimensionValue,
      formatWeightValue
    ]
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
        if (
          !nextTypeId ||
          !groundingCableTypes.some((type) => type.id === nextTypeId)
        ) {
          nextTypeId = groundingCableTypes[0]?.id ?? null;
        }
      }

      const nextPreference: GroundingSelection = {
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
      showToast
    ]
  );

  const handleGroundingCableTypeSelect = useCallback(
    (_event: unknown, data: { optionValue?: string }) => {
      if (!trayId || groundingPreferenceSaving) {
        return;
      }

      const nextTypeId = data.optionValue ?? null;
      if (!nextTypeId) {
        return;
      }

      if (!groundingCableTypes.some((type) => type.id === nextTypeId)) {
        return;
      }

      const previousPreference = currentGroundingPreference;
      const nextPreference: GroundingSelection = {
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
      persistGroundingPreference
    ]
  );

  const buildTrayInput = (values: TrayFormState) => {
    const errors: TrayFormErrors = {};

    const name = values.name.trim();
    if (name === '') {
      errors.name = 'Name is required';
    }

    const widthResult = parseNumberInput(values.widthMm);
    if (widthResult.error) {
      errors.widthMm = widthResult.error;
    }

    const heightResult = parseNumberInput(values.heightMm);
    if (heightResult.error) {
      errors.heightMm = heightResult.error;
    }

    const lengthResult = parseNumberInput(values.lengthMm);
    if (lengthResult.error) {
      errors.lengthMm = lengthResult.error;
    }

    const input: TrayInput = {
      name,
      type: toNullableString(values.type),
      purpose: toNullableString(values.purpose),
      widthMm: widthResult.numeric,
      heightMm: heightResult.numeric,
      lengthMm: lengthResult.numeric
    };

    return { input, errors };
  };

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
        const nextTrays = hasTray
          ? previous.map((item) =>
              item.id === response.tray.id ? response.tray : item
            )
          : [...previous, response.tray];
        return sortTrays(nextTrays);
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

  const canUseMaterialDropdown = !isLoadingMaterials && materialTrays.length > 0;
  const weightDisplay =
    formValues.weightKgPerM !== ''
      ? formValues.weightKgPerM
      : formatWeightValue(selectedMaterialTray?.weightKgPerM) || '-';
  const currentTypeHasMaterial = Boolean(
    formValues.type && findMaterialTrayByType(formValues.type)
  );

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
      <div className={styles.header}>
        <Title3>{pageTitle}</Title3>
        {project ? (
          <Body1>
            Project: {project.projectNumber} - {project.name}
          </Body1>
        ) : null}
      </div>

      <div className={styles.actions}>
        <Button
          appearance="secondary"
          onClick={() =>
            previousTray && handleNavigateTray(previousTray.id)
          }
          disabled={!previousTray}
        >
          Previous tray
        </Button>
        <Button
          appearance="secondary"
          onClick={() => nextTray && handleNavigateTray(nextTray.id)}
          disabled={!nextTray}
        >
          Next tray
        </Button>
        <Button onClick={() => navigate(`/projects/${projectId}?tab=trays`)}>
          Back to project
        </Button>
        {isAdmin ? (
          <>
            {!isEditing ? (
              <Button appearance="primary" onClick={() => setIsEditing(true)}>
                Edit tray
              </Button>
            ) : null}
            <Button
              appearance="secondary"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete tray'}
            </Button>
          </>
        ) : null}
      </div>

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
                  selectedOptions={
                    formValues.type ? [formValues.type] : []
                  }
                  value={formValues.type || undefined}
                  onOptionSelect={handleTypeSelect}
                >
                  {materialTrays.map((material) => (
                    <Option key={material.id} value={material.type}>
                      {material.type}
                    </Option>
                  ))}
                  {!currentTypeHasMaterial && formValues.type ? (
                    <Option value={formValues.type}>{formValues.type}</Option>
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
              label="Length"
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
                {tray.widthMm !== null
                  ? new Intl.NumberFormat(undefined, {
                      maximumFractionDigits: 3
                    }).format(tray.widthMm)
                  : '-'}
              </Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Height [mm]</Caption1>
              <Body1>
                {tray.heightMm !== null
                  ? new Intl.NumberFormat(undefined, {
                      maximumFractionDigits: 3
                    }).format(tray.heightMm)
                  : '-'}
              </Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Weight [kg/m]</Caption1>
              <Body1>{weightDisplay}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Length</Caption1>
              <Body1>
                {tray.lengthMm !== null
                  ? new Intl.NumberFormat(undefined, {
                      maximumFractionDigits: 3
                    }).format(tray.lengthMm)
                  : '-'}
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
      <div className={styles.section}>
        <Caption1>Cables laying on the tray</Caption1>
        {cablesError ? (
          <Body1 className={styles.errorText}>{cablesError}</Body1>
        ) : trayCables.length === 0 ? (
          <Body1 className={styles.emptyState}>No cables found on this tray.</Body1>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" className={styles.tableHeadCell}>
                    No.
                  </th>
                  <th scope="col" className={styles.tableHeadCell}>
                    Cable name
                  </th>
                  <th scope="col" className={styles.tableHeadCell}>
                    Cable type
                  </th>
                  <th scope="col" className={styles.tableHeadCell}>
                    Cable diameter [mm]
                  </th>
                  <th scope="col" className={styles.tableHeadCell}>
                    Cable weight [kg/m]
                  </th>
                </tr>
              </thead>
              <tbody>
                {trayCables.map((cable, index) => (
                  <tr key={cable.id}>
                    <td className={styles.tableCell}>{index + 1}</td>
                    <td className={styles.tableCell}>{cable.tag ?? '-'}</td>
                    <td className={styles.tableCell}>{cable.typeName}</td>
                    <td className={styles.tableCell}>
                      {cable.diameterMm !== null ? numberFormatter.format(cable.diameterMm) : '-'}
                    </td>
                    <td className={styles.tableCell}>
                      {cable.weightKgPerM !== null
                        ? numberFormatter.format(cable.weightKgPerM)
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
              {supportLengthMm !== null
                ? numberFormatter.format(supportLengthMm)
                : '-'}
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
                {groundingCableTypes.map((type) => {
                  const label = formatCableTypeLabel(type);
                  return (
                    <Option key={type.id} value={type.id}>
                      {label}
                    </Option>
                  );
                })}
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
                <Caption1>Point for chart - Span (m)</Caption1>
                <Body1>{chartPointSpanDisplay}</Body1>
              </div>
              <div className={styles.field}>
                <Caption1>Point for chart - Load (kN/m)</Caption1>
                <Body1>{chartPointLoadDisplay}</Body1>
              </div>
              {chartEvaluation.limitHighlight ? (
                <div className={styles.field}>
                  <Caption1>
                    {chartEvaluation.limitHighlight.type === 'min'
                      ? 'Minimum allowable span (m)'
                      : 'Max allowable span (m)'}
                  </Caption1>
                  <Body1>{numberFormatter.format(chartEvaluation.limitHighlight.span)}</Body1>
                </div>
              ) : null}
              {chartEvaluation.allowableLoadAtSpan !== null ? (
                <div className={styles.field}>
                  <Caption1>Load limit at span [kN/m]</Caption1>
                  <Body1>{numberFormatter.format(chartEvaluation.allowableLoadAtSpan)}</Body1>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
};
