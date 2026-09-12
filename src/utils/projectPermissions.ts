import type { User } from '@/api/client';

export const canEditProjectContent = (user: User | null | undefined, projectId: string | undefined): boolean =>
  Boolean(user && (user.isAdmin || (projectId && user.engineerProjectIds?.includes(projectId))));

export const canExportCatalog = (user: User | null | undefined): boolean =>
  Boolean(user && (user.isAdmin || user.engineerProjectIds?.length));
