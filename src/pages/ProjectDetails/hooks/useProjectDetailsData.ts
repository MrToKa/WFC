import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, Project, fetchProject } from '@/api/client';

type UseProjectDetailsDataParams = {
  projectId?: string;
  token?: string | null;
};

type UseProjectDetailsDataResult = {
  project: Project | null;
  projectLoading: boolean;
  projectError: string | null;
  formattedDates: { created: string; updated: string } | null;
  reloadProject: () => Promise<void>;
};

export const useProjectDetailsData = ({
  projectId,
  token,
}: UseProjectDetailsDataParams): UseProjectDetailsDataResult => {
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const identity = useMemo(() => ({ projectId, token }), [projectId, token]);
  const [settledIdentity, setSettledIdentity] = useState<typeof identity | null>(null);

  const loadProject = useCallback(async () => {
    const request = ++latestRequest.current;
    if (!projectId || token === null || token === '') {
      setError(!projectId ? 'Project not found.' : 'Sign in to view this project.');
      setProject(null);
      setIsLoading(false);
      setSettledIdentity(identity);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await (typeof token === 'string' ? fetchProject(projectId, token) : fetchProject(projectId));
      if (request !== latestRequest.current) return;
      setProject(response.project);
    } catch (err) {
      if (request !== latestRequest.current) return;
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
      if (request === latestRequest.current) {
        setIsLoading(false);
        setSettledIdentity(identity);
      }
    }
  }, [projectId, token, identity]);

  useEffect(() => {
    setProject(null);
    void loadProject();
    return () => {
      latestRequest.current += 1;
    };
  }, [loadProject]);

  const currentProject = settledIdentity === identity ? project : null;
  const formattedDates = useMemo(() => {
    if (!currentProject) {
      return null;
    }

    const format = (value: string) =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value));

    return {
      created: format(currentProject.createdAt),
      updated: format(currentProject.updatedAt),
    };
  }, [currentProject]);

  return {
    project: currentProject,
    projectLoading: isLoading || settledIdentity !== identity,
    projectError: settledIdentity === identity ? error : null,
    formattedDates,
    reloadProject: loadProject,
  };
};
