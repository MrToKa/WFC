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

import { ApiError, Project, updateProject } from '@/api/client';

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

  const trayTypes = useMemo(() => {
    const unique = new Set<string>();
    trays.forEach((tray) => {
      if (tray.type) {
        unique.add(tray.type);
      }
    });
    Object.keys(project?.supportDistanceOverrides ?? {}).forEach((trayType) => {
      if (trayType) {
        unique.add(trayType);
      }
    });
    return Array.from(unique).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }, [project?.supportDistanceOverrides, trays]);

  const [supportDistanceOverridesInputs, setSupportDistanceOverridesInputs] =
    useState<Record<string, string>>({});
  const [supportDistanceOverridesErrors, setSupportDistanceOverridesErrors] =
    useState<Record<string, string | null>>({});
  const [supportDistanceOverridesSaving, setSupportDistanceOverridesSaving] =
    useState<Record<string, boolean>>({});

  useEffect(() => {
    const overrides = project?.supportDistanceOverrides ?? {};
    setSupportDistanceOverridesInputs(() => {
      const next: Record<string, string> = {};
      trayTypes.forEach((trayType) => {
        const value = overrides[trayType];
        next[trayType] =
          value !== undefined && value !== null ? String(value) : '';
      });
      return next;
    });
    setSupportDistanceOverridesErrors({});
    setSupportDistanceOverridesSaving({});
  }, [project?.supportDistanceOverrides, trayTypes]);

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
        const next = { ...previous };
        delete next[trayType];
        return next;
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
          body: 'You need to be signed in to update support distances.'
        });
        return;
      }

      if (!isAdmin) {
        showToast({
          intent: 'error',
          title: 'Administrator access required',
          body: 'Only administrators can update support distances.'
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

      const nextValue =
        parsed.numeric !== null
          ? Math.round(parsed.numeric * 1000) / 1000
          : null;
      const currentValue =
        project.supportDistanceOverrides[trayType] ?? null;

      if (currentValue === nextValue) {
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
      setSupportDistanceOverridesErrors((previous) => {
        const next = { ...previous };
        delete next[trayType];
        return next;
      });

      try {
        const nextOverrides = { ...project.supportDistanceOverrides };

        if (nextValue === null) {
          delete nextOverrides[trayType];
        } else {
          nextOverrides[trayType] = nextValue;
        }

        await updateProject(token, project.id, {
          supportDistances: nextOverrides
        });
        await reloadProject();
        showToast({
          intent: 'success',
          title: `Support distance for ${trayType} updated`
        });
      } catch (error) {
        console.error(
          `Failed to update support distance for tray type "${trayType}"`,
          error
        );
        const message =
          error instanceof ApiError
            ? error.message
            : 'Failed to update support distance.';
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
      token
    ]
  );

  const supportDistanceOverrideFields = useMemo(() => {
    if (!project) {
      return [];
    }

    return trayTypes.map((trayType) => ({
      trayType,
      currentValue: project.supportDistanceOverrides[trayType] ?? null,
      defaultValue: project.supportDistance ?? null,
      input: supportDistanceOverridesInputs[trayType] ?? '',
      error: supportDistanceOverridesErrors[trayType] ?? null,
      saving: Boolean(supportDistanceOverridesSaving[trayType]),
      onInputChange: (value: string) =>
        handleSupportDistanceOverrideInputChange(trayType, value),
      onSave: () => handleSupportDistanceOverrideSave(trayType)
    }));
  }, [
    handleSupportDistanceOverrideInputChange,
    handleSupportDistanceOverrideSave,
    project,
    supportDistanceOverridesErrors,
    supportDistanceOverridesInputs,
    supportDistanceOverridesSaving,
    trayTypes
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

