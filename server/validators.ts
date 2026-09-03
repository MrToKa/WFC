import { z } from 'zod';
import { CABLE_MTO_VALUES } from './models/cable.js';
import { CHANGE_ORDER_SOURCE_CATALOGS } from './models/changeOrder.js';
import { STANDARD_MATERIAL_UNITS } from './models/standardMaterial.js';

export const registerSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(8),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(1),
  })
  .strict();

export const updateProfileSchema = z
  .object({
    email: z.string().trim().email().optional(),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    password: z.string().min(8).optional(),
  })
  .partial()
  .refine(
    (value) =>
      value.email !== undefined ||
      value.firstName !== undefined ||
      value.lastName !== undefined ||
      value.password !== undefined,
    {
      message: 'At least one field must be provided',
    },
  );

export const adminUpdateUserSchema = updateProfileSchema;

const traySupportOverrideSchema = z
  .object({
    distance: z.number().min(0).max(1_000_000).nullable().optional(),
    supportId: z.string().trim().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => value.distance !== undefined || value.supportId !== undefined, {
    message: 'Support override must include distance or support ID',
  });

const supportOverrideValueSchema = z.union([
  z.number().min(0).max(1_000_000).nullable(),
  traySupportOverrideSchema,
]);

const trayPurposeTemplateValueSchema = z.union([
  z.string().trim().uuid(),
  z
    .object({
      fileId: z.string().trim().uuid(),
    })
    .strict(),
  z.null(),
]);

const cableBundleSpacingSchema = z.enum(['0', '1D', '2D']);

const cableCategorySettingsSchema = z
  .object({
    maxRows: z.number().int().min(1).max(1_000).nullable().optional(),
    maxColumns: z.number().int().min(1).max(1_000).nullable().optional(),
    bundleSpacing: cableBundleSpacingSchema.nullable().optional(),
    trefoil: z.boolean().nullable().optional(),
    trefoilSpacingBetweenBundles: z.boolean().nullable().optional(),
    applyPhaseRotation: z.boolean().nullable().optional(),
  })
  .strict();

const customBundleRangeSchema = z
  .object({
    id: z.string().min(1),
    min: z.number().min(0).max(1000),
    max: z.number().min(0).max(1000),
  })
  .strict()
  .refine((data) => data.max > data.min, {
    message: 'max must be greater than min',
  });

const customBundleRangesSchema = z
  .object({
    mv: z.array(customBundleRangeSchema).optional(),
    power: z.array(customBundleRangeSchema).optional(),
    vfd: z.array(customBundleRangeSchema).optional(),
    control: z.array(customBundleRangeSchema).optional(),
  })
  .strict()
  .nullable();

const cableLayoutSchema = z
  .object({
    cableSpacing: z.number().min(1).max(5).nullable().optional(),
    considerBundleSpacingAsFree: z.boolean().nullable().optional(),
    minFreeSpacePercent: z.number().int().min(1).max(100).nullable().optional(),
    maxFreeSpacePercent: z.number().int().min(1).max(100).nullable().optional(),
    mv: cableCategorySettingsSchema.optional(),
    power: cableCategorySettingsSchema.optional(),
    vfd: cableCategorySettingsSchema.optional(),
    control: cableCategorySettingsSchema.optional(),
    customBundleRanges: customBundleRangesSchema.optional(),
  })
  .strict()
  .nullable();

const projectFieldSchema = {
  projectNumber: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  customer: z.string().trim().min(1).max(200),
  manager: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  secondaryTrayLength: z.number().min(0).max(1_000_000).nullable().optional(),
  supportDistance: z.number().min(0).max(1_000_000).nullable().optional(),
  supportWeight: z.number().min(0).max(1_000_000).nullable().optional(),
  trayLoadSafetyFactor: z.number().min(0).max(1_000_000).nullable().optional(),
  supportDistances: z
    .record(z.string().trim().min(1).max(200), supportOverrideValueSchema)
    .optional(),
  trayPurposeTemplates: z
    .record(z.string().trim().min(1).max(200), trayPurposeTemplateValueSchema)
    .optional(),
  cableLayout: cableLayoutSchema.optional(),
} as const;

export const createProjectSchema = z.object(projectFieldSchema).strict();

export const updateProjectSchema = z
  .object({
    projectNumber: projectFieldSchema.projectNumber.optional(),
    name: projectFieldSchema.name.optional(),
    customer: projectFieldSchema.customer.optional(),
    manager: projectFieldSchema.manager,
    description: projectFieldSchema.description.optional(),
    secondaryTrayLength: projectFieldSchema.secondaryTrayLength,
    supportDistance: projectFieldSchema.supportDistance,
    supportWeight: projectFieldSchema.supportWeight,
    trayLoadSafetyFactor: projectFieldSchema.trayLoadSafetyFactor,
    supportDistances: projectFieldSchema.supportDistances,
    trayPurposeTemplates: projectFieldSchema.trayPurposeTemplates,
    cableLayout: projectFieldSchema.cableLayout,
  })
  .strict()
  .refine(
    (value) =>
      value.projectNumber !== undefined ||
      value.name !== undefined ||
      value.customer !== undefined ||
      value.manager !== undefined ||
      value.description !== undefined ||
      value.secondaryTrayLength !== undefined ||
      value.supportDistance !== undefined ||
      value.supportWeight !== undefined ||
      value.trayLoadSafetyFactor !== undefined ||
      value.supportDistances !== undefined ||
      value.trayPurposeTemplates !== undefined ||
      value.cableLayout !== undefined,
    {
      message: 'At least one field must be provided',
    },
  );

export const clearProjectDataSchema = z
  .object({
    cableTypes: z.boolean().optional(),
    cables: z.boolean().optional(),
    trays: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.cableTypes || value.cables || value.trays, {
    message: 'At least one dataset must be selected',
  });

const cableTypeNumericField = z.number().min(0).max(1_000_000).nullable().optional();

const cableTypeStringField = z.string().trim().max(500).optional();

const materialCableTypeStringField = z.string().trim().max(2000).nullable().optional();
const minimumOrderQuantityField = z
  .number({ invalid_type_error: 'Enter a minimum order quantity' })
  .finite('Enter a finite minimum order quantity')
  .positive('Minimum order quantity must be greater than zero')
  .max(1_000_000)
  .optional();
const materialUnitPriceField = z
  .number({ invalid_type_error: 'Enter a unit price' })
  .finite('Enter a finite unit price')
  .nonnegative('Unit price must be non-negative')
  .optional();
const orderMeasurementField = z.enum(['pcs', 'pack', 'meters']).optional();
const materialPackagingField = z.enum(['m', 'Package', 'Box', 'Drum', 'pcs']).optional();
const materialSourceField = z
  .union([
    z
      .string()
      .trim()
      .max(2_000)
      .url('Enter a valid internet link')
      .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
        message: 'Source must use http:// or https://',
      }),
    z.null(),
  ])
  .optional();

