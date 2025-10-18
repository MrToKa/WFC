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
  Subtitle2
} from '@fluentui/react-components';

import { formatDateTime } from '../AdminPanel.utils';
import type { AdminPanelStyles } from '../AdminPanel.styles';
import type { AdminUsersSectionState } from '../hooks/useAdminUsersSection';

type UserManagementSectionProps = {
  styles: AdminPanelStyles;
  currentUserId: string | null;
  state: AdminUsersSectionState;
};

export const UserManagementSection = ({
  styles,
  currentUserId,
  state
}: UserManagementSectionProps) => {
  const {
    usersLoading,
    usersRefreshing,
    usersError,
    pagedUsers,
    userActionMessage,
    userActionError,
    userPendingAction,
    userSearch,
    setUserSearch,
    userPage,
    setUserPage,
    totalUserPages,
    userSortIndicator,
    toggleUserSort,
    loadUsers,
    editingUser,
    editingUserId,
    userFormValues,
    userFormErrors,
    userSaving,
    handleStartEditUser,
    handleCancelEditUser,
    handleUserFieldChange,
    handleSubmitUserEdit,
    handleDeleteUser,
    handlePromoteUser
  } = state;

  return (
    <section className={styles.section} aria-labelledby="user-management-heading">
      <div className={styles.header}>
        <Subtitle2 id="user-management-heading">User management</Subtitle2>
        <Body1>Update user profiles, promote new administrators, or remove accounts.</Body1>
      </div>

      <div className={styles.controls}>
        <Button
          onClick={() => void loadUsers({ showSpinner: false })}
          disabled={usersRefreshing || usersLoading}
        >
          {usersRefreshing ? 'Refreshing...' : 'Refresh users'}
        </Button>
        <Input
          className={styles.filterInput}
          placeholder="Filter users..."
          value={userSearch}
          onChange={(_event, data) => setUserSearch(data.value)}
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
      ) : pagedUsers.length === 0 ? (
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
                    >
                      Updated
                      {userSortIndicator('updatedAt')}
                    </button>
                  </th>
                  <th className={styles.tableHeadCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedUsers.map((user) => {
                  const isEditing = editingUserId === user.id;
                  const isCurrentUser = currentUserId === user.id;
                  const isBusy = userPendingAction === user.id;
                  const disableActions = isBusy || userSaving;

                  return (
                    <tr key={user.id}>
                      <td className={styles.tableCell}>{user.email}</td>
                      <td className={styles.tableCell}>
                        {user.firstName || user.lastName
                          ? [user.firstName, user.lastName].filter(Boolean).join(' ')
                          : '(not provided)'}
                      </td>
                      <td className={styles.tableCell}>
                        {user.isAdmin ? 'Administrator' : 'User'}
                      </td>
                      <td className={styles.tableCell}>{formatDateTime(user.createdAt)}</td>
                      <td className={styles.tableCell}>{formatDateTime(user.updatedAt)}</td>
                      <td className={`${styles.tableCell} ${styles.actionCell}`}>
                        {!isCurrentUser ? (
                          <Button
                            size="small"
                            onClick={() => handleStartEditUser(user)}
                            disabled={disableActions}
                          >
                            {isEditing ? 'Editing...' : 'Edit'}
                          </Button>
                        ) : null}
                        {!user.isAdmin ? (
                          <Button
                            size="small"
                            appearance="primary"
                            onClick={() => void handlePromoteUser(user.id)}
                            disabled={disableActions}
                          >
                            {isBusy ? 'Promoting...' : 'Promote to admin'}
                          </Button>
                        ) : null}
                        {!isCurrentUser ? (
                          <Button
                            size="small"
                            appearance="secondary"
                            onClick={() => void handleDeleteUser(user.id)}
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
                    required
                  >
                    <Input
                      type="email"
                      value={userFormValues.email}
                      required
                      onChange={handleUserFieldChange('email')}
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
                    hint="Leave blank to keep the current password."
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
  );
};

