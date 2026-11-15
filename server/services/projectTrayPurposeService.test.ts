// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { changeProjectTrayPurpose, listProjectTrayPurposes, trayPurposeNameSchema } from './projectTrayPurposeService.js';
vi.mock('../pathfinder/policySchema.js', () => ({ readPurposePolicyState: vi.fn().mockResolvedValue({}) }));
function fixture() {
  const names = new Set<string>(), trays = ['Power', 'Power'], templates = new Map([['Power', 'word-file']]);
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    if (sql.includes('WITH names AS')) return { rows: [...new Set([...names, ...trays, ...templates.keys()])].sort().map(name => ({ name, tray_count: String(trays.filter(n => n === name).length) })) };
    if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: 'project' }] };
    if (sql.startsWith('SELECT is_admin,role FROM users')) return { rows: [{ is_admin: true, role: 'admin' }] };
    if (sql.includes('SELECT r.allowed_categories')) return { rows: [{ allowed_categories: ['Control', 'Power'] }] };
    if (sql.includes('SELECT r.category_modes')) return { rows: [{ category_modes: { mv: 'left', power: 'right', control: 'left', vfd: 'right' } }] };
    if (sql.startsWith('INSERT INTO project_tray_purposes')) names.add(values[1]);
    if (sql.startsWith('DELETE FROM project_tray_purposes')) names.delete(values[1]);
    if (sql.startsWith('UPDATE trays SET')) for (let i = 0; i < trays.length; i++) { if (trays[i] === values[1]) trays[i] = values[2]; }
    if (sql.startsWith('UPDATE project_tray_purpose_templates')) { const value = templates.get(values[1]); if (value) { templates.delete(values[1]); templates.set(values[2], value); } }
    if (sql.startsWith('DELETE FROM project_tray_purpose_templates')) templates.delete(values[1]);
    return { rows: [] };
  });
  const client = { query } as unknown as PoolClient;
  return { client, query, names, trays, templates };
}
describe('project-specific tray purposes', () => {
  it('normalizes NFC and trim but preserves case and punctuation, rejecting oversized/control names', () => {
    expect(trayPurposeNameSchema.parse('  E\u0301MC & Control  ')).toBe('ÉMC & Control');
    for (const name of ['', ' ', 'x'.repeat(201), 'Bad\nname']) expect(trayPurposeNameSchema.safeParse(name).success).toBe(false);
  });
  it('reads existing tray/template names without mutating the project', async () => {
    const x = fixture(); x.names.add('Unused'); x.templates.set('Reports only', 'file');
    expect(await listProjectTrayPurposes(x.client, 'project')).toEqual({ purposes: [{ name: 'Power', trayCount: 2 }, { name: 'Reports only', trayCount: 0 }, { name: 'Unused', trayCount: 0 }] });
    expect(x.query).toHaveBeenCalledTimes(1);
    expect(x.query.mock.calls[0][1]).toEqual(['project']);
  });
  it('persists an unused name only in this project and rejects existing names', async () => {
    const x = fixture();
    const result = await changeProjectTrayPurpose(x.client, 'project', 'actor', { operation: 'create', name: ' New ' });
    expect(result.purposes).toContainEqual({ name: 'New', trayCount: 0 });
    expect(x.query).toHaveBeenCalledWith('INSERT INTO project_tray_purposes(project_id,name) VALUES($1,$2)', ['project', 'New']);
    await expect(changeProjectTrayPurpose(x.client, 'project', 'actor', { operation: 'create', name: 'Power' })).rejects.toMatchObject({ code: 'TRAY_PURPOSE_EXISTS', status: 409 });
  });
  it('renames trays and Word selection while copying active routing and drawing rules to the new incarnation', async () => {
    const x = fixture();
    const result = await changeProjectTrayPurpose(x.client, 'project', 'actor', { operation: 'rename', name: 'Power', nextName: 'LV' });
    expect(result.purposes).toEqual([{ name: 'LV', trayCount: 2 }]);
    expect(x.trays).toEqual(['LV', 'LV']); expect(x.templates.get('LV')).toBe('word-file');
    const calls = x.query.mock.calls;
    const trayUpdate = calls.findIndex(([sql]) => sql.startsWith('UPDATE trays SET'));
    const routingRead = calls.findIndex(([sql]) => sql.includes('SELECT r.allowed_categories'));
    const routingCopy = calls.findIndex(([sql]) => sql.startsWith('INSERT INTO pf_routing_purpose_rules'));
    expect(routingRead).toBeLessThan(trayUpdate); expect(routingCopy).toBeGreaterThan(trayUpdate);
    expect(calls[routingCopy][1]).toEqual(['project', 'LV', JSON.stringify(['Control', 'Power'])]);
    expect(calls.some(([sql]) => sql.startsWith('INSERT INTO pf_drawing_purpose_rules'))).toBe(true);
    expect(calls.some(([sql]) => sql.startsWith('UPDATE pf_purpose_project_state'))).toBe(true);
    expect(calls.some(([sql]) => sql.startsWith('INSERT INTO project_tray_purpose_changes'))).toBe(true);
  });
  it('refuses deleting a used purpose with a useful count and leaves assignments untouched', async () => {
    const x = fixture();
    await expect(changeProjectTrayPurpose(x.client, 'project', 'actor', { operation: 'delete', name: 'Power' })).rejects.toMatchObject({ code: 'TRAY_PURPOSE_IN_USE', status: 409, message: expect.stringContaining('2 trays') });
    expect(x.trays).toEqual(['Power', 'Power']); expect(x.templates.get('Power')).toBe('word-file');
    expect(x.query.mock.calls.some(([sql]) => /^(DELETE|UPDATE|INSERT)/.test(sql))).toBe(false);
  });
  it('deletes an unused purpose and its template without affecting other names', async () => {
    const x = fixture(); x.names.add('Unused'); x.templates.set('Unused', 'file');
    const result = await changeProjectTrayPurpose(x.client, 'project', 'actor', { operation: 'delete', name: 'Unused' });
    expect(result.purposes).toEqual([{ name: 'Power', trayCount: 2 }]); expect(x.templates.has('Unused')).toBe(false);
  });
  it('refuses rename collisions before updating trays', async () => {
    const x = fixture(); x.names.add('LV');
    await expect(changeProjectTrayPurpose(x.client, 'project', 'actor', { operation: 'rename', name: 'Power', nextName: 'LV' })).rejects.toMatchObject({ code: 'TRAY_PURPOSE_EXISTS' });
    expect(x.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE trays'))).toBe(false);
  });
});
