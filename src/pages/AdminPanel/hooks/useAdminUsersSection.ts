import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  type User,
  deleteUserAsAdmin,
  fetchAllUsers,
  promoteUserAsAdmin,
  updateUserAsAdmin
} from '@/api/client';

import {
  USERS_PER_PAGE,
  emptyUserForm,
  parseUserApiErrors,
  type UserFormErrors,
  type UserFormState
} from '../AdminPanel.utils';

type UseAdminUsersSectionParams = {
  token: string | null;
};

export type AdminUsersSectionState = {
  usersLoading: boolean;
  usersRefreshing: boolean;
  usersError: string | null;
  users: User[];
  pagedUsers: User[];
  userSearch: string;
  setUserSearch: (value: string) => void;
  userPage: number;
  setUserPage: (value: number | ((previous: number) => number)) => void;
  totalUserPages: number;
  userSortIndicator: (field: UserSortField) => string;
  toggleUserSort: (field: UserSortField) => void;
  loadUsers: (options?: { showSpinner?: boolean }) => Promise<void>;
  editingUserId: string | null;
  editingUser: User | null;
  userFormValues: UserFormState;
  userFormErrors: UserFormErrors;
  userSaving: boolean;
  userPendingAction: string | null;
  userActionMessage: string | null;
  userActionError: string | null;
  handleStartEditUser: (user: User) => void;
  handleCancelEditUser: () => void;
  handleUserFieldChange: (
    field: keyof UserFormState
  ) => (_event: unknown, data: { value: string }) => void;
  handleSubmitUserEdit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleDeleteUser: (userId: string) => Promise<void>;
  handlePromoteUser: (userId: string) => Promise<void>;
};

type UserSortField = 'email' | 'name' | 'role' | 'createdAt' | 'updatedAt';

