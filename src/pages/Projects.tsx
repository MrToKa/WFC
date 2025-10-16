import { useEffect, useState } from 'react';
import {
  Body1,
  Button,
  Caption1,
  Spinner,
  Subtitle2,
  Title3,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';
import { useNavigate } from 'react-router-dom';
import { ApiError, Project, fetchProjects } from '@/api/client';

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
    flexWrap: 'wrap',
    gap: '0.75rem'
  },
  tableWrapper: {
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: '32rem'
  },
  tableHeadCell: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
  },
  tableCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
  },
  actionsCell: {
    display: 'flex',
    gap: '0.5rem'
  },
  projectInfo: {
    display: 'flex',
    flexDirection: 'column'
  },
  emptyState: {
    padding: '1rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  }
});

export const Projects = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = async (showSpinner: boolean) => {
    if (showSpinner) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);

    try {
      const response = await fetchProjects();
      setProjects(response.projects);
    } catch (err) {
      console.error('Failed to load projects', err);
      const message = err instanceof ApiError ? err.message : 'Failed to load projects.';
      setError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadProjects(true);
  }, []);

  if (isLoading) {
    return (
      <section className={styles.root}>
        <Spinner label="Loading projects..." />
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="projects-heading">
      <div className={styles.header}>
        <Title3 id="projects-heading">Projects</Title3>
        <Body1>
          Browse the list of current projects. Select a project to view its customer details and
          description.
        </Body1>
      </div>

      <div className={styles.controls}>
        <Button onClick={() => void loadProjects(false)} disabled={isRefreshing}>
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {error ? (
        <Body1 className={styles.errorText}>{error}</Body1>
      ) : null}

      {projects.length === 0 ? (
        <div className={styles.emptyState}>
          <Subtitle2>No projects found</Subtitle2>
          <Body1>Projects will appear here when they are created.</Body1>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>Project #</th>
                <th className={styles.tableHeadCell}>Name</th>
                <th className={styles.tableHeadCell}>Customer</th>
                <th className={styles.tableHeadCell}>Created</th>
                <th className={styles.tableHeadCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td className={styles.tableCell}>{project.projectNumber}</td>
                  <td className={styles.tableCell}>
                    <div className={styles.projectInfo}>
                      <Subtitle2>{project.name}</Subtitle2>
                      {project.description ? (
                        <Caption1>{project.description}</Caption1>
                      ) : null}
                    </div>
                  </td>
                  <td className={styles.tableCell}>{project.customer}</td>
                  <td className={styles.tableCell}>
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: 'medium'
                    }).format(new Date(project.createdAt))}
                  </td>
                  <td className={`${styles.tableCell} ${styles.actionsCell}`}>
                    <Button
                      size="small"
                      appearance="primary"
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      Details
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
