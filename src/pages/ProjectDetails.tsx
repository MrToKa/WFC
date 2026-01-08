import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Body1,
  Button,
  Spinner,
  Tab,
  TabList,
  TabValue,
  Title3
} from '@fluentui/react-components';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ApiError, updateProject } from '@/api/client';
import type {
  ProjectCableCategorySettings,
  ProjectCableLayout,
  ProjectTrayPurposeTemplate
} from '@/api/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { getTrayBundleOverrides } from '@/utils/trayBundleOverrides';
import type { TrayBundleOverride } from '@/utils/trayBundleOverrides';

import { useProjectDetailsStyles } from './ProjectDetails.styles';
import { ProjectDetailsTab } from './ProjectDetails.forms';
import { formatNumeric, isWordDocument } from './ProjectDetails.utils';
import { CableReportTab } from './ProjectDetails/CableReportTab';
import {
  CableDialog,
  type CableDialogField
} from './ProjectDetails/CableDialog';
import { CableListTab } from './ProjectDetails/CableListTab';
import { CableTypeDialog } from './ProjectDetails/CableTypeDialog';
import { CableTypesTab } from './ProjectDetails/CableTypesTab';
import { DetailsTab } from './ProjectDetails/DetailsTab';
import { ProgressDialog } from './ProjectDetails/ProgressDialog';
import { TrayDialog } from './ProjectDetails/TrayDialog';
import { TraysTab } from './ProjectDetails/TraysTab';
import { ProjectFilesTab } from './ProjectDetails/ProjectFilesTab';
import {
  VariablesApiTab,
  type VariablesApiSection,
  type VariablesApiTable,
  type VariablesApiRow
} from './ProjectDetails/VariablesApiTab';
import { useCableListSection } from './ProjectDetails/hooks/useCableListSection';
import { useCableTypesSection } from './ProjectDetails/hooks/useCableTypesSection';
import { useProjectDetailsData } from './ProjectDetails/hooks/useProjectDetailsData';
import { useTraysSection } from './ProjectDetails/hooks/useTraysSection';
import {
  useProjectNumericField,
  NUMERIC_FIELD_LABELS
} from './ProjectDetails/hooks/useProjectNumericField';
import { useMaterialSupports } from './ProjectDetails/hooks/useMaterialSupports';
import { useSupportDistanceOverrides } from './ProjectDetails/hooks/useSupportDistanceOverrides';
import { useTrayTypeDetails } from './ProjectDetails/hooks/useTrayTypeDetails';
import { useProjectFilesSection } from './ProjectDetails/hooks/useProjectFilesSection';
import { useCableLayoutSettings } from './ProjectDetails/hooks/useCableLayoutSettings';
import { useCustomBundleRanges } from './ProjectDetails/hooks/useCustomBundleRanges';
import {
  CABLE_CATEGORY_CONFIG,
  DEFAULT_CABLE_SPACING,
  DEFAULT_CATEGORY_SETTINGS,
  type CableCategoryKey
} from './ProjectDetails/hooks/cableLayoutDefaults';
import {
  calculateTrayFreeSpaceMetrics,
  filterCablesByTray,
  matchCableCategory
} from './TrayDetails/TrayDetails.utils';
import type { TrayFreeSpaceMetrics } from './TrayDetails/TrayDetails.utils';
import {
  TrayDrawingService,
  determineCableDiameterGroup,
  determineCableDiameterGroupWithCustomRanges,
  type CableBundleMap,
  type CategoryLayoutConfig
} from './TrayDetails/trayDrawingService';
import {
  PROJECT_FILE_CATEGORIES,
  PROJECT_FILE_CATEGORY_LABELS,
  getProjectFileCategory
} from './ProjectDetails/projectFileUtils';
import { useMaterialData } from './TrayDetails/hooks';

const CATEGORY_KEYS: CableCategoryKey[] = ['power', 'control', 'mv', 'vfd'];

const buildCategoryLayoutConfig = (
  layout: ProjectCableLayout | null | undefined,
  spacingBetweenCablesMm: number
): CategoryLayoutConfig =>
  CATEGORY_KEYS.reduce<CategoryLayoutConfig>((acc, category) => {
    const defaults = DEFAULT_CATEGORY_SETTINGS[category];
    const layoutSettings = layout?.[category] ?? null;
    const trefoil = CABLE_CATEGORY_CONFIG[category].showTrefoil
      ? layoutSettings?.trefoil ?? defaults.trefoil
      : false;
    const trefoilSpacingBetweenBundles = CABLE_CATEGORY_CONFIG[category].allowTrefoilSpacing
      ? layoutSettings?.trefoilSpacingBetweenBundles ??
        defaults.trefoilSpacingBetweenBundles
      : defaults.trefoilSpacingBetweenBundles;
    const applyPhaseRotation = CABLE_CATEGORY_CONFIG[category].allowPhaseRotation
      ? layoutSettings?.applyPhaseRotation ?? defaults.applyPhaseRotation
      : defaults.applyPhaseRotation;

    acc[category] = {
      maxRows: layoutSettings?.maxRows ?? defaults.maxRows,
      maxColumns: layoutSettings?.maxColumns ?? defaults.maxColumns,
      bundleSpacing: layoutSettings?.bundleSpacing ?? defaults.bundleSpacing,
      cableSpacing: spacingBetweenCablesMm,
      trefoil,
      trefoilSpacingBetweenBundles,
      applyPhaseRotation
    };
    return acc;
  }, {} as CategoryLayoutConfig);

const mergeTrayLayoutOverrides = (
  baseLayout: ProjectCableLayout | null,
  override: TrayBundleOverride | null
): ProjectCableLayout | null => {
  if (!override?.useCustom) {
    return baseLayout;
  }

  const mergedCategories = CATEGORY_KEYS.reduce<
    Record<CableCategoryKey, ProjectCableCategorySettings>
  >((acc, key) => {
    const defaults = DEFAULT_CATEGORY_SETTINGS[key];
    const baseSettings =
      (baseLayout?.[key] as ProjectCableCategorySettings | null) ?? defaults;
    const overrideSettings = override.categories?.[key];
    acc[key] = overrideSettings ? { ...baseSettings, ...overrideSettings } : baseSettings;
    return acc;
  }, {} as Record<CableCategoryKey, ProjectCableCategorySettings>);

  return {
    cableSpacing: baseLayout?.cableSpacing ?? DEFAULT_CABLE_SPACING,
    considerBundleSpacingAsFree: baseLayout?.considerBundleSpacingAsFree ?? null,
    minFreeSpacePercent: baseLayout?.minFreeSpacePercent ?? null,
    maxFreeSpacePercent: baseLayout?.maxFreeSpacePercent ?? null,
    power: mergedCategories.power ?? DEFAULT_CATEGORY_SETTINGS.power,
    control: mergedCategories.control ?? DEFAULT_CATEGORY_SETTINGS.control,
    mv: mergedCategories.mv ?? DEFAULT_CATEGORY_SETTINGS.mv,
    vfd: mergedCategories.vfd ?? DEFAULT_CATEGORY_SETTINGS.vfd
  };
};
const VALID_TABS: ProjectDetailsTab[] = [
  'details',
  'cables',
  'cable-list',
  'trays',
  'files',
  'cable-report',
  'variables-api'
];

