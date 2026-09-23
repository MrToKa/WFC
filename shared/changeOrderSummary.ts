import type { ChangeOrderItem } from '../src/api/types/changeOrder.js';

export const calculateSpareQuantity = (
  designQuantity: number,
  orderQuantity: number,
  packagingQuantity?: number | null,
  orderedQuantity?: number | null,
): number => {
  if (
    packagingQuantity !== null &&
    packagingQuantity !== undefined &&
    packagingQuantity > 0 &&
    orderedQuantity !== null &&
    orderedQuantity !== undefined
  ) {
    return orderedQuantity * packagingQuantity - designQuantity;
  }
  return orderQuantity - designQuantity;
};

export const calculateLineTotal = (orderQuantity: number, unitPrice: number): number =>
  orderQuantity * unitPrice;

// Descriptive values are deliberately excluded: the same catalog material can be
// used by several cable lines with different tags or other report text. Those
// values are joined below. Numeric values that drive package and price formulas
// remain in the key so the consolidated row keeps valid calculations.
const summaryGroupingKey = (item: ChangeOrderItem): string =>
  JSON.stringify([
    item.sourceCatalog,
    item.sourceMaterialId,
    item.packagingQuantity,
    item.minimumOrderQuantity,
    item.orderMeasurement,
    item.weightKg,
    item.unitPrice,
  ]);

const joinDistinctTextValues = (
  items: readonly ChangeOrderItem[],
  select: (item: ChangeOrderItem) => string | null,
): string | null => {
  const values: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const value = select(item)?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }

  return values.length > 0 ? values.join(', ') : null;
};

const revisionCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

export const newestRevisionNumber = (items: readonly ChangeOrderItem[]): string | null => {
  let newest: string | null = null;
  for (const item of items) {
    const revision = item.revisionNumber?.trim();
    if (!revision) continue;
    if (newest === null || revisionCollator.compare(revision, newest) > 0) {
      newest = revision;
    }
  }
  return newest;
};

const consolidateSummaryGroup = (items: readonly ChangeOrderItem[]): ChangeOrderItem => {
  const first = items[0];
  if (!first) {
    throw new Error('Cannot consolidate an empty Change Order export group');
  }

  const designQuantity = items.reduce((total, item) => total + item.designQuantity, 0);
  const orderQuantity = items.reduce((total, item) => total + item.orderQuantity, 0);
  const orderedQuantity =
    first.packagingQuantity !== null && first.packagingQuantity > 0
      ? Math.ceil(orderQuantity / first.packagingQuantity)
      : items.every((item) => item.orderedQuantity === null)
        ? null
        : items.reduce((total, item) => total + (item.orderedQuantity ?? 0), 0);
  const packagedOrderQuantity = (first.packagingQuantity ?? 0) * (orderedQuantity ?? 0);

  return {
    ...first,
    designQuantity,
    orderQuantity,
    orderedQuantity,
    spareQuantity: calculateSpareQuantity(
      designQuantity,
      orderQuantity,
      first.packagingQuantity,
      orderedQuantity,
    ),
    totalPrice: calculateLineTotal(packagedOrderQuantity, first.unitPrice),
    unit: joinDistinctTextValues(items, (item) => item.unit),
    packaging: joinDistinctTextValues(items, (item) => item.packaging),
    packagingUnit: joinDistinctTextValues(items, (item) => item.packagingUnit),
    orderedUnit: joinDistinctTextValues(items, (item) => item.orderedUnit),
    sapNumber: joinDistinctTextValues(items, (item) => item.sapNumber),
    descriptionEn:
      joinDistinctTextValues(items, (item) => item.descriptionEn) ?? first.descriptionEn,
    descriptionDe: joinDistinctTextValues(items, (item) => item.descriptionDe),
    dimensionMm: joinDistinctTextValues(items, (item) => item.dimensionMm),
    material: joinDistinctTextValues(items, (item) => item.material),
    clearDescription: joinDistinctTextValues(items, (item) => item.clearDescription),
    countryOfOrigin: joinDistinctTextValues(items, (item) => item.countryOfOrigin),
    hsCode: joinDistinctTextValues(items, (item) => item.hsCode),
    tagNo: joinDistinctTextValues(items, (item) => item.tagNo),
    drawingNo: joinDistinctTextValues(items, (item) => item.drawingNo),
    shippingList: joinDistinctTextValues(items, (item) => item.shippingList),
    revisionNumber: newestRevisionNumber(items),
    clientBarcode: joinDistinctTextValues(items, (item) => item.clientBarcode),
    manufacturer: joinDistinctTextValues(items, (item) => item.manufacturer),
    manufacturerPartNo: joinDistinctTextValues(items, (item) => item.manufacturerPartNo),
    acsBarcode: joinDistinctTextValues(items, (item) => item.acsBarcode),
    remarks: joinDistinctTextValues(items, (item) => item.remarks),
    sourceStandardMaterialAssignmentIds: Array.from(
      new Set(items.flatMap((item) => item.sourceStandardMaterialAssignmentIds ?? [])),
    ).sort(),
  };
};

export const consolidateChangeOrderItems = (
  items: readonly ChangeOrderItem[],
): ChangeOrderItem[] => {
  const groups = new Map<string, ChangeOrderItem[]>();

  for (const item of items) {
    const key = summaryGroupingKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  return Array.from(groups.values(), consolidateSummaryGroup);
};
