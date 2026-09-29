import { useCallback, useEffect, useMemo, useState } from 'react';
import { Body1, Button, Tab, TabList, TabValue, Title3 } from '@fluentui/react-components';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useStyles } from './Materials/Materials.styles';
import { parseMaterialsTab } from './Materials/Materials.types';
import { useTrays } from './Materials/hooks/useTrays';
import { useSupports } from './Materials/hooks/useSupports';
import { useLoadCurves } from './Materials/hooks/useLoadCurves';
import { useCableTypes } from './Materials/hooks/useCableTypes';
import {
  useCableInstallationMaterials,
  useTrayInstallationMaterials,
  useInstruments,
  useInstrumentInstallationMaterials,
} from './Materials/hooks/useCableInstallationMaterials';
import { useTemplateImages } from './Materials/hooks/useTemplateImages';
import { CableInstallationMaterialDialog } from './Materials/components/CableInstallationMaterialDialog';
import { CableInstallationMaterialsTab } from './Materials/components/CableInstallationMaterialsTab';
import { TrayDialog } from './Materials/components/TrayDialog';
import { TrayLoadCurveDialog } from './Materials/components/TrayLoadCurveDialog';
import { SupportDialog } from './Materials/components/SupportDialog';
import { TraysTable } from './Materials/components/TraysTable';
import { SupportsTable } from './Materials/components/SupportsTable';
import { MaterialCatalogFilters } from './Materials/components/MaterialCatalogFilters';
import { LoadCurvesGrid } from './Materials/components/LoadCurvesGrid';
import { LoadCurveDialog } from './Materials/components/LoadCurveDialog';
import { CableTypesTab } from './ProjectDetails/CableTypesTab';
import { CableTypeDialog } from './ProjectDetails/CableTypeDialog';
import { useProjectDetailsStyles } from './ProjectDetails.styles';
import { MATERIAL_DETAILS_CAPABILITIES } from './Materials/materialCapabilities';

type MaterialsListState = {
  path: string;
  page: number;
  pageSizes: Record<string, number>;
  searchText: string;
  searchCriteria: string;
  facet: string;
};

