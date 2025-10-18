import { Body1, Title3 } from '@fluentui/react-components';

import { useAuth } from '@/context/AuthContext';

import { useAdminPanelStyles } from './AdminPanel/AdminPanel.styles';
import { ProjectManagementSection } from './AdminPanel/components/ProjectManagementSection';
import { UserManagementSection } from './AdminPanel/components/UserManagementSection';
import { useAdminProjectsSection } from './AdminPanel/hooks/useAdminProjectsSection';
import { useAdminUsersSection } from './AdminPanel/hooks/useAdminUsersSection';

export const AdminPanel = () => {
  const styles = useAdminPanelStyles();
  const { token, user } = useAuth();

  const usersState = useAdminUsersSection({ token: token ?? null });
  const projectsState = useAdminProjectsSection({ token: token ?? null });

  return (
    <section className={styles.root} aria-labelledby="admin-heading">
      <div className={styles.header}>
        <Title3 id="admin-heading">Administration</Title3>
        <Body1>
          Manage users and projects. Administrative privileges are required to update account roles
          or maintain project data.
        </Body1>
      </div>

      <UserManagementSection
        styles={styles}
        currentUserId={user?.id ?? null}
        state={usersState}
      />

      <ProjectManagementSection styles={styles} state={projectsState} />
    </section>
  );
};

