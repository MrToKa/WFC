import { describe, expect, it } from 'vitest';
import {
  calculateChangeOrderTotal,
  calculateLineTotal,
  calculateSpareQuantity,
} from './changeOrder.js';

describe('Change Order calculations', () => {
  it('calculates spare quantities including decimals and negative spare', () => {
    expect(calculateSpareQuantity(10, 12.5)).toBe(2.5);
    expect(calculateSpareQuantity(5.25, 5.25)).toBe(0);
    expect(calculateSpareQuantity(10, 8)).toBe(-2);
  });

  it('calculates line totals and the Change Order total', () => {
    expect(calculateLineTotal(2.5, 4.2)).toBeCloseTo(10.5);
    expect(calculateLineTotal(0, 100)).toBe(0);
    expect(
      calculateChangeOrderTotal([
        { orderQuantity: 2.5, unitPrice: 4.2 },
        { orderQuantity: 3, unitPrice: 2 },
      ]),
    ).toBeCloseTo(16.5);
  });
});
