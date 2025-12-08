import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Body1,
  Button,
  Checkbox,
  Caption1,
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
  updateTray,
  uploadProjectFile,
  downloadProjectFile,
  fetchProjectFiles,
  downloadTemplateFile
} from '@/api/client';
import type { ProjectFile } from '@/api/client';
import type {
  CableBundleSpacing,
  ProjectCableCategorySettings,
  ProjectCableLayout
} from '@/api/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  getProjectPlaceholders,
  setProjectPlaceholders,
  clearProjectPlaceholders
} from '@/utils/projectPlaceholders';
import {
  getCustomVariables,
  setCustomVariables,
  clearCustomVariables,
  type CustomVariable
} from '@/utils/customVariablesStorage';
import {
  getTrayBundleOverrides,
  setTrayBundleOverrides,
  type TrayBundleOverride
} from '@/utils/trayBundleOverrides';

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
  formatWeightValue,
  matchCableCategory,
  calculateTrayFreeSpaceMetrics
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
  type TrayLayoutSummary,
  determineCableDiameterGroup
} from './TrayDetails/trayDrawingService';
import {
  canvasToBlob,
  buildTrayPlaceholderValues,
  replaceDocxPlaceholders,
  type TrayPlaceholderContext,
  type WordTableDefinition,
  type DocxImageDefinition,
  MISSING_VALUE_PLACEHOLDER
} from './TrayDetails/trayReportUtils';

const WORD_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const sanitizeFileComponent = (value: string): string => {
  if (!value) {
    return 'value';
  }
  return (
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]+/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'value'
  );
};

const buildReportFileNames = (
  projectNumber: string,
  projectName: string,
  trayName: string
) => {
  const projectNumberPart = sanitizeFileComponent(projectNumber);
  const projectNamePart = sanitizeFileComponent(projectName);
  const trayNamePart = sanitizeFileComponent(trayName);

  const sharedPrefix =
    [projectNumberPart, projectNamePart, trayNamePart]
      .filter((segment) => segment && segment !== '')
      .join('_') || 'Tray';

  return {
    loadCurve: `${sharedPrefix}_LoadCurve.jpeg`,
    bundles: `${sharedPrefix}_Bundles.jpeg`,
    report: `${projectNumberPart}_${projectNamePart} - Cable tray calculations - ${trayNamePart}.docx`
  };
};

const triggerFileDownload = (blob: Blob, fileName: string) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

type TrayReportBaseContext = Omit<
  TrayPlaceholderContext,
  'projectFiles' | 'loadCurveImageFileName' | 'bundlesImageFileName'
>;

const EMUS_PER_PIXEL = 9525;
const EMUS_PER_INCH = 914400;
const MAX_IMAGE_WIDTH_EMU = 6.5 * EMUS_PER_INCH;
const MAX_IMAGE_HEIGHT_EMU = 9 * EMUS_PER_INCH;
const FULL_PAGE_IMAGE_WIDTH_EMU = 6.8 * EMUS_PER_INCH;
const FULL_PAGE_TARGET_HEIGHT_EMU = 9 * EMUS_PER_INCH;
const TRAY_TEMPLATE_MAX_HEIGHT_EMU = 6 * EMUS_PER_INCH;

type PendingImagePlaceholder = {
  blob: Blob;
  fileName: string;
  description: string;
  layout?: 'default' | 'full-page';
  maxHeightEmu?: number;
};

const readImageDimensions = (blob: Blob): Promise<{
  width: number;
  height: number;
}> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to read image dimensions'));
    };
    image.src = url;
  });

const computeImageSizeEmu = async (
  blob: Blob,
  options?: {
    layout?: 'default' | 'full-page';
    maxHeightEmu?: number;
  }
) => {
  const layout = options?.layout ?? 'default';
  const isFullPage = layout === 'full-page';
  const maxWidth = isFullPage
    ? FULL_PAGE_IMAGE_WIDTH_EMU
    : MAX_IMAGE_WIDTH_EMU;
  const fallbackMaxHeight = options?.maxHeightEmu ?? MAX_IMAGE_HEIGHT_EMU;
  const fallbackHeight = Math.min(
    Math.round(maxWidth * 0.6),
    fallbackMaxHeight
  );

  try {
    const { width, height } = await readImageDimensions(blob);
    if (!width || !height) {
      return {
        widthEmu: maxWidth,
        heightEmu: fallbackHeight
      };
    }

    const rawWidthEmu = width * EMUS_PER_PIXEL;
    const rawHeightEmu = height * EMUS_PER_PIXEL;

    if (isFullPage) {
      const targetHeight = FULL_PAGE_TARGET_HEIGHT_EMU;
      let scale = targetHeight / rawHeightEmu;
      let scaledWidth = rawWidthEmu * scale;

      if (scaledWidth > maxWidth) {
        scale = maxWidth / rawWidthEmu;
        scaledWidth = maxWidth;
      }

      return {
        widthEmu: Math.round(scaledWidth),
        heightEmu: Math.round(rawHeightEmu * scale)
      };
    }

    const maxHeight = options?.maxHeightEmu ?? MAX_IMAGE_HEIGHT_EMU;
    const scale = Math.min(maxWidth / rawWidthEmu, maxHeight / rawHeightEmu, 1);

    return {
      widthEmu: Math.round(rawWidthEmu * scale),
      heightEmu: Math.round(rawHeightEmu * scale)
    };
  } catch {
    return {
      widthEmu: maxWidth,
      heightEmu: fallbackHeight
    };
  }
};

const prepareImageDefinitions = async (
  placeholders: Record<string, PendingImagePlaceholder>
): Promise<Record<string, DocxImageDefinition>> => {
  const entries = await Promise.all(
    Object.entries(placeholders).map(async ([placeholder, data]) => {
      try {
        const { widthEmu, heightEmu } = await computeImageSizeEmu(
          data.blob,
          { layout: data.layout, maxHeightEmu: data.maxHeightEmu }
        );
        const buffer = await data.blob.arrayBuffer();
        const fileStem = data.fileName.replace(/\.[^.]+$/, '');

        const definition: DocxImageDefinition = {
          data: new Uint8Array(buffer),
          widthEmu,
          heightEmu,
          fileName: fileStem,
          contentType: data.blob.type || 'image/jpeg',
          description: data.description
        };

        return [placeholder, definition] as const;
      } catch (error) {
        console.error(
          `Failed to prepare image for placeholder "${placeholder}"`,
          error
        );
        return null;
      }
    })
  );

  return Object.fromEntries(
    entries.filter(
      (entry): entry is [string, DocxImageDefinition] => entry !== null
    )
  );
};

const rotateImageBlob = async (
  blob: Blob,
  direction: 'ccw90' | 'cw90'
): Promise<Blob> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return blob;
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(blob);
          return;
        }

        const angle = direction === 'ccw90' ? -Math.PI / 2 : Math.PI / 2;
        canvas.width = image.height;
        canvas.height = image.width;

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(angle);
        ctx.drawImage(image, -image.width / 2, -image.height / 2);

        canvasToBlob(canvas, blob.type || 'image/jpeg', 0.92)
          .then((rotatedBlob) => {
            resolve(rotatedBlob);
          })
          .catch(() => resolve(blob));
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };

    image.src = url;
  });
};

const BUNDLE_SPACING_OPTIONS: CableBundleSpacing[] = ['0', '1D', '2D'];

type BundleCategoryFormState = {
  maxRows: string;
  maxColumns: string;
  bundleSpacing: CableBundleSpacing;
  trefoil: boolean;
  trefoilSpacing: boolean;
  phaseRotation: boolean;
};

