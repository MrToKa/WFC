import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { describeRoxtecChanges, recordRoxtecChanges } from './roxtecChangeLogService.js';
const row = {
  project_id: 'project',
  id: 1,
  revision: 'A',
  tag: 'R1',
  type: 'Frame',
  description: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};
describe('Roxtec change log', () => {
  it('records additions and deletions with the entry identity and values', () => {
    expect(describeRoxtecChanges(null, row)[0]).toContain('Added Roxtec 1 (R1)');
    expect(describeRoxtecChanges(row, null)[0]).toContain('Deleted Roxtec 1 (R1)');
    expect(describeRoxtecChanges(null, row)[0]).toContain(
      'Rev.: A; Tag: R1; Type: Frame; Description: Not specified',
    );
  });
  it('tracks changed fields and ignores timestamp-only saves', () => {
    expect(describeRoxtecChanges(row, { ...row, updated_at: '2026-02-01' })).toEqual([]);
    expect(describeRoxtecChanges(row, { ...row, revision: 'B', description: 'New' })).toEqual([
      'Roxtec 1 (R1) / Rev.: A \u2192 B',
      'Roxtec 1 (R1) / Description: Not specified \u2192 New',
    ]);
  });
  it('persists history on the project with the authenticated author and skips no-op saves', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ name: 'Test User' }] });
    const client = { query } as unknown as PoolClient;
    await recordRoxtecChanges(client, 'project', 'user', row, row);
    expect(query).not.toHaveBeenCalled();
    await recordRoxtecChanges(client, 'project', 'user', row, null);
    expect(query.mock.calls[1][0]).toContain('UPDATE projects SET roxtec_change_log');
    expect(JSON.parse(query.mock.calls[1][1][1])[0]).toMatchObject({
      userId: 'user',
      userName: 'Test User',
      changes: describeRoxtecChanges(row, null),
    });
  });
});
