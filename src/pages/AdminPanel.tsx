
import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Body1,
  Button,
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

const USERS_PER_PAGE = 10;
const PROJECTS_PER_PAGE = 10;

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2.5rem',
    width: '100%',
    maxWidth: '80rem',
    margin: '0 auto',
    ...shorthands.padding('0', '0', '2rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    textAlign: 'center'
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    width: '100%'
  },
  controls: {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'center',
    flexWrap: 'wrap'
  },
  filterInput: {
    width: '18rem'
  },
  statusMessage: {
    padding: '0.5rem 0.75rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    alignSelf: 'center'
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  },
  successText: {
    color: tokens.colorStatusSuccessForeground1
  },
  tableContainer: {
    width: '100%',
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: '48rem'
  },
  tableHeadCell: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
  },
  sortButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: tokens.colorNeutralForeground1,
    font: 'inherit'
  },
  tableCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: 'top'
  },
  actionCell: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  pagination: {
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'center',
    alignItems: 'center',
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
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  textarea: {
    minHeight: '6rem'
  },
  emptyState: {
    textAlign: 'center'
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
  const [userSaving, setUserSaving] = useState<boolean>(false);
  const [userPendingAction, setUserPendingAction] = useState<string | null>(null);
  const [userActionMessage, setUserActionMessage] = useState<string | null>(null);
  const [userActionError, setUserActionError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState<string>('');
  const [userSortField, setUserSortField] = useState<
    'email' | 'name' | 'role' | 'createdAt' | 'updatedAt'
  >('createdAt');
  const [userSortDirection, setUserSortDirection] = useState<'asc' | 'desc'>('desc');
  const [userPage, setUserPage] = useState<number>(1);

  const [isCreateProjectDialogOpen, setCreateProjectDialogOpen] = useState<boolean>(false);
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
  const [projectSearch, setProjectSearch] = useState<string>('');
  const [projectSortField, setProjectSortField] = useState<
    'projectNumber' | 'name' | 'customer' | 'createdAt' | 'updatedAt'
  >('createdAt');
  const [projectSortDirection, setProjectSortDirection] = useState<'asc' | 'desc'>('desc');
  const [projectPage, setProjectPage] = useState<number>(1);

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

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    const list = term
      ? users.filter((user) => {
          const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim().toLowerCase();
          return (
            user.email.toLowerCase().includes(term) ||
            name.includes(term) ||
            (user.isAdmin ? 'administrator' : 'user').includes(term)
          );
        })
      : [...users];

    const direction = userSortDirection === 'asc' ? 1 : -1;

    return list.sort((a, b) => {
      switch (userSortField) {
        case 'email':
          return a.email.localeCompare(b.email) * direction;
        case 'name': {
          const nameA = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim().toLowerCase();
          const nameB = `${b.firstName ?? ''} ${b.lastName ?? ''}`.trim().toLowerCase();
          return nameA.localeCompare(nameB) * direction;
        }
        case 'role': {
          const roleA = a.isAdmin ? 'administrator' : 'user';
          const roleB = b.isAdmin ? 'administrator' : 'user';
          return roleA.localeCompare(roleB) * direction;
        }
        case 'updatedAt':
          return (
            (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * direction
          );
        case 'createdAt':
        default:
          return (
            (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * direction
          );
      }
    });
  }, [users, userSearch, userSortField, userSortDirection]);

  const filteredProjects = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    const list = term
      ? projects.filter((project) => {
          return (
            project.projectNumber.toLowerCase().includes(term) ||
            project.name.toLowerCase().includes(term) ||
            project.customer.toLowerCase().includes(term)
          );
        })
      : [...projects];

    const direction = projectSortDirection === 'asc' ? 1 : -1;

    return list.sort((a, b) => {
      switch (projectSortField) {
        case 'projectNumber':
          return a.projectNumber.localeCompare(b.projectNumber) * direction;
        case 'name':
          return a.name.localeCompare(b.name) * direction;
        case 'customer':
          return a.customer.localeCompare(b.customer) * direction;
        case 'updatedAt':
          return (
            (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * direction
          );
        case 'createdAt':
        default:
          return (
            (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * direction
          );
      }
    });
  }, [projects, projectSearch, projectSortField, projectSortDirection]);

  const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PER_PAGE));
  const totalProjectPages = Math.max(1, Math.ceil(filteredProjects.length / PROJECTS_PER_PAGE));

  useEffect(() => {
    if (userPage > totalUserPages) {
      setUserPage(totalUserPages);
    }
  }, [totalUserPages, userPage]);

  useEffect(() => {
    if (projectPage > totalProjectPages) {
      setProjectPage(totalProjectPages);
    }
  }, [totalProjectPages, projectPage]);

  useEffect(() => {
    setUserPage(1);
  }, [userSearch, userSortField, userSortDirection]);

  useEffect(() => {
    setProjectPage(1);
  }, [projectSearch, projectSortField, projectSortDirection]);

  const pagedUsers = useMemo(() => {
    const start = (userPage - 1) * USERS_PER_PAGE;
    return filteredUsers.slice(start, start + USERS_PER_PAGE);
  }, [filteredUsers, userPage]);

  const pagedProjects = useMemo(() => {
    const start = (projectPage - 1) * PROJECTS_PER_PAGE;
    return filteredProjects.slice(start, start + PROJECTS_PER_PAGE);
  }, [filteredProjects, projectPage]);

  const toggleUserSort = (field: typeof userSortField) => {
    if (userSortField === field) {
      setUserSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setUserSortField(field);
    setUserSortDirection('asc');
  };

  const userSortIndicator = (field: typeof userSortField): string =>
    userSortField === field ? (userSortDirection === 'asc' ? ' ↑' : ' ↓') : '';

  const toggleProjectSort = (field: typeof projectSortField) => {
    if (projectSortField === field) {
      setProjectSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setProjectSortField(field);
    setProjectSortDirection('asc');
  };

  const projectSortIndicator = (field: typeof projectSortField): string =>
    projectSortField === field ? (projectSortDirection === 'asc' ? ' ↑' : ' ↓') : '';
  const handleStartEditUser = (userToEdit: User) => {
    setEditingUserId(userToEdit.id);
    setUserFormValues({
      email: userToEdit.email,
      firstName: userToEdit.firstName ?? '',
      lastName: userToEdit.lastName ?? '',
      password: ''
    });
    setUserFormErrors({});
    setUserActionMessage(null);
    setUserActionError(null);
  };

  const handleCancelEditUser = () => {
    setEditingUserId(null);
    setUserFormValues(emptyUserForm);
    setUserFormErrors({});
  };

  const handleUserFieldChange =
    (field: keyof UserFormState) => (event: ChangeEvent<HTMLInputElement>) => {
      setUserFormValues((prev) => ({ ...prev, [field]: event.target.value }));
      setUserFormErrors((prev) => ({ ...prev, [field]: undefined, general: undefined }));
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

    try {
      const response = await updateUserAsAdmin(token, editingUserId, payload);
      setUsers((prev) =>
        prev.map((candidate) => (candidate.id === editingUserId ? response.user : candidate))
      );
      setUserActionMessage('User details updated.');
      setUserActionError(null);
      handleCancelEditUser();
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
      setProjectPage(1);
      setCreateProjectDialogOpen(false);
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
      setEditingProjectId(null);
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
          Manage users and projects. Administrative privileges are required to update account roles
          or maintain project data.
        </Body1>
      </div>

      <section className={styles.section} aria-labelledby="user-management-heading">
        <div className={styles.header}>
          <Subtitle2 id="user-management-heading">User management</Subtitle2>
          <Body1>Update user profiles, promote new administrators, or remove accounts.</Body1>
        </div>

        <div className={styles.controls}>
          <Button onClick={() => void loadUsers(false)} disabled={usersRefreshing || usersLoading}>
            {usersRefreshing ? 'Refreshing...' : 'Refresh users'}
          </Button>
          <Input
            className={styles.filterInput}
            placeholder="Filter users…"
            value={userSearch}
            onChange={(event, data) => setUserSearch(data.value)}
          />
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
        ) : filteredUsers.length === 0 ? (
          <Body1 className={styles.emptyState}>No users found.</Body1>
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
                        onClick={() => toggleUserSort('email')}
                        aria-label={`Sort by email ${
                          userSortField === 'email' && userSortDirection === 'asc'
                            ? 'descending'
                            : 'ascending'
                        }`}
                      >
                        Email
                        {userSortIndicator('email')}
                      </button>
                    </th>
                    <th className={styles.tableHeadCell}>
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={() => toggleUserSort('name')}
                        aria-label={`Sort by name ${
                          userSortField === 'name' && userSortDirection === 'asc'
                            ? 'descending'
                            : 'ascending'
                        }`}
                      >
                        Name
                        {userSortIndicator('name')}
                      </button>
                    </th>
                    <th className={styles.tableHeadCell}>
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={() => toggleUserSort('role')}
                        aria-label={`Sort by role ${
                          userSortField === 'role' && userSortDirection === 'asc'
                            ? 'descending'
                            : 'ascending'
                        }`}
                      >
                        Role
                        {userSortIndicator('role')}
                      </button>
                    </th>
                    <th className={styles.tableHeadCell}>
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={() => toggleUserSort('createdAt')}
                        aria-label={`Sort by created date ${
                          userSortField === 'createdAt' && userSortDirection === 'asc'
                            ? 'descending'
                            : 'ascending'
                        }`}
                      >
                        Created
                        {userSortIndicator('createdAt')}
                      </button>
                    </th>
                    <th className={styles.tableHeadCell}>
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={() => toggleUserSort('updatedAt')}
                        aria-label={`Sort by updated date ${
                          userSortField === 'updatedAt' && userSortDirection === 'asc'
                            ? 'descending'
                            : 'ascending'
                        }`}
                      >
                        Updated
                        {userSortIndicator('updatedAt')}
                      </button>
                    </th>
                    <th className={styles.tableHeadCell}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedUsers.map((userEntry) => {
                    const isEditing = editingUserId === userEntry.id;
                    const isCurrentUser = currentUserId === userEntry.id;
                    const isBusy = userPendingAction === userEntry.id;
                    const disableActions = isBusy || userSaving;

                    return (
                      <tr key={userEntry.id}>
                        <td className={styles.tableCell}>{userEntry.email}</td>
                        <td className={styles.tableCell}>
                          {userEntry.firstName || userEntry.lastName
                            ? [userEntry.firstName, userEntry.lastName].filter(Boolean).join(' ')
                            : '(not provided)'}
                        </td>
                        <td className={styles.tableCell}>
                          {userEntry.isAdmin ? 'Administrator' : 'User'}
                        </td>
                        <td className={styles.tableCell}>{formatDateTime(userEntry.createdAt)}</td>
                        <td className={styles.tableCell}>{formatDateTime(userEntry.updatedAt)}</td>
                        <td className={`${styles.tableCell} ${styles.actionCell}`}>
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalUserPages > 1 ? (
              <div className={styles.pagination} aria-label="User table pagination">
                <Button
                  size="small"
                  onClick={() => setUserPage((prev) => Math.max(1, prev - 1))}
                  disabled={userPage === 1}
                >
                  Previous
                </Button>
                <Body1>
                  Page {userPage} of {totalUserPages}
                </Body1>
                <Button
                  size="small"
                  onClick={() => setUserPage((prev) => Math.min(totalUserPages, prev + 1))}
                  disabled={userPage === totalUserPages}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </>
        )}
        <Dialog
          open={Boolean(editingUser)}
          onOpenChange={(_event, data) => {
            if (!data.open) {
              handleCancelEditUser();
            }
          }}
        >
          <DialogSurface>
            <form onSubmit={handleSubmitUserEdit} noValidate>
              <DialogBody>
                <DialogTitle>Edit user</DialogTitle>
                <DialogContent>
                  <div className={styles.form}>
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
                  </div>
                </DialogContent>
                <DialogActions>
                  <Button
                    appearance="secondary"
                    type="button"
                    onClick={handleCancelEditUser}
                    disabled={userSaving}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" appearance="primary" disabled={userSaving}>
                    {userSaving ? 'Saving...' : 'Save changes'}
                  </Button>
                </DialogActions>
              </DialogBody>
            </form>
          </DialogSurface>
        </Dialog>
      </section>

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
              setCreateProjectValues(emptyProjectForm);
              setCreateProjectErrors({});
              setCreateProjectDialogOpen(true);
            }}
          >
            New project
          </Button>
          <Button
            onClick={() => void loadProjects(false)}
            disabled={projectsRefreshing || projectsLoading}
          >
            {projectsRefreshing ? 'Refreshing...' : 'Refresh projects'}
          </Button>
          <Input
            className={styles.filterInput}
            placeholder="Filter projects…"
            value={projectSearch}
            onChange={(event, data) => setProjectSearch(data.value)}
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
          open={isCreateProjectDialogOpen}
          onOpenChange={(_event, data) => {
            setCreateProjectDialogOpen(data.open);
            if (!data.open) {
              setCreateProjectErrors({});
              setCreateProjectValues(emptyProjectForm);
            }
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
        ) : filteredProjects.length === 0 ? (
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
                        aria-label={`Sort by project number ${
                          projectSortField === 'projectNumber' && projectSortDirection === 'asc'
                            ? 'descending'
                            : 'ascending'
                        }`}
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
                        aria-label={`Sort by name ${
                          projectSortField === 'name' && projectSortDirection === 'asc'
                            ? 'descending'
                            : 'ascending'
                        }`}
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
                        aria-label={`Sort by customer ${
                          projectSortField === 'customer' && projectSortDirection === 'asc'
                            ? 'descending'
                            : 'ascending'
                        }`}
                      >
                        Customer
                        {projectSortIndicator('customer')}
                      </button>
                    </th>
                    <th className={styles.tableHeadCell}>
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={() => toggleProjectSort('createdAt')}
                        aria-label={`Sort by created date ${
                          projectSortField === 'createdAt' && projectSortDirection === 'asc'
                            ? 'descending'
                            : 'ascending'
                        }`}
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
                        aria-label={`Sort by updated date ${
                          projectSortField === 'updatedAt' && projectSortDirection === 'asc'
                            ? 'descending'
                            : 'ascending'
                        }`}
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
                    const isBusy = pendingProjectAction === project.id;
                    const disableActions = isBusy || projectSaving;

                    return (
                      <tr key={project.id}>
                        <td className={styles.tableCell}>{project.projectNumber}</td>
                        <td className={styles.tableCell}>{project.name}</td>
                        <td className={styles.tableCell}>{project.customer}</td>
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
                            onClick={() => void handleDeleteProject(project.id)}
                            disabled={disableActions}
                          >
                            {isBusy ? 'Deleting...' : 'Delete'}
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
    </section>
  );
};
