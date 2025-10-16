import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Body1,
  Button,
  Caption1,
  Field,
  Input,
  Spinner,
  Subtitle2,
  Textarea,
  Title3,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';
import {
  ApiError,
  ApiErrorPayload,
  Project,
  User,
  createProject,
  deleteProject,
  deleteUserAsAdmin,
  fetchAllUsers,
  fetchProjects,
  promoteUserAsAdmin,
  updateProject,
  updateUserAsAdmin
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2rem',
    maxWidth: '72rem',
    width: '100%',
    ...shorthands.padding('0', '0', '2rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem'
  },
  sectionHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  controls: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap'
  },
  statusMessage: {
    padding: '0.5rem 0.75rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  },
  successText: {
    color: tokens.colorStatusSuccessForeground1
  },
  cardGrid: {
    display: 'grid',
    gap: '1rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))'
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1rem')
  },
  cardMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  actionRow: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  formActions: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  textarea: {
    minHeight: '6rem'
  },
  panel: {
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1rem')
  }
});

type UserFormState = {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
};

type UserFormErrors = Partial<Record<keyof UserFormState, string>> & { general?: string };

type ProjectFormState = {
  projectNumber: string;
  name: string;
  customer: string;
  description: string;
};

type ProjectFormErrors = Partial<Record<keyof ProjectFormState, string>> & { general?: string };

const emptyUserForm: UserFormState = {
  email: '',
  firstName: '',
  lastName: '',
  password: ''
};

const emptyProjectForm: ProjectFormState = {
  projectNumber: '',
  name: '',
  customer: '',
  description: ''
};

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));

const parseUserApiErrors = (payload: ApiErrorPayload): UserFormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors = Object.entries(payload.fieldErrors ?? {}).reduce<UserFormErrors>(
    (acc, [field, messages]) => {
      if (messages.length > 0) {
        acc[field as keyof UserFormState] = messages[0];
      }
      return acc;
    },
    {}
  );

  const formError = payload.formErrors?.[0];
  return formError
    ? { ...fieldErrors, general: formError }
    : Object.keys(fieldErrors).length > 0
      ? fieldErrors
      : { general: 'Request failed' };
};

const parseProjectApiErrors = (payload: ApiErrorPayload): ProjectFormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors = Object.entries(payload.fieldErrors ?? {}).reduce<ProjectFormErrors>(
    (acc, [field, messages]) => {
      if (messages.length > 0) {
        acc[field as keyof ProjectFormState] = messages[0];
      }
      return acc;
    },
    {}
  );

  const formError = payload.formErrors?.[0];
  return formError
    ? { ...fieldErrors, general: formError }
    : Object.keys(fieldErrors).length > 0
      ? fieldErrors
      : { general: 'Request failed' };
};

