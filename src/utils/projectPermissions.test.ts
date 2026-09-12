import { describe, it, expect } from 'vitest';
import type { User } from '@/api/client';
import { canEditProjectContent, canExportCatalog } from './projectPermissions';

describe('project content UI permission', () => {
  it('allows administrators and assigned engineers, with no grants for other projects or ordinary users', () => {
    const engineer = { isAdmin: false, engineerProjectIds: ['project-a'] } as User;
    expect(canEditProjectContent(engineer, 'project-a')).toBe(true);
    expect(canEditProjectContent(engineer, 'project-b')).toBe(false);
    expect(canEditProjectContent({ isAdmin: false } as User, 'project-a')).toBe(false);
    expect(canEditProjectContent(null, 'project-a')).toBe(false);
    expect(canEditProjectContent({ isAdmin: true } as User, 'project-b')).toBe(true);
  });
});

it('allows catalog exports only for admins and engineers', () => {
  expect(canExportCatalog(null)).toBe(false);
  expect(canExportCatalog({ isAdmin: false, engineerProjectIds: [] } as unknown as User)).toBe(false);
  expect(canExportCatalog({ isAdmin: false, engineerProjectIds: ['project-a'] } as User)).toBe(true);
  expect(canExportCatalog({ isAdmin: true } as User)).toBe(true);
});
