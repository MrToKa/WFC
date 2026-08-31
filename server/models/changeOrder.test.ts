import { describe, expect, it, vi } from 'vitest';
import {
  calculateChangeOrderTotal,
  calculateLineTotal,
  calculateSpareQuantity,
  mapChangeOrderSummaryRow,
} from './changeOrder.js';

describe('Change Order calculations', () => {
  it('calculates spare quantities including decimals and negative spare', () => {
    expect(calculateSpareQuantity(10, 12.5)).toBe(2.5);
    expect(calculateSpareQuantity(5.25, 5.25)).toBe(0);
    expect(calculateSpareQuantity(10, 8)).toBe(-2);
    expect(calculateSpareQuantity(8, 8, 50, 1)).toBe(42);
    expect(calculateSpareQuantity(75, 75, 50, 2)).toBe(25);
    expect(calculateSpareQuantity(100, 104, 1, 104)).toBe(4);
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

  it('preserves the local calendar day returned for a database DATE', () => {
    const reportDate = new Date('2026-08-13T21:00:00.000Z');
    vi.spyOn(reportDate, 'getFullYear').mockReturnValue(2026);
    vi.spyOn(reportDate, 'getMonth').mockReturnValue(7);
    vi.spyOn(reportDate, 'getDate').mockReturnValue(14);

    const result = mapChangeOrderSummaryRow({
      id: '11111111-1111-4111-8111-111111111111',
      project_id: '22222222-2222-4222-8222-222222222222',
      document_type: 'change-order',
      title: 'Test order',
      project_reference: null,
      prepared_by: 'Test User',
      report_date: reportDate,
      revision: '00',
      created_by: null,
      created_at: '2026-08-14T00:00:00.000Z',
      updated_at: '2026-08-14T00:00:00.000Z',
    });

    expect(result.reportDate).toBe('2026-08-14');
  });
});