const cableTypeDefaultMaterialNameField = z.string().trim().min(1).max(200);
const cableTypeDefaultMaterialTextField = z.string().trim().max(500).nullable().optional();
const cableTypeDefaultMaterialRemarksField = z.string().trim().max(2000).nullable().optional();
const cableTypeDefaultMaterialUnitField = z.enum(['pcs', 'meters', 'pcs/m']).nullable().optional();

export const createCableTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    sourceMaterialCableTypeId: z.string().uuid().optional(),
    purpose: cableTypeStringField,
    diameterMm: cableTypeNumericField,
    weightKgPerM: cableTypeNumericField,
  })
  .strict();

export const updateCableTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    sourceMaterialCableTypeId: z.string().uuid().optional(),
    purpose: cableTypeStringField,
    diameterMm: cableTypeNumericField,
    weightKgPerM: cableTypeNumericField,
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.sourceMaterialCableTypeId !== undefined ||
      value.purpose !== undefined ||
      value.diameterMm !== undefined ||
      value.weightKgPerM !== undefined,
    { message: 'At least one field must be provided' },
  );

export const createMaterialCableTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    purpose: cableTypeStringField,
    material: materialCableTypeStringField,
    description: materialCableTypeStringField,
    manufacturer: materialCableTypeStringField,
    partNo: materialCableTypeStringField,
    unitPrice: materialUnitPriceField,
    minimumOrderQuantity: minimumOrderQuantityField,
    orderMeasurement: orderMeasurementField,
    packaging: materialPackagingField,
    source: materialSourceField,
    remarks: materialCableTypeStringField,
    diameterMm: cableTypeNumericField,
    weightKgPerM: cableTypeNumericField,
  })
  .strict();

