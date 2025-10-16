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
  Title3,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';
import {
  ApiError,
  ApiErrorPayload,
  User,
  deleteUserAsAdmin,
  fetchAllUsers,
  promoteUserAsAdmin,
  updateUserAsAdmin
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    maxWidth: '72rem',
    width: '100%',
    ...shorthands.padding('0', '0', '2rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
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
  userGrid: {
    display: 'grid',
    gap: '1rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))'
  },
  userCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1rem')
  },
  userMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  actionRow: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  editForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    paddingTop: '0.75rem'
  },
  formActions: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  }
});

type FormState = {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
};

type FormErrors = Partial<Record<keyof FormState, string>> & { general?: string };

const emptyFormState: FormState = {
  email: '',
  firstName: '',
  lastName: '',
  password: ''
};

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));

const parseApiErrors = (payload: ApiErrorPayload): FormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors = Object.entries(payload.fieldErrors ?? {}).reduce<FormErrors>(
    (acc, [field, messages]) => {
      if (messages.length > 0) {
        acc[field as keyof FormState] = messages[0];
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

  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<FormState>(emptyFormState);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [pendingUserAction, setPendingUserAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const currentUserId = currentUser?.id ?? null;

  const loadUsers = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setLoadError(null);

      if (!token) {
        setUsers([]);
        setLoadError('Authentication token is missing.');
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      try {
        const response = await fetchAllUsers(token);
        setUsers(response.users);
      } catch (error) {
        console.error('Failed to fetch users', error);
        const message =
          error instanceof ApiError ? error.message : 'Failed to fetch users.';
        setLoadError(message);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [token]
  );

  useEffect(() => {
    void loadUsers(true);
  }, [loadUsers]);

  const handleStartEdit = (userToEdit: User) => {
    setEditingUserId(userToEdit.id);
    setFormValues({
      email: userToEdit.email,
      firstName: userToEdit.firstName ?? '',
      lastName: userToEdit.lastName ?? '',
      password: ''
    });
    setFormErrors({});
    setFormSuccess(null);
    setActionError(null);
    setActionMessage(null);
  };

  const handleCancelEdit = () => {
    setEditingUserId(null);
    setFormValues(emptyFormState);
    setFormErrors({});
    setFormSuccess(null);
  };

  const handleFormChange =
    (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => {
      setFormValues((prev) => ({ ...prev, [field]: event.target.value }));
      setFormErrors((prev) => ({ ...prev, [field]: undefined, general: undefined }));
      setFormSuccess(null);
    };

  const editingUser = useMemo(
    () => users.find((candidate) => candidate.id === editingUserId) ?? null,
    [users, editingUserId]
  );

  const handleSubmitEdit = async (event: FormEvent<HTMLFormElement>) => {
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

    const emailValue = formValues.email.trim();
    if (emailValue && emailValue.toLowerCase() !== editingUser.email.toLowerCase()) {
      payload.email = emailValue;
    }

    const firstNameValue = formValues.firstName.trim();
    if (
      firstNameValue &&
      firstNameValue !== (editingUser.firstName ?? '')
    ) {
      payload.firstName = firstNameValue;
    }

    const lastNameValue = formValues.lastName.trim();
    if (lastNameValue && lastNameValue !== (editingUser.lastName ?? '')) {
      payload.lastName = lastNameValue;
    }

    const passwordValue = formValues.password.trim();
    if (passwordValue) {
      payload.password = passwordValue;
    }

    if (Object.keys(payload).length === 0) {
      setFormErrors({ general: 'Update at least one field before saving.' });
      return;
    }

    setIsSaving(true);
    setFormErrors({});
    setFormSuccess(null);

    try {
      const response = await updateUserAsAdmin(token, editingUserId, payload);
      setUsers((prev) =>
        prev.map((candidate) => (candidate.id === editingUserId ? response.user : candidate))
      );
      setFormSuccess('User updated successfully.');
      setFormValues((prev) => ({ ...prev, password: '' }));
      setActionError(null);
      setActionMessage('User details updated.');
    } catch (error) {
      if (error instanceof ApiError) {
        setFormErrors(parseApiErrors(error.payload));
      } else {
        setFormErrors({ general: 'Failed to update user. Please try again.' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!token) {
      return;
    }

    if (!window.confirm('This will permanently delete the user. Continue?')) {
      return;
    }

    setPendingUserAction(userId);
    setActionError(null);
    setActionMessage(null);

    try {
      await deleteUserAsAdmin(token, userId);
      setUsers((prev) => prev.filter((candidate) => candidate.id !== userId));
      if (editingUserId === userId) {
        handleCancelEdit();
      }
      setActionMessage('User deleted successfully.');
    } catch (error) {
      console.error('Failed to delete user', error);
      const message =
        error instanceof ApiError ? error.message : 'Failed to delete user.';
      setActionError(message);
    } finally {
      setPendingUserAction(null);
    }
  };

  const handlePromoteUser = async (userId: string) => {
    if (!token) {
      return;
    }

    setPendingUserAction(userId);
    setActionError(null);
    setActionMessage(null);

    try {
      const response = await promoteUserAsAdmin(token, userId);
      setUsers((prev) =>
        prev.map((candidate) => (candidate.id === userId ? response.user : candidate))
      );
      setActionMessage('User promoted to administrator.');
    } catch (error) {
      console.error('Failed to promote user', error);
      const message =
        error instanceof ApiError ? error.message : 'Failed to promote user.';
      setActionError(message);
    } finally {
      setPendingUserAction(null);
    }
  };

  const renderUserCard = (userEntry: User) => {
    const isEditing = editingUserId === userEntry.id;
    const isCurrentUser = currentUserId === userEntry.id;
    const isBusy = pendingUserAction === userEntry.id;
    const disableActions = isBusy || isSaving;

    return (
      <article key={userEntry.id} className={styles.userCard} aria-labelledby={`user-${userEntry.id}`}>
        <div className={styles.userMeta}>
          <Subtitle2 id={`user-${userEntry.id}`}>{userEntry.email}</Subtitle2>
          <Body1>
            Name:{' '}
            {userEntry.firstName || userEntry.lastName
              ? [userEntry.firstName, userEntry.lastName].filter(Boolean).join(' ')
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
              onClick={() => handleStartEdit(userEntry)}
              disabled={disableActions}
            >
              {isEditing ? 'Editing…' : 'Edit'}
            </Button>
          ) : null}
          {!userEntry.isAdmin ? (
            <Button
              size="small"
              appearance="primary"
              onClick={() => void handlePromoteUser(userEntry.id)}
              disabled={disableActions}
            >
              {isBusy ? 'Promoting…' : 'Promote to admin'}
            </Button>
          ) : null}
          {!isCurrentUser ? (
            <Button
              size="small"
              appearance="secondary"
              onClick={() => void handleDeleteUser(userEntry.id)}
              disabled={disableActions}
            >
              {isBusy ? 'Deleting…' : 'Delete'}
            </Button>
          ) : null}
        </div>

        {isEditing ? (
          <form className={styles.editForm} onSubmit={handleSubmitEdit} noValidate>
            <Field
              label="Email"
              validationState={formErrors.email ? 'error' : undefined}
              validationMessage={formErrors.email}
            >
              <Input
                type="email"
                value={formValues.email}
                onChange={handleFormChange('email')}
                required
              />
            </Field>
            <Field
              label="First name"
              validationState={formErrors.firstName ? 'error' : undefined}
              validationMessage={formErrors.firstName}
            >
              <Input value={formValues.firstName} onChange={handleFormChange('firstName')} />
            </Field>
            <Field
              label="Last name"
              validationState={formErrors.lastName ? 'error' : undefined}
              validationMessage={formErrors.lastName}
            >
              <Input value={formValues.lastName} onChange={handleFormChange('lastName')} />
            </Field>
            <Field
              label="Temporary password"
              helperText="Leave blank to keep the current password"
              validationState={formErrors.password ? 'error' : undefined}
              validationMessage={formErrors.password}
            >
              <Input
                type="password"
                value={formValues.password}
                onChange={handleFormChange('password')}
              />
            </Field>

            {formErrors.general ? (
              <Body1 className={styles.errorText}>{formErrors.general}</Body1>
            ) : null}
            {formSuccess ? (
              <Body1 className={styles.successText}>{formSuccess}</Body1>
            ) : null}

            <div className={styles.formActions}>
              <Button type="submit" appearance="primary" disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save changes'}
              </Button>
              <Button appearance="secondary" onClick={handleCancelEdit} disabled={isSaving}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </article>
    );
  };

  if (isLoading) {
    return (
      <section className={styles.root}>
        <Spinner label="Loading users..." />
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="admin-heading">
      <div className={styles.header}>
        <Title3 id="admin-heading">Administration</Title3>
        <Body1>
          Manage registered users. You can update their profiles, promote them to administrators,
          or remove accounts.
        </Body1>
      </div>

      <div className={styles.controls}>
        <Button onClick={() => void loadUsers(false)} disabled={isRefreshing || isLoading}>
          {isRefreshing ? 'Refreshing…' : 'Refresh list'}
        </Button>
      </div>

      {loadError ? (
        <Body1 className={`${styles.statusMessage} ${styles.errorText}`}>{loadError}</Body1>
      ) : null}

      {actionError ? (
        <Body1 className={`${styles.statusMessage} ${styles.errorText}`}>{actionError}</Body1>
      ) : null}

      {actionMessage ? (
        <Body1 className={`${styles.statusMessage} ${styles.successText}`}>{actionMessage}</Body1>
      ) : null}

      {users.length === 0 ? (
        <Body1>No users found.</Body1>
      ) : (
        <div className={styles.userGrid}>{users.map(renderUserCard)}</div>
      )}
    </section>
  );
};
