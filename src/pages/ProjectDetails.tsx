import { useEffect, useMemo, useState } from 'react';
import {
  Body1,
  Button,
  Caption1,
  Spinner,
  Title3,
  makeStyles,
  shorthands,
  tokens
} from '@fluentui/react-components';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, Project, fetchProject } from '@/api/client';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    maxWidth: '48rem',
    width: '100%',
    ...shorthands.padding('0', '0', '2rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  metadata: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
    gap: '0.75rem'
  },
  panel: {
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1rem')
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  }
});

export const ProjectDetails = () => {
  const styles = useStyles();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!projectId) {
        setError('Project not found.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchProject(projectId);
        setProject(response.project);
      } catch (err) {
        console.error('Failed to load project', err);
        const message =
          err instanceof ApiError
            ? err.status === 404
              ? 'Project not found.'
              : err.message
            : 'Failed to load project.';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [projectId]);

  const formattedDates = useMemo(() => {
    if (!project) {
      return null;
    }

    const format = (value: string) =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(value));

    return {
      created: format(project.createdAt),
      updated: format(project.updatedAt)
    };
  }, [project]);

  if (isLoading) {
    return (
      <section className={styles.root}>
        <Spinner label="Loading project..." />
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.root}>
        <Body1 className={styles.errorText}>{error}</Body1>
        <Button onClick={() => navigate('/', { replace: true })}>Back to projects</Button>
      </section>
    );
  }

  if (!project) {
    return (
      <section className={styles.root}>
        <Body1>Project not available.</Body1>
        <Button onClick={() => navigate('/', { replace: true })}>Back to projects</Button>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="project-details-heading">
      <div className={styles.header}>
        <Title3 id="project-details-heading">
          {project.projectNumber} &mdash; {project.name}
        </Title3>
        <Body1>Customer: {project.customer}</Body1>
      </div>

      {formattedDates ? (
        <div className={styles.metadata}>
          <div className={styles.panel}>
            <Caption1>Created</Caption1>
            <Body1>{formattedDates.created}</Body1>
          </div>
          <div className={styles.panel}>
            <Caption1>Last updated</Caption1>
            <Body1>{formattedDates.updated}</Body1>
          </div>
        </div>
      ) : null}

      <div className={styles.panel}>
        <Caption1>Description</Caption1>
        <Body1>{project.description ? project.description : 'No description provided.'}</Body1>
      </div>

      <Button appearance="secondary" onClick={() => navigate(-1)}>
        Back
      </Button>
    </section>
  );
};
