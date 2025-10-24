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

import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

import {
  ApiError,
  MaterialSupport,
  Project,
  ProjectSupportOverridePayload,
  fetchMaterialSupports,
  updateProject
} from '@/api/client';

import { useProjectDetailsStyles } from './ProjectDetails.styles';
import { ProjectDetailsTab } from './ProjectDetails.forms';
import { formatNumeric, parseNumberInput } from './ProjectDetails.utils';
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
import { useCableListSection } from './ProjectDetails/hooks/useCableListSection';
import { useCableTypesSection } from './ProjectDetails/hooks/useCableTypesSection';
import { useProjectDetailsData } from './ProjectDetails/hooks/useProjectDetailsData';
import { useTraysSection } from './ProjectDetails/hooks/useTraysSection';

type UpdatableNumericProjectField =
  | 'secondaryTrayLength'
  | 'supportDistance'
  | 'supportWeight';

type NumericFieldLabelMap = Record<UpdatableNumericProjectField, string>;

const NUMERIC_FIELD_LABELS: NumericFieldLabelMap = {
  secondaryTrayLength: 'Secondary tray length',
  supportDistance: 'Default distance between supports',
  supportWeight: 'Support weight'
};

const SUPPORT_LENGTH_MATCH_TOLERANCE = 15;

type ShowToast = ReturnType<typeof useToast>['showToast'];

type UseProjectNumericFieldParams = {
  project: Project | null;
  field: UpdatableNumericProjectField;
  token: string | null;
  isAdmin: boolean;
  showToast: ShowToast;
  reloadProject: () => Promise<void>;
};

type NumericFieldController = {
  input: string;
  error: string | null;
  saving: boolean;
  onInputChange: (value: string) => void;
  onSave: () => Promise<void>;
};

type TrayTypeDetail = {
  trayType: string;
  widthMm: number | null;
  hasMultipleWidths: boolean;
};

const useProjectNumericField = ({
  project,
  field,
  token,
  isAdmin,
  showToast,
  reloadProject
}: UseProjectNumericFieldParams): NumericFieldController => {
  const [input, setInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (project) {
      const currentValue = project[field];
      setInput(
        currentValue !== null && currentValue !== undefined
          ? String(currentValue)
          : ''
      );
    } else {
      setInput('');
    }
    setError(null);
  }, [project, field]);

  const onInputChange = useCallback((value: string) => {
    setInput(value);
    setError(null);
  }, []);

  const onSave = useCallback(async () => {
    const label = NUMERIC_FIELD_LABELS[field];

    if (!project || !token) {
      showToast({
        intent: 'error',
        title: 'Sign-in required',
        body: `You need to be signed in to update the ${label.toLowerCase()}.`
      });
      return;
    }

    if (!isAdmin) {
      showToast({
        intent: 'error',
        title: 'Administrator access required',
        body: `Only administrators can update the ${label.toLowerCase()}.`
      });
      return;
    }

    const parsed = parseNumberInput(input);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }

    const nextValue =
      parsed.numeric !== null
        ? Math.round(parsed.numeric * 1000) / 1000
        : null;
    const currentValue = project[field];

    if (currentValue === nextValue) {
      setError('No changes to save.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await updateProject(token, project.id, {
        [field]: nextValue
      });
      await reloadProject();
      showToast({
        intent: 'success',
        title: `${label} updated`
      });
    } catch (error) {
      console.error(`Failed to update ${field}`, error);
      const message =
        error instanceof ApiError
          ? error.message
          : `Failed to update ${label.toLowerCase()}.`;
      setError(message);
      showToast({
        intent: 'error',
        title: 'Update failed',
        body: message
      });
    } finally {
      setSaving(false);
    }
  }, [field, input, isAdmin, project, reloadProject, showToast, token]);

  return useMemo(
    () => ({
      input,
      error,
      saving,
      onInputChange,
      onSave
    }),
    [error, input, onInputChange, onSave, saving]
  );
};

const VALID_TABS: ProjectDetailsTab[] = [
  'details',
  'cables',
  'cable-list',
  'trays',
  'cable-report'
];

