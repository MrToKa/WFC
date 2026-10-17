import { describe, expect, it } from 'vitest';
import type { RoutingCable } from '@/api/routingCables';
import { cableTagSearchKey, projectCableRows } from './routingCableList';

const projectId = '11111111-1111-4111-8111-111111111111';
const cable = (id: string, tag: string | null, routing: string | null = null): RoutingCable => ({ id, projectId, tag, routing, fromLocation: null, toLocation: null });
describe('independent cable tag rows', () => {
  it('counts every missing tag before filtering and never invents or deduplicates labels', () => {
    const values = [cable('a', null), cable('b', ''), cable('c', ' \n\t '), cable('d', 'DUP', '/A'), cable('e', 'DUP', '/B')];
    const value = projectCableRows(values, 'DUP'); expect(value.omittedCount).toBe(3); expect(value.taggedCount).toBe(2);
    expect(value.rows.map(row => [row.id, row.tag, row.routing])).toEqual([['d', 'DUP', '/A'], ['e', 'DUP', '/B']]);
    expect(projectCableRows(values, 'missing').omittedCount).toBe(3);
  });
  it('filters with NFKC/case/trim substring keys while preserving original tags and order', () => {
    const original = '  Ｓ８-Ｃａｓｅ  '; const values = [cable('a', original), cable('b', 'prefixS8-CASEsuffix'), cable('c', 'other')];
    expect(projectCableRows(values, '  s8-ca  ').rows.map(row => row.id)).toEqual(['a', 'b']);
    expect(projectCableRows(values, 'Ｓ８-cAsE').rows[0].tag).toBe(original); expect(values[0].tag).toBe(original);
    expect(projectCableRows(values, '   ').rows).toEqual(values);
  });
  it('does not parse slash or SECONDARY markers in tag search', () => {
    expect(cableTagSearchKey(' /secondary/ ')).toBe('/SECONDARY/');
    expect(projectCableRows([cable('a', '/SECONDARY/'), cable('b', 'SECONDARY')], '/secondary/').rows.map(row => row.id)).toEqual(['a']);
  });
});