export const useAdminUsersSection = ({
  token
}: UseAdminUsersSectionParams): AdminUsersSectionState => {
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState<boolean>(true);
  const [usersRefreshing, setUsersRefreshing] = useState<boolean>(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [userSearch, setUserSearch] = useState<string>('');
  const [userSortField, setUserSortField] = useState<UserSortField>('createdAt');
  const [userSortDirection, setUserSortDirection] = useState<'asc' | 'desc'>('desc');
  const [userPage, setUserPageState] = useState<number>(1);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userFormValues, setUserFormValues] =
    useState<UserFormState>(emptyUserForm);
  const [userFormErrors, setUserFormErrors] = useState<UserFormErrors>({});
  const [userSaving, setUserSaving] = useState<boolean>(false);

  const [userPendingAction, setUserPendingAction] = useState<string | null>(null);
  const [userActionMessage, setUserActionMessage] = useState<string | null>(null);
  const [userActionError, setUserActionError] = useState<string | null>(null);

  const loadUsers = useCallback(
    async ({ showSpinner = true }: { showSpinner?: boolean } = {}) => {
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
        const message =
          error instanceof ApiError ? error.message : 'Failed to fetch users.';
        setUsersError(message);
      } finally {
        setUsersLoading(false);
        setUsersRefreshing(false);
      }
    },
    [token]
  );

  useEffect(() => {
    void loadUsers({ showSpinner: true });
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    const list = term
      ? users.filter((candidate) => {
          const name = `${candidate.firstName ?? ''} ${candidate.lastName ?? ''}`
            .trim()
            .toLowerCase();
          return (
            candidate.email.toLowerCase().includes(term) ||
            name.includes(term) ||
            (candidate.isAdmin ? 'administrator' : 'user').includes(term)
          );
        })
      : [...users];

    const direction = userSortDirection === 'asc' ? 1 : -1;

    return list.sort((a, b) => {
      switch (userSortField) {
        case 'email':
          return a.email.localeCompare(b.email) * direction;
        case 'name': {
          const nameA = `${a.firstName ?? ''} ${a.lastName ?? ''}`
            .trim()
            .toLowerCase();
          const nameB = `${b.firstName ?? ''} ${b.lastName ?? ''}`
            .trim()
            .toLowerCase();
          return nameA.localeCompare(nameB) * direction;
        }
        case 'role': {
          const roleA = a.isAdmin ? 'administrator' : 'user';
          const roleB = b.isAdmin ? 'administrator' : 'user';
          return roleA.localeCompare(roleB) * direction;
        }
        case 'updatedAt':
          return (
            (new Date(a.updatedAt).getTime() -
              new Date(b.updatedAt).getTime()) * direction
          );
        case 'createdAt':
        default:
          return (
            (new Date(a.createdAt).getTime() -
              new Date(b.createdAt).getTime()) * direction
          );
      }
    });
  }, [users, userSearch, userSortField, userSortDirection]);

  const totalUserPages = useMemo(
    () => Math.max(1, Math.ceil(filteredUsers.length / USERS_PER_PAGE)),
    [filteredUsers.length]
  );

  useEffect(() => {
    if (userPage > totalUserPages) {
      setUserPageState(totalUserPages);
    }
  }, [totalUserPages, userPage]);

  useEffect(() => {
    setUserPageState(1);
  }, [userSearch, userSortField, userSortDirection]);

  const pagedUsers = useMemo(() => {
    const start = (userPage - 1) * USERS_PER_PAGE;
    return filteredUsers.slice(start, start + USERS_PER_PAGE);
  }, [filteredUsers, userPage]);

  const toggleUserSort = (field: UserSortField) => {
    if (userSortField === field) {
      setUserSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setUserSortField(field);
    setUserSortDirection('asc');
  };

  const userSortIndicator = (field: UserSortField): string =>
    userSortField === field ? (userSortDirection === 'asc' ? ' ↑' : ' ↓') : '';

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

  const editingUser = useMemo(
    () => users.find((candidate) => candidate.id === editingUserId) ?? null,
    [users, editingUserId]
  );

  const handleUserFieldChange =
    (field: keyof UserFormState) =>
    (_event: unknown, data: { value: string }) => {
      setUserFormValues((previous) => ({
        ...previous,
        [field]: data.value
      }));
      setUserFormErrors((previous) => ({
        ...previous,
        [field]: undefined,
        general: undefined
      }));
    };

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
      setUsers((previous) =>
        previous.map((candidate) =>
          candidate.id === editingUserId ? response.user : candidate
        )
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
      setUsers((previous) => previous.filter((candidate) => candidate.id !== userId));
      if (editingUserId === userId) {
        handleCancelEditUser();
      }
      setUserActionMessage('User deleted successfully.');
    } catch (error) {
      console.error('Failed to delete user', error);
      const message =
        error instanceof ApiError ? error.message : 'Failed to delete user.';
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
      setUsers((previous) =>
        previous.map((candidate) =>
          candidate.id === userId ? response.user : candidate
        )
      );
      setUserActionMessage('User promoted to administrator.');
    } catch (error) {
      console.error('Failed to promote user', error);
      const message =
        error instanceof ApiError ? error.message : 'Failed to promote user.';
      setUserActionError(message);
    } finally {
      setUserPendingAction(null);
    }
  };

  return {
    usersLoading,
    usersRefreshing,
    usersError,
    users,
    pagedUsers,
    userSearch,
    setUserSearch,
    userPage,
    setUserPage: (value) => {
      setUserPageState((previous) =>
        typeof value === 'function' ? (value as (p: number) => number)(previous) : value
      );
    },
    totalUserPages,
    userSortIndicator,
    toggleUserSort,
    loadUsers,
    editingUserId,
    editingUser,
    userFormValues,
    userFormErrors,
    userSaving,
    userPendingAction,
    userActionMessage,
    userActionError,
    handleStartEditUser,
    handleCancelEditUser,
    handleUserFieldChange,
    handleSubmitUserEdit,
    handleDeleteUser,
    handlePromoteUser
  };
};