export const updateMaterialCableTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    purpose: cableTypeStringField,
    material: materialCableTypeStringField,
    description: materialCableTypeStringField,
    manufacturer: materialCableTypeStringField,
    partNo: materialCableTypeStringField,
    unitPrice: materialUnitPriceField,
    minimumOrderQuantity: minimumOrderQuantityField,
    orderMeasurement: orderMeasurementField,
    packaging: materialPackagingField,
    source: materialSourceField,
    remarks: materialCableTypeStringField,
    diameterMm: cableTypeNumericField,
    weightKgPerM: cableTypeNumericField,
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.purpose !== undefined ||
      value.material !== undefined ||
      value.description !== undefined ||
      value.manufacturer !== undefined ||
      value.partNo !== undefined ||
      value.unitPrice !== undefined ||
      value.remarks !== undefined ||
      value.diameterMm !== undefined ||
      value.weightKgPerM !== undefined ||
      value.minimumOrderQuantity !== undefined ||
      value.orderMeasurement !== undefined ||
      value.packaging !== undefined ||
      value.source !== undefined,
    { message: 'At least one field must be provided' },
  );

export const createMaterialCableInstallationMaterialSchema = z
  .object({
    type: z.string().trim().min(1).max(200),
    purpose: materialCableTypeStringField,
    material: materialCableTypeStringField,
    description: materialCableTypeStringField,
    manufacturer: materialCableTypeStringField,
    partNo: materialCableTypeStringField,
    dimensionMm: z.string().trim().min(1).max(500).nullable().optional(),
    weightKg: cableTypeNumericField,
    unitPrice: materialUnitPriceField,
    minimumOrderQuantity: minimumOrderQuantityField,
    orderMeasurement: orderMeasurementField,
    packaging: materialPackagingField,
    source: materialSourceField,
  })
  .strict();

export const updateMaterialCableInstallationMaterialSchema = z
  .object({
    type: z.string().trim().min(1).max(200).optional(),
    purpose: materialCableTypeStringField,
    material: materialCableTypeStringField,
    description: materialCableTypeStringField,
    manufacturer: materialCableTypeStringField,
    partNo: materialCableTypeStringField,
    dimensionMm: z.string().trim().min(1).max(500).nullable().optional(),
    weightKg: cableTypeNumericField,
    unitPrice: materialUnitPriceField,
    minimumOrderQuantity: minimumOrderQuantityField,
    orderMeasurement: orderMeasurementField,
    packaging: materialPackagingField,
    source: materialSourceField,
  })
  .strict()
  .refine(
    (value) =>
      value.type !== undefined ||
      value.purpose !== undefined ||
      value.material !== undefined ||
      value.description !== undefined ||
      value.manufacturer !== undefined ||
      value.partNo !== undefined ||
      value.dimensionMm !== undefined ||
      value.weightKg !== undefined ||
      value.unitPrice !== undefined ||
      value.minimumOrderQuantity !== undefined ||
      value.orderMeasurement !== undefined ||
      value.packaging !== undefined ||
      value.source !== undefined,
    { message: 'At least one field must be provided' },
  );

// Tray installation materials intentionally share the same catalog shape and
// validation rules as cable installation materials.
export const createMaterialTrayInstallationMaterialSchema =
  createMaterialCableInstallationMaterialSchema;

export const updateMaterialTrayInstallationMaterialSchema =
  updateMaterialCableInstallationMaterialSchema;

