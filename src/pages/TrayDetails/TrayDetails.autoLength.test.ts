import { describe, expect, it } from 'vitest';
import type { Tray } from '@/api/client';
import type { TrayAutoLengthMeasurement } from '../../../shared/trayAutoLength';
import { applyTrayAutoLength, buildTrayInput, requiresTrayAutoLengthApproval, toTrayFormState, updateTrayFormField, TrayAutoLengthRequest } from './TrayDetails.utils';

const measurement: TrayAutoLengthMeasurement = {
  lengthMm: 1234.567, elementCount: 3,
  modelVersionId: '10000000-0000-4000-8000-000000000001', geometryRevision: '7',
  aggregateId: '10000000-0000-4000-8000-000000000002', traceId: '10000000-0000-4000-8000-000000000003',
};
const tray = (lengthMm: number | null = 800): Tray => ({
  id: 'tray', projectId: 'project', name: 'B001', type: null, purpose: null,
  widthMm: null, heightMm: null, lengthMm, includeGroundingCable: false, groundingCableTypeId: null,
  createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z',
});

describe('tray auto-length form data', () => {
  it.each([800, 0])('protects legacy manual length %s until explicitly accepted', lengthMm => {
    const saved = tray(lengthMm), values = toTrayFormState(saved);
    expect(values.lengthSource).toBe('manual'); expect(values.lengthMm).toBe(String(lengthMm));
    expect(requiresTrayAutoLengthApproval(values, saved)).toBe(true);
    expect(buildTrayInput(values).input).toMatchObject({ lengthMm, lengthSource: 'manual' });
    expect(buildTrayInput(values).input).not.toHaveProperty('autoLengthReference');
  });
  it('does not bypass approval when a saved manual length is cleared in the draft', () => {
    const saved = tray(800), values = updateTrayFormField(toTrayFormState(saved), 'lengthMm', '');
    expect(requiresTrayAutoLengthApproval(values, saved)).toBe(true);
  });
  it('allows a genuinely empty length to receive auto-length directly', () => {
    const saved = tray(null), values = toTrayFormState(saved);
    expect(requiresTrayAutoLengthApproval(values, saved)).toBe(false);
    const calculated = applyTrayAutoLength(values, measurement);
    expect(calculated.lengthMm).toBe('1234.567'); expect(calculated.lengthSource).toBe('auto');
    expect(buildTrayInput(calculated).input).not.toHaveProperty('approvedManualLengthMm');
  });
  it('requires approval for an unsaved manual value even when the saved value is empty or auto', () => {
    for (const saved of [tray(null), { ...tray(800), lengthSource: 'auto' as const }]) {
      const values = updateTrayFormField(toTrayFormState(saved), 'lengthMm', '450');
      expect(requiresTrayAutoLengthApproval(values, saved)).toBe(true);
    }
  });
  it('carries only the server reference and the approved saved baseline into an auto save', () => {
    const values = updateTrayFormField(toTrayFormState(tray(800)), 'lengthMm', '950');
    const accepted = applyTrayAutoLength(values, measurement, 800), { input, errors } = buildTrayInput(accepted);
    expect(errors).toEqual({}); expect(input).toMatchObject({ lengthMm: 1234.567, lengthSource: 'auto', approvedManualLengthMm: 800,
      autoLengthReference: { modelVersionId: measurement.modelVersionId, geometryRevision: '7', aggregateId: measurement.aggregateId, traceId: measurement.traceId } });
    expect(input.autoLengthReference).not.toHaveProperty('lengthMm'); expect(input.autoLengthReference).not.toHaveProperty('elementCount');
  });
  it('reopens a saved auto length at three decimals and allows refresh while retaining its reference', () => {
    const saved = { ...tray(1200), lengthSource: 'auto' as const, lengthCalculation: { ...measurement, lengthMm: 1200, calculatedAt: '2026-10-29T00:00:00Z' } };
    const values = toTrayFormState(saved);
    expect(values.lengthMm).toBe('1200.000'); expect(requiresTrayAutoLengthApproval(values, saved)).toBe(false);
    expect(values.autoLengthReference?.traceId).toBe(measurement.traceId); expect(values.autoLengthRequested).toBe(false);
    const refreshed = applyTrayAutoLength(values, measurement);
    expect(refreshed.autoLengthRequested).toBe(true); expect(buildTrayInput(refreshed).input.autoLengthReference?.traceId).toBe(measurement.traceId);
  });
  it('saves unrelated edits to a reopened auto tray without requesting remeasurement from an old network', () => {
    const saved = { ...tray(1200), lengthSource: 'auto' as const, lengthCalculation: { ...measurement, lengthMm: 1200, calculatedAt: '2026-10-29T00:00:00Z' } };
    const renamed = updateTrayFormField(toTrayFormState(saved), 'name', 'B002'), { input, errors } = buildTrayInput(renamed);
    expect(errors).toEqual({}); expect(renamed.lengthSource).toBe('auto'); expect(renamed.autoLengthRequested).toBe(false);
    expect(input).toMatchObject({ name: 'B002', lengthMm: 1200 });
    expect(input).not.toHaveProperty('lengthSource'); expect(input).not.toHaveProperty('autoLengthReference'); expect(input).not.toHaveProperty('approvedManualLengthMm');
  });
  it('preserves auto provenance during unrelated edits and removes it on a manual length change', () => {
    const accepted = applyTrayAutoLength(toTrayFormState(tray()), measurement, 800);
    const renamed = updateTrayFormField(accepted, 'name', 'B002');
    expect(renamed.autoLengthReference).toEqual(accepted.autoLengthReference); expect(renamed.approvedManualLengthMm).toBe(800);
    const manual = updateTrayFormField(renamed, 'lengthMm', '2400,125');
    expect(manual.lengthSource).toBe('manual'); expect(manual.autoLengthRequested).toBe(false); expect(manual.autoLengthReference).toBeUndefined(); expect(manual.approvedManualLengthMm).toBeUndefined();
    expect(buildTrayInput(manual).input).toMatchObject({ name: 'B002', lengthMm: 2400.125, lengthSource: 'manual' });
    expect(buildTrayInput(manual).input).not.toHaveProperty('autoLengthReference');
  });
  it('refuses to save an auto source without its verified reference', () => {
    expect(buildTrayInput({ ...toTrayFormState(tray()), lengthSource: 'auto', autoLengthRequested: true }).errors.lengthMm).toContain('Use Auto-length again');
  });
});

