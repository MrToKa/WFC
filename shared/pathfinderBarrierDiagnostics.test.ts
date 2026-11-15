import { describe, expect, it } from 'vitest';
import { barrierNativeDiagnosticSchema, barrierRefusalDiagnosticsSchema, safeBarrierRefusalDiagnostics } from './pathfinderBarrierDiagnostics.js';
import { barrierPublicationRefusalReceiptSchema } from './pathfinderBarrierOutcomes.js';

const receipt = { schemaVersion: 'wfc.pf.barrier-publication-refusal.v1', outcome: 'not-published',
  intentId: 'ba000000-0000-4000-8000-000000000001', commandSha256: 'a'.repeat(64), captureSha256: 'b'.repeat(64),
  frameSha256: 'c'.repeat(64), implementationSha256: 'd'.repeat(64), reasonCode: 'BARRIER_GEOMETRY_REFUSED', duplicate: false };

describe('bounded barrier refusal diagnostics', () => {
  it('preserves old hash-only receipts and accepts optional bounded known diagnostics', () => {
    expect(barrierPublicationRefusalReceiptSchema.parse(receipt)).toEqual(receipt);
    const diagnostics = safeBarrierRefusalDiagnostics([{ code: 'NONMANIFOLD_EDGE', message: 'Native detail', objectIds: ['dbid:29711'] }]);
    expect(barrierPublicationRefusalReceiptSchema.parse({ ...receipt, diagnostics }).diagnostics).toEqual(diagnostics);
  });
  it('keeps known codes but replaces arbitrary native text with canonical safe human messages', () => {
    const diagnostics = safeBarrierRefusalDiagnostics([{ code: 'DEGENERATE_TRIANGLE', message: '/private/model/path\nsecret' },
      { code: 'UNKNOWN_NATIVE_CODE', message: '/private/other/path' }]);
    expect(diagnostics).toEqual([{ code: 'DEGENERATE_TRIANGLE', message: 'A captured triangle is collapsed or below the supported numerical resolution.' }]);
    expect(JSON.stringify(diagnostics)).not.toMatch(/private|secret|UNKNOWN_NATIVE/);
  });
  it('retains only recognized exact closed-solid cause codes, never the surrounding native text', () => {
    expect(safeBarrierRefusalDiagnostics([{ code: 'CLOSED_SOLID_QUALIFICATION_REFUSED',
      message: 'Independent unchanged closed-solid qualification refused: ill_conditioned_geometry' }])[0].message)
      .toContain('Verification reason: ill_conditioned_geometry.');
    expect(safeBarrierRefusalDiagnostics([{ code: 'CLOSED_SOLID_QUALIFICATION_REFUSED',
      message: 'Independent unchanged closed-solid qualification refused: /private/path' }])[0].message)
      .toBe('A closed component failed independent solid verification.');
    expect(safeBarrierRefusalDiagnostics([{ code: 'KERNEL_QUALIFICATION_REFUSED',
      message: 'Independent closed-solid qualification refused: ill_conditioned_geometry: /private/native-detail' }])[0].message)
      .toBe('A closed component failed independent solid verification. Verification reason: ill_conditioned_geometry.');
  });
  it('bounds public diagnostic counts, messages and proven object identities', () => {
    const diagnostics = safeBarrierRefusalDiagnostics(Array.from({ length: 64 }, () => ({ code: 'WORK_LIMIT', message: 'Bound exhausted' })));
    expect(diagnostics).toHaveLength(4);
    for (const invalid of [[], Array(5).fill(diagnostics[0]), [{ ...diagnostics[0], message: 'x'.repeat(513) }],
      [{ ...diagnostics[0], message: 'unsafe\ntext' }], [{ ...diagnostics[0], objectIds: ['dbid:1', 'dbid:1'] }],
      [{ ...diagnostics[0], objectIds: ['dbid:2147483648'] }], [{ ...diagnostics[0], objectIds: Array.from({ length: 17 }, (_, i) => `dbid:${i}`) }]])
      expect(barrierRefusalDiagnosticsSchema.safeParse(invalid).success).toBe(false);
    expect(barrierNativeDiagnosticSchema.safeParse({ code: 'WORK_LIMIT', message: '', objectIds: ['/private/path'] }).success).toBe(false);
  });
});
