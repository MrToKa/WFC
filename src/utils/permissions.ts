import type { Project, User } from '@/api/client';

export const canReadCatalogs = (user: User | null | undefined): boolean =>
  Boolean(user?.isAdmin || user?.role === 'engineer');

export const canEditProject = (
  user: User | null | undefined,
  project: Project | null | undefined,
  projectId?: string,
): boolean =>
  Boolean(
    user?.isAdmin ||
      (user?.role === 'engineer' && project?.canEdit && (!projectId || project.id === projectId)),
  );
