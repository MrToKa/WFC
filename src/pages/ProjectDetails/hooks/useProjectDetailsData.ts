import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, Project, fetchProject } from '@/api/client';

type UseProjectDetailsDataParams = {
  projectId?: string;
};

type UseProjectDetailsDataResult = {
  project: Project | null;
  projectLoading: boolean;
  projectError: string | null;
  formattedDates: { created: string; updated: string } | null;
  reloadProject: () => Promise<void>;
};

export const useProjectDetailsData = ({
  projectId
}: UseProjectDetailsDataParams): UseProjectDetailsDataResult => {
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadProject = useCallback(async () => {
    if (!projectId) {
      setError('Project not found.');
      setProject(null);
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
      setProject(null);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

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

  return {
    project,
    projectLoading: isLoading,
    projectError: error,
    formattedDates,
    reloadProject: loadProject
  };
};

