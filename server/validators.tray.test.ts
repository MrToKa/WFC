import { describe, expect, it } from 'vitest';
import { createTraySchema, updateTraySchema } from './validators.js';

describe('tray clamp preference validators', () => {
  it('accepts existing create inputs without clamp preferences', () => {
    expect(createTraySchema.parse({ name: 'T1' })).toEqual({ name: 'T1' });
  });

  it('accepts explicit clamp preferences on creation', () => {
    expect(
      createTraySchema.safeParse({
        name: 'T1',
        useTrefoilClamps: true,
        trefoilClampSpacingMm: 600,
      }).success,
    ).toBe(true);
  });

  it.each([{ useTrefoilClamps: false }, { trefoilClampSpacingMm: 0.5 }])(
    'accepts a clamp preference update on its own',
    (input) => {
      expect(updateTraySchema.safeParse(input).success).toBe(true);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1_000_001, null, '600'])(
    'rejects invalid clamp spacing %s on create and update',
    (trefoilClampSpacingMm) => {
      expect(createTraySchema.safeParse({ name: 'T1', trefoilClampSpacingMm }).success).toBe(false);
      expect(updateTraySchema.safeParse({ trefoilClampSpacingMm }).success).toBe(false);
    },
  );

  it('rejects an empty update', () => {
    expect(updateTraySchema.safeParse({}).success).toBe(false);
  });
});

describe('automatic tray length inputs', () => {
  const reference = { modelVersionId: '00000000-0000-4000-8000-000000000001', geometryRevision: '2', aggregateId: '00000000-0000-4000-8000-000000000002', traceId: '00000000-0000-4000-8000-000000000003' };
  it('accepts a measured automatic length with a bounded reference and explicit manual approval', () => {
    expect(updateTraySchema.safeParse({ lengthMm: 123.456, lengthSource: 'auto', autoLengthReference: reference, approvedManualLengthMm: 0 }).success).toBe(true);
  });
  it.each([
    { lengthMm: 123, lengthSource: 'auto' },
    { lengthMm: null, lengthSource: 'auto', autoLengthReference: reference },
    { lengthSource: 'auto', autoLengthReference: reference },
    { autoLengthReference: reference, lengthMm: 123 },
    { lengthSource: 'manual', approvedManualLengthMm: 123 },
    { lengthMm: 123, lengthSource: 'auto', autoLengthReference: { ...reference, extra: true } },
    { lengthMm: 123, lengthSource: 'auto', autoLengthReference: reference, approvedManualLengthMm: -1 },
  ])('rejects incomplete or inconsistent automatic length input', (input) => {
    expect(updateTraySchema.safeParse(input).success).toBe(false);
  });
  it('allows explicitly returning an existing length to manual', () => {
    expect(updateTraySchema.safeParse({ lengthSource: 'manual' }).success).toBe(true);
  });
});