export const ProjectDetails = () => {
  const styles = useProjectDetailsStyles();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projectId } = useParams<{ projectId: string }>();
  const { user, token } = useAuth();
  const { showToast } = useToast();

  const isAdmin = Boolean(user?.isAdmin);
  const canManageCables = Boolean(token);

  const [selectedTab, setSelectedTab] = useState<ProjectDetailsTab>(() => {
    const tabParam = searchParams.get('tab');
    return tabParam && VALID_TABS.includes(tabParam as ProjectDetailsTab)
      ? (tabParam as ProjectDetailsTab)
      : 'details';
  });

  const [progressDialogOpen, setProgressDialogOpen] = useState(false);
  const openProgress = useCallback(() => setProgressDialogOpen(true), []);

  const {
    project,
    projectLoading,
    projectError,
    formattedDates,
    reloadProject
  } = useProjectDetailsData({ projectId });

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
    handleCableDraftChange,
    handleCableTextFieldBlur,
    handleInlineCableTypeChange,
    filterText,
    cableTypeFilter,
    sortColumn,
    sortDirection,
    setFilterText: setCableFilterText,
    setCableTypeFilter: setCableTypeFilterValue,
    handleSortChange: handleCableSortChange,
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
    pendingCableTypeId,
    pagedCableTypes,
    totalCableTypePages,
    cableTypePage,
    showCableTypePagination,
    fileInputRef: cableTypesFileInputRef,
    reloadCableTypes,
    goToPreviousPage: handleCableTypesPreviousPage,
    goToNextPage: handleCableTypesNextPage,
    openCreateCableTypeDialog,
    openEditCableTypeDialog,
    handleDeleteCableType,
    handleImportCableTypes,
    handleExportCableTypes,
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
    pendingTrayId,
    fileInputRef: traysFileInputRef,
    reloadTrays,
    goToPreviousPage: handleTraysPreviousPage,
    goToNextPage: handleTraysNextPage,
    openCreateTrayDialog,
    handleDeleteTray,
    handleImportTrays,
    handleExportTrays,
    trayDialog
  } = useTraysSection({
    projectId,
    project,
    token,
    showToast
  });

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
      }
    ],
    [secondaryTrayLengthField, supportDistanceField, supportWeightField]
  );

  const trayTypeDetails = useMemo<TrayTypeDetail[]>(() => {
    const map = new Map<string, Set<number>>();

    trays.forEach((tray) => {
      if (!tray.type) {
        return;
      }

      if (!map.has(tray.type)) {
        map.set(tray.type, new Set<number>());
      }

      if (tray.widthMm !== null && tray.widthMm !== undefined) {
        map.get(tray.type)!.add(tray.widthMm);
      }
    });

    Object.keys(project?.supportDistanceOverrides ?? {}).forEach((trayType) => {
      if (trayType && !map.has(trayType)) {
        map.set(trayType, new Set<number>());
      }
    });

    return Array.from(map.entries())
      .map(([trayType, widths]) => {
        const values = Array.from(widths);
        const hasMultipleWidths = values.length > 1;
        const widthMm =
          values.length === 1 ? values[0] : null;

        return {
          trayType,
          widthMm,
          hasMultipleWidths
        };
      })
      .sort((a, b) =>
        a.trayType.localeCompare(b.trayType, undefined, {
          sensitivity: 'base'
        })
      );
  }, [project?.supportDistanceOverrides, trays]);

  const [supportDistanceOverridesInputs, setSupportDistanceOverridesInputs] =
    useState<Record<string, string>>({});
  const [supportDistanceOverridesSupportIds, setSupportDistanceOverridesSupportIds] =
    useState<Record<string, string | null>>({});
  const [supportDistanceOverridesErrors, setSupportDistanceOverridesErrors] =
    useState<Record<string, string | null | undefined>>({});
  const [supportDistanceOverridesSaving, setSupportDistanceOverridesSaving] =
    useState<Record<string, boolean>>({});

  useEffect(() => {
    const overrides = project?.supportDistanceOverrides ?? {};
    setSupportDistanceOverridesInputs(() => {
      const next: Record<string, string> = {};
      trayTypeDetails.forEach(({ trayType }) => {
        const override = overrides[trayType];
        next[trayType] =
          override && override.distance !== null && override.distance !== undefined
            ? String(override.distance)
            : '';
      });
      return next;
    });
    setSupportDistanceOverridesSupportIds(() => {
      const next: Record<string, string | null> = {};
      trayTypeDetails.forEach(({ trayType }) => {
        const override = overrides[trayType];
        next[trayType] =
          override && override.supportId ? override.supportId : null;
      });
      return next;
    });
    setSupportDistanceOverridesErrors(() => ({}));
    setSupportDistanceOverridesSaving({});
  }, [project?.supportDistanceOverrides, trayTypeDetails]);

  const [supports, setSupports] = useState<MaterialSupport[]>([]);
  const [supportsLoading, setSupportsLoading] = useState<boolean>(false);
  const [supportsError, setSupportsError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setSupports([]);
      setSupportsLoading(false);
      setSupportsError(null);
      return;
    }

    let cancelled = false;

    const loadSupports = async () => {
      setSupportsLoading(true);
      setSupportsError(null);

      try {
        const loaded: MaterialSupport[] = [];
        let page = 1;
        const PAGE_SIZE = 100;

        while (true) {
          const { supports: pageSupports, pagination } =
            await fetchMaterialSupports({ page, pageSize: PAGE_SIZE });

          loaded.push(...pageSupports);

          if (!pagination || pagination.totalPages === 0 || page >= pagination.totalPages) {
            break;
          }

          page += 1;
        }

        if (!cancelled) {
          loaded.sort((a, b) =>
            a.type.localeCompare(b.type, undefined, { sensitivity: 'base' })
          );
          setSupports(loaded);
        }
      } catch (error) {
        console.error('Failed to load supports', error);
        if (!cancelled) {
          const message =
            error instanceof ApiError
              ? error.message
              : 'Failed to load supports.';
          setSupportsError(message);
          showToast({
            intent: 'error',
            title: 'Failed to load supports',
            body: message
          });
        }
      } finally {
        if (!cancelled) {
          setSupportsLoading(false);
        }
      }
    };

    void loadSupports();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, showToast]);

  const supportsById = useMemo(
    () =>
      supports.reduce<Record<string, MaterialSupport>>((acc, support) => {
        acc[support.id] = support;
        return acc;
      }, {}),
    [supports]
  );

  const supportOptionsByTrayType = useMemo(
    () =>
      trayTypeDetails.reduce<
        Record<
          string,
          {
            options: MaterialSupport[];
            widthMm: number | null;
            hasMultipleWidths: boolean;
          }
        >
      >((acc, detail) => {
        let options: MaterialSupport[] = [];

        if (detail.widthMm !== null && !detail.hasMultipleWidths) {
          const targetWidth = detail.widthMm;
          options = supports.filter(
            (support) =>
              support.lengthMm !== null &&
              Math.abs(support.lengthMm - targetWidth) <=
                SUPPORT_LENGTH_MATCH_TOLERANCE
          );
        } else {
          options = supports;
        }

        acc[detail.trayType] = {
          options,
          widthMm: detail.widthMm,
          hasMultipleWidths: detail.hasMultipleWidths
        };
        return acc;
      }, {}),
    [supports, trayTypeDetails]
  );

  const handleSupportDistanceOverrideInputChange = useCallback(
    (trayType: string, value: string) => {
      setSupportDistanceOverridesInputs((previous) => ({
        ...previous,
        [trayType]: value
      }));
      setSupportDistanceOverridesErrors((previous) => {
        if (!previous[trayType]) {
          return previous;
        }
        return {
          ...previous,
          [trayType]: null
        };
      });
    },
    []
  );

  const handleSupportDistanceOverrideSupportChange = useCallback(
    (trayType: string, supportId: string | null) => {
      const normalizedSupportId =
        supportId && supportId.trim() !== '' ? supportId : null;

      setSupportDistanceOverridesSupportIds((previous) => {
        const next = { ...previous };
        next[trayType] = normalizedSupportId;
        return next;
      });
      setSupportDistanceOverridesErrors((previous) => {
        if (!previous[trayType]) {
          return previous;
        }
        return {
          ...previous,
          [trayType]: null
        };
      });
    },
    []
  );

  const handleSupportDistanceOverrideSave = useCallback(
    async (trayType: string) => {
      if (!project || !token) {
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: 'You need to be signed in to update support settings.'
        });
        return;
      }

      if (!isAdmin) {
        showToast({
          intent: 'error',
          title: 'Administrator access required',
          body: 'Only administrators can update support settings.'
        });
        return;
      }

      const inputValue = supportDistanceOverridesInputs[trayType] ?? '';
      const parsed = parseNumberInput(inputValue);

      if (parsed.error) {
        setSupportDistanceOverridesErrors((previous) => ({
          ...previous,
          [trayType]: parsed.error
        }));
        return;
      }

      const nextDistance =
        parsed.numeric !== null
          ? Math.round(parsed.numeric * 1000) / 1000
          : null;
      const selectedSupportId =
        supportDistanceOverridesSupportIds[trayType] ?? null;

      const currentOverride = project.supportDistanceOverrides[trayType];
      const currentDistance =
        currentOverride && currentOverride.distance !== null
          ? currentOverride.distance
          : null;
      const currentSupportId =
        currentOverride && currentOverride.supportId
          ? currentOverride.supportId
          : null;

      if (
        currentDistance === nextDistance &&
        currentSupportId === selectedSupportId
      ) {
        setSupportDistanceOverridesErrors((previous) => ({
          ...previous,
          [trayType]: 'No changes to save.'
        }));
        return;
      }

      setSupportDistanceOverridesSaving((previous) => ({
        ...previous,
        [trayType]: true
      }));
      setSupportDistanceOverridesErrors((previous) => ({
        ...previous,
        [trayType]: null
      }));

      try {
        const nextOverrides = Object.entries(
          project.supportDistanceOverrides
        ).reduce<Record<string, ProjectSupportOverridePayload>>(
          (acc, [key, override]) => {
            acc[key] = {
              distance:
                override?.distance !== undefined && override?.distance !== null
                  ? override.distance
                  : null,
              supportId: override?.supportId ?? null
            };
            return acc;
          },
          {}
        );

        if (nextDistance === null && !selectedSupportId) {
          delete nextOverrides[trayType];
        } else {
          nextOverrides[trayType] = {
            distance: nextDistance,
            supportId: selectedSupportId
          };
        }

        await updateProject(token, project.id, {
          supportDistances: nextOverrides
        });
        await reloadProject();
        showToast({
          intent: 'success',
          title: `Support settings for ${trayType} updated`
        });
      } catch (error) {
        console.error(
          `Failed to update support settings for tray type "${trayType}"`,
          error
        );
        const message =
          error instanceof ApiError
            ? error.message
            : 'Failed to update support settings.';
        setSupportDistanceOverridesErrors((previous) => ({
          ...previous,
          [trayType]: message
        }));
        showToast({
          intent: 'error',
          title: 'Update failed',
          body: message
        });
      } finally {
        setSupportDistanceOverridesSaving((previous) => ({
          ...previous,
          [trayType]: false
        }));
      }
    },
    [
      isAdmin,
      project,
      reloadProject,
      showToast,
      supportDistanceOverridesInputs,
      supportDistanceOverridesSupportIds,
      token
    ]
  );

  const supportDistanceOverrideFields = useMemo(() => {
    if (!project) {
      return [];
    }

    return trayTypeDetails.map((detail) => {
      const override = project.supportDistanceOverrides[detail.trayType];
      const currentDistance =
        override && override.distance !== null ? override.distance : null;
      const currentSupportType =
        override?.supportType ??
        (override?.supportId ? supportsById[override.supportId]?.type ?? null : null);
      const selectedSupportId =
        supportDistanceOverridesSupportIds[detail.trayType] ?? null;
      const optionsInfo =
        supportOptionsByTrayType[detail.trayType] ?? {
          options: [] as MaterialSupport[],
          widthMm: detail.widthMm,
          hasMultipleWidths: detail.hasMultipleWidths
        };

      return {
        trayType: detail.trayType,
        trayWidthMm: optionsInfo.widthMm,
        hasWidthConflict: detail.hasMultipleWidths,
        currentDistance,
        currentSupportType,
        defaultValue: project.supportDistance ?? null,
        input: supportDistanceOverridesInputs[detail.trayType] ?? '',
        selectedSupportId,
        selectedSupportLabel:
          selectedSupportId
            ? supportsById[selectedSupportId]?.type ??
              override?.supportType ??
              'Support no longer available'
            : 'None (use default)',
        selectedSupportMissing: Boolean(
          selectedSupportId && !supportsById[selectedSupportId]
        ),
        supportOptions: optionsInfo.options,
        supportsLoading,
        supportsError,
        error: supportDistanceOverridesErrors[detail.trayType] ?? null,
        saving: Boolean(supportDistanceOverridesSaving[detail.trayType]),
        onInputChange: (value: string) =>
          handleSupportDistanceOverrideInputChange(detail.trayType, value),
        onSupportChange: (supportId: string | null) =>
          handleSupportDistanceOverrideSupportChange(detail.trayType, supportId),
        onSave: () => handleSupportDistanceOverrideSave(detail.trayType)
      };
    });
  }, [
    handleSupportDistanceOverrideInputChange,
    handleSupportDistanceOverrideSave,
    handleSupportDistanceOverrideSupportChange,
    project,
    supportDistanceOverridesErrors,
    supportDistanceOverridesInputs,
    supportDistanceOverridesSaving,
    supportDistanceOverridesSupportIds,
    supportOptionsByTrayType,
    supportsById,
    supportsError,
    supportsLoading,
    trayTypeDetails
  ]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const nextTab =
      tabParam && VALID_TABS.includes(tabParam as ProjectDetailsTab)
        ? (tabParam as ProjectDetailsTab)
        : 'details';

    if (nextTab !== selectedTab) {
      setSelectedTab(nextTab);
    }
  }, [searchParams, selectedTab]);

  const handleTabSelect = useCallback(
    (_event: unknown, data: { value: TabValue }) => {
      const tab = data.value as ProjectDetailsTab;
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
    [setSearchParams]
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
      </TabList>

      {selectedTab === 'details' ? (
        <DetailsTab
          styles={styles}
          project={project}
          formattedDates={formattedDates}
          isAdmin={isAdmin}
          numericFields={numericFields}
          supportDistanceOverrides={supportDistanceOverrideFields}
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
          onImportFileChange={handleImportCableTypes}
          isImporting={cableTypesImporting}
          isExporting={cableTypesExporting}
          fileInputRef={cableTypesFileInputRef}
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
          onExport={() => void handleExportTrays()}
          onImportFileChange={handleImportTrays}
          isImporting={traysImporting}
          isExporting={traysExporting}
          fileInputRef={traysFileInputRef}
          error={traysError}
          isLoading={traysLoading}
          items={pagedTrays}
          pendingId={pendingTrayId}
          onDetails={openTrayDetails}
          onDelete={(tray) => void handleDeleteTray(tray)}
          formatNumeric={formatNumeric}
          showPagination={showTrayPagination}
          page={traysPage}
          totalPages={totalTrayPages}
          onPreviousPage={handleTraysPreviousPage}
          onNextPage={handleTraysNextPage}
        />
      ) : null}

      {selectedTab === 'cable-list' ? (
        <CableListTab
          styles={styles}
          canManageCables={canManageCables}
          isAdmin={isAdmin}
          filterText={filterText}
          onFilterTextChange={setCableFilterText}
          cableTypeFilter={cableTypeFilter}
          onCableTypeFilterChange={setCableTypeFilterValue}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSortChange={handleCableSortChange}
          isRefreshing={cablesRefreshing}
          onRefresh={() => void reloadCables({ showSpinner: false })}
          onCreate={handleCreateCable}
          onImportClick={() => cablesFileInputRef.current?.click()}
          onExport={() => void handleExportCables('list')}
          onImportFileChange={handleImportCables}
          isImporting={cablesImporting}
          isExporting={cablesExporting}
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
        onFieldChange={trayDialog.handleFieldChange}
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