describe('tray auto-length request ownership', () => {
  it('ignores a response that finishes after Cancel', () => {
    const request = new TrayAutoLengthRequest(), current = request.start('tray', () => 'tray');
    expect(request.pending).toBe(true); request.cancel();
    expect(request.pending).toBe(false); expect(current()).toBe(false);
  });
  it('keeps a new tray request pending when an old tray response arrives', () => {
    const request = new TrayAutoLengthRequest(); let owner = 'old-tray';
    const old = request.start(owner, () => owner); owner = 'new-tray';
    expect(old()).toBe(false); request.cancel(); const current = request.start(owner, () => owner);
    expect(old()).toBe(false); expect(current()).toBe(true); expect(request.pending).toBe(true);
    request.cancel(); expect(current()).toBe(false); expect(request.pending).toBe(false);
  });
  it('does not overwrite a manual edit with a cancelled auto-length response', () => {
    const request = new TrayAutoLengthRequest(), current = request.start('tray', () => 'tray');
    let values = toTrayFormState(tray());
    request.cancel(); values = updateTrayFormField(values, 'lengthMm', '950');
    if (current()) values = applyTrayAutoLength(values, measurement);
    expect(values.lengthMm).toBe('950'); expect(values.lengthSource).toBe('manual');
    expect(values.autoLengthReference).toBeUndefined();
  });
});
