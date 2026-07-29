export const CHANGE_ORDER_SOURCE_CATALOGS = [
  'cable-type',
  'cable-installation-material',
  'tray',
  'support',
] as const;

export type ChangeOrderSourceCatalog = (typeof CHANGE_ORDER_SOURCE_CATALOGS)[number];

export type ChangeOrderRow = {
  id: string;
  project_id: string;
  project_name?: string;
  project_customer?: string;
  title: string;
  project_reference: string | null;
  prepared_by: string;
  report_date: Date | string;
  revision: string;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  item_count?: string | number;
  total_price?: string | number;
};

export type ChangeOrderItemRow = {
  id: string;
  change_order_id: string;
  sort_order: string | number;
  source_catalog: ChangeOrderSourceCatalog;
  source_material_id: string;
  design_quantity: string | number;
  order_quantity: string | number;
  unit: string | null;
  packaging: string | null;
  packaging_quantity: string | number | null;
  packaging_unit: string | null;
  ordered_quantity: string | number | null;
  ordered_unit: string | null;
  sap_number: string | null;
  description_en: string;
  description_de: string | null;
  dimension_mm: string | null;
  material: string | null;
  weight_kg: string | number | null;
  clear_description: string | null;
  unit_price: string | number;
  country_of_origin: string | null;
  hs_code: string | null;
  tag_no: string | null;
  drawing_no: string | null;
  shipping_list: string | null;
  revision_number: string | null;
  client_barcode: string | null;
  manufacturer: string | null;
  manufacturer_part_no: string | null;
  acs_barcode: string | null;
  remarks: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type ChangeOrderItem = {
  id: string;
  changeOrderId: string;
  sortOrder: number;
  sourceCatalog: ChangeOrderSourceCatalog;
  sourceMaterialId: string;
  designQuantity: number;
  orderQuantity: number;
  spareQuantity: number;
  unit: string | null;
  packaging: string | null;
  packagingQuantity: number | null;
  packagingUnit: string | null;
  orderedQuantity: number | null;
  orderedUnit: string | null;
  sapNumber: string | null;
  descriptionEn: string;
  descriptionDe: string | null;
  dimensionMm: string | null;
  material: string | null;
  weightKg: number | null;
  clearDescription: string | null;
  unitPrice: number;
  totalPrice: number;
  countryOfOrigin: string | null;
  hsCode: string | null;
  tagNo: string | null;
  drawingNo: string | null;
  shippingList: string | null;
  revisionNumber: string | null;
  clientBarcode: string | null;
  manufacturer: string | null;
  manufacturerPartNo: string | null;
  acsBarcode: string | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChangeOrderSummary = {
  id: string;
  projectId: string;
  title: string;
  projectReference: string | null;
  preparedBy: string;
  reportDate: string;
  revision: string;
  itemCount: number;
  totalPrice: number;
  createdAt: string;
  updatedAt: string;
};

export type ChangeOrderDetails = ChangeOrderSummary & {
  projectName: string;
  projectCustomer: string;
  createdBy: string | null;
  items: ChangeOrderItem[];
};

const toIsoString = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

const toDateString = (value: Date | string): string => {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
};

export const toFiniteNumber = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const calculateSpareQuantity = (designQuantity: number, orderQuantity: number): number =>
  orderQuantity - designQuantity;

export const calculateLineTotal = (orderQuantity: number, unitPrice: number): number =>
  orderQuantity * unitPrice;

export const calculateChangeOrderTotal = (
  items: ReadonlyArray<Pick<ChangeOrderItem, 'orderQuantity' | 'unitPrice'>>,
): number =>
  items.reduce((total, item) => total + calculateLineTotal(item.orderQuantity, item.unitPrice), 0);

export const mapChangeOrderItemRow = (row: ChangeOrderItemRow): ChangeOrderItem => {
  const designQuantity = toFiniteNumber(row.design_quantity) ?? 0;
  const orderQuantity = toFiniteNumber(row.order_quantity) ?? 0;
  const unitPrice = toFiniteNumber(row.unit_price) ?? 0;

  return {
    id: row.id,
    changeOrderId: row.change_order_id,
    sortOrder: toFiniteNumber(row.sort_order) ?? 0,
    sourceCatalog: row.source_catalog,
    sourceMaterialId: row.source_material_id,
    designQuantity,
    orderQuantity,
    spareQuantity: calculateSpareQuantity(designQuantity, orderQuantity),
    unit: row.unit ?? null,
    packaging: row.packaging ?? null,
    packagingQuantity: toFiniteNumber(row.packaging_quantity),
    packagingUnit: row.packaging_unit ?? null,
    orderedQuantity: toFiniteNumber(row.ordered_quantity),
    orderedUnit: row.ordered_unit ?? null,
    sapNumber: row.sap_number ?? null,
    descriptionEn: row.description_en,
    descriptionDe: row.description_de ?? null,
    dimensionMm: row.dimension_mm ?? null,
    material: row.material ?? null,
    weightKg: toFiniteNumber(row.weight_kg),
    clearDescription: row.clear_description ?? null,
    unitPrice,
    totalPrice: calculateLineTotal(orderQuantity, unitPrice),
    countryOfOrigin: row.country_of_origin ?? null,
    hsCode: row.hs_code ?? null,
    tagNo: row.tag_no ?? null,
    drawingNo: row.drawing_no ?? null,
    shippingList: row.shipping_list ?? null,
    revisionNumber: row.revision_number ?? null,
    clientBarcode: row.client_barcode ?? null,
    manufacturer: row.manufacturer ?? null,
    manufacturerPartNo: row.manufacturer_part_no ?? null,
    acsBarcode: row.acs_barcode ?? null,
    remarks: row.remarks ?? null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
};

export const mapChangeOrderSummaryRow = (row: ChangeOrderRow): ChangeOrderSummary => ({
  id: row.id,
  projectId: row.project_id,
  title: row.title,
  projectReference: row.project_reference ?? null,
  preparedBy: row.prepared_by,
  reportDate: toDateString(row.report_date),
  revision: row.revision,
  itemCount: toFiniteNumber(row.item_count) ?? 0,
  totalPrice: toFiniteNumber(row.total_price) ?? 0,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});
