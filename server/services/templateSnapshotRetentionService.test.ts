// @vitest-environment node
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { removeTemplateMetadata } from './templateSnapshotRetentionService.js';

describe('template snapshot image retention', () => {
  it('deletes metadata but returns only unreferenced storage keys for cleanup', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM template_files WHERE')) return { rows: [{ object_key: 'current' }] };
      if (sql.includes('FROM template_file_versions WHERE')) return { rows: [{ object_key: 'historical' }, { object_key: 'unused' }] };
      if (sql.includes('AS retained')) return { rows: [{ retained: params?.[0] !== 'unused' }] };
      return { rows: [] };
    });
    await expect(removeTemplateMetadata({ query } as unknown as PoolClient, 'template'))
      .resolves.toEqual(['unused']);
    expect(query.mock.calls[0][0]).toContain("pg_advisory_xact_lock(hashtext('wfc:project-snapshot-images'))");
    const checks = query.mock.calls.filter(([sql]) => sql.includes('AS retained'));
    expect(checks).toHaveLength(3);
    expect(checks[0][0]).toContain('FROM mutation_history');
    expect(checks[0][0]).toContain('FROM project_support_distances');
    expect(query.mock.calls.at(-1)).toEqual(['DELETE FROM template_files WHERE id = $1', ['template']]);
  });

  it('retains the binary for a referenced version while removing that catalog version', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes('AS retained')
      ? [{ retained: true }] : sql.startsWith('SELECT object_key') ? [{ object_key: 'saved-version' }] : [] }));
    await expect(removeTemplateMetadata({ query } as unknown as PoolClient, 'template', 'version')).resolves.toEqual([]);
    expect(query).toHaveBeenCalledWith('DELETE FROM template_file_versions WHERE template_id = $1 AND id = $2', ['template', 'version']);
  });

  it('does not delete metadata when the retention check fails', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('AS retained')) throw new Error('Retention query failed');
      return { rows: sql.startsWith('SELECT object_key') ? [{ object_key: 'image' }] : [] };
    });
    await expect(removeTemplateMetadata({ query } as unknown as PoolClient, 'template')).rejects.toThrow('Retention query failed');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
  });
});
