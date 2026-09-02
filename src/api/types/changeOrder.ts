export type ChangeOrderSourceCatalog =
  | 'cable-type'
  | 'cable-installation-material'
  | 'tray-installation-material'
  | 'tray'
  | 'support';

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
  lineKind?: 'manual' | 'inherited';
  parentItemId?: string | null;
  quantityPerParent?: number | null;
  sourceStandardMaterialAssignmentIds?: string[];
  minimumOrderQuantity?: number | null;
  orderMeasurement?: 'pcs' | 'pack' | 'meters' | null;
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

export type ChangeOrderHeaderInput = {
  title: string;
  projectReference?: string | null;
  preparedBy: string;
  reportDate: string;
  revision: string;
};

export type ChangeOrderItemUpdate = Partial<
  Pick<
    ChangeOrderItem,
    | 'designQuantity'
    | 'orderQuantity'
    | 'unit'
    | 'packaging'
    | 'packagingQuantity'
    | 'packagingUnit'
    | 'orderedQuantity'
    | 'orderedUnit'
    | 'sapNumber'
    | 'descriptionEn'
    | 'descriptionDe'
    | 'dimensionMm'
    | 'material'
    | 'weightKg'
    | 'clearDescription'
    | 'unitPrice'
    | 'countryOfOrigin'
    | 'hsCode'
    | 'tagNo'
    | 'drawingNo'
    | 'shippingList'
    | 'revisionNumber'
    | 'clientBarcode'
    | 'manufacturer'
    | 'manufacturerPartNo'
    | 'acsBarcode'
    | 'remarks'
  >
>;
