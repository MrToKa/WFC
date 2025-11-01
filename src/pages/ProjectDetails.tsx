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

import { useProjectDetailsStyles } from './ProjectDetails.styles';
import { ProjectDetailsTab } from './ProjectDetails.forms';
import { formatNumeric } from './ProjectDetails.utils';
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

const VALID_TABS: ProjectDetailsTab[] = [
  'details',
  'cables',
  'cable-list',
  'trays',
  'files',
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
        <Tab value="files">Files</Tab>
        <Tab value="cable-report">Cables report</Tab>
      </TabList>

      {selectedTab === 'details' ? (
        <DetailsTab
          styles={styles}
          project={project}
          formattedDates={formattedDates}
          isAdmin={isAdmin}
          cableSpacingField={cableSpacingField}
          cableCategoryCards={cableCategoryCards}
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
          onExport={() => void handleExportTrays()}
          onImportFileChange={handleImportTrays}
          isImporting={traysImporting}
          isExporting={traysExporting}
          fileInputRef={traysFileInputRef}
          searchText={traysSearchText}
          searchCriteria={traysSearchCriteria}
          onSearchTextChange={setTraysSearchText}
          onSearchCriteriaChange={setTraysSearchCriteria}
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