type BundleFormState = Record<CableCategoryKey, BundleCategoryFormState>;
type BundleFormErrors = Record<CableCategoryKey, string | null>;

const createBundleFormErrors = (): BundleFormErrors => ({
  mv: null,
  power: null,
  vfd: null,
  control: null
});

const buildBundleFormState = (
  layout: ProjectCableLayout | null,
  overrides: Partial<Record<CableCategoryKey, ProjectCableCategorySettings>> | null
): BundleFormState =>
  CABLE_CATEGORY_ORDER.reduce((acc, key) => {
    const defaults = DEFAULT_CATEGORY_SETTINGS[key];
    const settings = overrides?.[key] ?? layout?.[key] ?? defaults;
    const maxRows = settings?.maxRows ?? defaults.maxRows;
    const maxColumns = settings?.maxColumns ?? defaults.maxColumns;
    const bundleSpacing = settings?.bundleSpacing ?? defaults.bundleSpacing;
    const validBundleSpacing = BUNDLE_SPACING_OPTIONS.includes(bundleSpacing)
      ? bundleSpacing
      : defaults.bundleSpacing;

    const trefoil =
      settings?.trefoil === null || settings?.trefoil === undefined
        ? defaults.trefoil
        : settings.trefoil;
    const trefoilSpacing =
      settings?.trefoilSpacingBetweenBundles === null ||
      settings?.trefoilSpacingBetweenBundles === undefined
        ? defaults.trefoilSpacingBetweenBundles
        : settings.trefoilSpacingBetweenBundles;
    const phaseRotation =
      settings?.applyPhaseRotation === null ||
      settings?.applyPhaseRotation === undefined
        ? defaults.applyPhaseRotation
        : settings.applyPhaseRotation;

    acc[key] = {
      maxRows: maxRows !== null && maxRows !== undefined ? String(maxRows) : '',
      maxColumns:
        maxColumns !== null && maxColumns !== undefined ? String(maxColumns) : '',
      bundleSpacing: validBundleSpacing,
      trefoil: Boolean(trefoil),
      trefoilSpacing: Boolean(trefoilSpacing),
      phaseRotation: Boolean(phaseRotation)
    };
    return acc;
  }, {} as BundleFormState);

