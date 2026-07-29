import { describe, expect, it } from 'vitest';
import {
  addChangeOrderItemSchema,
  createChangeOrderSchema,
  reorderChangeOrderItemsSchema,
  updateChangeOrderItemSchema,
  updateChangeOrderSchema,
} from './validators.js';

const validId = '11111111-1111-4111-8111-111111111111';

describe('Change Order validation', () => {
  it('accepts a valid header and rejects empty titles and invalid dates', () => {
    expect(
      createChangeOrderSchema.safeParse({
        title: 'Materials',
        preparedBy: 'Tester',
        reportDate: '2026-07-29',
        revision: '00',
      }).success,
    ).toBe(true);
    expect(
      createChangeOrderSchema.safeParse({
        title: ' ',
        preparedBy: 'Tester',
        reportDate: '2026-02-30',
        revision: '00',
      }).success,
    ).toBe(false);
  });

  it('rejects empty PATCH requests, negative values, NaN, and Infinity', () => {
    expect(updateChangeOrderSchema.safeParse({}).success).toBe(false);
    expect(updateChangeOrderItemSchema.safeParse({}).success).toBe(false);
    for (const unitPrice of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(updateChangeOrderItemSchema.safeParse({ unitPrice }).success).toBe(false);
    }
    expect(updateChangeOrderItemSchema.safeParse({ orderQuantity: -0.1 }).success).toBe(false);
  });

  it('rejects invalid UUIDs, unsupported catalogs, and invalid reorder lists', () => {
    expect(
      addChangeOrderItemSchema.safeParse({
        sourceCatalog: 'tray',
        sourceMaterialId: 'invalid',
      }).success,
    ).toBe(false);
    expect(
      addChangeOrderItemSchema.safeParse({
        sourceCatalog: 'load-curve',
        sourceMaterialId: validId,
      }).success,
    ).toBe(false);
    expect(
      reorderChangeOrderItemsSchema.safeParse({ orderedItemIds: [validId, validId] }).success,
    ).toBe(false);
    expect(reorderChangeOrderItemsSchema.safeParse({ orderedItemIds: [] }).success).toBe(false);
  });
});