export const createCableTypeDefaultMaterialSchema = z
  .object({
    name: cableTypeDefaultMaterialNameField,
    quantity: cableTypeNumericField,
    unit: cableTypeDefaultMaterialUnitField,
    remarks: cableTypeDefaultMaterialRemarksField,
  })
  .strict();

export const updateCableTypeDefaultMaterialSchema = z
  .object({
    name: cableTypeDefaultMaterialNameField.optional(),
    quantity: cableTypeNumericField,
    unit: cableTypeDefaultMaterialUnitField,
    remarks: cableTypeDefaultMaterialRemarksField,
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.quantity !== undefined ||
      value.unit !== undefined ||
      value.remarks !== undefined,
    { message: 'At least one field must be provided' },
  );

export const createCableMaterialSchema = createCableTypeDefaultMaterialSchema;

export const updateCableMaterialSchema = updateCableTypeDefaultMaterialSchema;

const standardMaterialQuantity = z.number().finite().positive().max(1_000_000_000);

export const createStandardMaterialSchema = z
  .object({
    referencedMaterialId: z.string().uuid(),
    quantity: standardMaterialQuantity,
    unit: z.enum(STANDARD_MATERIAL_UNITS),
    remarks: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();

export const updateStandardMaterialSchema = createStandardMaterialSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

const cableStringField = z.string().trim().max(500).optional();
const cableMtoField = z.enum(CABLE_MTO_VALUES).nullable().optional();

export const createCableSchema = z
  .object({
    cableId: z.number().int().min(0).max(2_147_483_647),
    revision: z.string().trim().max(500).optional(),
    mto: cableMtoField,
    tag: z.string().trim().max(500).optional(),
    cableTypeId: z.string().trim().uuid(),
    fromLocation: cableStringField,
    toLocation: cableStringField,
    routing: cableStringField,
    delivery: cableStringField,
    designLength: z.number().int().min(0).max(1_000_000).nullable().optional(),
    installLength: z.number().int().min(0).max(1_000_000).nullable().optional(),
    pullDate: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date',
      })
      .nullable()
      .optional(),
    connectedFrom: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date',
      })
      .nullable()
      .optional(),
    connectedTo: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date',
      })
      .nullable()
      .optional(),
    tested: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date',
      })
      .nullable()
      .optional(),
  })
  .strict();

export const updateCableSchema = z
  .object({
    cableId: z.number().int().min(0).max(2_147_483_647).optional(),
    revision: z.string().trim().max(500).optional(),
    mto: cableMtoField,
    tag: z.string().trim().max(500).optional(),
    cableTypeId: z.string().trim().uuid().optional(),
    fromLocation: cableStringField,
    toLocation: cableStringField,
    routing: cableStringField,
    delivery: cableStringField,
    designLength: z.number().int().min(0).max(1_000_000).nullable().optional(),
    installLength: z.number().int().min(0).max(1_000_000).nullable().optional(),
    pullDate: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date',
      })
      .nullable()
      .optional(),
    connectedFrom: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date',
      })
      .nullable()
      .optional(),
    connectedTo: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date',
      })
      .nullable()
      .optional(),
    tested: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date',
      })
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.cableId !== undefined ||
      value.revision !== undefined ||
      value.mto !== undefined ||
      value.tag !== undefined ||
      value.cableTypeId !== undefined ||
      value.fromLocation !== undefined ||
      value.toLocation !== undefined ||
      value.routing !== undefined ||
      value.delivery !== undefined ||
      value.designLength !== undefined ||
      value.installLength !== undefined ||
      value.pullDate !== undefined ||
      value.connectedFrom !== undefined ||
      value.connectedTo !== undefined ||
      value.tested !== undefined,
    { message: 'At least one field must be provided' },
  );

const trayStringField = z.string().trim().max(500).optional();

const trayNumericField = z.number().min(0).max(1_000_000).nullable().optional();

export const createTraySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: trayStringField,
    purpose: trayStringField,
    widthMm: trayNumericField,
    heightMm: trayNumericField,
    lengthMm: trayNumericField,
  })
  .strict();