const parseBundleInteger = (
  value: string,
  label: 'rows' | 'columns'
): { numeric: number | null; error?: string } => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { numeric: null };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { numeric: null, error: `Enter a whole number for ${label}` };
  }

  if (!Number.isInteger(parsed)) {
    return { numeric: null, error: 'Only whole numbers are allowed' };
  }

  if (parsed < 1) {
    return { numeric: null, error: 'Value must be at least 1' };
  }

  if (parsed > 1_000) {
    return { numeric: null, error: 'Value is too large' };
  }

  return { numeric: parsed };
};

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
  bundleCard: {
    display: 'grid',
    gap: '0.5rem',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.padding('0.75rem')
  },
  bundleSummary: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  emptyState: {
    padding: '0.5rem 0'
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  },
  freeSpaceDanger: {
    color: tokens.colorStatusDangerForeground1,
    fontWeight: tokens.fontWeightSemibold
  },
  freeSpaceWarning: {
    color: tokens.colorStatusWarningForeground1,
    fontWeight: tokens.fontWeightSemibold
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

export const TrayDetails = () => {
  const styles = useStyles();
  const trayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadCurveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trayDrawingServiceRef = useRef<TrayDrawingService | null>(null);
  const navigate = useNavigate();
  const { projectId, trayId } = useParams<{ projectId: string; trayId: string }>();
  const { user, token } = useAuth();
  const { showToast } = useToast();

  const isAdmin = Boolean(user?.isAdmin);
  const currentUserDisplay = useMemo(() => {
    if (!user) {
      return '-';
    }
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    if (fullName !== '') {
      return fullName;
    }
    return user.email ?? '-';
  }, [user]);

  // Use custom hooks for data management
  const {
    project,
    tray,
    trays,
    trayCables,
    projectCables,
    cablesError,
    isLoading,
    error,
    setTray,
    setTrays
  } = useTrayData(projectId, trayId);
  const canonicalProjectId = project?.id ?? projectId ?? null;

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
  const [layoutSummary, setLayoutSummary] = useState<TrayLayoutSummary | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState<boolean>(false);
  const [bundleFormUseCustom, setBundleFormUseCustom] = useState<boolean>(false);
  const [bundleFormState, setBundleFormState] = useState<BundleFormState>(() =>
    buildBundleFormState(project?.cableLayout ?? null, null)
  );
  const [bundleFormErrors, setBundleFormErrors] = useState<BundleFormErrors>(
    () => createBundleFormErrors()
  );
  const [bundleOverrides, setBundleOverrides] = useState<TrayBundleOverride | null>(null);
  const [bundleSaving, setBundleSaving] = useState<boolean>(false);

  // Initialize form when tray loads
  useEffect(() => {
    if (tray) {
      setFormValues(toTrayFormState(tray));
      setIsEditing(false);
      setFormErrors({});
    }
  }, [tray]);

  useEffect(() => {
    const stored = getTrayBundleOverrides(canonicalProjectId, tray?.id ?? trayId ?? null);
    const categories = stored?.categories ?? null;
    setBundleOverrides(stored);
    setBundleFormUseCustom(Boolean(stored?.useCustom));
    setBundleFormState(buildBundleFormState(project?.cableLayout ?? null, categories));
    setBundleFormErrors(createBundleFormErrors());
  }, [canonicalProjectId, project?.cableLayout, tray?.id, trayId]);

  // Material tray selection
  const selectedMaterialTray = useMemo(() => {
    const fromForm = findMaterialTrayByType(formValues.type);
    if (fromForm) {
      return fromForm;
    }
    if (tray?.type) {
      return findMaterialTrayByType(tray.type);
    }
    return null;
  }, [findMaterialTrayByType, formValues.type, tray?.type]);

  const materialTrayMetadata = useMemo(() => {
    if (!selectedMaterialTray) {
      return null;
    }
    return {
      manufacturer: selectedMaterialTray.manufacturer ?? null,
      heightMm: selectedMaterialTray.heightMm ?? null,
      widthMm: selectedMaterialTray.widthMm ?? null,
      weightKgPerM: selectedMaterialTray.weightKgPerM ?? null,
      rungHeightMm: selectedMaterialTray.rungHeightMm ?? null,
      imageTemplateId: selectedMaterialTray.imageTemplateId ?? null,
      imageTemplateFileName: selectedMaterialTray.imageTemplateFileName ?? null,
      imageTemplateContentType: selectedMaterialTray.imageTemplateContentType ?? null
    };
  }, [selectedMaterialTray]);

  const selectedRungHeightMm = selectedMaterialTray?.rungHeightMm ?? null;

  const selectedLoadCurveId = selectedMaterialTray?.loadCurveId ?? null;
  const { selectedLoadCurve, loadCurveLoadingId, loadCurveError } =
    useLoadCurveData(selectedLoadCurveId);
  const selectedLoadCurveName =
    selectedMaterialTray?.loadCurveName ?? selectedLoadCurve?.name ?? null;

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

  const percentageFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    []
  );

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
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

  const isUsingCustomBundles = Boolean(bundleOverrides?.useCustom);

  const activeProjectCableLayout = useMemo<ProjectCableLayout | null>(() => {
    const base = project?.cableLayout ?? null;

    if (!bundleOverrides?.useCustom) {
      return base;
    }

    const mergedCategories = CABLE_CATEGORY_ORDER.reduce<
      Record<CableCategoryKey, ProjectCableCategorySettings>
    >((acc, key) => {
      const defaults = DEFAULT_CATEGORY_SETTINGS[key];
      const baseSettings = (base?.[key] as ProjectCableCategorySettings | null) ?? defaults;
      const override = bundleOverrides?.categories?.[key];
      acc[key] = override ? { ...baseSettings, ...override } : baseSettings;
      return acc;
    }, {} as Record<CableCategoryKey, ProjectCableCategorySettings>);

    return {
      cableSpacing: base?.cableSpacing ?? DEFAULT_CABLE_SPACING,
      considerBundleSpacingAsFree: base?.considerBundleSpacingAsFree ?? null,
      minFreeSpacePercent: base?.minFreeSpacePercent ?? null,
      maxFreeSpacePercent: base?.maxFreeSpacePercent ?? null,
      mv: mergedCategories.mv ?? DEFAULT_CATEGORY_SETTINGS.mv,
      power: mergedCategories.power ?? DEFAULT_CATEGORY_SETTINGS.power,
      vfd: mergedCategories.vfd ?? DEFAULT_CATEGORY_SETTINGS.vfd,
      control: mergedCategories.control ?? DEFAULT_CATEGORY_SETTINGS.control
    };
  }, [bundleOverrides, project?.cableLayout]);

  const projectCableSpacingMm = useMemo(() => {
    const spacing = activeProjectCableLayout?.cableSpacing;
    if (typeof spacing === 'number' && Number.isFinite(spacing) && spacing >= 0) {
      return spacing;
    }
    return DEFAULT_CABLE_SPACING;
  }, [activeProjectCableLayout?.cableSpacing]);

  const effectiveLayoutConfig = useMemo<CategoryLayoutConfig>(() => {
    const categories: CableCategoryKey[] = ['power', 'control', 'mv', 'vfd'];
    return categories.reduce<CategoryLayoutConfig>((acc, category) => {
      const defaults = DEFAULT_CATEGORY_SETTINGS[category];
      const layout = activeProjectCableLayout?.[category] ?? null;
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
  }, [activeProjectCableLayout, projectCableSpacingMm]);

  const considerBundleSpacingAsFree = Boolean(
    activeProjectCableLayout?.considerBundleSpacingAsFree
  );

  const minFreeSpacePercent = activeProjectCableLayout?.minFreeSpacePercent ?? null;
  const maxFreeSpacePercent = activeProjectCableLayout?.maxFreeSpacePercent ?? null;
  const trayPurposeNormalized = tray?.purpose
    ? tray.purpose.trim().toLowerCase()
    : '';
  const isMvTrayPurpose =
    trayPurposeNormalized === 'mv cable trays' ||
    trayPurposeNormalized === 'type a (pink color) for mv cables';

  const freeSpaceMetrics = useMemo(
    () =>
      calculateTrayFreeSpaceMetrics({
        tray,
        cables: nonGroundingCables,
        layout: activeProjectCableLayout ?? null,
        spacingBetweenCablesMm: projectCableSpacingMm,
        considerBundleSpacingAsFree,
        layoutSummary
      }),
    [
      considerBundleSpacingAsFree,
      activeProjectCableLayout,
      layoutSummary,
      nonGroundingCables,
      projectCableSpacingMm,
      tray
    ]
  );

  const freeSpaceAlert = useMemo(() => {
    if (
      !freeSpaceMetrics.calculationAvailable ||
      freeSpaceMetrics.freeWidthPercent === null ||
      isMvTrayPurpose
    ) {
      return null;
    }

    const percent = freeSpaceMetrics.freeWidthPercent;
    const percentDisplay = `${percentageFormatter.format(percent)} %`;

    if (minFreeSpacePercent !== null && percent < minFreeSpacePercent) {
      const minDisplay = `${percentageFormatter.format(
        minFreeSpacePercent
      )} %`;
      return {
        kind: 'danger' as const,
        message: `Cable tray free space ${percentDisplay} is below the minimum threshold of ${minDisplay}.`
      };
    }

    if (maxFreeSpacePercent !== null && percent > maxFreeSpacePercent) {
      const maxDisplay = `${percentageFormatter.format(
        maxFreeSpacePercent
      )} %`;
      return {
        kind: 'warning' as const,
        message: `Cable tray free space ${percentDisplay} exceeds the maximum threshold of ${maxDisplay}.`
      };
    }

    return null;
  }, [
    freeSpaceMetrics.calculationAvailable,
    freeSpaceMetrics.freeWidthPercent,
    freeSpaceMetrics.occupiedWidthMm,
    isMvTrayPurpose,
    maxFreeSpacePercent,
    minFreeSpacePercent,
    percentageFormatter
  ]);

  const drawTrayVisualization = useCallback(() => {
    const canvasElement = trayCanvasRef.current;
    if (!tray || !canvasElement) {
      setLayoutSummary(null);
      return false;
    }

    if (!trayDrawingServiceRef.current) {
      trayDrawingServiceRef.current = new TrayDrawingService();
    }

    try {
      const summary = trayDrawingServiceRef.current.drawTrayLayout(
        canvasElement,
        tray,
        nonGroundingCables,
        cableBundles,
        6,
        projectCableSpacingMm,
        effectiveLayoutConfig,
        { rungHeightMm: selectedRungHeightMm ?? undefined }
      );
      setLayoutSummary(summary ?? null);
      return summary !== null;
    } catch (error) {
      console.error('Failed to render tray visualization', error);
      setLayoutSummary(null);
      return false;
    }
  }, [
    tray,
    nonGroundingCables,
    cableBundles,
    projectCableSpacingMm,
    effectiveLayoutConfig,
    selectedRungHeightMm
  ]);

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

  const trayTemplatePurposeCount = useMemo(() => {
    if (trays.length === 0) {
      return 0;
    }
    const purposes = new Set<string>();
    for (const trayItem of trays) {
      const trimmed = trayItem.purpose?.trim();
      if (trimmed) {
        purposes.add(trimmed);
      }
    }
    return purposes.size;
  }, [trays]);

  const trayBundleDetails = useMemo(
    () =>
      trayCableCategories.map((key) => {
        const config = CABLE_CATEGORY_CONFIG[key];
        const defaults = DEFAULT_CATEGORY_SETTINGS[key];
        const layout = activeProjectCableLayout?.[key] ?? null;

        const maxRows = layout?.maxRows ?? defaults.maxRows;
        const maxColumns = layout?.maxColumns ?? defaults.maxColumns;
        const bundleSpacing = layout?.bundleSpacing ?? defaults.bundleSpacing;
        const trefoil = config.showTrefoil
          ? layout?.trefoil ?? defaults.trefoil
          : null;
        const trefoilSpacing = config.allowTrefoilSpacing
          ? layout?.trefoilSpacingBetweenBundles ?? defaults.trefoilSpacingBetweenBundles
          : null;
        const phaseRotation = config.allowPhaseRotation
          ? layout?.applyPhaseRotation ?? defaults.applyPhaseRotation
          : null;

        return {
          key,
          label: config.label,
          maxRows,
          maxColumns,
          bundleSpacing,
          trefoil,
          trefoilSpacing,
          phaseRotation
        };
      }),
    [activeProjectCableLayout, trayCableCategories]
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

  const trayLengthMeters = supportCalculations.lengthMeters;
  const supportsWeightPerMeterKg = supportCalculations.weightPerMeterKg;

  const cableWeightComponents = useMemo(() => {
    const weights: number[] = [];

    for (const cable of nonGroundingCables) {
      const weight = cable.weightKgPerM;
      if (weight !== null && !Number.isNaN(weight)) {
        weights.push(weight);
      }
    }

    if (groundingCableWeightKgPerM !== null) {
      weights.push(groundingCableWeightKgPerM);
    }

    return weights;
  }, [nonGroundingCables, groundingCableWeightKgPerM]);

  const trayWeightLoadPerMeterFormula = useMemo(() => {
    if (
      trayWeightPerMeterKg === null ||
      supportsWeightPerMeterKg === null ||
      trayWeightLoadPerMeterKg === null
    ) {
      return null;
    }

    return `${numberFormatter.format(trayWeightPerMeterKg)} + ${numberFormatter.format(
      supportsWeightPerMeterKg
    )} = ${numberFormatter.format(trayWeightLoadPerMeterKg)} kg/m`;
  }, [
    trayWeightPerMeterKg,
    supportsWeightPerMeterKg,
    trayWeightLoadPerMeterKg,
    numberFormatter
  ]);

  const trayTotalOwnWeightFormula = useMemo(() => {
    if (
      trayWeightLoadPerMeterKg === null ||
      trayLengthMeters === null ||
      trayLengthMeters <= 0 ||
      trayTotalOwnWeightKg === null
    ) {
      return null;
    }

    return `${numberFormatter.format(trayWeightLoadPerMeterKg)} * ${numberFormatter.format(
      trayLengthMeters
    )} = ${numberFormatter.format(trayTotalOwnWeightKg)} kg`;
  }, [trayWeightLoadPerMeterKg, trayLengthMeters, trayTotalOwnWeightKg, numberFormatter]);

  const cablesWeightPerMeterFormula = useMemo(() => {
    if (cablesWeightLoadPerMeterKg === null || cableWeightComponents.length === 0) {
      return null;
    }

    const parts = cableWeightComponents.map((value) => numberFormatter.format(value));
    return `${parts.join(' + ')} = ${numberFormatter.format(cablesWeightLoadPerMeterKg)} kg/m`;
  }, [cableWeightComponents, cablesWeightLoadPerMeterKg, numberFormatter]);

  const cablesTotalWeightFormula = useMemo(() => {
    if (
      cablesWeightLoadPerMeterKg === null ||
      trayLengthMeters === null ||
      trayLengthMeters <= 0 ||
      cablesTotalWeightKg === null
    ) {
      return null;
    }

    return `${numberFormatter.format(cablesWeightLoadPerMeterKg)} * ${numberFormatter.format(
      trayLengthMeters
    )} = ${numberFormatter.format(cablesTotalWeightKg)} kg`;
  }, [
    cablesWeightLoadPerMeterKg,
    trayLengthMeters,
    cablesTotalWeightKg,
    numberFormatter
  ]);

  const totalWeightLoadPerMeterFormula = useMemo(() => {
    if (
      trayWeightLoadPerMeterKg === null ||
      cablesWeightLoadPerMeterKg === null ||
      totalWeightLoadPerMeterKg === null
    ) {
      return null;
    }

    return `${numberFormatter.format(trayWeightLoadPerMeterKg)} + ${numberFormatter.format(
      cablesWeightLoadPerMeterKg
    )} = ${numberFormatter.format(totalWeightLoadPerMeterKg)} kg/m`;
  }, [
    trayWeightLoadPerMeterKg,
    cablesWeightLoadPerMeterKg,
    totalWeightLoadPerMeterKg,
    numberFormatter
  ]);

  const totalWeightFormula = useMemo(() => {
    if (
      trayTotalOwnWeightKg === null ||
      cablesTotalWeightKg === null ||
      totalWeightKg === null
    ) {
      return null;
    }

    return `${numberFormatter.format(trayTotalOwnWeightKg)} + ${numberFormatter.format(
      cablesTotalWeightKg
    )} = ${numberFormatter.format(totalWeightKg)} kg`;
  }, [trayTotalOwnWeightKg, cablesTotalWeightKg, totalWeightKg, numberFormatter]);

  const occupiedWidthDisplay = freeSpaceMetrics.occupiedWidthMm === null
    ? 'N/A'
    : `${numberFormatter.format(freeSpaceMetrics.occupiedWidthMm)} mm`;

  const trayFreeSpaceDisplay = freeSpaceMetrics.freeWidthPercent === null
    ? 'N/A'
    : `${percentageFormatter.format(freeSpaceMetrics.freeWidthPercent)} %`;

  const rawTrayWidthMm = tray?.widthMm ?? null;
  const trayWidthMm =
    typeof rawTrayWidthMm === 'number' && Number.isFinite(rawTrayWidthMm) && rawTrayWidthMm > 0
      ? rawTrayWidthMm
      : null;

  const occupiedWidthFormula = useMemo(() => {
    const occupiedWidth = freeSpaceMetrics.occupiedWidthMm;
    if (occupiedWidth === null || Number.isNaN(occupiedWidth)) {
      return null;
    }

    if (
      layoutSummary &&
      typeof layoutSummary.totalCableWidthMm === 'number' &&
      Number.isFinite(layoutSummary.totalCableWidthMm)
    ) {
      const spacingContribution = Math.max(0, occupiedWidth - layoutSummary.totalCableWidthMm);
      return `${numberFormatter.format(layoutSummary.totalCableWidthMm)} + ${numberFormatter.format(
        spacingContribution
      )} = ${numberFormatter.format(occupiedWidth)} mm`;
    }

    if (trayWidthMm !== null) {
      const freeWidthMm = Math.max(0, trayWidthMm - occupiedWidth);
      return `${numberFormatter.format(trayWidthMm)} - ${numberFormatter.format(
        freeWidthMm
      )} = ${numberFormatter.format(occupiedWidth)} mm`;
    }

    return null;
  }, [freeSpaceMetrics.occupiedWidthMm, layoutSummary, numberFormatter, trayWidthMm]);

  const trayFreeSpaceFormula = useMemo(() => {
    const occupiedWidth = freeSpaceMetrics.occupiedWidthMm;
    const freePercent = freeSpaceMetrics.freeWidthPercent;

    if (
      trayWidthMm === null ||
      occupiedWidth === null ||
      freePercent === null ||
      Number.isNaN(occupiedWidth) ||
      Number.isNaN(freePercent)
    ) {
      return null;
    }

    return `((${numberFormatter.format(trayWidthMm)} - ${numberFormatter.format(
      occupiedWidth
    )}) / ${numberFormatter.format(trayWidthMm)}) * 100 = ${percentageFormatter.format(
      freePercent
    )} %`;
  }, [
    freeSpaceMetrics.freeWidthPercent,
    freeSpaceMetrics.occupiedWidthMm,
    numberFormatter,
    percentageFormatter,
    trayWidthMm
  ]);

  // Calculate useful tray height (tray height - rung height)
  const usefulTrayHeightMm = useMemo(() => {
    const trayHeightMm = tray?.heightMm ?? null;
    const rungHeightMm = selectedRungHeightMm;
    
    if (trayHeightMm === null || rungHeightMm === null) {
      return null;
    }
    
    return trayHeightMm - rungHeightMm;
  }, [tray?.heightMm, selectedRungHeightMm]);

  const usefulTrayHeightDisplay = usefulTrayHeightMm === null
    ? 'N/A'
    : `${numberFormatter.format(usefulTrayHeightMm)} mm`;

  const usefulTrayHeightFormula = useMemo(() => {
    const trayHeight = tray?.heightMm ?? null;
    const rungHeight = selectedRungHeightMm;

    if (
      trayHeight === null ||
      trayHeight === undefined ||
      Number.isNaN(trayHeight) ||
      rungHeight === null ||
      Number.isNaN(rungHeight) ||
      usefulTrayHeightMm === null
    ) {
      return null;
    }

    return `${numberFormatter.format(trayHeight)} - ${numberFormatter.format(
      rungHeight
    )} = ${numberFormatter.format(usefulTrayHeightMm)} mm`;
  }, [tray?.heightMm, selectedRungHeightMm, usefulTrayHeightMm, numberFormatter]);

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

  const handleBundleNumericChange = useCallback(
    (category: CableCategoryKey, field: 'maxRows' | 'maxColumns') =>
      (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
        if (!isEditing) {
          return;
        }
        setBundleFormErrors((previous) => ({ ...previous, [category]: null }));
        setBundleFormState((previous) => ({
          ...previous,
          [category]: { ...previous[category], [field]: data.value }
        }));
      },
    [isEditing]
  );

  const handleBundleSpacingChange = useCallback(
    (category: CableCategoryKey) =>
      (_event: unknown, data: { optionValue?: string }) => {
        if (!isEditing) {
          return;
        }
        const rawValue = data.optionValue as CableBundleSpacing | undefined;
        const nextValue =
          rawValue && BUNDLE_SPACING_OPTIONS.includes(rawValue)
            ? rawValue
            : DEFAULT_CATEGORY_SETTINGS[category].bundleSpacing;

        setBundleFormErrors((previous) => ({ ...previous, [category]: null }));
        setBundleFormState((previous) => ({
          ...previous,
          [category]: { ...previous[category], bundleSpacing: nextValue }
        }));
      },
    [isEditing]
  );

  const handleBundleToggle = useCallback(
    (category: CableCategoryKey, field: 'trefoil' | 'trefoilSpacing' | 'phaseRotation') =>
      (_event: unknown, data: CheckboxOnChangeData) => {
        if (!isEditing) {
          return;
        }
        setBundleFormErrors((previous) => ({ ...previous, [category]: null }));
        setBundleFormState((previous) => ({
          ...previous,
          [category]: { ...previous[category], [field]: Boolean(data.checked) }
        }));
      },
    [isEditing]
  );

  const handleBundleUseCustomChange = useCallback(
    (_event: unknown, data: CheckboxOnChangeData) => {
      if (!isEditing) {
        return;
      }
      setBundleFormUseCustom(Boolean(data.checked));
    },
    [isEditing]
  );

  const handleResetBundleForm = useCallback(
    (overrideState?: TrayBundleOverride | null) => {
      const source = overrideState ?? bundleOverrides ?? null;
      setBundleFormUseCustom(Boolean(source?.useCustom));
      setBundleFormState(
        buildBundleFormState(project?.cableLayout ?? null, source?.categories ?? null)
      );
      setBundleFormErrors(createBundleFormErrors());
    },
    [bundleOverrides, project?.cableLayout]
  );

  const buildBundleOverrideInput = useCallback(() => {
    const errors = createBundleFormErrors();
    let hasError = false;
    const categories: Partial<Record<CableCategoryKey, ProjectCableCategorySettings>> = {};

    for (const key of CABLE_CATEGORY_ORDER) {
      const input = bundleFormState[key];
      const defaults = DEFAULT_CATEGORY_SETTINGS[key];
      const parsedRows = parseBundleInteger(input.maxRows, 'rows');
      const parsedColumns = parseBundleInteger(input.maxColumns, 'columns');
      const errorMessage = parsedRows.error ?? parsedColumns.error ?? null;
      if (errorMessage) {
        errors[key] = errorMessage;
        hasError = true;
      }

      categories[key] = {
        maxRows: parsedRows.numeric,
        maxColumns: parsedColumns.numeric,
        bundleSpacing: input.bundleSpacing ?? defaults.bundleSpacing,
        trefoil: CABLE_CATEGORY_CONFIG[key].showTrefoil ? input.trefoil : null,
        trefoilSpacingBetweenBundles: CABLE_CATEGORY_CONFIG[key].allowTrefoilSpacing
          ? input.trefoilSpacing
          : null,
        applyPhaseRotation: CABLE_CATEGORY_CONFIG[key].allowPhaseRotation
          ? input.phaseRotation
          : null
      };
    }

    return { errors, hasError, categories };
  }, [bundleFormState]);

  const persistBundleOverride = useCallback(
    (
      override: TrayBundleOverride,
      options: { silent?: boolean } = {}
    ): boolean => {
      if (!canonicalProjectId || (!tray?.id && !trayId)) {
        if (!options.silent) {
          showToast({
            intent: 'error',
            title: 'Tray not available',
            body: 'Load a tray before saving bundle configuration.'
          });
        }
        return false;
      }

      setBundleOverrides(override);
      setTrayBundleOverrides(canonicalProjectId, tray?.id ?? trayId ?? null, override);
      setBundleFormErrors(createBundleFormErrors());

      if (!options.silent) {
        showToast({
          intent: 'success',
          title: override.useCustom
            ? 'Custom bundle configuration saved'
            : 'Using project bundle configuration',
          body: override.useCustom
            ? 'Tray-level bundle rules will be used for this tray.'
            : 'Project bundle rules will be applied to this tray.'
        });
      }

      return true;
    },
    [canonicalProjectId, showToast, tray?.id, trayId]
  );

  const handleSaveBundleConfig = useCallback(() => {
    const { errors, hasError, categories } = buildBundleOverrideInput();
    if (hasError) {
      setBundleFormErrors(errors);
      return;
    }

    setBundleSaving(true);
    try {
      const nextOverride: TrayBundleOverride = {
        useCustom: bundleFormUseCustom,
        categories
      };

      persistBundleOverride(nextOverride);
      handleResetBundleForm(nextOverride);
    } catch (error) {
      console.error('Failed to save bundle configuration', error);
      showToast({
        intent: 'error',
        title: 'Failed to save bundle configuration',
        body: error instanceof Error ? error.message : undefined
      });
    } finally {
      setBundleSaving(false);
    }
  }, [
    buildBundleOverrideInput,
    bundleFormUseCustom,
    handleResetBundleForm,
    persistBundleOverride,
    showToast
  ]);

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

      const { errors, hasError, categories } = buildBundleOverrideInput();
      if (hasError) {
        setBundleFormErrors(errors);
      } else {
        const nextOverride: TrayBundleOverride = {
          useCustom: bundleFormUseCustom,
          categories
        };
        const currentOverride = bundleOverrides ?? {
          useCustom: false,
          categories: {}
        };
        if (JSON.stringify(nextOverride) !== JSON.stringify(currentOverride)) {
          persistBundleOverride(nextOverride, { silent: true });
          handleResetBundleForm(nextOverride);
        } else {
          handleResetBundleForm(currentOverride);
        }
      }

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
    handleResetBundleForm();
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
  const groundingCableDisplay =
    selectedGroundingCableLabel ??
    (selectedGroundingCableType ? selectedGroundingCableType.name ?? null : null);

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
  const rawSupportLengthMm = overrideSupport?.lengthMm ?? null;
  const supportLengthMm = useMemo(() => {
    if (rawSupportLengthMm !== null) {
      return rawSupportLengthMm;
    }
    const supportType = supportOverride?.supportType?.trim().toLowerCase();
    if (!supportType) {
      return null;
    }
    const matchedSupport = Object.values(materialSupportsById).find((support) =>
      support.type?.trim().toLowerCase() === supportType
    );
    return matchedSupport?.lengthMm ?? null;
  }, [materialSupportsById, rawSupportLengthMm, supportOverride?.supportType]);

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

  const loadCurveRefreshKey = useMemo(
    () => `${includeGroundingCable}-${selectedGroundingCableTypeId ?? 'none'}-${groundingCableWeightKgPerM ?? 'na'}`,
    [includeGroundingCable, selectedGroundingCableTypeId, groundingCableWeightKgPerM]
  );

  const trayReportBaseContext = useMemo<TrayReportBaseContext | null>(() => {
    if (!project || !tray) {
      return null;
    }
    return {
      project,
      trays,
      tray,
      trayCables,
      projectCableTypes,
      projectCables,
      trayTemplatePurposeCount,
      trayFreeSpacePercent: freeSpaceMetrics.freeWidthPercent,
      trayOccupiedWidthMm: freeSpaceMetrics.occupiedWidthMm,
      includeGroundingCable,
      groundingCableTypeName: groundingCableDisplay ?? null,
      supportCalculations,
      supportTypeDisplay,
      supportLengthMm,
      trayWeightLoadPerMeterKg,
      trayWeightPerMeterKg,
      trayTotalOwnWeightKg,
      cablesWeightLoadPerMeterKg,
      cablesTotalWeightKg,
      totalWeightLoadPerMeterKg,
      totalWeightKg,
      groundingCableWeightKgPerM,
      projectCableSpacingMm,
      considerBundleSpacingAsFree,
      minFreeSpacePercent,
      maxFreeSpacePercent,
      safetyFactorPercent,
      safetyFactorStatusMessage,
      chartSpanMeters,
      safetyAdjustedLoadKnPerM,
      chartEvaluation,
      selectedLoadCurveName,
      numberFormatter,
      percentageFormatter,
      dateTimeFormatter,
      materialTrayMetadata,
      currentUserDisplay
    };
  }, [
    project,
    tray,
    trays,
    trayCables,
    projectCableTypes,
    projectCables,
    trayTemplatePurposeCount,
    freeSpaceMetrics.freeWidthPercent,
    includeGroundingCable,
    groundingCableDisplay,
    supportCalculations,
    supportTypeDisplay,
    supportLengthMm,
    trayWeightLoadPerMeterKg,
    trayWeightPerMeterKg,
    trayTotalOwnWeightKg,
    cablesWeightLoadPerMeterKg,
    cablesTotalWeightKg,
    totalWeightLoadPerMeterKg,
    totalWeightKg,
    groundingCableWeightKgPerM,
    projectCableSpacingMm,
    considerBundleSpacingAsFree,
    minFreeSpacePercent,
    maxFreeSpacePercent,
    safetyFactorPercent,
    safetyFactorStatusMessage,
    chartSpanMeters,
    safetyAdjustedLoadKnPerM,
    chartEvaluation,
    selectedLoadCurveName,
    numberFormatter,
    percentageFormatter,
    dateTimeFormatter,
    materialTrayMetadata,
    currentUserDisplay
  ]);

  const canGenerateReport = Boolean(token && trayReportBaseContext);

  const handleGenerateReport = useCallback(async () => {
    if (!project || !tray || !projectId || !token || !trayReportBaseContext) {
      showToast({
        intent: 'error',
        title: 'Unable to generate report',
        body: 'Project data is still loading. Try again in a moment.'
      });
      return;
    }

    if (!tray.purpose || tray.purpose.trim() === '') {
      showToast({
        intent: 'error',
        title: 'Tray purpose required',
        body: 'Assign a purpose to this tray before generating a report.'
      });
      return;
    }

    const templatePurpose = tray.purpose.trim();
    const templateSelection =
      project.trayPurposeTemplates?.[templatePurpose] ?? null;

    if (!templateSelection?.fileId) {
      showToast({
        intent: 'error',
        title: 'Tray template missing',
        body: 'Assign a report template to this tray purpose in Project details.'
      });
      return;
    }

    if (!loadCurveCanvasRef.current) {
      showToast({
        intent: 'error',
        title: 'Load curve unavailable',
        body: 'Load curve visualization is not available to export.'
      });
      return;
    }

    if (!trayCanvasRef.current) {
      showToast({
        intent: 'error',
        title: 'Tray visualization unavailable',
        body: 'Tray layout visualization is not available to export.'
      });
      return;
    }

    setIsGeneratingReport(true);

    try {
      const { loadCurve, bundles, report } = buildReportFileNames(
        project.projectNumber,
        project.name,
        tray.name
      );

      const projectFilesResponse = await fetchProjectFiles(projectId, token);
      let projectFilesList = [...projectFilesResponse.files];

      const normalizeFileName = (fileName: string): string =>
        fileName.trim().toLowerCase();

      const findExistingFileIdByName = (fileName: string): string | null => {
        const normalized = normalizeFileName(fileName);
        if (!normalized) {
          return null;
        }
        const existing = projectFilesList.find(
          (file) => normalizeFileName(file.fileName) === normalized
        );
        return existing?.id ?? null;
      };

      const registerProjectFile = (file: ProjectFile) => {
        projectFilesList = (() => {
          const index = projectFilesList.findIndex(
            (existing) => existing.id === file.id
          );
          if (index === -1) {
            return [...projectFilesList, file];
          }
          const next = [...projectFilesList];
          next[index] = file;
          return next;
        })();
      };

      const templateDownloadPromise = downloadProjectFile(
        token,
        projectId,
        templateSelection.fileId
      );

      const [loadCurveBlob, bundlesBlob] = await Promise.all([
        canvasToBlob(loadCurveCanvasRef.current, 'image/jpeg', 0.92),
        canvasToBlob(trayCanvasRef.current, 'image/jpeg', 0.92)
      ]);

      const rotatedBundlesBlob = await rotateImageBlob(bundlesBlob, 'ccw90');
      const docBundlesBlob = rotatedBundlesBlob ?? bundlesBlob;
      let trayTemplateImageBlob: Blob | null | undefined;

      const getTrayTemplateImageBlob = async (): Promise<Blob | null> => {
        if (trayTemplateImageBlob !== undefined) {
          return trayTemplateImageBlob;
        }

        const imageMeta = trayReportBaseContext.materialTrayMetadata;
        if (
          !imageMeta?.imageTemplateId ||
          !imageMeta.imageTemplateContentType ||
          !imageMeta.imageTemplateContentType.startsWith('image/')
        ) {
          trayTemplateImageBlob = null;
          return trayTemplateImageBlob;
        }

        if (!token) {
          trayTemplateImageBlob = null;
          return trayTemplateImageBlob;
        }

        try {
          const { blob } = await downloadTemplateFile(
            token,
            imageMeta.imageTemplateId
          );
          trayTemplateImageBlob = blob;
        } catch (error) {
          console.error('Failed to download tray type image template', error);
          trayTemplateImageBlob = null;
        }

        return trayTemplateImageBlob;
      };

      const loadCurveFile = new File([loadCurveBlob], loadCurve, {
        type: 'image/jpeg'
      });
      const bundlesFile = new File([bundlesBlob], bundles, {
        type: 'image/jpeg'
      });

      const loadCurveReplaceId = findExistingFileIdByName(loadCurve);
      const bundlesReplaceId = findExistingFileIdByName(bundles);

      const [{ file: storedLoadCurve }, { file: storedBundles }] =
        await Promise.all([
          uploadProjectFile(
            token,
            projectId,
            loadCurveFile,
            loadCurveReplaceId ? { replaceFileId: loadCurveReplaceId } : undefined
          ),
          uploadProjectFile(
            token,
            projectId,
            bundlesFile,
            bundlesReplaceId ? { replaceFileId: bundlesReplaceId } : undefined
          )
        ]);

      registerProjectFile(storedLoadCurve);
      registerProjectFile(storedBundles);

      const { blob: templateBlob, contentType } =
        await templateDownloadPromise;

    if (!canonicalProjectId) {
      showToast({
        intent: 'error',
        title: 'Project unavailable',
        body: 'Project identifier is missing for placeholder resolution.'
      });
      return;
    }

    const placeholderKeyCandidates = [
      canonicalProjectId,
      projectId && projectId !== canonicalProjectId ? projectId : null
    ].filter(
      (value, index, array): value is string =>
        Boolean(value) && array.indexOf(value) === index
    );

    let storedPlaceholders: Record<string, string> = {};
    let placeholdersSourceKey: string | null = null;

    for (const candidate of placeholderKeyCandidates) {
      if (!candidate) {
        continue;
      }
      const candidateValues = getProjectPlaceholders(candidate);
      if (Object.keys(candidateValues).length > 0) {
        storedPlaceholders = candidateValues;
        placeholdersSourceKey = candidate;
        break;
      }
    }

    if (Object.keys(storedPlaceholders).length === 0) {
      showToast({
        intent: 'error',
        title: 'No placeholders configured',
        body: 'Map placeholders in the Variables tab before generating a report.'
      });
      return;
    }

    if (
      placeholdersSourceKey &&
      placeholdersSourceKey !== canonicalProjectId
    ) {
      setProjectPlaceholders(canonicalProjectId, storedPlaceholders);
      clearProjectPlaceholders(placeholdersSourceKey);
    }

    const resolveCustomVariables = (): CustomVariable[] => {
      if (!canonicalProjectId) {
        return [];
      }
      const keyCandidates = [
        canonicalProjectId,
        projectId && projectId !== canonicalProjectId ? projectId : null
      ].filter(
        (value, index, array): value is string =>
          Boolean(value) && array.indexOf(value) === index
      );

      let variables: CustomVariable[] = [];
      let sourceKey: string | null = null;

      for (const candidate of keyCandidates) {
        if (!candidate) {
          continue;
        }
        const candidateVariables = getCustomVariables(candidate);
        if (candidateVariables.length > 0) {
          variables = candidateVariables;
          sourceKey = candidate;
          break;
        }
      }

      if (
        sourceKey &&
        sourceKey !== canonicalProjectId &&
        variables.length > 0
      ) {
        setCustomVariables(canonicalProjectId, variables);
        clearCustomVariables(sourceKey);
      }

      return variables;
    };

    const customVariables = resolveCustomVariables();
    const customVariableIds = new Set(customVariables.map((item) => item.id));
    const customPlaceholderTokens = new Set<string>();

    const placeholderBundle = buildTrayPlaceholderValues({
      ...trayReportBaseContext,
      projectFiles: projectFilesList,
      loadCurveImageFileName: loadCurve,
        bundlesImageFileName: bundles
      });
      const textReplacements: Record<string, string> = {};
      const tableReplacements: Record<string, WordTableDefinition> = {};
      const pendingImagePlaceholders: Record<
        string,
        PendingImagePlaceholder
      > = {};

      for (const variable of customVariables) {
        const placeholderToken = storedPlaceholders[variable.id];
        if (!placeholderToken) {
          continue;
        }
        const replacementValue =
          variable.name.trim() === ''
            ? MISSING_VALUE_PLACEHOLDER
            : variable.name.trim();
        textReplacements[placeholderToken] = replacementValue;
        customPlaceholderTokens.add(placeholderToken);
      }

      for (const [rowId, placeholder] of Object.entries(storedPlaceholders)) {
        if (customVariableIds.has(rowId)) {
          continue;
        }
        const trimmedPlaceholder = placeholder?.trim();
        if (!trimmedPlaceholder) {
          continue;
        }

        const tableDefinition = placeholderBundle.tables[rowId];
        if (tableDefinition) {
          tableReplacements[trimmedPlaceholder] = tableDefinition;
          continue;
        }

        if (customPlaceholderTokens.has(trimmedPlaceholder)) {
          continue;
        }

        const imageSource = placeholderBundle.images[rowId];
        if (imageSource) {
          let sourceBlob: Blob | null = null;
          let fileNameForBlob = loadCurve;
          let description = '';
          let layout: 'default' | 'full-page' = 'default';
          let maxHeightEmu: number | undefined;

          if (imageSource === 'loadCurve') {
            sourceBlob = loadCurveBlob;
            fileNameForBlob = loadCurve;
            description = 'Tray load curve visualization';
            layout = 'default';
          } else if (imageSource === 'bundles') {
            sourceBlob = docBundlesBlob;
            fileNameForBlob = bundles;
            description = 'Tray laying concept visualization';
            layout = 'full-page';
          } else if (imageSource === 'trayTemplate') {
            const templateBlob = await getTrayTemplateImageBlob();
            if (templateBlob) {
              sourceBlob = templateBlob;
              fileNameForBlob =
                trayReportBaseContext.materialTrayMetadata
                  ?.imageTemplateFileName ?? 'TrayTypeImage';
              description = 'Tray type illustration';
              layout = 'default';
              maxHeightEmu = TRAY_TEMPLATE_MAX_HEIGHT_EMU;
            }
          }

          if (sourceBlob) {
            pendingImagePlaceholders[trimmedPlaceholder] = {
              blob: sourceBlob,
              fileName: fileNameForBlob,
              description,
              layout,
              maxHeightEmu
            };
          }
          continue;
        }

        const resolvedValue = placeholderBundle.values[rowId] ?? '';
        if (
          trimmedPlaceholder in textReplacements &&
          textReplacements[trimmedPlaceholder] !== resolvedValue &&
          resolvedValue !== ''
        ) {
          console.warn(
            `Placeholder "${trimmedPlaceholder}" has multiple values; keeping the first one.`
          );
          continue;
        }
        textReplacements[trimmedPlaceholder] = resolvedValue;
      }

      const resolvedImagePlaceholders = await prepareImageDefinitions(
        pendingImagePlaceholders
      );

      const updatedDocumentBlob = await replaceDocxPlaceholders(
        templateBlob,
        textReplacements,
        {
          tables:
            Object.keys(tableReplacements).length > 0
              ? tableReplacements
              : undefined,
          images:
            Object.keys(resolvedImagePlaceholders).length > 0
              ? resolvedImagePlaceholders
              : undefined
        }
      );

      const wordContentType =
        contentType && contentType !== 'application/octet-stream'
          ? contentType
          : WORD_MIME_TYPE;

      const reportFile = new File([updatedDocumentBlob], report, {
        type: wordContentType
      });

      const reportReplaceId = findExistingFileIdByName(report);

      const { file: uploadedReport } = await uploadProjectFile(
        token,
        projectId,
        reportFile,
        reportReplaceId ? { replaceFileId: reportReplaceId } : undefined
      );

      registerProjectFile(uploadedReport);

      triggerFileDownload(updatedDocumentBlob, report);

      showToast({
        intent: 'success',
        title: 'Tray report generated',
        body: `Saved as "${uploadedReport.fileName}". Check your downloads to store a local copy.`
      });
    } catch (error) {
      console.error('Failed to generate tray report', error);
      showToast({
        intent: 'error',
        title: 'Failed to generate tray report',
        body:
          error instanceof ApiError
            ? error.message
            : error instanceof Error
            ? error.message
            : undefined
      });
    } finally {
      setIsGeneratingReport(false);
    }
  }, [
    project,
    tray,
    projectId,
    token,
    trayReportBaseContext,
    showToast,
    canonicalProjectId
  ]);

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
        canGenerateReport={canGenerateReport}
        isGeneratingReport={isGeneratingReport}
        onNavigateTray={handleNavigateTray}
        onBack={() => navigate(`/projects/${projectId}?tab=trays`)}
        onGenerateReport={() => void handleGenerateReport()}
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
          manufacturer={selectedMaterialTray?.manufacturer ?? null}
          rungHeightMm={selectedRungHeightMm}
          styles={styles}
        />
      )}

      <div className={styles.section}>
        <Caption1>Bundle configuration for this tray</Caption1>
        <Checkbox
          label="Use custom bundle configuration for this tray"
          checked={bundleFormUseCustom}
          onChange={handleBundleUseCustomChange}
          disabled={!isEditing}
        />
        {isEditing && bundleFormUseCustom !== isUsingCustomBundles ? (
          <Body1 className={styles.emptyState}>
            Save to {bundleFormUseCustom ? 'apply tray bundle overrides' : 'use project bundle settings'}.
          </Body1>
        ) : null}
        {isEditing && bundleFormUseCustom && trayCableCategories.length === 0 ? (
          <Body1 className={styles.emptyState}>
            Add cables to this tray to configure bundle spacing.
          </Body1>
        ) : null}
        {bundleFormUseCustom && isEditing && trayCableCategories.length > 0 ? (
          <>
            <Body1>
              These settings override the project bundle configuration only for this tray.
            </Body1>
            <div className={styles.grid}>
              {trayCableCategories.map((key) => {
                const form = bundleFormState[key];
                const error = bundleFormErrors[key];
                const config = CABLE_CATEGORY_CONFIG[key];
                return (
                  <div key={key} className={styles.bundleCard}>
                    <Caption1 className={styles.fieldTitle}>{config.label}</Caption1>
                    <Field
                      label="Max rows"
                      validationState={error ? 'error' : undefined}
                      validationMessage={error ?? undefined}
                    >
                      <Input
                        value={form.maxRows}
                        type="number"
                        onChange={handleBundleNumericChange(key, 'maxRows')}
                      />
                    </Field>
                    <Field label="Max columns">
                      <Input
                        value={form.maxColumns}
                        type="number"
                        onChange={handleBundleNumericChange(key, 'maxColumns')}
                      />
                    </Field>
                    <Field label="Space between bundles">
                      <Dropdown
                        selectedOptions={[form.bundleSpacing]}
                        value={form.bundleSpacing}
                        onOptionSelect={handleBundleSpacingChange(key)}
                      >
                        {BUNDLE_SPACING_OPTIONS.map((option) => (
                          <Option key={option} value={option}>
                            {option}
                          </Option>
                        ))}
                      </Dropdown>
                    </Field>
                    {config.showTrefoil ? (
                      <Checkbox
                        label="Trefoil"
                        checked={form.trefoil}
                        onChange={handleBundleToggle(key, 'trefoil')}
                      />
                    ) : null}
                    {config.allowTrefoilSpacing ? (
                      <Checkbox
                        label="Space between trefoil bundles"
                        checked={form.trefoilSpacing}
                        onChange={handleBundleToggle(key, 'trefoilSpacing')}
                      />
                    ) : null}
                    {config.allowPhaseRotation ? (
                      <Checkbox
                        label="Apply phase rotation"
                        checked={form.phaseRotation}
                        onChange={handleBundleToggle(key, 'phaseRotation')}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
        {isEditing ? (
          <div className={styles.actions}>
            <Button
              appearance="secondary"
              onClick={() => handleResetBundleForm()}
              disabled={bundleSaving}
            >
              Reset
            </Button>
            <Button
              appearance="primary"
              onClick={handleSaveBundleConfig}
              disabled={bundleSaving}
            >
              {bundleSaving ? 'Saving...' : 'Save bundle settings'}
            </Button>
          </div>
        ) : null}
        <div className={styles.bundleSummary}>
          <Body1>
            {isUsingCustomBundles
              ? 'Custom tray bundle configuration is applied.'
              : 'Project bundle configuration is applied.'}
          </Body1>
          {trayBundleDetails.length === 0 ? (
            <Body1 className={styles.emptyState}>
              {trayCables.length === 0
                ? 'There are no cables on this tray.'
                : 'Bundles configuration is not defined for the cables on this tray.'}
            </Body1>
          ) : (
            trayBundleDetails.map((detail) => (
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
                }<br />
                {detail.trefoilSpacing !== null ? (
                  <>
                    Space between trefoil bundles -{' '}
                    {detail.trefoilSpacing ? 'Enabled' : 'Disabled'}{'    '}<br />
                  </>
                ) : null}
                {detail.phaseRotation !== null ? (
                  <>
                    Apply phase rotation -{' '}
                    {detail.phaseRotation ? 'Enabled' : 'Disabled'}
                  </>
                ) : null}
              </Body1>
            ))
          )}
        </div>
      </div>

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
          {
            label: 'Tray weight load per meter kg/m',
            value: trayWeightLoadPerMeterKg,
            formula: trayWeightLoadPerMeterFormula
          },
          {
            label: 'Tray total own weight kg',
            value: trayTotalOwnWeightKg,
            formula: trayTotalOwnWeightFormula
          }
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
          isAdmin={isAdmin}
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
            <Caption1>Cables weight load per meter kg/m</Caption1>
            <Body1>
              {cablesWeightPerMeterFormula ?? formatSupportNumber(cablesWeightLoadPerMeterKg)}
            </Body1>
          </div>
          <div className={styles.field}>
            <Caption1>Total weight on the tray kg</Caption1>
            <Body1>
              {cablesTotalWeightFormula ?? formatSupportNumber(cablesTotalWeightKg)}
            </Body1>
          </div>
        </div>
      </div>

      {/* Total Weight Section */}
      <WeightCalculationsSection
        title="Total weight calculations"
        calculations={[
          {
            label: 'Total weight load per meter kg/m',
            value: totalWeightLoadPerMeterKg,
            formula: totalWeightLoadPerMeterFormula
          },
          {
            label: 'Total weight kg',
            value: totalWeightKg,
            formula: totalWeightFormula
          }
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
        refreshKey={loadCurveRefreshKey}
        canvasRef={loadCurveCanvasRef}
      />
      <div className={styles.section}>
        <Caption1>Free space calculations</Caption1>
        <div className={styles.grid}>
          <div className={styles.field}>
            <Caption1>Useful tray height [mm]</Caption1>
            <Body1>{usefulTrayHeightFormula ?? usefulTrayHeightDisplay}</Body1>
          </div>
          <div className={styles.field}>
            <Caption1>Space occupied by cables</Caption1>
            <Body1>{occupiedWidthFormula ?? occupiedWidthDisplay}</Body1>
          </div>
          <div className={styles.field}>
            <Caption1>Cable tray free space</Caption1>
            <Body1>{trayFreeSpaceFormula ?? trayFreeSpaceDisplay}</Body1>
          </div>
        </div>
        {freeSpaceAlert ? (
          <Body1
            className={
              freeSpaceAlert.kind === 'danger'
                ? styles.freeSpaceDanger
                : styles.freeSpaceWarning
            }
          >
            {freeSpaceAlert.message}
          </Body1>
        ) : null}
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
        {isAdmin ? (
          <Button
            appearance="primary"
            onClick={() => void handleGenerateReport()}
            disabled={!canGenerateReport || isGeneratingReport}
          >
            {isGeneratingReport ? 'Generating...' : 'Generate report'}
          </Button>
        ) : null}
        <Button appearance="secondary" onClick={handleNextTray} disabled={!nextTray}>
          Next tray
        </Button>
      </div>
    </section>
  );
};
