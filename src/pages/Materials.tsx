import { useCallback, useMemo, useState } from 'react';
import {
  Body1,
  Button,
  Tab,
  TabList,
  TabValue,
  Title3
} from '@fluentui/react-components';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useStyles } from './Materials/Materials.styles';
import { MaterialsTab } from './Materials/Materials.types';
import { useTrays } from './Materials/hooks/useTrays';
import { useSupports } from './Materials/hooks/useSupports';
import { useLoadCurves } from './Materials/hooks/useLoadCurves';
import { useTemplateImages } from './Materials/hooks/useTemplateImages';
import { TrayDialog } from './Materials/components/TrayDialog';
import { TrayLoadCurveDialog } from './Materials/components/TrayLoadCurveDialog';
import { SupportDialog } from './Materials/components/SupportDialog';
import { TraysTable } from './Materials/components/TraysTable';
import { SupportsTable } from './Materials/components/SupportsTable';
import { LoadCurvesGrid } from './Materials/components/LoadCurvesGrid';
import { LoadCurveDialog } from './Materials/components/LoadCurveDialog';

export const Materials = () => {
  const styles = useStyles();
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const isAdmin = Boolean(user?.isAdmin);
  const [selectedTab, setSelectedTab] = useState<MaterialsTab>('trays');

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2
      }),
    []
  );

  const weightFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
      }),
    []
  );

  const formatNumeric = useCallback(
    (value: number | null) => {
      if (value === null || Number.isNaN(value)) {
        return '-';
      }
      return numberFormatter.format(value);
    },
    [numberFormatter]
  );

  const formatWeight = useCallback(
    (value: number | null) => {
      if (value === null || Number.isNaN(value)) {
        return '-';
      }
      return weightFormatter.format(value);
    },
    [weightFormatter]
  );

  const traysHook = useTrays({ token, isAdmin, showToast });
  const supportsHook = useSupports({ token, isAdmin, showToast });
  const loadCurvesHook = useLoadCurves({ token, isAdmin, showToast });
  const templateImagesHook = useTemplateImages({ token, showToast });

  const handleTabSelect = useCallback(
    (_event: unknown, data: { value: TabValue }) => {
      setSelectedTab(data.value as MaterialsTab);
    },
    []
  );

  const trayTotalPages = traysHook.trayPagination ? traysHook.trayPagination.totalPages : 1;
  const supportTotalPages = supportsHook.supportPagination ? supportsHook.supportPagination.totalPages : 1;
  const loadCurveTotalPages = loadCurvesHook.loadCurvePagination
    ? loadCurvesHook.loadCurvePagination.totalPages
    : 1;

  return (
    <section className={styles.root} aria-labelledby='materials-heading'>
      <div className={styles.header}>
        <Title3 id='materials-heading'>Materials</Title3>
        <Body1>
          Reference trays, supports, and load curves that can be reused across projects.
        </Body1>
      </div>

      <TabList
        selectedValue={selectedTab}
        onTabSelect={handleTabSelect}
        aria-label='Materials categories'
      >
        <Tab value='trays'>Trays</Tab>
        <Tab value='supports'>Supports</Tab>
        <Tab value='loadCurves'>Load curves</Tab>
      </TabList>

      <div
        role='tabpanel'
        aria-label={
          selectedTab === 'trays'
            ? 'Trays'
            : selectedTab === 'supports'
            ? 'Supports'
            : 'Load curves'
        }
      >
        {selectedTab === 'trays' ? (
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
                  <Button appearance='primary' onClick={traysHook.openTrayCreateDialog}>
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
                    type='file'
                    className={styles.hiddenInput}
                    accept='.xlsx'
                    onChange={traysHook.handleTrayImportChange}
                  />
                  <Button
                    appearance='secondary'
                    onClick={traysHook.handleGetTrayTemplate}
                    disabled={traysHook.isGettingTrayTemplate}
                  >
                    {traysHook.isGettingTrayTemplate ? 'Getting template...' : 'Get upload template'}
                  </Button>
                </>
              ) : null}
              <Button
                onClick={traysHook.handleExportTrays}
                disabled={traysHook.isExportingTrays}
              >
                {traysHook.isExportingTrays ? 'Exporting...' : 'Export to Excel'}
              </Button>
            </div>

            <TraysTable
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
            onDelete={traysHook.handleTrayDelete}
            onAssignLoadCurve={traysHook.openTrayLoadCurveDialog}
            token={token}
            page={traysHook.trayPage}
            totalPages={trayTotalPages}
            onSetPage={traysHook.setTrayPage}
            styles={styles}
          />
          </>
        ) : selectedTab === 'supports' ? (
          <>
            <div className={styles.actionsRow}>
              <Button
                onClick={() => supportsHook.loadSupports(supportsHook.supportPage, { silent: true })}
                disabled={supportsHook.isRefreshingSupports}
              >
                {supportsHook.isRefreshingSupports ? 'Refreshing...' : 'Refresh'}
              </Button>
              {isAdmin ? (
                <>
                  <Button appearance='primary' onClick={supportsHook.openSupportCreateDialog}>
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
                    type='file'
                    className={styles.hiddenInput}
                    accept='.xlsx'
                    onChange={supportsHook.handleSupportImportChange}
                  />
                  <Button
                    appearance='secondary'
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

            <SupportsTable
              supports={supportsHook.supports}
              isLoading={supportsHook.isLoadingSupports}
              error={supportsHook.supportsError}
              isAdmin={isAdmin}
              pendingId={supportsHook.supportPendingId}
              isSubmitting={supportsHook.isSupportSubmitting}
              formatNumeric={formatNumeric}
            formatWeight={formatWeight}
            onEdit={supportsHook.openSupportEditDialog}
            onDelete={supportsHook.handleSupportDelete}
            token={token}
            page={supportsHook.supportPage}
            totalPages={supportTotalPages}
            onSetPage={supportsHook.setSupportPage}
            styles={styles}
          />
          </>
        ) : (
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
                <Button appearance='primary' onClick={loadCurvesHook.openLoadCurveCreateDialog}>
                  Add load curve
                </Button>
              ) : null}
            </div>

            <LoadCurvesGrid
              loadCurves={loadCurvesHook.loadCurves}
              isLoading={loadCurvesHook.isLoadingLoadCurves}
              isRefreshing={loadCurvesHook.isRefreshingLoadCurves}
              error={loadCurvesHook.loadCurvesError}
              isAdmin={isAdmin}
              pendingId={loadCurvesHook.loadCurvePendingId}
              page={loadCurvesHook.loadCurvePage}
              totalPages={loadCurveTotalPages}
              onSetPage={loadCurvesHook.setLoadCurvePage}
              onView={(loadCurve) => navigate(`/materials/load-curves/${loadCurve.id}`)}
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
    </section>
  );
};
