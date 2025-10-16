import { useEffect, useState } from 'react';
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
import { useNavigate } from 'react-router-dom';
import { ApiError, Project, fetchProjects } from '@/api/client';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    width: '100%',
    maxWidth: 'none',
    ...shorthands.padding('0', '0', '2rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  controls: {
    display: 'flex',
    gap: '0.75rem'
  },
  filterInput: {
    width: '18rem'
  },
  tableWrapper: {
    width: '100%',
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
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap'
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
  const [search, setSearch] = useState<string>('');
  const [sortField, setSortField] = useState<'projectNumber' | 'name' | 'customer' | 'createdAt'>(
    'createdAt'
  );
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

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

  const filteredProjects = projects
    .filter((project) => {
      if (!search.trim()) {
        return true;
      }
      const term = search.trim().toLowerCase();
      return (
        project.projectNumber.toLowerCase().includes(term) ||
        project.name.toLowerCase().includes(term) ||
        project.customer.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'projectNumber':
          return a.projectNumber.localeCompare(b.projectNumber) * direction;
        case 'name':
          return a.name.localeCompare(b.name) * direction;
        case 'customer':
          return a.customer.localeCompare(b.customer) * direction;
        case 'createdAt':
        default:
          return (
            (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * direction
          );
      }
    });

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  };

  const sortIndicator = (field: typeof sortField): string =>
    sortField === field ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : '';

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
        <Input
          className={styles.filterInput}
          placeholder="Filter projects…"
          value={search}
          onChange={(event, data) => setSearch(data.value)}
        />
      </div>

      {error ? (
        <Body1 className={styles.errorText}>{error}</Body1>
      ) : null}

      {filteredProjects.length === 0 ? (
        <div className={styles.emptyState}>
          <Subtitle2>No projects found</Subtitle2>
          <Body1>Projects will appear here when they are created.</Body1>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.tableHeadCell}>
                  <button
                    type="button"
                    className={styles.sortButton}
                    onClick={() => toggleSort('projectNumber')}
                    aria-label={`Sort by project number ${
                      sortField === 'projectNumber' && sortDirection === 'asc'
                        ? 'descending'
                        : 'ascending'
                    }`}
                  >
                    Project #
                    {sortIndicator('projectNumber')}
                  </button>
                </th>
                <th className={styles.tableHeadCell}>
                  <button
                    type="button"
                    className={styles.sortButton}
                    onClick={() => toggleSort('name')}
                    aria-label={`Sort by name ${
                      sortField === 'name' && sortDirection === 'asc' ? 'descending' : 'ascending'
                    }`}
                  >
                    Name
                    {sortIndicator('name')}
                  </button>
                </th>
                <th className={styles.tableHeadCell}>
                  <button
                    type="button"
                    className={styles.sortButton}
                    onClick={() => toggleSort('customer')}
                    aria-label={`Sort by customer ${
                      sortField === 'customer' && sortDirection === 'asc'
                        ? 'descending'
                        : 'ascending'
                    }`}
                  >
                    Customer
                    {sortIndicator('customer')}
                  </button>
                </th>
                <th className={styles.tableHeadCell}>
                  <button
                    type="button"
                    className={styles.sortButton}
                    onClick={() => toggleSort('createdAt')}
                    aria-label={`Sort by created date ${
                      sortField === 'createdAt' && sortDirection === 'asc'
                        ? 'descending'
                        : 'ascending'
                    }`}
                  >
                    Created
                    {sortIndicator('createdAt')}
                  </button>
                </th>
                <th className={styles.tableHeadCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((project) => (
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



