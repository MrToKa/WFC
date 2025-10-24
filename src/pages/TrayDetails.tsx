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
  Tray,
  TrayInput,
  MaterialTray,
  MaterialSupport,
  fetchProject,
  fetchCables,
  fetchTrays,
  fetchTray,
  deleteTray,
  updateTray,
  fetchAllMaterialTrays,
  fetchMaterialSupports
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

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

const getCableDisplayName = (cable: Cable): string => {
  const tag = cable.tag?.trim();
  if (tag) {
    return tag;
  }

  return cable.typeName;
};

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
  const [includeGroundingCables, setIncludeGroundingCables] =
    useState<boolean>(false);
  const [selectedGroundingCableId, setSelectedGroundingCableId] =
    useState<string | null>(null);
  const [groundingCableOptions, setGroundingCableOptions] = useState<Cable[]>([]);
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
      setGroundingCableOptions([]);
      setCablesError(null);

      try {
        const [projectResponse, trayResponse] = await Promise.all([
          fetchProject(projectId),
          fetchTray(projectId, trayId)
        ]);

        setProject(projectResponse.project);
        setTray(trayResponse.tray);
        setFormValues(toTrayFormState(trayResponse.tray));
        setIsEditing(false);
        setFormErrors({});

        try {
          const cablesResponse = await fetchCables(projectId);
          setGroundingCableOptions(
            cablesResponse.cables.filter((cable) => isGroundingPurpose(cable.purpose))
          );
          setTrayCables(
            filterCablesByTray(cablesResponse.cables, trayResponse.tray.name)
          );
        } catch (cableError) {
          console.error('Failed to load tray cables', cableError);
          setGroundingCableOptions([]);
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

  const nonGroundingCables = useMemo(
    () => trayCables.filter((cable) => !isGroundingPurpose(cable.purpose)),
    [trayCables]
  );

  useEffect(() => {
    if (!includeGroundingCables) {
      setSelectedGroundingCableId(null);
      return;
    }

    if (groundingCableOptions.length === 0) {
      setSelectedGroundingCableId(null);
      return;
    }

    setSelectedGroundingCableId((previous) => {
      if (
        previous &&
        groundingCableOptions.some((cable) => cable.id === previous)
      ) {
        return previous;
      }
      return groundingCableOptions[0]?.id ?? null;
    });
  }, [includeGroundingCables, groundingCableOptions]);

  const selectedGroundingCable = useMemo(() => {
    if (!includeGroundingCables || !selectedGroundingCableId) {
      return null;
    }

    return (
      groundingCableOptions.find(
        (cable) => cable.id === selectedGroundingCableId
      ) ?? null
    );
  }, [groundingCableOptions, includeGroundingCables, selectedGroundingCableId]);

  const cablesForWeightCalculation = useMemo(() => {
    const result: Cable[] = [];

    nonGroundingCables.forEach((cable) => {
      if (
        cable.weightKgPerM !== null &&
        !Number.isNaN(cable.weightKgPerM)
      ) {
        result.push(cable);
      }
    });

    if (
      selectedGroundingCable &&
      selectedGroundingCable.weightKgPerM !== null &&
      !Number.isNaN(selectedGroundingCable.weightKgPerM)
    ) {
      const alreadyIncluded = result.some(
        (cable) => cable.id === selectedGroundingCable.id
      );
      if (!alreadyIncluded) {
        result.push(selectedGroundingCable);
      }
    }

    return result;
  }, [nonGroundingCables, selectedGroundingCable]);

  const cablesWeightLoadPerMeterKg = useMemo(() => {
    if (cablesForWeightCalculation.length === 0) {
      return null;
    }

    return cablesForWeightCalculation.reduce((sum, cable) => {
      const weight = cable.weightKgPerM;
      return weight !== null && !Number.isNaN(weight) ? sum + weight : sum;
    }, 0);
  }, [cablesForWeightCalculation]);

  const handleIncludeGroundingChange = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, data: CheckboxOnChangeData) => {
      setIncludeGroundingCables(Boolean(data.checked));
    },
    []
  );

  const handleGroundingCableSelect = useCallback(
    (_event: unknown, data: { optionValue?: string }) => {
      setSelectedGroundingCableId(data.optionValue ?? null);
    },
    []
  );

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
        <Checkbox
          label='Include "Bare grounding copper cable"'
          checked={includeGroundingCables}
          onChange={handleIncludeGroundingChange}
        />
        {includeGroundingCables ? (
          groundingCableOptions.length > 0 ? (
            <Dropdown
              placeholder="Select grounding cable"
              selectedOptions={
                selectedGroundingCableId ? [selectedGroundingCableId] : []
              }
              onOptionSelect={handleGroundingCableSelect}
            >
              {groundingCableOptions.map((cable) => (
                <Option key={cable.id} value={cable.id}>
                  {getCableDisplayName(cable)}
                </Option>
              ))}
            </Dropdown>
          ) : (
            <Body1 className={styles.emptyState}>
              No grounding cables available for selection.
            </Body1>
          )
        ) : null}
        {cablesForWeightCalculation.length === 0 ? (
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
    </section>
  );
};