export const updateTraySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    type: trayStringField,
    purpose: trayStringField,
    widthMm: trayNumericField,
    heightMm: trayNumericField,
    lengthMm: trayNumericField,
    includeGroundingCable: z.boolean().optional(),
    groundingCableTypeId: z.union([z.string().trim().uuid(), z.null()]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.type !== undefined ||
      value.purpose !== undefined ||
      value.widthMm !== undefined ||
      value.heightMm !== undefined ||
      value.lengthMm !== undefined ||
      value.includeGroundingCable !== undefined ||
      value.groundingCableTypeId !== undefined,
    { message: 'At least one field must be provided' },
  );

const materialNumericField = z.number().min(0).max(1_000_000).nullable().optional();

const materialManufacturerField = z.string().trim().min(1).max(200).nullable().optional();

const materialImageTemplateField = z.union([z.string().trim().uuid(), z.null()]).optional();

export const createMaterialTraySchema = z
  .object({
    type: z.string().trim().min(1).max(200),
    manufacturer: materialManufacturerField,
    heightMm: materialNumericField,
    rungHeightMm: materialNumericField,
    widthMm: materialNumericField,
    weightKgPerM: materialNumericField,
    unitPrice: materialUnitPriceField,
    imageTemplateId: materialImageTemplateField,
    minimumOrderQuantity: minimumOrderQuantityField,
    orderMeasurement: orderMeasurementField,
    packaging: materialPackagingField,
    source: materialSourceField,
  })
  .strict();

export const createMaterialSupportSchema = z
  .object({
    type: z.string().trim().min(1).max(200),
    manufacturer: materialManufacturerField,
    heightMm: materialNumericField,
    widthMm: materialNumericField,
    lengthMm: materialNumericField,
    weightKg: materialNumericField,
    unitPrice: materialUnitPriceField,
    imageTemplateId: materialImageTemplateField,
    minimumOrderQuantity: minimumOrderQuantityField,
    orderMeasurement: orderMeasurementField,
    packaging: materialPackagingField,
    source: materialSourceField,
  })
  .strict();

export const updateMaterialTraySchema = z
  .object({
    type: z.string().trim().min(1).max(200).optional(),
    manufacturer: materialManufacturerField,
    heightMm: materialNumericField,
    rungHeightMm: materialNumericField,
    widthMm: materialNumericField,
    weightKgPerM: materialNumericField,
    unitPrice: materialUnitPriceField,
    loadCurveId: z.string().uuid().optional().nullable(),
    imageTemplateId: materialImageTemplateField,
    minimumOrderQuantity: minimumOrderQuantityField,
    orderMeasurement: orderMeasurementField,
    packaging: materialPackagingField,
    source: materialSourceField,
  })
  .strict()
  .refine(
    (value) =>
      value.type !== undefined ||
      value.manufacturer !== undefined ||
      value.heightMm !== undefined ||
      value.rungHeightMm !== undefined ||
      value.widthMm !== undefined ||
      value.weightKgPerM !== undefined ||
      value.unitPrice !== undefined ||
      value.loadCurveId !== undefined ||
      value.imageTemplateId !== undefined ||
      value.minimumOrderQuantity !== undefined ||
      value.orderMeasurement !== undefined ||
      value.packaging !== undefined ||
      value.source !== undefined,
    { message: 'At least one field must be provided' },
  );

export const updateMaterialSupportSchema = z
  .object({
    type: z.string().trim().min(1).max(200).optional(),
    manufacturer: materialManufacturerField,
    heightMm: materialNumericField,
    widthMm: materialNumericField,
    lengthMm: materialNumericField,
    weightKg: materialNumericField,
    unitPrice: materialUnitPriceField,
    imageTemplateId: materialImageTemplateField,
    minimumOrderQuantity: minimumOrderQuantityField,
    orderMeasurement: orderMeasurementField,
    packaging: materialPackagingField,
    source: materialSourceField,
  })
  .strict()
  .refine(
    (value) =>
      value.type !== undefined ||
      value.manufacturer !== undefined ||
      value.heightMm !== undefined ||
      value.widthMm !== undefined ||
      value.lengthMm !== undefined ||
      value.weightKg !== undefined ||
      value.unitPrice !== undefined ||
      value.imageTemplateId !== undefined ||
      value.minimumOrderQuantity !== undefined ||
      value.orderMeasurement !== undefined ||
      value.packaging !== undefined ||
      value.source !== undefined,
    { message: 'At least one field must be provided' },
  );