export const ProjectDetails = () => {
  const styles = useProjectDetailsStyles();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projectId } = useParams<{ projectId: string }>();
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const { materialTrays } = useMaterialData();

  const isAdmin = Boolean(user?.isAdmin);
  const canManageCables = Boolean(token);

  const findMaterialTrayManufacturer = useCallback(
    (trayType: string | null | undefined): string | null => {
      if (!trayType) {
        return null;
      }
      const normalized = trayType.trim().toLowerCase();
      if (!normalized) {
        return null;
      }
      const match = materialTrays.find(
        (materialTray) =>
          materialTray.type.trim().toLowerCase() === normalized
      );
      const manufacturer = match?.manufacturer?.trim();
      return manufacturer ? (manufacturer === '' ? null : manufacturer) : null;
    },
    [materialTrays]
  );

  const [selectedTab, setSelectedTab] = useState<ProjectDetailsTab>(() => {
    const tabParam = searchParams.get('tab');
    const initial = tabParam && VALID_TABS.includes(tabParam as ProjectDetailsTab)
      ? (tabParam as ProjectDetailsTab)
      : 'details';
    // Prevent non-admin users from landing on Variables API via deep link
    return initial === 'variables-api' && !isAdmin ? 'details' : initial;
  });

  const [progressDialogOpen, setProgressDialogOpen] = useState(false);
  const [trayTemplateSaving, setTrayTemplateSaving] = useState<Record<string, boolean>>({});
  const [trayTemplateErrors, setTrayTemplateErrors] = useState<Record<string, string | null>>({});
  const [trayTemplateOverrides, setTrayTemplateOverrides] =
    useState<Record<string, ProjectTrayPurposeTemplate> | null>(null);
  const openProgress = useCallback(() => setProgressDialogOpen(true), []);

  const {
    project,
    projectLoading,
    projectError,
    formattedDates,
    reloadProject
  } = useProjectDetailsData({ projectId });
  const canonicalProjectId = project?.id ?? projectId ?? null;

  const {
    cables,
    pagedCables,
    totalCablePages,
    cablesPage,
    showCablePagination,
    cablesLoading,
    cablesRefreshing,
    cablesError,
    cablesImporting,
    cablesExporting,
    cablesGettingTemplate,
    pendingCableId,
    fileInputRef: cablesFileInputRef,
    inlineEditingEnabled,
    setInlineEditingEnabled,
    inlineUpdatingIds,
    cableDrafts,
    reloadCables,
    goToPreviousPage: handleCablesPreviousPage,
    goToNextPage: handleCablesNextPage,
    openCreateCableDialog,
    openEditCableDialog,
    handleDeleteCable,
    handleImportCables,
    handleExportCables,
    handleGetCablesTemplate,
    handleCableDraftChange,
    handleCableTextFieldBlur,
    handleInlineCableTypeChange,
    filterText,
    filterCriteria,
    setFilterText: setCableFilterText,
    setFilterCriteria: setCableFilterCriteria,
    cableDialog
  } = useCableListSection({
    projectId,
    project,
    token,
    showToast
  });

  const cableDialogVisibleFields: CableDialogField[] = (() => {
    if (cableDialog.mode === 'edit') {
      if (selectedTab === 'cable-report') {
        return ['installLength', 'pullDate', 'connectedFrom', 'connectedTo', 'tested'];
      }
      return ['tag', 'cableTypeId', 'fromLocation', 'toLocation', 'routing', 'designLength'];
    }
    return [
      'cableId',
      'tag',
      'cableTypeId',
      'fromLocation',
      'toLocation',
      'routing',
      'designLength',
      'installLength',
      'pullDate',
      'connectedFrom',
      'connectedTo',
      'tested'
    ];
  })();

  const {
    cableTypes,
    cableTypesLoading,
    cableTypesRefreshing,
    cableTypesError,
    cableTypesImporting,
    cableTypesExporting,
    cableTypesGettingTemplate,
    pendingCableTypeId,
    pagedCableTypes,
    totalCableTypePages,
    cableTypePage,
    showCableTypePagination,
    fileInputRef: cableTypesFileInputRef,
    searchText: cableTypesSearchText,
    searchCriteria: cableTypesSearchCriteria,
    setSearchText: setCableTypesSearchText,
    setSearchCriteria: setCableTypesSearchCriteria,
    reloadCableTypes,
    goToPreviousPage: handleCableTypesPreviousPage,
    goToNextPage: handleCableTypesNextPage,
    openCreateCableTypeDialog,
    openEditCableTypeDialog,
    handleDeleteCableType,
    handleImportCableTypes,
    handleExportCableTypes,
    handleGetCableTypesTemplate,
    cableTypeDialog
  } = useCableTypesSection({
    projectId,
    project,
    token,
    showToast,
    onMutate: () => void reloadCables({ showSpinner: false })
  });

  const {
    trays,
    pagedTrays,
    totalTrayPages,
    traysPage,
    showTrayPagination,
    traysLoading,
    traysRefreshing,
    traysError,
    traysImporting,
    traysExporting,
    traysGettingTemplate,
    pendingTrayId,
    fileInputRef: traysFileInputRef,
    searchText: traysSearchText,
    searchCriteria: traysSearchCriteria,
    setSearchText: setTraysSearchText,
    setSearchCriteria: setTraysSearchCriteria,
    reloadTrays,
    goToPreviousPage: handleTraysPreviousPage,
    goToNextPage: handleTraysNextPage,
    openCreateTrayDialog,
    handleDeleteTray,
    handleImportTrays,
    handleExportTrays,
    handleGetTraysTemplate,
    trayDialog
  } = useTraysSection({
    projectId,
    project,
    token,
    showToast
  });

  const {
    files: projectFiles,
    isLoading: projectFilesLoading,
    isRefreshing: projectFilesRefreshing,
    isUploading: projectFilesUploading,
    downloadingFileId: downloadingProjectFileId,
    pendingFileId: deletingProjectFileId,
    error: projectFilesError,
    fileInputRef: projectFilesInputRef,
    canUpload: canUploadProjectFiles,
    maxFileSizeBytes: projectFileMaxSize,
    reloadFiles: reloadProjectFiles,
    handleFileInputChange: handleProjectFileInputChange,
    handleDeleteFile: handleProjectFileDelete,
    handleDownloadFile: handleProjectFileDownload,
    replaceDialog: projectFilesReplaceDialog,
    handleReplaceConfirm: handleProjectFileReplaceConfirm,
    handleReplaceCancel: handleProjectFileReplaceCancel,
    openVersionsDialog: openProjectFileVersionsDialog,
    closeVersionsDialog: closeProjectFileVersionsDialog,
    versionsDialog: projectFileVersionsDialog,
    handleDownloadVersion: handleProjectFileVersionDownload,
    handleDeleteVersion: handleProjectFileVersionDelete
  } = useProjectFilesSection({
    projectId,
    token,
    isAdmin,
    showToast
  });

  const wordFileOptions = useMemo(
    () =>
      projectFiles
        .filter((file) => isWordDocument(file.fileName, file.contentType))
        .map((file) => ({
          id: file.id,
          label: file.fileName
        })),
    [projectFiles]
  );

  const effectiveTrayTemplates: Record<string, ProjectTrayPurposeTemplate> =
    trayTemplateOverrides ?? project?.trayPurposeTemplates ?? {};

  const trayTemplateRows = useMemo(() => {
    if (!project) {
      return [];
    }

    const purposeMap = new Map<string, string>();
    trays.forEach((tray) => {
      if (!tray.purpose) {
        return;
      }
      const trimmed = tray.purpose.trim();
      if (!trimmed || purposeMap.has(trimmed)) {
        return;
      }
      purposeMap.set(trimmed, trimmed);
    });

    if (purposeMap.size === 0) {
      return [];
    }

    return Array.from(purposeMap.entries())
      .sort((a, b) =>
        a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })
      )
      .map(([purpose, label]) => {
        const assignment = effectiveTrayTemplates[purpose] ?? null;
        const selectedFileId = assignment?.fileId ?? null;
        const selectedFileAvailable =
          !selectedFileId ||
          wordFileOptions.some((option) => option.id === selectedFileId);

        return {
          purpose,
          label,
          selectedFileId,
          selectedFileName: assignment?.fileName ?? null,
          selectedFileAvailable
        };
      });
  }, [effectiveTrayTemplates, project, trays, wordFileOptions]);

  const secondaryTrayLengthField = useProjectNumericField({
    project,
    field: 'secondaryTrayLength',
    token,
    isAdmin,
    showToast,
    reloadProject
  });
  const supportDistanceField = useProjectNumericField({
    project,
    field: 'supportDistance',
    token,
    isAdmin,
    showToast,
    reloadProject
  });
  const supportWeightField = useProjectNumericField({
    project,
    field: 'supportWeight',
    token,
    isAdmin,
    showToast,
    reloadProject
  });
  const trayLoadSafetyFactorField = useProjectNumericField({
    project,
    field: 'trayLoadSafetyFactor',
    token,
    isAdmin,
    showToast,
    reloadProject
  });

  const numericFields = useMemo(
    () => [
      {
        field: 'secondaryTrayLength' as const,
        label: NUMERIC_FIELD_LABELS.secondaryTrayLength,
        unit: 'm',
        ...secondaryTrayLengthField
      },
      {
        field: 'supportDistance' as const,
        label: NUMERIC_FIELD_LABELS.supportDistance,
        unit: 'm',
        ...supportDistanceField
      },
      {
        field: 'supportWeight' as const,
        label: NUMERIC_FIELD_LABELS.supportWeight,
        unit: 'kg',
        ...supportWeightField
      },
      {
        field: 'trayLoadSafetyFactor' as const,
        label: NUMERIC_FIELD_LABELS.trayLoadSafetyFactor,
        unit: '%',
        ...trayLoadSafetyFactorField
      }
    ],
    [
      secondaryTrayLengthField,
      supportDistanceField,
      supportWeightField,
      trayLoadSafetyFactorField
    ]
  );

  const trayTypeDetails = useTrayTypeDetails({
    trays,
    project
  });

  const { supports, supportsLoading, supportsError } = useMaterialSupports({
    isAdmin,
    showToast
  });

  const supportDistanceOverrideFields = useSupportDistanceOverrides({
    project,
    trayTypeDetails,
    supports,
    supportsLoading,
    supportsError,
    token,
    isAdmin,
    showToast,
    reloadProject
  });

  const { cableSpacingField, categoryCards: cableCategoryCards } =
    useCableLayoutSettings({
      project,
      token,
      isAdmin,
      showToast,
      reloadProject
    });

  const customBundleRangesController = useCustomBundleRanges({
    project,
    token,
    isAdmin,
    showToast,
    reloadProject
  });

  const trayDrawingService = useMemo(
    () => new TrayDrawingService(),
    []
  );

  const projectCableSpacingMm = useMemo(() => {
    const spacing = project?.cableLayout?.cableSpacing;
    if (
      typeof spacing === 'number' &&
      Number.isFinite(spacing) &&
      spacing >= 0
    ) {
      return spacing;
    }
    return DEFAULT_CABLE_SPACING;
  }, [project?.cableLayout?.cableSpacing]);

  const considerBundleSpacingAsFree = Boolean(
    project?.cableLayout?.considerBundleSpacingAsFree
  );
  const minFreeSpacePercent = project?.cableLayout?.minFreeSpacePercent ?? null;
  const maxFreeSpacePercent = project?.cableLayout?.maxFreeSpacePercent ?? null;

  const trayFreeSpaceMetricsById = useMemo<Record<string, TrayFreeSpaceMetrics>>(() => {
    if (trays.length === 0) {
      return {};
    }

    const baseLayout = project?.cableLayout ?? null;
    const docAvailable = typeof document !== 'undefined';
    const canvas = docAvailable ? document.createElement('canvas') : null;

    return trays.reduce<Record<string, TrayFreeSpaceMetrics>>((acc, tray) => {
      const trayOverride: TrayBundleOverride | null =
        canonicalProjectId && tray.id
          ? getTrayBundleOverrides(canonicalProjectId, tray.id)
          : null;
      const effectiveLayout = mergeTrayLayoutOverrides(baseLayout, trayOverride);
      const spacingBetweenCables =
        typeof effectiveLayout?.cableSpacing === 'number' &&
        Number.isFinite(effectiveLayout.cableSpacing) &&
        effectiveLayout.cableSpacing >= 0
          ? effectiveLayout.cableSpacing
          : projectCableSpacingMm;
      const layoutConfig = buildCategoryLayoutConfig(
        effectiveLayout,
        spacingBetweenCables
      );

      const trayCables = filterCablesByTray(cables, tray.name);
      
      // Use project-level custom bundle ranges
      const projectCustomRanges = project?.cableLayout?.customBundleRanges;

      const cableBundles = trayCables.reduce<CableBundleMap>((bundleAcc, cable) => {
        const category = matchCableCategory(cable.purpose);
        if (!category) {
          return bundleAcc;
        }

        if (!bundleAcc[category]) {
          bundleAcc[category] = {};
        }

        const bucket = bundleAcc[category];
        // Use custom bundle ranges for this category if available at project level
        const categoryCustomRanges = projectCustomRanges?.[category as CableCategoryKey];
        const bundleKey = categoryCustomRanges && categoryCustomRanges.length > 0
          ? determineCableDiameterGroupWithCustomRanges(cable.diameterMm ?? null, categoryCustomRanges)
          : determineCableDiameterGroup(cable.diameterMm ?? null);
        if (!bucket[bundleKey]) {
          bucket[bundleKey] = [];
        }
        bucket[bundleKey].push(cable);
        return bundleAcc;
      }, {} as CableBundleMap);

      let layoutSummary = null;
      if (
        canvas &&
        trayDrawingService &&
        typeof tray.widthMm === 'number' &&
        tray.widthMm > 0 &&
        typeof tray.heightMm === 'number' &&
        tray.heightMm > 0
      ) {
        try {
          layoutSummary = trayDrawingService.drawTrayLayout(
            canvas,
            tray,
            trayCables,
            cableBundles,
            6,
            spacingBetweenCables,
            layoutConfig
          );
        } catch (error) {
          console.error('Failed to build tray layout summary', {
            trayId: tray.id,
            error
          });
        }
      }

      const metrics = calculateTrayFreeSpaceMetrics({
        tray,
        cables: trayCables,
        layout: effectiveLayout,
        spacingBetweenCablesMm: spacingBetweenCables,
        considerBundleSpacingAsFree: Boolean(effectiveLayout?.considerBundleSpacingAsFree),
        layoutSummary: layoutSummary ?? undefined
      });

      acc[tray.id] = metrics;

      return acc;
    }, {});
  }, [
    cables,
    canonicalProjectId,
    project?.cableLayout,
    projectCableSpacingMm,
    trayDrawingService,
    trays
  ]);

  const trayFreeSpaceById = useMemo<Record<string, number | null>>(
    () =>
      Object.entries(trayFreeSpaceMetricsById).reduce(
        (acc, [trayId, metrics]) => {
          acc[trayId] =
            metrics.calculationAvailable && metrics.freeWidthPercent !== null
              ? metrics.freeWidthPercent
              : null;
          return acc;
        },
        {} as Record<string, number | null>
      ),
    [trayFreeSpaceMetricsById]
  );


  const variablesApiSections = useMemo<VariablesApiSection[]>(() => {
    if (!project) {
      return [];
    }

    const numberFormatter = new Intl.NumberFormat();
    const percentFormatter = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    const fallbackText = (value: string | null | undefined): string => {
      if (value === null || value === undefined) {
        return '-';
      }
      const trimmed = value.trim();
      return trimmed === '' ? '-' : trimmed;
    };

    const formatNumberWithUnit = (
      value: number | null | undefined,
      unit?: string
    ): string => {
      const formatted = formatNumeric(
        typeof value === 'number' ? value : value ?? null
      );
      return formatted === '-' ? '-' : unit ? `${formatted} ${unit}` : formatted;
    };

    const yesNo = (value: boolean | null | undefined): string => {
      if (value === null || value === undefined) {
        return '-';
      }
      return value ? 'Yes' : 'No';
    };

    const formatPercentValue = (
      value: number | null | undefined
    ): string => {
      if (value === null || value === undefined) {
        return '-';
      }
      return `${percentFormatter.format(value)} %`;
    };

    const formatRowCount = (count: number): string => {
      const normalized = count < 0 ? 0 : count;
      return `${numberFormatter.format(normalized)} ${
        normalized === 1 ? 'row' : 'rows'
      }`;
    };

    const formatDateTime = (value: string | null | undefined): string => {
      if (!value) {
        return '-';
      }
      return dateTimeFormatter.format(new Date(value));
    };

    const buildTableVariable = ({
      sectionId,
      tableId,
      label,
      displayName,
      recordCount,
      note
    }: {
      sectionId: string;
      tableId: string;
      label: string;
      displayName?: string;
      recordCount?: number | null;
      note?: string;
    }): VariablesApiTable => {
      const safeCount =
        typeof recordCount === 'number' && Number.isFinite(recordCount)
          ? recordCount
          : null;
      const summaryParts: string[] = [];

      if (note) {
        summaryParts.push(note);
      } else {
        summaryParts.push('Entire table export');
      }

      if (safeCount !== null) {
        summaryParts.push(formatRowCount(safeCount));
      }

      return {
        id: `${sectionId}:${tableId}`,
        label,
        rows: [
          {
            id: `table:${sectionId}:${tableId}`,
            name: displayName ?? label,
            value: summaryParts.join(' — ')
          }
        ]
      };
    };

    const sections: VariablesApiSection[] = [];

    const currentUserDisplay = (() => {
      if (!user) {
        return '-';
      }
      const name = [user.firstName, user.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      return name !== '' ? name : user.email ?? '-';
    })();

    const detailRows: VariablesApiRow[] = [
      {
        id: 'details:project-number',
        name: 'Project number',
        value: fallbackText(project.projectNumber)
      },
      {
        id: 'details:project-name',
        name: 'Project name',
        value: fallbackText(project.name)
      },
      {
        id: 'details:customer',
        name: 'Customer',
        value: fallbackText(project.customer)
      },
      {
        id: 'details:manager',
        name: 'Manager',
        value: fallbackText(project.manager)
      },
      {
        id: 'details:description',
        name: 'Description',
        value: fallbackText(project.description)
      },
      {
        id: 'details:current-user',
        name: 'Current user',
        value: currentUserDisplay
      },
      {
        id: 'details:created-at',
        name: 'Created at',
        value: formattedDates?.created ?? '-'
      },
      {
        id: 'details:updated-at',
        name: 'Last updated',
        value: formattedDates?.updated ?? '-'
      },
      {
        id: 'details:secondary-tray-length',
        name: 'Secondary tray length',
        value: formatNumberWithUnit(project.secondaryTrayLength, 'm')
      },
      {
        id: 'details:support-distance',
        name: 'Support distance',
        value: formatNumberWithUnit(project.supportDistance, 'm')
      },
      {
        id: 'details:support-weight',
        name: 'Support weight',
        value: formatNumberWithUnit(project.supportWeight, 'kg')
      },
      {
        id: 'details:tray-load-safety-factor',
        name: 'Tray load safety factor',
        value: formatNumberWithUnit(project.trayLoadSafetyFactor, '%')
      },
      {
        id: 'details:cable-spacing',
        name: 'Cable spacing',
        value: formatNumberWithUnit(project.cableLayout?.cableSpacing, 'mm')
      },
      {
        id: 'details:bundle-spacing-free',
        name: 'Bundle spacing counted as free space',
        value: yesNo(project.cableLayout?.considerBundleSpacingAsFree)
      },
      {
        id: 'details:min-free-space',
        name: 'Minimum tray free space',
        value: formatNumberWithUnit(project.cableLayout?.minFreeSpacePercent, '%')
      },
      {
        id: 'details:max-free-space',
        name: 'Maximum tray free space',
        value: formatNumberWithUnit(project.cableLayout?.maxFreeSpacePercent, '%')
      }
    ];

    const detailTables: VariablesApiTable[] =
      detailRows.length > 0
        ? [
            {
              id: 'details:main',
              label: 'Main table',
              rows: detailRows
            }
          ]
        : [];

    detailTables.push(
      buildTableVariable({
        sectionId: 'details',
        tableId: 'tray-report-templates',
        label: 'Tray report templates',
        displayName: 'Tray report templates table',
        recordCount: trayTemplateRows.length
      })
    );

    sections.push({
      id: 'details',
      label: 'Details',
      tables: detailTables
    });

    sections.push({
      id: 'cables',
      label: 'Cable types',
      tables: [
        buildTableVariable({
          sectionId: 'cables',
          tableId: 'main',
          label: 'Main table',
          displayName: 'Cable types main table',
          recordCount: cableTypes.length
        })
      ]
    });

    sections.push({
      id: 'cable-list',
      label: 'Cables list',
      tables: [
        buildTableVariable({
          sectionId: 'cable-list',
          tableId: 'main',
          label: 'Main table',
          displayName: 'Cables list main table',
          recordCount: cables.length
        })
      ]
    });

    sections.push({
      id: 'cable-report',
      label: 'Cables report',
      tables: [
        buildTableVariable({
          sectionId: 'cable-report',
          tableId: 'main',
          label: 'Main table',
          displayName: 'Cables report main table',
          recordCount: cables.length
        })
      ]
    });

    const cableTypeNameById = new Map<string, string>();
    cableTypes.forEach((type) => {
      cableTypeNameById.set(type.id, type.name ?? type.id);
    });

    const trayTables: VariablesApiTable[] = [
      buildTableVariable({
        sectionId: 'trays',
        tableId: 'main',
        label: 'Main table',
        displayName: 'Trays main table',
        recordCount: trays.length
      })
    ];

    const sampleTray = trays[0] ?? null;
    const sampleMetrics =
      sampleTray && sampleTray.id in trayFreeSpaceMetricsById
        ? trayFreeSpaceMetricsById[sampleTray.id]
        : null;
    const sampleFreeSpace = sampleTray
      ? formatPercentValue(sampleMetrics?.freeWidthPercent ?? null)
      : '-';
    const sampleOccupiedWidth = sampleTray
      ? formatNumberWithUnit(sampleMetrics?.occupiedWidthMm ?? null, 'mm')
      : '-';
    const describeDynamicValue = (value: string): string =>
      value === '-'
        ? 'Dynamic per tray during export'
        : `${value} (example)`;
    const calculatedValueNote = 'Calculated per tray during export';
    const pushTraySection = (
      sectionId: string,
      label: string,
      rows: VariablesApiRow[]
    ) => {
      if (rows.length === 0) {
        return;
      }
      trayTables.push({
        id: `trays:${sectionId}`,
        label,
        rows
      });
    };

    pushTraySection('details', 'Tray info', [
      {
        id: 'tray-details:name',
        name: 'Tray name',
        value: describeDynamicValue(fallbackText(sampleTray?.name ?? null))
      },
      {
        id: 'tray-details:type',
        name: 'Tray type',
        value: describeDynamicValue(fallbackText(sampleTray?.type ?? null))
      },
      {
        id: 'tray-details:manufacturer',
        name: 'Tray manufacturer',
        value: describeDynamicValue(
          fallbackText(findMaterialTrayManufacturer(sampleTray?.type ?? null))
        )
      },
      {
        id: 'tray-details:purpose',
        name: 'Tray purpose',
        value: describeDynamicValue(fallbackText(sampleTray?.purpose ?? null))
      },
      {
        id: 'tray-details:width',
        name: 'Tray width [mm]',
        value: describeDynamicValue(
          formatNumberWithUnit(sampleTray?.widthMm ?? null, 'mm')
        )
      },
      {
        id: 'tray-details:height',
        name: 'Tray height [mm]',
        value: describeDynamicValue(
          formatNumberWithUnit(sampleTray?.heightMm ?? null, 'mm')
        )
      },
      {
        id: 'tray-details:length',
        name: 'Tray length [mm]',
        value: describeDynamicValue(
          formatNumberWithUnit(sampleTray?.lengthMm ?? null, 'mm')
        )
      },
      {
        id: 'tray-details:rung-height',
        name: 'Rung height [mm]',
        value: describeDynamicValue('-')
      },
      {
        id: 'tray-details:useful-height',
        name: 'Useful tray height [mm]',
        value: describeDynamicValue('-')
      },
      {
        id: 'tray-details:material-weight-per-meter',
        name: 'Tray weight per meter [kg/m]',
        value: describeDynamicValue('-')
      },
      {
        id: 'tray-details:tray-type-image',
        name: 'Tray type picture',
        value: 'Tray type template image'
      },
      {
        id: 'tray-details:occupied-space',
        name: 'Space occupied by cables [mm]',
        value: describeDynamicValue(sampleOccupiedWidth)
      },
      {
        id: 'tray-details:free-space',
        name: 'Tray free space [%]',
        value: describeDynamicValue(sampleFreeSpace)
      },
      {
        id: 'tray-details:grounding-flag',
        name: 'Grounding cable included',
        value: describeDynamicValue(
          sampleTray ? yesNo(sampleTray.includeGroundingCable) : '-'
        )
      },
      {
        id: 'tray-details:grounding-type',
        name: 'Grounding cable type',
        value: describeDynamicValue(
          sampleTray?.groundingCableTypeId
            ? cableTypeNameById.get(sampleTray.groundingCableTypeId) ??
              sampleTray.groundingCableTypeId
            : '-'
        )
      },
      {
        id: 'tray-details:grounding-note',
        name: 'Grounding cable note',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:created-at',
        name: 'Tray created at',
        value: describeDynamicValue(formatDateTime(sampleTray?.createdAt ?? null))
      },
      {
        id: 'tray-details:updated-at',
        name: 'Tray updated at',
        value: describeDynamicValue(formatDateTime(sampleTray?.updatedAt ?? null))
      }
    ]);

    pushTraySection('load-curve', 'Tray load curve', [
      {
        id: 'tray-details:load-curve-name',
        name: 'Assigned load curve',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:safety-factor',
        name: 'Safety factor [%]',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:calculated-span',
        name: 'Calculated point span [m]',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:calculated-load',
        name: 'Calculated point load [kN/m]',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:limit-highlight',
        name: 'Limit highlight span [m]',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:allowable-load',
        name: 'Allowable load at span [kN/m]',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:load-curve-status',
        name: 'Load curve status message',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:load-curve-canvas',
        name: 'Load curve canvas',
        value: 'Canvas snapshot for selected tray during export'
      }
    ]);

    pushTraySection('own-weight', 'Tray own weight calculations', [
      {
        id: 'tray-details:weight-load-per-meter',
        name: 'Tray weight load per meter [kg/m]',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:total-own-weight',
        name: 'Tray total own weight [kg]',
        value: calculatedValueNote
      }
    ]);

    pushTraySection('cables-weight', 'Cables on tray weight calculations', [
      {
        id: 'tray-details:cables-weight-load-per-meter',
        name: 'Cables weight load per meter [kg/m]',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:cables-total-weight',
        name: 'Total weight on the tray [kg]',
        value: calculatedValueNote
      }
    ]);
    pushTraySection('cables-table', 'Cables laying on the tray table', [
      {
        id: 'tray-details:cables-table',
        name: 'Cables laying on the tray',
        value: 'Entire table export for selected tray'
      }
    ]);

    pushTraySection('total-weight', 'Total weight calculations', [
      {
        id: 'tray-details:total-weight-load-per-meter',
        name: 'Total weight load per meter [kg/m]',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:total-weight',
        name: 'Total weight [kg]',
        value: calculatedValueNote
      }
    ]);

    pushTraySection('supports', 'Supports weight calculations', [
      {
        id: 'tray-details:support-type',
        name: 'Support type',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:support-length',
        name: 'Support length [mm]',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:support-distance',
        name: 'Distance between supports [m]',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:supports-count',
        name: 'Supports count',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:support-weight-per-piece',
        name: 'Support weight per piece [kg]',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:supports-total-weight',
        name: 'Supports total weight [kg]',
        value: calculatedValueNote
      },
      {
        id: 'tray-details:supports-weight-per-meter',
        name: 'Supports weight load per meter [kg/m]',
        value: calculatedValueNote
      }
    ]);

    pushTraySection('visualization', 'Tray cables laying concept', [
      {
        id: 'tray-details:concept-canvas',
        name: 'Tray cables laying concept canvas',
        value: 'Canvas snapshot for selected tray during export'
      }
    ]);

    sections.push({
      id: 'trays',
      label: 'Trays',
      tables: trayTables
    });

    const fileTables: VariablesApiTable[] = PROJECT_FILE_CATEGORIES.map(
      (category) =>
        buildTableVariable({
          sectionId: 'files',
          tableId: `category-${category}`,
          label: PROJECT_FILE_CATEGORY_LABELS[category],
          displayName: `${PROJECT_FILE_CATEGORY_LABELS[category]} files`,
          recordCount: projectFiles.filter(
            (file) => getProjectFileCategory(file) === category
          ).length,
          note: `${PROJECT_FILE_CATEGORY_LABELS[category]} files table`
        })
    );

    sections.push({
      id: 'files',
      label: 'Files',
      tables: fileTables
    });

    return sections;
  }, [
    cableTypes,
    cables,
    formattedDates,
    project,
    projectFiles,
    user,
    trays,
    trayFreeSpaceMetricsById,
    trayTemplateRows,
    findMaterialTrayManufacturer
  ]);

  const variablesTabLoading =
    projectFilesLoading || cableTypesLoading || cablesLoading || traysLoading;

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    let nextTab =
      tabParam && VALID_TABS.includes(tabParam as ProjectDetailsTab)
        ? (tabParam as ProjectDetailsTab)
        : 'details';
    // Block navigation to Variables API for non-admin users
    if (nextTab === 'variables-api' && !isAdmin) {
      nextTab = 'details';
    }
    if (nextTab !== selectedTab) {
      setSelectedTab(nextTab);
    }
  }, [searchParams, selectedTab, isAdmin]);

  const handleTabSelect = useCallback(
    (_event: unknown, data: { value: TabValue }) => {
      const requested = data.value as ProjectDetailsTab;
      // Ignore clicks on Variables API for non-admin users (should not render, but defensive)
      const tab = requested === 'variables-api' && !isAdmin ? selectedTab : requested;
      setSelectedTab(tab);
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        if (tab === 'details') {
          next.delete('tab');
        } else {
          next.set('tab', tab);
        }
        return next;
      });
    },
    [isAdmin, selectedTab, setSearchParams]
  );

  const handleCreateCable = useCallback(() => {
    if (cableTypes.length === 0) {
      showToast({
        intent: 'error',
        title: 'Cable type required',
        body: 'Create at least one cable type before adding cables.'
      });
      return;
    }

    openCreateCableDialog(cableTypes[0]?.id ?? '');
  }, [cableTypes, openCreateCableDialog, showToast]);

  const openTrayDetails = useCallback(
    (tray: { id: string }) => {
      if (!projectId) {
        return;
      }
      navigate(`/projects/${projectId}/trays/${tray.id}`);
    },
    [navigate, projectId]
  );

  const isInlineEditable = inlineEditingEnabled && canManageCables;

  useEffect(() => {
    setTrayTemplateSaving({});
    setTrayTemplateErrors({});
    setTrayTemplateOverrides(project?.trayPurposeTemplates ?? null);
  }, [project?.id, project?.trayPurposeTemplates]);

  const handleTrayTemplateChange = useCallback(
    async (purpose: string, nextFileId: string | null) => {
      const normalizedPurpose = purpose.trim();

      if (!project || !token) {
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: 'You must be signed in to update tray report templates.'
        });
        return;
      }

      if (!isAdmin) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'Only administrators can update tray report templates.'
        });
        return;
      }

      if (normalizedPurpose === '') {
        return;
      }

      setTrayTemplateSaving((previous) => ({
        ...previous,
        [normalizedPurpose]: true
      }));
      setTrayTemplateErrors((previous) => ({
        ...previous,
        [normalizedPurpose]: null
      }));

      try {
        const currentTemplates = trayTemplateOverrides ?? project.trayPurposeTemplates ?? {};
        const payload = Object.entries(currentTemplates).reduce<
          Record<string, { fileId: string }>
        >((acc, [key, value]) => {
          if (value?.fileId) {
            acc[key] = { fileId: value.fileId };
          }
          return acc;
        }, {});

        if (nextFileId) {
          payload[normalizedPurpose] = { fileId: nextFileId };
        } else {
          delete payload[normalizedPurpose];
        }

        const response = await updateProject(token, project.id, {
          trayPurposeTemplates: payload
        });
        setTrayTemplateOverrides(response.project.trayPurposeTemplates ?? {});
        showToast({
          intent: 'success',
          title: 'Tray report template updated'
        });
      } catch (error) {
        console.error('Failed to update tray report template', error);
        const message =
          error instanceof ApiError
            ? error.message
            : 'Failed to update tray report template.';
        setTrayTemplateErrors((previous) => ({
          ...previous,
          [normalizedPurpose]: message
        }));
        showToast({
          intent: 'error',
          title: 'Update failed',
          body: message
        });
      } finally {
        setTrayTemplateSaving((previous) => ({
          ...previous,
          [normalizedPurpose]: false
        }));
      }
    },
    [isAdmin, project, showToast, token, trayTemplateOverrides]
  );

  if (projectLoading) {
    return (
      <section className={styles.root}>
        <Spinner label="Loading project..." />
      </section>
    );
  }

  if (projectError) {
    return (
      <section className={styles.root}>
        <Body1 className={styles.errorText}>{projectError}</Body1>
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
        <div className={styles.headerRow}>
          <Title3 id="project-details-heading">
            {project.projectNumber} &mdash; {project.name}
          </Title3>
          {/* Progress button moved into tab action rows */}
          </div>
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
        <Tab value="cable-list">Cables list</Tab>
        <Tab value="trays">Trays</Tab>
        <Tab value="cable-report">Cables report</Tab>
        <Tab value="files">Files</Tab>
  {isAdmin ? <Tab value="variables-api">Variables API</Tab> : null}
      </TabList>

      {selectedTab === 'details' ? (
        <DetailsTab
          styles={styles}
          project={project}
          formattedDates={formattedDates}
          isAdmin={isAdmin}
          cableSpacingField={cableSpacingField}
          cableCategoryCards={cableCategoryCards}
          customBundleRanges={customBundleRangesController}
          numericFields={numericFields}
          supportDistanceOverrides={supportDistanceOverrideFields}
          trayTemplateRows={trayTemplateRows}
          trayTemplateOptions={wordFileOptions}
          trayTemplateSaving={trayTemplateSaving}
          trayTemplateErrors={trayTemplateErrors}
          canEditTrayTemplates={isAdmin && Boolean(token)}
          onTrayTemplateChange={handleTrayTemplateChange}
        />
      ) : null}

      {selectedTab === 'cables' ? (
        <CableTypesTab
          styles={styles}
          isAdmin={isAdmin}
          isRefreshing={cableTypesRefreshing}
          onRefresh={() => void reloadCableTypes({ showSpinner: false })}
          onCreate={openCreateCableTypeDialog}
          onImportClick={() => cableTypesFileInputRef.current?.click()}
          onExport={() => void handleExportCableTypes()}
          onGetTemplate={() => void handleGetCableTypesTemplate()}
          onImportFileChange={handleImportCableTypes}
          isImporting={cableTypesImporting}
          isExporting={cableTypesExporting}
          isGettingTemplate={cableTypesGettingTemplate}
          fileInputRef={cableTypesFileInputRef}
          searchText={cableTypesSearchText}
          searchCriteria={cableTypesSearchCriteria}
          onSearchTextChange={setCableTypesSearchText}
          onSearchCriteriaChange={setCableTypesSearchCriteria}
          error={cableTypesError}
          isLoading={cableTypesLoading}
          items={pagedCableTypes}
          pendingId={pendingCableTypeId}
          onEdit={openEditCableTypeDialog}
          onDelete={(cableType) => void handleDeleteCableType(cableType)}
          formatNumeric={formatNumeric}
          showPagination={showCableTypePagination}
          page={cableTypePage}
          totalPages={totalCableTypePages}
          paginationHandlers={{
            onPrevious: handleCableTypesPreviousPage,
            onNext: handleCableTypesNextPage
          }}
        />
      ) : null}

      {selectedTab === 'trays' ? (
        <TraysTab
          styles={styles}
          isAdmin={isAdmin}
          isRefreshing={traysRefreshing}
          onRefresh={() => void reloadTrays({ showSpinner: false })}
          onCreate={openCreateTrayDialog}
          onImportClick={() => traysFileInputRef.current?.click()}
          onExport={() => void handleExportTrays(trayFreeSpaceById)}
          onGetTemplate={() => void handleGetTraysTemplate()}
          onImportFileChange={handleImportTrays}
          isImporting={traysImporting}
          isExporting={traysExporting}
          isGettingTemplate={traysGettingTemplate}
          fileInputRef={traysFileInputRef}
          searchText={traysSearchText}
          searchCriteria={traysSearchCriteria}
          onSearchTextChange={setTraysSearchText}
          onSearchCriteriaChange={setTraysSearchCriteria}
          error={traysError}
          isLoading={traysLoading}
          items={pagedTrays}
          pendingId={pendingTrayId}
          freeSpaceByTrayId={trayFreeSpaceById}
          onDetails={openTrayDetails}
          onDelete={(tray) => void handleDeleteTray(tray)}
          formatNumeric={formatNumeric}
          showPagination={showTrayPagination}
          page={traysPage}
          totalPages={totalTrayPages}
          onPreviousPage={handleTraysPreviousPage}
          onNextPage={handleTraysNextPage}
          minFreeSpacePercent={minFreeSpacePercent}
          maxFreeSpacePercent={maxFreeSpacePercent}
        />
      ) : null}

      {selectedTab === 'files' ? (
        <ProjectFilesTab
          styles={styles}
          files={projectFiles}
          isLoading={projectFilesLoading}
          isRefreshing={projectFilesRefreshing}
          isUploading={projectFilesUploading}
          downloadingFileId={downloadingProjectFileId}
          pendingFileId={deletingProjectFileId}
          error={projectFilesError}
          canUpload={canUploadProjectFiles}
          maxFileSizeBytes={projectFileMaxSize}
          onRefresh={() => void reloadProjectFiles({ showSpinner: false })}
          onFileInputChange={handleProjectFileInputChange}
          onDownload={handleProjectFileDownload}
          onDelete={handleProjectFileDelete}
          onOpenVersions={openProjectFileVersionsDialog}
          onCloseVersions={closeProjectFileVersionsDialog}
          versionsDialog={projectFileVersionsDialog}
          onDownloadVersion={handleProjectFileVersionDownload}
          onDeleteVersion={handleProjectFileVersionDelete}
          replaceDialog={projectFilesReplaceDialog}
          onReplaceConfirm={handleProjectFileReplaceConfirm}
          onReplaceCancel={handleProjectFileReplaceCancel}
          fileInputRef={projectFilesInputRef}
        />
      ) : null}

      {selectedTab === 'variables-api' && isAdmin ? (
        <VariablesApiTab
          styles={styles}
          projectId={project.id}
          sections={variablesApiSections}
          isLoading={variablesTabLoading}
        />
      ) : null}

      {selectedTab === 'cable-list' ? (
        <CableListTab
          styles={styles}
          canManageCables={canManageCables}
          isAdmin={isAdmin}
          filterText={filterText}
          onFilterTextChange={setCableFilterText}
          filterCriteria={filterCriteria}
          onFilterCriteriaChange={setCableFilterCriteria}
          isRefreshing={cablesRefreshing}
          onRefresh={() => void reloadCables({ showSpinner: false })}
          onCreate={handleCreateCable}
          onImportClick={() => cablesFileInputRef.current?.click()}
          onExport={() => void handleExportCables('list')}
          onGetTemplate={() => void handleGetCablesTemplate('list')}
          onImportFileChange={handleImportCables}
          isImporting={cablesImporting}
          isExporting={cablesExporting}
          isGettingTemplate={cablesGettingTemplate}
          fileInputRef={cablesFileInputRef}
          inlineEditingEnabled={inlineEditingEnabled}
          onInlineEditingToggle={setInlineEditingEnabled}
          inlineUpdatingIds={inlineUpdatingIds}
          isInlineEditable={isInlineEditable}
          cableTypes={cableTypes}
          items={pagedCables}
          drafts={cableDrafts}
          onDraftChange={handleCableDraftChange}
          onTextFieldBlur={(cable, field) =>
            void handleCableTextFieldBlur(cable, field)
          }
          onInlineCableTypeChange={(cable, nextCableTypeId) =>
            void handleInlineCableTypeChange(cable, nextCableTypeId)
          }
          pendingId={pendingCableId}
          onEdit={openEditCableDialog}
          onDelete={(cable) => void handleDeleteCable(cable)}
          error={cablesError}
          isLoading={cablesLoading}
          showPagination={showCablePagination}
          page={cablesPage}
          totalPages={totalCablePages}
          onPreviousPage={handleCablesPreviousPage}
          onNextPage={handleCablesNextPage}
        />
      ) : null}

      {selectedTab === 'cable-report' ? (
        <CableReportTab
          styles={styles}
          canManageCables={canManageCables}
          isAdmin={isAdmin}
          onOpenProgress={openProgress}
          isRefreshing={cablesRefreshing}
          onRefresh={() => void reloadCables({ showSpinner: false })}
          onImportClick={() => cablesFileInputRef.current?.click()}
          onExport={() => void handleExportCables('report')}
          onImportFileChange={handleImportCables}
          isImporting={cablesImporting}
          isExporting={cablesExporting}
          fileInputRef={cablesFileInputRef}
          filterText={filterText}
          onFilterTextChange={setCableFilterText}
          filterCriteria={filterCriteria}
          onFilterCriteriaChange={setCableFilterCriteria}
          inlineEditingEnabled={inlineEditingEnabled}
          onInlineEditingToggle={setInlineEditingEnabled}
          inlineUpdatingIds={inlineUpdatingIds}
          isInlineEditable={isInlineEditable}
          items={pagedCables}
          drafts={cableDrafts}
          onDraftChange={handleCableDraftChange}
          onFieldBlur={(cable, field) => void handleCableTextFieldBlur(cable, field)}
          pendingId={pendingCableId}
          onEdit={openEditCableDialog}
          error={cablesError}
          isLoading={cablesLoading}
          showPagination={showCablePagination}
          page={cablesPage}
          totalPages={totalCablePages}
          onPreviousPage={handleCablesPreviousPage}
          onNextPage={handleCablesNextPage}
        />
      ) : null}

      <Button appearance="secondary" onClick={() => navigate(-1)}>
        Back
      </Button>

      <TrayDialog
        styles={styles}
        open={trayDialog.open}
        mode={trayDialog.mode}
        values={trayDialog.values}
        errors={trayDialog.errors}
        submitting={trayDialog.submitting}
        materialTrays={trayDialog.materialTrays}
        onFieldChange={trayDialog.handleFieldChange}
        onTypeSelect={trayDialog.handleTypeSelect}
        onPurposeSelect={trayDialog.handlePurposeSelect}
        onSubmit={(event) => void trayDialog.handleSubmit(event)}
        onDismiss={trayDialog.reset}
      />

      <CableTypeDialog
        styles={styles}
        open={cableTypeDialog.open}
        mode={cableTypeDialog.mode}
        values={cableTypeDialog.values}
        errors={cableTypeDialog.errors}
        submitting={cableTypeDialog.submitting}
        onFieldChange={cableTypeDialog.handleFieldChange}
        onPurposeSelect={cableTypeDialog.handlePurposeSelect}
        onSubmit={(event) => void cableTypeDialog.handleSubmit(event)}
        onDismiss={cableTypeDialog.reset}
      />

      <CableDialog
        styles={styles}
        open={cableDialog.open}
        mode={cableDialog.mode}
        values={cableDialog.values}
        errors={cableDialog.errors}
        submitting={cableDialog.submitting}
        cableTypes={cableTypes}
        onFieldChange={cableDialog.handleFieldChange}
        onCableTypeSelect={cableDialog.handleCableTypeSelect}
        onSubmit={(event) => void cableDialog.handleSubmit(event)}
        onDismiss={cableDialog.reset}
        visibleFields={cableDialogVisibleFields}
      />

      <ProgressDialog
        open={progressDialogOpen}
        cables={cables}
        onDismiss={() => setProgressDialogOpen(false)}
      />
    </section>
  );
};

