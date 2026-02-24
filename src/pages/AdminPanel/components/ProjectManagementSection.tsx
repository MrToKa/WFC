import {
  Body1,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Spinner,
  Subtitle2,
  Textarea
} from '@fluentui/react-components';

import { formatDateTime } from '../AdminPanel.utils';
import type { AdminPanelStyles } from '../AdminPanel.styles';
import type { AdminProjectsSectionState } from '../hooks/useAdminProjectsSection';

type ProjectManagementSectionProps = {
  styles: AdminPanelStyles;
  state: AdminProjectsSectionState;
};

export const ProjectManagementSection = ({
  styles,
  state
}: ProjectManagementSectionProps) => {
  const {
    projectsLoading,
    projectsRefreshing,
    projectsError,
    pagedProjects,
    projectActionMessage,
    projectActionError,
    pendingProjectAction,
    pendingProjectClearAction,
    clearDataProject,
    clearDataSelection,
    clearDataError,
    projectSearch,
    setProjectSearch,
    projectPage,
    setProjectPage,
    totalProjectPages,
    projectSortIndicator,
    toggleProjectSort,
    loadProjects,
    createProjectDialogOpen,
    setCreateProjectDialogOpen,
    createProjectValues,
    createProjectErrors,
    creatingProject,
    handleCreateProjectFieldChange,
    handleSubmitCreateProject,
    editingProject,
    editingProjectId,
    projectEditValues,
    projectEditErrors,
    projectEditSuccess,
    projectSaving,
    handleStartEditProject,
    handleCancelEditProject,
    handleEditProjectFieldChange,
    handleSubmitEditProject,
    handleDeleteProject,
    handleOpenClearDataDialog,
    handleCloseClearDataDialog,
    handleClearDataSelectionChange,
    handleSubmitClearProjectData
  } = state;

  const hasClearDataSelection =
    clearDataSelection.cableTypes ||
    clearDataSelection.cables ||
    clearDataSelection.trays;
  const isClearDataInProgress = Boolean(pendingProjectClearAction);

  return (
    <section className={styles.section} aria-labelledby="project-management-heading">
      <div className={styles.header}>
        <Subtitle2 id="project-management-heading">Project management</Subtitle2>
        <Body1>
          Create new projects or update existing records. Only administrators can change project
          data.
        </Body1>
      </div>

      <div className={styles.controls}>
        <Button
          appearance="primary"
          onClick={() => {
            setCreateProjectDialogOpen(true);
          }}
        >
          New project
        </Button>
        <Button
          onClick={() => void loadProjects({ showSpinner: false })}
          disabled={projectsRefreshing || projectsLoading}
        >
          {projectsRefreshing ? 'Refreshing...' : 'Refresh projects'}
        </Button>
        <Input
          className={styles.filterInput}
          placeholder="Filter projects..."
          value={projectSearch}
          onChange={(_event, data) => setProjectSearch(data.value)}
        />
      </div>

      {projectsError ? (
        <Body1 className={`${styles.statusMessage} ${styles.errorText}`}>
          {projectsError}
        </Body1>
      ) : null}

      {projectActionError ? (
        <Body1 className={`${styles.statusMessage} ${styles.errorText}`}>
          {projectActionError}
        </Body1>
      ) : null}

      {projectActionMessage ? (
        <Body1 className={`${styles.statusMessage} ${styles.successText}`}>
          {projectActionMessage}
        </Body1>
      ) : null}

      <Dialog
        open={createProjectDialogOpen}
        onOpenChange={(_event, data) => {
          setCreateProjectDialogOpen(data.open);
        }}
      >
        <DialogSurface>
          <form onSubmit={handleSubmitCreateProject} noValidate>
            <DialogBody>
              <DialogTitle>Create a project</DialogTitle>
              <DialogContent>
                <div className={styles.form}>
                  <Field
                    label="Project number"
                    required
                    validationState={createProjectErrors.projectNumber ? 'error' : undefined}
                    validationMessage={createProjectErrors.projectNumber}
                  >
                    <Input
                      value={createProjectValues.projectNumber}
                      required
                      onChange={handleCreateProjectFieldChange('projectNumber')}
                    />
                  </Field>
                  <Field
                    label="Project name"
                    required
                    validationState={createProjectErrors.name ? 'error' : undefined}
                    validationMessage={createProjectErrors.name}
                  >
                    <Input
                      value={createProjectValues.name}
                      required
                      onChange={handleCreateProjectFieldChange('name')}
                    />
                  </Field>
                  <Field
                    label="Customer"
                    required
                    validationState={createProjectErrors.customer ? 'error' : undefined}
                    validationMessage={createProjectErrors.customer}
                  >
                    <Input
                      value={createProjectValues.customer}
                      required
                      onChange={handleCreateProjectFieldChange('customer')}
                    />
                  </Field>
                  <Field
                    label="Project manager"
                    validationState={createProjectErrors.manager ? 'error' : undefined}
                    validationMessage={createProjectErrors.manager}
                  >
                    <Input
                      value={createProjectValues.manager}
                      onChange={handleCreateProjectFieldChange('manager')}
                    />
                  </Field>
                  <Field
                    label="Description"
                    validationState={createProjectErrors.description ? 'error' : undefined}
                    validationMessage={createProjectErrors.description}
                  >
                    <Textarea
                      className={styles.textarea}
                      value={createProjectValues.description}
                      onChange={handleCreateProjectFieldChange('description')}
                    />
                  </Field>
                  {createProjectErrors.general ? (
                    <Body1 className={styles.errorText}>{createProjectErrors.general}</Body1>
                  ) : null}
                </div>
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="secondary"
                  type="button"
                  onClick={() => setCreateProjectDialogOpen(false)}
                  disabled={creatingProject}
                >
                  Cancel
                </Button>
                <Button type="submit" appearance="primary" disabled={creatingProject}>
                  {creatingProject ? 'Creating...' : 'Create project'}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>

      {projectsLoading ? (
        <Spinner label="Loading projects..." />
      ) : pagedProjects.length === 0 ? (
        <Body1 className={styles.emptyState}>No projects found.</Body1>
      ) : (
        <>
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.tableHeadCell}>
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => toggleProjectSort('projectNumber')}
                    >
                      Project #
                      {projectSortIndicator('projectNumber')}
                    </button>
                  </th>
                  <th className={styles.tableHeadCell}>
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => toggleProjectSort('name')}
                    >
                      Name
                      {projectSortIndicator('name')}
                    </button>
                  </th>
                  <th className={styles.tableHeadCell}>
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => toggleProjectSort('customer')}
                    >
                      Customer
                      {projectSortIndicator('customer')}
                    </button>
                  </th>
                  <th className={styles.tableHeadCell}>
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => toggleProjectSort('manager')}
                    >
                      Project manager
                      {projectSortIndicator('manager')}
                    </button>
                  </th>
                <th className={styles.tableHeadCell}>
                  <button
                    type="button"
                    className={styles.sortButton}
                    onClick={() => toggleProjectSort('createdAt')}
                    >
                      Created
                      {projectSortIndicator('createdAt')}
                    </button>
                  </th>
                  <th className={styles.tableHeadCell}>
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => toggleProjectSort('updatedAt')}
                    >
                      Updated
                      {projectSortIndicator('updatedAt')}
                    </button>
                  </th>
                  <th className={styles.tableHeadCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedProjects.map((project) => {
                  const isEditing = editingProjectId === project.id;
                  const isDeleting = pendingProjectAction === project.id;
                  const isClearing = pendingProjectClearAction === project.id;
                  const disableActions = isDeleting || isClearing || projectSaving;

                  return (
                    <tr key={project.id}>
                      <td className={styles.tableCell}>{project.projectNumber}</td>
                      <td className={styles.tableCell}>{project.name}</td>
                      <td className={styles.tableCell}>{project.customer}</td>
                      <td className={styles.tableCell}>{project.manager ?? 'N/A'}</td>
                      <td className={styles.tableCell}>{formatDateTime(project.createdAt)}</td>
                      <td className={styles.tableCell}>{formatDateTime(project.updatedAt)}</td>
                      <td className={`${styles.tableCell} ${styles.actionCell}`}>
                        <Button
                          size="small"
                          onClick={() => handleStartEditProject(project)}
                          disabled={disableActions}
                        >
                          {isEditing ? 'Editing...' : 'Edit'}
                        </Button>
                        <Button
                          size="small"
                          appearance="secondary"
                          onClick={() => handleOpenClearDataDialog(project)}
                          disabled={disableActions}
                        >
                          {isClearing ? 'Clearing...' : 'Clear data'}
                        </Button>
                        <Button
                          size="small"
                          appearance="secondary"
                          onClick={() => void handleDeleteProject(project.id)}
                          disabled={disableActions}
                        >
                          {isDeleting ? 'Deleting...' : 'Delete'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

      {totalProjectPages > 1 ? (
        <div className={styles.pagination} aria-label="Project table pagination">
          <Button
            size="small"
            onClick={() => setProjectPage((prev) => Math.max(1, prev - 1))}
            disabled={projectPage === 1}
          >
            Previous
          </Button>
          <Body1>
            Page {projectPage} of {totalProjectPages}
          </Body1>
          <Button
            size="small"
            onClick={() => setProjectPage((prev) => Math.min(totalProjectPages, prev + 1))}
            disabled={projectPage === totalProjectPages}
          >
            Next
          </Button>
        </div>
      ) : null}
        </>
      )}

      <Dialog
        open={Boolean(clearDataProject)}
        onOpenChange={(_event, data) => {
          if (!data.open && !isClearDataInProgress) {
            handleCloseClearDataDialog();
          }
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Clear data</DialogTitle>
            <DialogContent>
              <div className={styles.form}>
                <Body1>
                  Select data to delete for project{' '}
                  {clearDataProject?.projectNumber ?? '(unknown)'}.
                </Body1>
                <Checkbox
                  label="Cable types"
                  checked={clearDataSelection.cableTypes}
                  onChange={(_event, data) =>
                    handleClearDataSelectionChange('cableTypes', data.checked === true)
                  }
                  disabled={isClearDataInProgress}
                />
                <Checkbox
                  label="Cables list"
                  checked={clearDataSelection.cables}
                  onChange={(_event, data) =>
                    handleClearDataSelectionChange('cables', data.checked === true)
                  }
                  disabled={isClearDataInProgress || clearDataSelection.cableTypes}
                />
                <Checkbox
                  label="Trays"
                  checked={clearDataSelection.trays}
                  onChange={(_event, data) =>
                    handleClearDataSelectionChange('trays', data.checked === true)
                  }
                  disabled={isClearDataInProgress}
                />
                {clearDataSelection.cableTypes ? (
                  <Body1>
                    Deleting cable types also removes cables linked to those types.
                  </Body1>
                ) : null}
                {clearDataError ? (
                  <Body1 className={styles.errorText}>{clearDataError}</Body1>
                ) : null}
              </div>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                type="button"
                onClick={handleCloseClearDataDialog}
                disabled={isClearDataInProgress}
              >
                Cancel
              </Button>
              <Button
                appearance="primary"
                type="button"
                onClick={() => void handleSubmitClearProjectData()}
                disabled={isClearDataInProgress || !hasClearDataSelection}
              >
                {isClearDataInProgress ? 'Deleting...' : 'Delete'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={Boolean(editingProject)}
        onOpenChange={(_event, data) => {
          if (!data.open) {
            handleCancelEditProject();
          }
        }}
      >
        <DialogSurface>
          <form onSubmit={handleSubmitEditProject} noValidate>
            <DialogBody>
              <DialogTitle>Edit project</DialogTitle>
              <DialogContent>
                <div className={styles.form}>
                  <Field
                    label="Project number"
                    validationState={projectEditErrors.projectNumber ? 'error' : undefined}
                    validationMessage={projectEditErrors.projectNumber}
                  >
                    <Input
                      value={projectEditValues.projectNumber}
                      onChange={handleEditProjectFieldChange('projectNumber')}
                    />
                  </Field>
                  <Field
                    label="Project name"
                    validationState={projectEditErrors.name ? 'error' : undefined}
                    validationMessage={projectEditErrors.name}
                  >
                    <Input
                      value={projectEditValues.name}
                      onChange={handleEditProjectFieldChange('name')}
                    />
                  </Field>
                  <Field
                    label="Customer"
                    validationState={projectEditErrors.customer ? 'error' : undefined}
                    validationMessage={projectEditErrors.customer}
                  >
                    <Input
                      value={projectEditValues.customer}
                      onChange={handleEditProjectFieldChange('customer')}
                    />
                  </Field>
                  <Field
                    label="Project manager"
                    hint="Leave blank to clear the project manager."
                    validationState={projectEditErrors.manager ? 'error' : undefined}
                    validationMessage={projectEditErrors.manager}
                  >
                    <Input
                      value={projectEditValues.manager}
                      onChange={handleEditProjectFieldChange('manager')}
                    />
                  </Field>
                  <Field
                    label="Description"
                    hint="Leave blank to clear the description."
                    validationState={projectEditErrors.description ? 'error' : undefined}
                    validationMessage={projectEditErrors.description}
                  >
                    <Textarea
                      className={styles.textarea}
                      value={projectEditValues.description}
                      onChange={handleEditProjectFieldChange('description')}
                    />
                  </Field>
                  {projectEditErrors.general ? (
                    <Body1 className={styles.errorText}>{projectEditErrors.general}</Body1>
                  ) : null}
                  {projectEditSuccess ? (
                    <Body1 className={styles.successText}>{projectEditSuccess}</Body1>
                  ) : null}
                </div>
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="secondary"
                  type="button"
                  onClick={handleCancelEditProject}
                  disabled={projectSaving}
                >
                  Cancel
                </Button>
                <Button type="submit" appearance="primary" disabled={projectSaving}>
                  {projectSaving ? 'Saving...' : 'Save changes'}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </section>
  );
};
