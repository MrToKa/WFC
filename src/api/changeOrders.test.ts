import { describe, expect, it } from 'vitest';
import { buildChangeOrderExportFileName } from './changeOrders';

describe('Change Order export filename', () => {
  it('uses the Change Order title in the client fallback filename', () => {
    expect(buildChangeOrderExportFileName('GDS ESD cables')).toBe(
      'Change order - GDS ESD cables.xlsx',
    );
    expect(buildChangeOrderExportFileName('  Area 1: cable/order  ')).toBe(
      'Change order - Area 1 cable order.xlsx',
    );
  });
});