export const AdminPanel = () => {
  const styles = useStyles();
  const { token, user: currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;

  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState<boolean>(true);
  const [usersRefreshing, setUsersRefreshing] = useState<boolean>(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userFormValues, setUserFormValues] = useState<UserFormState>(emptyUserForm);
  const [userFormErrors, setUserFormErrors] = useState<UserFormErrors>({});
  const [userFormSuccess, setUserFormSuccess] = useState<string | null>(null);
  const [userSaving, setUserSaving] = useState<boolean>(false);
  const [userPendingAction, setUserPendingAction] = useState<string | null>(null);
  const [userActionMessage, setUserActionMessage] = useState<string | null>(null);
  const [userActionError, setUserActionError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState<boolean>(true);
  const [projectsRefreshing, setProjectsRefreshing] = useState<boolean>(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [createProjectValues, setCreateProjectValues] =
    useState<ProjectFormState>(emptyProjectForm);
  const [createProjectErrors, setCreateProjectErrors] = useState<ProjectFormErrors>({});
  const [creatingProject, setCreatingProject] = useState<boolean>(false);
  const [projectActionMessage, setProjectActionMessage] = useState<string | null>(null);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectEditValues, setProjectEditValues] =
    useState<ProjectFormState>(emptyProjectForm);
  const [projectEditErrors, setProjectEditErrors] = useState<ProjectFormErrors>({});
  const [projectEditSuccess, setProjectEditSuccess] = useState<string | null>(null);
  const [projectSaving, setProjectSaving] = useState<boolean>(false);
  const [pendingProjectAction, setPendingProjectAction] = useState<string | null>(null);

  const loadUsers = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) {
        setUsersLoading(true);
      } else {
        setUsersRefreshing(true);
      }
      setUsersError(null);

      if (!token) {
        setUsers([]);
        setUsersError('Authentication token is missing.');
        setUsersLoading(false);
        setUsersRefreshing(false);
        return;
      }

      try {
        const response = await fetchAllUsers(token);
        setUsers(response.users);
      } catch (error) {
        console.error('Failed to fetch users', error);
        const message = error instanceof ApiError ? error.message : 'Failed to fetch users.';
        setUsersError(message);
      } finally {
        setUsersLoading(false);
        setUsersRefreshing(false);
      }
    },
    [token]
  );

  const loadProjects = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) {
        setProjectsLoading(true);
      } else {
        setProjectsRefreshing(true);
      }
      setProjectsError(null);

      try {
        const response = await fetchProjects();
        setProjects(response.projects);
      } catch (error) {
        console.error('Failed to fetch projects', error);
        const message = error instanceof ApiError ? error.message : 'Failed to fetch projects.';
        setProjectsError(message);
      } finally {
        setProjectsLoading(false);
        setProjectsRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadUsers(true);
    void loadProjects(true);
  }, [loadUsers, loadProjects]);

  const handleStartEditUser = (userToEdit: User) => {
    setEditingUserId(userToEdit.id);
    setUserFormValues({
      email: userToEdit.email,
      firstName: userToEdit.firstName ?? '',
      lastName: userToEdit.lastName ?? '',
      password: ''
    });
    setUserFormErrors({});
    setUserFormSuccess(null);
    setUserActionMessage(null);
    setUserActionError(null);
  };

  const handleCancelEditUser = () => {
    setEditingUserId(null);
    setUserFormValues(emptyUserForm);
    setUserFormErrors({});
    setUserFormSuccess(null);
  };

  const handleUserFieldChange =
    (field: keyof UserFormState) => (event: ChangeEvent<HTMLInputElement>) => {
      setUserFormValues((prev) => ({ ...prev, [field]: event.target.value }));
      setUserFormErrors((prev) => ({ ...prev, [field]: undefined, general: undefined }));
      setUserFormSuccess(null);
    };

  const editingUser = useMemo(
    () => users.find((candidate) => candidate.id === editingUserId) ?? null,
    [users, editingUserId]
  );

  const handleSubmitUserEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token || !editingUserId || !editingUser) {
      return;
    }

    const payload: {
      email?: string;
      firstName?: string;
      lastName?: string;
      password?: string;
    } = {};

    const emailValue = userFormValues.email.trim();
    if (emailValue && emailValue.toLowerCase() !== editingUser.email.toLowerCase()) {
      payload.email = emailValue;
    }

    const firstNameValue = userFormValues.firstName.trim();
    if (firstNameValue !== (editingUser.firstName ?? '')) {
      payload.firstName = firstNameValue;
    }

    const lastNameValue = userFormValues.lastName.trim();
    if (lastNameValue !== (editingUser.lastName ?? '')) {
      payload.lastName = lastNameValue;
    }

    const passwordValue = userFormValues.password.trim();
    if (passwordValue) {
      payload.password = passwordValue;
    }

    if (Object.keys(payload).length === 0) {
      setUserFormErrors({ general: 'Update at least one field before saving.' });
      return;
    }

    setUserSaving(true);
    setUserFormErrors({});
    setUserFormSuccess(null);

    try {
      const response = await updateUserAsAdmin(token, editingUserId, payload);
      setUsers((prev) =>
        prev.map((candidate) => (candidate.id === editingUserId ? response.user : candidate))
      );
      setUserFormSuccess('User updated successfully.');
      setUserFormValues((prev) => ({ ...prev, password: '' }));
      setUserActionMessage('User details updated.');
      setUserActionError(null);
    } catch (error) {
      if (error instanceof ApiError) {
        setUserFormErrors(parseUserApiErrors(error.payload));
      } else {
        setUserFormErrors({ general: 'Failed to update user. Please try again.' });
      }
    } finally {
      setUserSaving(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!token) {
      return;
    }

    if (!window.confirm('This will permanently delete the user. Continue?')) {
      return;
    }

    setUserPendingAction(userId);
    setUserActionError(null);
    setUserActionMessage(null);

    try {
      await deleteUserAsAdmin(token, userId);
      setUsers((prev) => prev.filter((candidate) => candidate.id !== userId));
      if (editingUserId === userId) {
        handleCancelEditUser();
      }
      setUserActionMessage('User deleted successfully.');
    } catch (error) {
      console.error('Failed to delete user', error);
      const message = error instanceof ApiError ? error.message : 'Failed to delete user.';
      setUserActionError(message);
    } finally {
      setUserPendingAction(null);
    }
  };

  const handlePromoteUser = async (userId: string) => {
    if (!token) {
      return;
    }

    setUserPendingAction(userId);
    setUserActionError(null);
    setUserActionMessage(null);

    try {
      const response = await promoteUserAsAdmin(token, userId);
      setUsers((prev) =>
        prev.map((candidate) => (candidate.id === userId ? response.user : candidate))
      );
      setUserActionMessage('User promoted to administrator.');
    } catch (error) {
      console.error('Failed to promote user', error);
      const message = error instanceof ApiError ? error.message : 'Failed to promote user.';
      setUserActionError(message);
    } finally {
      setUserPendingAction(null);
    }
  };

  const handleCreateProjectFieldChange =
    (field: keyof ProjectFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setCreateProjectValues((prev) => ({ ...prev, [field]: event.target.value }));
      setCreateProjectErrors((prev) => ({ ...prev, [field]: undefined, general: undefined }));
      setProjectActionMessage(null);
      setProjectActionError(null);
    };

  const handleSubmitCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token) {
      setProjectActionError('Authentication token is missing.');
      return;
    }

    const payload = {
      projectNumber: createProjectValues.projectNumber.trim(),
      name: createProjectValues.name.trim(),
      customer: createProjectValues.customer.trim(),
      description: createProjectValues.description.trim()
    };

    const errors: ProjectFormErrors = {};

    if (!payload.projectNumber) {
      errors.projectNumber = 'Project number is required.';
    }
    if (!payload.name) {
      errors.name = 'Project name is required.';
    }
    if (!payload.customer) {
      errors.customer = 'Customer is required.';
    }

    if (Object.keys(errors).length > 0) {
      setCreateProjectErrors(errors);
      return;
    }

    setCreatingProject(true);
    setCreateProjectErrors({});

    try {
      const response = await createProject(token, {
        projectNumber: payload.projectNumber,
        name: payload.name,
        customer: payload.customer,
        description: payload.description || undefined
      });
      setProjects((prev) => [response.project, ...prev]);
      setCreateProjectValues(emptyProjectForm);
      setProjectActionMessage('Project created successfully.');
      setProjectActionError(null);
    } catch (error) {
      if (error instanceof ApiError) {
        setCreateProjectErrors(parseProjectApiErrors(error.payload));
      } else {
        setCreateProjectErrors({ general: 'Failed to create project. Please try again.' });
      }
    } finally {
      setCreatingProject(false);
    }
  };

  const handleStartEditProject = (projectToEdit: Project) => {
    setEditingProjectId(projectToEdit.id);
    setProjectEditValues({
      projectNumber: projectToEdit.projectNumber,
      name: projectToEdit.name,
      customer: projectToEdit.customer,
      description: projectToEdit.description ?? ''
    });
    setProjectEditErrors({});
    setProjectEditSuccess(null);
    setProjectActionMessage(null);
    setProjectActionError(null);
  };

  const handleCancelEditProject = () => {
    setEditingProjectId(null);
    setProjectEditValues(emptyProjectForm);
    setProjectEditErrors({});
    setProjectEditSuccess(null);
  };

  const handleEditProjectFieldChange =
    (field: keyof ProjectFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setProjectEditValues((prev) => ({ ...prev, [field]: event.target.value }));
      setProjectEditErrors((prev) => ({ ...prev, [field]: undefined, general: undefined }));
      setProjectEditSuccess(null);
    };

  const editingProject = useMemo(
    () => projects.find((candidate) => candidate.id === editingProjectId) ?? null,
    [projects, editingProjectId]
  );

  const handleSubmitEditProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token || !editingProjectId || !editingProject) {
      return;
    }

    const payload: {
      projectNumber?: string;
      name?: string;
      customer?: string;
      description?: string;
    } = {};

    const projectNumberValue = projectEditValues.projectNumber.trim();
    if (projectNumberValue !== editingProject.projectNumber) {
      payload.projectNumber = projectNumberValue;
    }

    const nameValue = projectEditValues.name.trim();
    if (nameValue !== editingProject.name) {
      payload.name = nameValue;
    }

    const customerValue = projectEditValues.customer.trim();
    if (customerValue !== editingProject.customer) {
      payload.customer = customerValue;
    }

    const descriptionValue = projectEditValues.description.trim();
    if (descriptionValue !== (editingProject.description ?? '')) {
      payload.description = descriptionValue || '';
    }

    if (Object.keys(payload).length === 0) {
      setProjectEditErrors({ general: 'Update at least one field before saving.' });
      return;
    }

    setProjectSaving(true);
    setProjectEditErrors({});
    setProjectEditSuccess(null);

    try {
      const response = await updateProject(token, editingProjectId, payload);
      setProjects((prev) =>
        prev.map((candidate) => (candidate.id === editingProjectId ? response.project : candidate))
      );
      setProjectEditSuccess('Project updated successfully.');
      setProjectActionMessage('Project details updated.');
      setProjectActionError(null);
    } catch (error) {
      if (error instanceof ApiError) {
        setProjectEditErrors(parseProjectApiErrors(error.payload));
      } else {
        setProjectEditErrors({ general: 'Failed to update project. Please try again.' });
      }
    } finally {
      setProjectSaving(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!token) {
      return;
    }

    if (!window.confirm('This will permanently delete the project. Continue?')) {
      return;
    }

    setPendingProjectAction(projectId);
    setProjectActionError(null);
    setProjectActionMessage(null);

    try {
      await deleteProject(token, projectId);
      setProjects((prev) => prev.filter((candidate) => candidate.id !== projectId));
      if (editingProjectId === projectId) {
        handleCancelEditProject();
      }
      setProjectActionMessage('Project deleted successfully.');
    } catch (error) {
      console.error('Failed to delete project', error);
      const message = error instanceof ApiError ? error.message : 'Failed to delete project.';
      setProjectActionError(message);
    } finally {
      setPendingProjectAction(null);
    }
  };

  return (
    <section className={styles.root} aria-labelledby="admin-heading">
      <div className={styles.header}>
        <Title3 id="admin-heading">Administration</Title3>
        <Body1>
          Manage users and projects. Administrative privileges are required to change account roles
          or maintain project data.
        </Body1>
      </div>

      <section className={styles.section} aria-labelledby="user-management-heading">
        <div className={styles.sectionHeader}>
          <Subtitle2 id="user-management-heading">User management</Subtitle2>
          <Body1>Update user profiles, promote new administrators, or remove accounts.</Body1>
        </div>

        <div className={styles.controls}>
          <Button onClick={() => void loadUsers(false)} disabled={usersRefreshing || usersLoading}>
            {usersRefreshing ? 'Refreshing...' : 'Refresh users'}
          </Button>
        </div>

        {usersError ? (
          <Body1 className={`${styles.statusMessage} ${styles.errorText}`}>{usersError}</Body1>
        ) : null}

        {userActionError ? (
          <Body1 className={`${styles.statusMessage} ${styles.errorText}`}>
            {userActionError}
          </Body1>
        ) : null}

        {userActionMessage ? (
          <Body1 className={`${styles.statusMessage} ${styles.successText}`}>
            {userActionMessage}
          </Body1>
        ) : null}

        {usersLoading ? (
          <Spinner label="Loading users..." />
        ) : users.length === 0 ? (
          <Body1>No users found.</Body1>
        ) : (
          <div className={styles.cardGrid}>
            {users.map((userEntry) => {
              const isEditing = editingUserId === userEntry.id;
              const isCurrentUser = currentUserId === userEntry.id;
              const isBusy = userPendingAction === userEntry.id;
              const disableActions = isBusy || userSaving;

              return (
                <article
                  key={userEntry.id}
                  className={styles.card}
                  aria-labelledby={`user-${userEntry.id}`}
                >
                  <div className={styles.cardMeta}>
                    <Subtitle2 id={`user-${userEntry.id}`}>{userEntry.email}</Subtitle2>
                    <Body1>
                      Name:{' '}
                      {userEntry.firstName || userEntry.lastName
                        ? [userEntry.firstName, userEntry.lastName]
                            .filter(Boolean)
                            .join(' ')
                        : '(not provided)'}
                    </Body1>
                    <Body1>Role: {userEntry.isAdmin ? 'Administrator' : 'User'}</Body1>
                    <Caption1>Created {formatDateTime(userEntry.createdAt)}</Caption1>
                    <Caption1>Updated {formatDateTime(userEntry.updatedAt)}</Caption1>
                  </div>

                  <div className={styles.actionRow}>
                    {!isCurrentUser ? (
                      <Button
                        size="small"
                        onClick={() => handleStartEditUser(userEntry)}
                        disabled={disableActions}
                      >
                        {isEditing ? 'Editing...' : 'Edit'}
                      </Button>
                    ) : null}
                    {!userEntry.isAdmin ? (
                      <Button
                        size="small"
                        appearance="primary"
                        onClick={() => void handlePromoteUser(userEntry.id)}
                        disabled={disableActions}
                      >
                        {isBusy ? 'Promoting...' : 'Promote to admin'}
                      </Button>
                    ) : null}
                    {!isCurrentUser ? (
                      <Button
                        size="small"
                        appearance="secondary"
                        onClick={() => void handleDeleteUser(userEntry.id)}
                        disabled={disableActions}
                      >
                        {isBusy ? 'Deleting...' : 'Delete'}
                      </Button>
                    ) : null}
                  </div>

                  {isEditing ? (
                    <form className={styles.form} onSubmit={handleSubmitUserEdit} noValidate>
                      <Field
                        label="Email"
                        validationState={userFormErrors.email ? 'error' : undefined}
                        validationMessage={userFormErrors.email}
                      >
                        <Input
                          type="email"
                          value={userFormValues.email}
                          onChange={handleUserFieldChange('email')}
                          required
                        />
                      </Field>
                      <Field
                        label="First name"
                        validationState={userFormErrors.firstName ? 'error' : undefined}
                        validationMessage={userFormErrors.firstName}
                      >
                        <Input
                          value={userFormValues.firstName}
                          onChange={handleUserFieldChange('firstName')}
                        />
                      </Field>
                      <Field
                        label="Last name"
                        validationState={userFormErrors.lastName ? 'error' : undefined}
                        validationMessage={userFormErrors.lastName}
                      >
                        <Input
                          value={userFormValues.lastName}
                          onChange={handleUserFieldChange('lastName')}
                        />
                      </Field>
                      <Field
                        label="Temporary password"
                        helperText="Leave blank to keep the current password."
                        validationState={userFormErrors.password ? 'error' : undefined}
                        validationMessage={userFormErrors.password}
                      >
                        <Input
                          type="password"
                          value={userFormValues.password}
                          onChange={handleUserFieldChange('password')}
                        />
                      </Field>

                      {userFormErrors.general ? (
                        <Body1 className={styles.errorText}>{userFormErrors.general}</Body1>
                      ) : null}
                      {userFormSuccess ? (
                        <Body1 className={styles.successText}>{userFormSuccess}</Body1>
                      ) : null}

                      <div className={styles.formActions}>
                        <Button type="submit" appearance="primary" disabled={userSaving}>
                          {userSaving ? 'Saving...' : 'Save changes'}
                        </Button>
                        <Button
                          appearance="secondary"
                          onClick={handleCancelEditUser}
                          disabled={userSaving}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="project-management-heading">
        <div className={styles.sectionHeader}>
          <Subtitle2 id="project-management-heading">Project management</Subtitle2>
          <Body1>
            Create new projects or update existing records. Only administrators can change project
            data.
          </Body1>
        </div>

        <div className={styles.controls}>
          <Button
            onClick={() => void loadProjects(false)}
            disabled={projectsRefreshing || projectsLoading}
          >
            {projectsRefreshing ? 'Refreshing...' : 'Refresh projects'}
          </Button>
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

        <div className={styles.panel} aria-labelledby="create-project-heading">
          <Subtitle2 id="create-project-heading">Create a project</Subtitle2>
          <form className={styles.form} onSubmit={handleSubmitCreateProject} noValidate>
            <Field
              label="Project number"
              required
              validationState={createProjectErrors.projectNumber ? 'error' : undefined}
              validationMessage={createProjectErrors.projectNumber}
            >
              <Input
                value={createProjectValues.projectNumber}
                onChange={handleCreateProjectFieldChange('projectNumber')}
                required
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
                onChange={handleCreateProjectFieldChange('name')}
                required
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
                onChange={handleCreateProjectFieldChange('customer')}
                required
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

            <div className={styles.formActions}>
              <Button type="submit" appearance="primary" disabled={creatingProject}>
                {creatingProject ? 'Creating...' : 'Create project'}
              </Button>
              <Button
                appearance="secondary"
                type="button"
                onClick={() => {
                  setCreateProjectValues(emptyProjectForm);
                  setCreateProjectErrors({});
                }}
                disabled={creatingProject}
              >
                Clear
              </Button>
            </div>
          </form>
        </div>

        {projectsLoading ? (
          <Spinner label="Loading projects..." />
        ) : projects.length === 0 ? (
          <Body1>No projects found.</Body1>
        ) : (
          <div className={styles.cardGrid}>
            {projects.map((project) => {
              const isEditing = editingProjectId === project.id;
              const isBusy = pendingProjectAction === project.id;
              const disableActions = isBusy || projectSaving;

              return (
                <article
                  key={project.id}
                  className={styles.card}
                  aria-labelledby={`project-${project.id}`}
                >
                  <div className={styles.cardMeta}>
                    <Subtitle2 id={`project-${project.id}`}>
                      {project.projectNumber} - {project.name}
                    </Subtitle2>
                    <Body1>Customer: {project.customer}</Body1>
                    {project.description ? <Body1>{project.description}</Body1> : null}
                    <Caption1>Created {formatDateTime(project.createdAt)}</Caption1>
                    <Caption1>Updated {formatDateTime(project.updatedAt)}</Caption1>
                  </div>

                  <div className={styles.actionRow}>
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
                      onClick={() => void handleDeleteProject(project.id)}
                      disabled={disableActions}
                    >
                      {isBusy ? 'Deleting...' : 'Delete'}
                    </Button>
                  </div>

                  {isEditing ? (
                    <form className={styles.form} onSubmit={handleSubmitEditProject} noValidate>
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
                        label="Description"
                        helperText="Leave blank to clear the description."
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

                      <div className={styles.formActions}>
                        <Button type="submit" appearance="primary" disabled={projectSaving}>
                          {projectSaving ? 'Saving...' : 'Save changes'}
                        </Button>
                        <Button
                          appearance="secondary"
                          onClick={handleCancelEditProject}
                          disabled={projectSaving}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
};
