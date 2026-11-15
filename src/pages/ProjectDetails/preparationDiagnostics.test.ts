// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PreparationPlan } from '../../../shared/pathfinderPreparation';
import { formatPreparationDiagnostics } from './preparationDiagnostics';

const trays = [
  { projectTrayId: 'tray-10', rawName: 'C010' },
  { projectTrayId: 'tray-2', rawName: 'C002' },
  { projectTrayId: 'tray-1', rawName: 'C001' },
];
const diagnostic = (code: string, projectTrayIds: string[] = [], message = 'Generic preparation message.'):
  PreparationPlan['diagnostics'][number] => ({ code, projectTrayIds, objectIds: [], message });

describe('preparation diagnostics', () => {
  it('groups every affected tray and replaces generic purpose errors with an action', () => {
    const result = formatPreparationDiagnostics([
      diagnostic('PURPOSE_UNCONFIGURED', ['tray-10', 'tray-1']),
      diagnostic('PURPOSE_UNCONFIGURED', ['tray-2', 'tray-1']),
    ], trays);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ code: 'PURPOSE_UNCONFIGURED',
      trayIds: ['tray-1', 'tray-2', 'tray-10'], trayNames: ['C001', 'C002', 'C010'] });
    expect(result[0].message).toContain('Set the purpose permissions in Project Details');
    expect(result[0].message).toContain('Affected trays: C001, C002, C010.');
    expect(result[0].message).not.toContain('Generic preparation message');
  });

  it('keeps independent blockers visible in a deterministic order without mutating inputs', () => {
    const input = [diagnostic('TRAY_GEOMETRY_MISSING', ['tray-2']), diagnostic('PURPOSE_UNCONFIGURED', ['tray-1'])];
    const before = JSON.stringify({ input, trays });
    const result = formatPreparationDiagnostics(input, trays);
    expect(result.map(item => item.code)).toEqual(['PURPOSE_UNCONFIGURED', 'TRAY_GEOMETRY_MISSING']);
    expect(formatPreparationDiagnostics([...input].reverse(), [...trays].reverse())).toEqual(result);
    expect(JSON.stringify({ input, trays })).toBe(before);
  });

  it.each([
    ['TRAY_POLICY_INVALID', 'Review the tray details in Project Details'],
    ['TRAY_ROOT_MISSING', 'No matching model tray was found'],
    ['TRAY_ROOT_AMBIGUOUS', 'Select the intended physical tray'],
    ['NON_LEAF_ROUTING_GEOMETRY', 'Review the model hierarchy'],
    ['TRAY_GEOMETRY_MISSING', 'Select physical tray objects with geometry'],
    ['NO_AUTHORIZED_ROUTING_GEOMETRY', 'at least one tray with routing permissions'],
    ['ENDPOINT_DISCOVERY_INCOMPLETE', 'Repeat discovery for this preparation scope'],
  ])('explains %s with a specific next step', (code, expected) => {
    expect(formatPreparationDiagnostics([diagnostic(code)], trays)[0].message).toContain(expected);
  });

  it('retains unknown codes, distinct server explanations and unknown tray identifiers', () => {
    const result = formatPreparationDiagnostics([
      diagnostic('FUTURE_BLOCKER', ['removed-tray'], 'Review the new setting.'),
      diagnostic('FUTURE_BLOCKER', ['tray-1'], 'Read the model again.'),
      diagnostic('FUTURE_BLOCKER', ['tray-1'], 'Review the new setting.'),
    ], trays);
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain('Read the model again. Review the new setting. (FUTURE_BLOCKER).');
    expect(result[0].trayNames).toEqual(['C001', 'removed-tray']);
  });

  it('handles empty diagnostics and empty future messages', () => {
    expect(formatPreparationDiagnostics([], trays)).toEqual([]);
    expect(formatPreparationDiagnostics([diagnostic('FUTURE_BLOCKER', [], ' ')], trays)[0].message)
      .toBe('Preparation requires attention. (FUTURE_BLOCKER).');
  });
});
