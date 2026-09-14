import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { mapProjectRow, type ProjectRow } from '../models/project.js';
import { describeProjectChanges, recordProjectChanges } from './projectChangeLogService.js';

const project = mapProjectRow({
  id: 'project',
  project_number: 'P-1',
  name: 'Project',
  customer: 'Customer',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
} as ProjectRow);

describe('project change tracker', () => {
  it('ignores timestamps and unchanged settings', () => {
    expect(describeProjectChanges(project, { ...project, updatedAt: '2026-02-01' })).toEqual([]);
  });
  it('describes nested edits, false values and removed settings', () => {
    const before = {
      ...project,
      supportDistance: 2,
      cableLayout: { ...project.cableLayout, considerBundleSpacingAsFree: true },
    };
    const after = {
      ...project,
      cableLayout: { ...project.cableLayout, considerBundleSpacingAsFree: false },
    };
    expect(describeProjectChanges(before, after)).toEqual([
      'Distance between supports: 2 → Not specified',
      'Bundles configuration / Consider space between bundles as free: Enabled → Disabled',
    ]);
  });
  it('stores the authenticated author and changes, but skips no-op saves', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ name: 'Test User' }] });
    const client = { query } as unknown as PoolClient;
    expect(await recordProjectChanges(client, 'project', 'user', project, project)).toBeNull();
    expect(query).not.toHaveBeenCalled();
    const entry = await recordProjectChanges(client, 'project', 'user', project, {
      ...project,
      supportWeight: 5,
    });
    expect(entry).toMatchObject({
      userId: 'user',
      userName: 'Test User',
      changes: ['Support weight: Not specified → 5'],
    });
    expect(query.mock.calls[1][1]).toEqual(['project', JSON.stringify([entry])]);
  });
});