export const Materials = () => {
  const styles = useStyles();
  const cableTypesStyles = useProjectDetailsStyles();
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const location = useLocation();
  const [returnState] = useState<MaterialsListState | undefined>(
    () => location.state?.materialsList,
  );
  const [restorePhase, setRestorePhase] = useState(returnState ? 'filters' : 'done');
  const [pageSizes, setPageSizes] = useState<Record<string, number>>(returnState?.pageSizes ?? {});
  const isAdmin = Boolean(user?.isAdmin);
  const selectedTab = parseMaterialsTab(searchParams.get('tab'));

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2,
      }),
    [],
  );

  const weightFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      }),
    [],
  );

  const formatNumeric = useCallback(
    (value: number | null) => {
      if (value === null || Number.isNaN(value)) {
        return '-';
      }
      return numberFormatter.format(value);
    },
    [numberFormatter],
  );

  const formatWeight = useCallback(
    (value: number | null) => {
      if (value === null || Number.isNaN(value)) {
        return '-';
      }
      return weightFormatter.format(value);
    },
    [weightFormatter],
  );

  const traysHook = useTrays({ token, isAdmin, showToast, pageSize: pageSizes.trays ?? 10 });
  const supportsHook = useSupports({
    token,
    isAdmin,
    showToast,
    pageSize: pageSizes.supports ?? 10,
  });
  const loadCurvesHook = useLoadCurves({
    token,
    isAdmin,
    showToast,
    pageSize: pageSizes.loadCurves ?? 10,
  });
  const cableTypesHook = useCableTypes({
    token,
    isAdmin,
    showToast,
    pageSize: pageSizes.cableTypes ?? 10,
  });
  const cableInstallationMaterialsHook = useCableInstallationMaterials({
    pageSize: pageSizes.cableInstallationMaterials ?? 10,
    token,
    isAdmin,
    showToast,
  });
  const trayInstallationMaterialsHook = useTrayInstallationMaterials({
    pageSize: pageSizes.trayInstallationMaterials ?? 10,
    token,
    isAdmin,
    showToast,
  });
  const instrumentsHook = useInstruments({
    token,
    isAdmin,
    showToast,
    pageSize: pageSizes.instruments ?? 10,
  });
  const instrumentInstallationMaterialsHook = useInstrumentInstallationMaterials({
    pageSize: pageSizes.instrumentInstallationMaterials ?? 10,
    token,
    isAdmin,
    showToast,
  });
  const catalogs = {
    cableInstallationMaterials: {
      hook: cableInstallationMaterialsHook,
      category: 'cable-installation-material',
      label: 'Cable installation materials',
      itemLabel: 'cable installation material',
    },
    trayInstallationMaterials: {
      hook: trayInstallationMaterialsHook,
      category: 'tray-installation-material',
      label: 'Trays installation materials',
      itemLabel: 'tray installation material',
    },
    instruments: {
      hook: instrumentsHook,
      category: 'instrument',
      label: 'Instruments',
      itemLabel: 'instrument',
    },
    instrumentInstallationMaterials: {
      hook: instrumentInstallationMaterialsHook,
      category: 'instrument-installation-material',
      label: 'Instruments installation materials',
      itemLabel: 'instrument installation material',
    },
  } as const;
  const selectedCatalog =
    selectedTab in catalogs ? catalogs[selectedTab as keyof typeof catalogs] : null;
  const catalogHook = selectedCatalog?.hook;
  const templateImagesHook = useTemplateImages({ token, showToast });

  const activeFilterHook =
    selectedTab === 'trays'
      ? traysHook
      : selectedTab === 'supports'
        ? supportsHook
        : (catalogHook ?? cableTypesHook);
  const activePage =
    selectedTab === 'trays'
      ? traysHook.trayPage
      : selectedTab === 'supports'
        ? supportsHook.supportPage
        : selectedTab === 'loadCurves'
          ? loadCurvesHook.loadCurvePage
          : catalogHook
            ? catalogHook.cableInstallationMaterialPage
            : cableTypesHook.cableTypePage;
  const setActivePage =
    selectedTab === 'trays'
      ? traysHook.setTrayPage
      : selectedTab === 'supports'
        ? supportsHook.setSupportPage
        : selectedTab === 'loadCurves'
          ? loadCurvesHook.setLoadCurvePage
          : catalogHook
            ? catalogHook.goToPage
            : cableTypesHook.goToPage;
  const activeLoading =
    selectedTab === 'trays'
      ? traysHook.isLoadingTrays
      : selectedTab === 'supports'
        ? supportsHook.isLoadingSupports
        : selectedTab === 'loadCurves'
          ? loadCurvesHook.isLoadingLoadCurves
          : catalogHook
            ? catalogHook.cableInstallationMaterialsLoading
            : cableTypesHook.cableTypesLoading;

  useEffect(() => {
    if (!returnState || restorePhase === 'done') return;
    if (restorePhase === 'filters') {
      if (selectedTab !== 'loadCurves') {
        activeFilterHook.setSearchText(returnState.searchText);
        if (selectedTab === 'trays' || selectedTab === 'supports') {
          const hook = selectedTab === 'trays' ? traysHook : supportsHook;
          hook.setSearchCriteria(
            returnState.searchCriteria as Parameters<typeof hook.setSearchCriteria>[0],
          );
          hook.setManufacturerFilter(returnState.facet);
        } else if (catalogHook) {
          catalogHook.setSearchCriteria(
            returnState.searchCriteria as Parameters<typeof catalogHook.setSearchCriteria>[0],
          );
          catalogHook.setPurposeFilter(returnState.facet);
        } else {
          cableTypesHook.setSearchCriteria(
            returnState.searchCriteria as Parameters<typeof cableTypesHook.setSearchCriteria>[0],
          );
          cableTypesHook.setPurposeFilter(returnState.facet);
        }
      }
      setRestorePhase('page');
    } else if (!activeLoading) {
      setActivePage(returnState.page);
      setRestorePhase('done');
    }
  }, [
    returnState,
    restorePhase,
    selectedTab,
    activeFilterHook,
    traysHook,
    supportsHook,
    catalogHook,
    cableTypesHook,
    activeLoading,
    setActivePage,
  ]);

  const openMaterialDetails = (path: string) => {
    const materialsList: MaterialsListState = {
      path: location.pathname + location.search,
      page: activePage,
      pageSizes,
      searchText: activeFilterHook.searchText,
      searchCriteria: activeFilterHook.searchCriteria,
      facet:
        'manufacturerFilter' in activeFilterHook
          ? activeFilterHook.manufacturerFilter
          : activeFilterHook.purposeFilter,
    };
    navigate(path, { state: { materialsList } });
  };

  const handleTabSelect = useCallback(
    (_event: unknown, data: { value: TabValue }) => {
      const nextTab = parseMaterialsTab(String(data.value));
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set('tab', nextTab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const trayTotalPages = traysHook.trayPagination ? traysHook.trayPagination.totalPages : 1;
  const supportTotalPages = supportsHook.supportPagination
    ? supportsHook.supportPagination.totalPages
    : 1;
  const loadCurveTotalPages = loadCurvesHook.loadCurvePagination
    ? loadCurvesHook.loadCurvePagination.totalPages
    : 1;
  const handlePageSizeChange = (size: number) => {
    if (![10, 25, 50, 100].includes(size)) return;
    setPageSizes((previous) => ({ ...previous, [selectedTab]: size }));
    if (catalogHook) catalogHook.goToPage(1);
    else if (selectedTab === 'trays') traysHook.setTrayPage(1);
    else if (selectedTab === 'supports') supportsHook.setSupportPage(1);
    else if (selectedTab === 'loadCurves') loadCurvesHook.setLoadCurvePage(1);
    else cableTypesHook.goToPage(1);
  };
  const selectedTabLabel =
    selectedCatalog?.label ??
    (selectedTab === 'trays'
      ? 'Trays'
      : selectedTab === 'supports'
        ? 'Supports'
        : selectedTab === 'loadCurves'
          ? 'Load curves'
          : 'Cable types');

  return (
    <section className={styles.root} aria-labelledby="materials-heading">
      <div className={styles.header}>
        <Title3 id="materials-heading">Materials</Title3>
        <Body1>
          Reference cable types, trays, instruments, installation materials, supports, and load
          curves that can be reused across projects.
        </Body1>
      </div>

      <TabList
        className={styles.tabs}
        selectedValue={selectedTab}
        onTabSelect={handleTabSelect}
        aria-label="Materials categories"
      >
        <Tab value="cableTypes">Cable types</Tab>
        <Tab value="cableInstallationMaterials">Cable installation materials</Tab>
        <Tab value="trays">Trays</Tab>
        <Tab value="trayInstallationMaterials">Trays installation materials</Tab>
        <Tab value="instruments">Instruments</Tab>
        <Tab value="instrumentInstallationMaterials">Instruments installation materials</Tab>
        <Tab value="supports">Supports</Tab>
        <Tab value="loadCurves">Load curves</Tab>
      </TabList>

      <div className={styles.tabPanel} role="tabpanel" aria-label={selectedTabLabel}>
        {selectedCatalog && catalogHook ? (
          <CableInstallationMaterialsTab
            pageSize={pageSizes[selectedTab] ?? 10}
            onPageSizeChange={handlePageSizeChange}
            styles={cableTypesStyles}
            isAdmin={isAdmin}
            isRefreshing={catalogHook.cableInstallationMaterialsRefreshing}
            onRefresh={() =>
              void catalogHook.reloadCableInstallationMaterials({
                showSpinner: false,
              })
            }
            onCreate={catalogHook.openCreateCableInstallationMaterialDialog}
            onImportClick={() => catalogHook.fileInputRef.current?.click()}
            onExport={() => void catalogHook.handleExportCableInstallationMaterials()}
            onGetTemplate={() => void catalogHook.handleGetCableInstallationMaterialsTemplate()}
            onImportFileChange={catalogHook.handleImportCableInstallationMaterials}
            isImporting={catalogHook.cableInstallationMaterialsImporting}
            isExporting={catalogHook.cableInstallationMaterialsExporting}
            isGettingTemplate={catalogHook.cableInstallationMaterialsGettingTemplate}
            fileInputRef={catalogHook.fileInputRef}
            searchText={catalogHook.searchText}
            searchCriteria={catalogHook.searchCriteria}
            purposeFilter={catalogHook.purposeFilter}
            purposeOptions={catalogHook.purposeFilterOptions}
            onSearchTextChange={catalogHook.setSearchText}
            onSearchCriteriaChange={catalogHook.setSearchCriteria}
            onPurposeFilterChange={catalogHook.setPurposeFilter}
            error={catalogHook.cableInstallationMaterialsError}
            isLoading={catalogHook.cableInstallationMaterialsLoading}
            items={catalogHook.pagedCableInstallationMaterials}
            pendingId={catalogHook.pendingCableInstallationMaterialId}
            onDetails={(item) =>
              openMaterialDetails(
                MATERIAL_DETAILS_CAPABILITIES[selectedCatalog.category].route(item.id),
              )
            }
            onEdit={catalogHook.openEditCableInstallationMaterialDialog}
            onDelete={(item) => void catalogHook.handleDeleteCableInstallationMaterial(item)}
            showPagination={catalogHook.showCableInstallationMaterialPagination}
            page={catalogHook.cableInstallationMaterialPage}
            totalPages={catalogHook.totalCableInstallationMaterialPages}
            paginationHandlers={{
              onPrevious: catalogHook.goToPreviousPage,
              onNext: catalogHook.goToNextPage,
              onPageSelect: catalogHook.goToPage,
            }}
            includeTabPanelRole={false}
            catalogLabel={selectedCatalog.label}
            itemLabel={selectedCatalog.itemLabel}
            emptyStateTitle={`No ${selectedCatalog.itemLabel}s found`}
            emptyStateBody={
              isAdmin
                ? `Use the buttons above to add or import ${selectedCatalog.itemLabel}s.`
                : `There are no ${selectedCatalog.itemLabel}s recorded for materials yet.`
            }
          />
        ) : selectedTab === 'trays' ? (
          <>
            <div className={styles.actionsRow}>
              <Button
                onClick={() => traysHook.loadTrays(traysHook.trayPage, { silent: true })}
                disabled={traysHook.isRefreshingTrays}
              >
                {traysHook.isRefreshingTrays ? 'Refreshing...' : 'Refresh'}
              </Button>
              {isAdmin ? (
                <>
                  <Button appearance="primary" onClick={traysHook.openTrayCreateDialog}>
                    Add tray
                  </Button>
                  <Button
                    onClick={traysHook.handleTrayImportClick}
                    disabled={traysHook.isImportingTrays}
                  >
                    {traysHook.isImportingTrays ? 'Importing...' : 'Import from Excel'}
                  </Button>
                  <input
                    ref={traysHook.trayFileInputRef}
                    type="file"
                    className={styles.hiddenInput}
                    accept=".xlsx"
                    onChange={traysHook.handleTrayImportChange}
                  />
                  <Button
                    appearance="secondary"
                    onClick={traysHook.handleGetTrayTemplate}
                    disabled={traysHook.isGettingTrayTemplate}
                  >
                    {traysHook.isGettingTrayTemplate
                      ? 'Getting template...'
                      : 'Get upload template'}
                  </Button>
                </>
              ) : null}
              <Button onClick={traysHook.handleExportTrays} disabled={traysHook.isExportingTrays}>
                {traysHook.isExportingTrays ? 'Exporting...' : 'Export to Excel'}
              </Button>
            </div>

            <MaterialCatalogFilters
              className={cableTypesStyles.filtersRow}
              catalog="trays"
              searchText={traysHook.searchText}
              searchCriteria={traysHook.searchCriteria}
              manufacturerFilter={traysHook.manufacturerFilter}
              manufacturerOptions={traysHook.manufacturerFilterOptions}
              onSearchTextChange={traysHook.setSearchText}
              onSearchCriteriaChange={traysHook.setSearchCriteria}
              onManufacturerFilterChange={traysHook.setManufacturerFilter}
            />
            <TraysTable
              pageSize={pageSizes[selectedTab] ?? 10}
              onPageSizeChange={handlePageSizeChange}
              trays={traysHook.trays}
              isLoading={traysHook.isLoadingTrays}
              error={traysHook.traysError}
              isAdmin={isAdmin}
              pendingId={traysHook.trayPendingId}
              loadCurvePendingId={traysHook.trayLoadCurvePendingId}
              isSubmitting={traysHook.isTraySubmitting}
              formatNumeric={formatNumeric}
              formatWeight={formatWeight}
              onEdit={traysHook.openTrayEditDialog}
              onDetails={(tray) =>
                openMaterialDetails(MATERIAL_DETAILS_CAPABILITIES.tray.route(tray.id))
              }
              onDelete={traysHook.handleTrayDelete}
              onAssignLoadCurve={traysHook.openTrayLoadCurveDialog}
              token={token}
              page={traysHook.trayPage}
              totalPages={trayTotalPages}
              onSetPage={traysHook.setTrayPage}
              hasFilters={Boolean(traysHook.searchText.trim() || traysHook.manufacturerFilter)}
              paginationStyles={cableTypesStyles}
              styles={styles}
            />
          </>
        ) : selectedTab === 'supports' ? (
          <>
            <div className={styles.actionsRow}>
              <Button
                onClick={() =>
                  supportsHook.loadSupports(supportsHook.supportPage, { silent: true })
                }
                disabled={supportsHook.isRefreshingSupports}
              >
                {supportsHook.isRefreshingSupports ? 'Refreshing...' : 'Refresh'}
              </Button>
              {isAdmin ? (
                <>
                  <Button appearance="primary" onClick={supportsHook.openSupportCreateDialog}>
                    Add support
                  </Button>
                  <Button
                    onClick={supportsHook.handleSupportImportClick}
                    disabled={supportsHook.isImportingSupports}
                  >
                    {supportsHook.isImportingSupports ? 'Importing...' : 'Import from Excel'}
                  </Button>
                  <input
                    ref={supportsHook.supportFileInputRef}
                    type="file"
                    className={styles.hiddenInput}
                    accept=".xlsx"
                    onChange={supportsHook.handleSupportImportChange}
                  />
                  <Button
                    appearance="secondary"
                    onClick={supportsHook.handleGetSupportTemplate}
                    disabled={supportsHook.isGettingSupportTemplate}
                  >
                    {supportsHook.isGettingSupportTemplate
                      ? 'Getting template...'
                      : 'Get upload template'}
                  </Button>
                </>
              ) : null}
              <Button
                onClick={supportsHook.handleExportSupports}
                disabled={supportsHook.isExportingSupports}
              >
                {supportsHook.isExportingSupports ? 'Exporting...' : 'Export to Excel'}
              </Button>
            </div>

            <MaterialCatalogFilters
              className={cableTypesStyles.filtersRow}
              catalog="supports"
              searchText={supportsHook.searchText}
              searchCriteria={supportsHook.searchCriteria}
              manufacturerFilter={supportsHook.manufacturerFilter}
              manufacturerOptions={supportsHook.manufacturerFilterOptions}
              onSearchTextChange={supportsHook.setSearchText}
              onSearchCriteriaChange={supportsHook.setSearchCriteria}
              onManufacturerFilterChange={supportsHook.setManufacturerFilter}
            />
            <SupportsTable
              pageSize={pageSizes[selectedTab] ?? 10}
              onPageSizeChange={handlePageSizeChange}
              supports={supportsHook.supports}
              isLoading={supportsHook.isLoadingSupports}
              error={supportsHook.supportsError}
              isAdmin={isAdmin}
              pendingId={supportsHook.supportPendingId}
              isSubmitting={supportsHook.isSupportSubmitting}
              formatNumeric={formatNumeric}
              formatWeight={formatWeight}
              onEdit={supportsHook.openSupportEditDialog}
              onDetails={(support) =>
                openMaterialDetails(MATERIAL_DETAILS_CAPABILITIES.support.route(support.id))
              }
              onDelete={supportsHook.handleSupportDelete}
              token={token}
              page={supportsHook.supportPage}
              totalPages={supportTotalPages}
              onSetPage={supportsHook.setSupportPage}
              hasFilters={Boolean(
                supportsHook.searchText.trim() || supportsHook.manufacturerFilter,
              )}
              paginationStyles={cableTypesStyles}
              styles={styles}
            />
          </>
        ) : selectedTab === 'loadCurves' ? (
          <>
            <div className={styles.actionsRow}>
              <Button
                onClick={() =>
                  loadCurvesHook.loadLoadCurves(loadCurvesHook.loadCurvePage, { silent: true })
                }
                disabled={loadCurvesHook.isRefreshingLoadCurves}
              >
                {loadCurvesHook.isRefreshingLoadCurves ? 'Refreshing...' : 'Refresh'}
              </Button>
              {isAdmin ? (
                <Button appearance="primary" onClick={loadCurvesHook.openLoadCurveCreateDialog}>
                  Add load curve
                </Button>
              ) : null}
            </div>

            <LoadCurvesGrid
              pageSize={pageSizes[selectedTab] ?? 10}
              onPageSizeChange={handlePageSizeChange}
              loadCurves={loadCurvesHook.loadCurves}
              isLoading={loadCurvesHook.isLoadingLoadCurves}
              isRefreshing={loadCurvesHook.isRefreshingLoadCurves}
              error={loadCurvesHook.loadCurvesError}
              isAdmin={isAdmin}
              pendingId={loadCurvesHook.loadCurvePendingId}
              page={loadCurvesHook.loadCurvePage}
              totalPages={loadCurveTotalPages}
              onSetPage={loadCurvesHook.setLoadCurvePage}
              onView={(loadCurve) => openMaterialDetails(`/materials/load-curves/${loadCurve.id}`)}
              onEdit={loadCurvesHook.openLoadCurveEditDialog}
              onDelete={loadCurvesHook.handleLoadCurveDelete}
              gridClassName={styles.loadCurvesGrid}
              cardClassName={styles.loadCurveCard}
              chartClassName={styles.loadCurveChart}
              footerClassName={styles.loadCurveFooter}
              emptyStateClassName={styles.loadCurvesEmpty}
              paginationClassName={styles.pagination}
            />
          </>
        ) : (
          <CableTypesTab
            pageSize={pageSizes[selectedTab] ?? 10}
            onPageSizeChange={handlePageSizeChange}
            styles={cableTypesStyles}
            isAdmin={isAdmin}
            isRefreshing={cableTypesHook.cableTypesRefreshing}
            onRefresh={() => void cableTypesHook.reloadCableTypes({ showSpinner: false })}
            onCreate={cableTypesHook.openCreateCableTypeDialog}
            onImportClick={() => cableTypesHook.fileInputRef.current?.click()}
            onExport={() => void cableTypesHook.handleExportCableTypes()}
            onGetTemplate={() => void cableTypesHook.handleGetCableTypesTemplate()}
            onImportFileChange={cableTypesHook.handleImportCableTypes}
            isImporting={cableTypesHook.cableTypesImporting}
            isExporting={cableTypesHook.cableTypesExporting}
            isGettingTemplate={cableTypesHook.cableTypesGettingTemplate}
            fileInputRef={cableTypesHook.fileInputRef}
            searchText={cableTypesHook.searchText}
            searchCriteria={cableTypesHook.searchCriteria}
            purposeFilter={cableTypesHook.purposeFilter}
            purposeOptions={cableTypesHook.purposeFilterOptions}
            onSearchTextChange={cableTypesHook.setSearchText}
            onSearchCriteriaChange={cableTypesHook.setSearchCriteria}
            onPurposeFilterChange={cableTypesHook.setPurposeFilter}
            error={cableTypesHook.cableTypesError}
            isLoading={cableTypesHook.cableTypesLoading}
            items={cableTypesHook.pagedCableTypes}
            pendingId={cableTypesHook.pendingCableTypeId}
            onDetails={(cableType) =>
              openMaterialDetails(MATERIAL_DETAILS_CAPABILITIES['cable-type'].route(cableType.id))
            }
            onEdit={cableTypesHook.openEditCableTypeDialog}
            onDelete={(cableType) => void cableTypesHook.handleDeleteCableType(cableType)}
            deleteActionLabel="Mark obsolete"
            formatNumeric={formatNumeric}
            showPagination={cableTypesHook.showCableTypePagination}
            page={cableTypesHook.cableTypePage}
            totalPages={cableTypesHook.totalCableTypePages}
            paginationHandlers={{
              onPrevious: cableTypesHook.goToPreviousPage,
              onNext: cableTypesHook.goToNextPage,
              onPageSelect: cableTypesHook.goToPage,
            }}
            includeTabPanelRole={false}
            emptyStateTitle="No cable types found"
            emptyStateBody={
              isAdmin
                ? 'Use the buttons above to add or import cable types for materials.'
                : 'There are no cable types recorded for materials yet.'
            }
          />
        )}
      </div>

      <TrayDialog
        open={traysHook.isTrayDialogOpen}
        mode={traysHook.trayDialogMode}
        editingTray={traysHook.editingTray}
        form={traysHook.trayForm}
        formErrors={traysHook.trayFormErrors}
        isSubmitting={traysHook.isTraySubmitting}
        onFieldChange={traysHook.handleTrayFieldChange}
        onTemplateChange={traysHook.handleTrayImageTemplateChange}
        templateOptions={templateImagesHook.templateImages}
        selectedTemplateId={traysHook.trayForm.imageTemplateId}
        isTemplateLoading={templateImagesHook.isLoadingTemplateImages}
        onSubmit={traysHook.handleTraySubmit}
        onClose={traysHook.closeTrayDialog}
        dialogActionsClassName={styles.dialogActions}
      />
      <TrayLoadCurveDialog
        open={traysHook.isTrayLoadCurveDialogOpen}
        tray={traysHook.trayLoadCurveTray}
        loadCurves={traysHook.trayLoadCurveSummaries}
        selection={traysHook.trayLoadCurveSelection}
        isLoading={traysHook.isLoadingTrayLoadCurves}
        isSubmitting={traysHook.isSubmittingTrayLoadCurve}
        error={traysHook.trayLoadCurveError}
        onSelectionChange={traysHook.handleTrayLoadCurveChange}
        onReload={traysHook.loadTrayLoadCurves}
        onSubmit={traysHook.handleTrayLoadCurveSubmit}
        onClose={traysHook.closeTrayLoadCurveDialog}
        dialogActionsClassName={styles.dialogActions}
      />

      <SupportDialog
        open={supportsHook.isSupportDialogOpen}
        mode={supportsHook.supportDialogMode}
        editingSupport={supportsHook.editingSupport}
        form={supportsHook.supportForm}
        formErrors={supportsHook.supportFormErrors}
        isSubmitting={supportsHook.isSupportSubmitting}
        onFieldChange={supportsHook.handleSupportFieldChange}
        onTemplateChange={supportsHook.handleSupportImageTemplateChange}
        templateOptions={templateImagesHook.templateImages}
        selectedTemplateId={supportsHook.supportForm.imageTemplateId}
        isTemplateLoading={templateImagesHook.isLoadingTemplateImages}
        onSubmit={supportsHook.handleSupportSubmit}
        onClose={supportsHook.closeSupportDialog}
        dialogActionsClassName={styles.dialogActions}
      />
      <LoadCurveDialog
        open={loadCurvesHook.isLoadCurveDialogOpen}
        mode={loadCurvesHook.loadCurveDialogMode}
        editingLoadCurve={loadCurvesHook.editingLoadCurve}
        form={loadCurvesHook.loadCurveForm}
        formErrors={loadCurvesHook.loadCurveFormErrors}
        isSubmitting={loadCurvesHook.isLoadCurveSubmitting}
        onFieldChange={loadCurvesHook.handleLoadCurveFieldChange}
        onSubmit={loadCurvesHook.handleLoadCurveSubmit}
        onClose={loadCurvesHook.closeLoadCurveDialog}
        dialogActionsClassName={styles.dialogActions}
      />
      <CableTypeDialog
        styles={cableTypesStyles}
        open={cableTypesHook.cableTypeDialog.open}
        mode={cableTypesHook.cableTypeDialog.mode}
        values={cableTypesHook.cableTypeDialog.values}
        errors={cableTypesHook.cableTypeDialog.errors}
        submitting={cableTypesHook.cableTypeDialog.submitting}
        showMaterialFields
        onFieldChange={cableTypesHook.cableTypeDialog.handleFieldChange}
        onPurposeSelect={cableTypesHook.cableTypeDialog.handlePurposeSelect}
        onSubmit={(event) => void cableTypesHook.cableTypeDialog.handleSubmit(event)}
        onDismiss={cableTypesHook.cableTypeDialog.reset}
      />
      {Object.values(catalogs).map(({ category, hook, itemLabel }) => (
        <CableInstallationMaterialDialog
          key={category}
          styles={cableTypesStyles}
          open={hook.cableInstallationMaterialDialog.open}
          mode={hook.cableInstallationMaterialDialog.mode}
          values={hook.cableInstallationMaterialDialog.values}
          errors={hook.cableInstallationMaterialDialog.errors}
          submitting={hook.cableInstallationMaterialDialog.submitting}
          purposeOptions={hook.cableInstallationMaterialDialog.purposeOptions}
          itemLabel={itemLabel}
          onFieldChange={hook.cableInstallationMaterialDialog.handleFieldChange}
          onPurposeSelect={hook.cableInstallationMaterialDialog.handlePurposeSelect}
          onSubmit={(event) => void hook.cableInstallationMaterialDialog.handleSubmit(event)}
          onDismiss={hook.cableInstallationMaterialDialog.reset}
        />
      ))}
    </section>
  );
};