const loadCurvePointNumericField = z
  .number({ invalid_type_error: 'Enter a non-negative number' })
  .refine((value) => Number.isFinite(value) && value >= 0, {
    message: 'Enter a non-negative finite number',
  });

export const loadCurvePointSchema = z
  .object({
    spanM: loadCurvePointNumericField,
    loadKnPerM: loadCurvePointNumericField,
  })
  .strict();

export const createMaterialLoadCurveSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional().nullable(),
    trayId: z.string().uuid().optional().nullable(),
    points: z.array(loadCurvePointSchema).max(2000).optional(),
  })
  .strict();

export const updateMaterialLoadCurveSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    trayId: z.string().uuid().optional().nullable(),
    points: z.array(loadCurvePointSchema).max(2000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.trayId !== undefined ||
      value.points !== undefined,
    { message: 'At least one field must be provided' },
  );

const changeOrderDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date in YYYY-MM-DD format')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date');

const optionalChangeOrderText = (maximum = 2_000) =>
  z.string().trim().max(maximum).nullable().optional();

const finiteNonNegativeNumber = z
  .number({ invalid_type_error: 'Enter a non-negative number' })
  .finite('Enter a finite number')
  .nonnegative('Enter a non-negative number');

export const createChangeOrderSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(300),
    projectReference: optionalChangeOrderText(300),
    preparedBy: z.string().trim().min(1, 'Prepared by is required').max(300),
    reportDate: changeOrderDateSchema,
    revision: z.string().trim().min(1, 'Revision is required').max(50),
  })
  .strict();

export const updateChangeOrderSchema = createChangeOrderSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const addChangeOrderItemSchema = z
  .object({
    sourceCatalog: z.enum(CHANGE_ORDER_SOURCE_CATALOGS),
    sourceMaterialId: z.string().uuid(),
  })
  .strict();

export const updateChangeOrderItemSchema = z
  .object({
    designQuantity: finiteNonNegativeNumber.optional(),
    orderQuantity: finiteNonNegativeNumber.optional(),
    unit: optionalChangeOrderText(50),
    packaging: optionalChangeOrderText(200),
    packagingQuantity: finiteNonNegativeNumber.nullable().optional(),
    packagingUnit: optionalChangeOrderText(50),
    orderedQuantity: finiteNonNegativeNumber.nullable().optional(),
    orderedUnit: optionalChangeOrderText(50),
    sapNumber: optionalChangeOrderText(200),
    descriptionEn: z.string().trim().min(1).max(2_000).optional(),
    descriptionDe: optionalChangeOrderText(),
    dimensionMm: optionalChangeOrderText(500),
    material: optionalChangeOrderText(500),
    weightKg: finiteNonNegativeNumber.nullable().optional(),
    clearDescription: optionalChangeOrderText(5_000),
    unitPrice: finiteNonNegativeNumber.optional(),
    countryOfOrigin: optionalChangeOrderText(200),
    hsCode: optionalChangeOrderText(200),
    tagNo: optionalChangeOrderText(500),
    drawingNo: optionalChangeOrderText(500),
    shippingList: optionalChangeOrderText(500),
    revisionNumber: optionalChangeOrderText(100),
    clientBarcode: optionalChangeOrderText(500),
    manufacturer: optionalChangeOrderText(500),
    manufacturerPartNo: optionalChangeOrderText(500),
    acsBarcode: optionalChangeOrderText(500),
    remarks: optionalChangeOrderText(5_000),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const reorderChangeOrderItemsSchema = z
  .object({
    orderedItemIds: z
      .array(z.string().uuid())
      .min(1)
      .max(5_000)
      .refine((ids) => new Set(ids).size === ids.length, 'Item IDs must be unique'),
  })
  .strict();
