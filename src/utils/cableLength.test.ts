import { describe, expect, it } from 'vitest';
import type { Tray } from '@/api/client';
import { calculateAutoCableLength } from './cableLength';

const trays = [{ name: 'T1', lengthMm: 10_000 }] as Tray[];

describe('automatic cable length', () => {
  it('preserves the default 10% allowance and 5 m connection length', () => {
    expect(calculateAutoCableLength('T1', trays, null)).toBe(16);
  });

  it('applies custom allowances to the route including every secondary segment', () => {
    expect(calculateAutoCableLength('T1 / Secondary / secondary', trays, 2, 12.5, 2.5)).toBe(19);
  });

  it('allows both allowances to be zero', () => {
    expect(calculateAutoCableLength('T1', trays, null, 0, 0)).toBe(10);
  });

  it('does not calculate incomplete routes', () => {
    expect(calculateAutoCableLength('', trays, null, 20, 3)).toBeNull();
    expect(calculateAutoCableLength('missing', trays, null, 20, 3)).toBeNull();
    expect(calculateAutoCableLength('T1/Secondary', trays, null, 20, 3)).toBeNull();
  });
});
