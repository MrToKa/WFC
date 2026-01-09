import { z } from 'zod';

export const registerSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(8),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional()
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(1)
  })
  .strict();

export const updateProfileSchema = z
  .object({
    email: z.string().trim().email().optional(),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    password: z.string().min(8).optional()
  })
  .partial()
  .refine(
    (value) =>
      value.email !== undefined ||
      value.firstName !== undefined ||
      value.lastName !== undefined ||
      value.password !== undefined,
    {
      message: 'At least one field must be provided'
    }
  );

export const adminUpdateUserSchema = updateProfileSchema;

const traySupportOverrideSchema = z
  .object({
    distance: z
      .number()
      .min(0)
      .max(1_000_000)
      .nullable()
      .optional(),
    supportId: z
      .string()
      .trim()
      .uuid()
      .nullable()
      .optional()
  })
  .strict()
  .refine(
    (value) =>
      value.distance !== undefined || value.supportId !== undefined,
    {
      message: 'Support override must include distance or support ID'
    }
  );

const supportOverrideValueSchema = z.union([
  z
    .number()
    .min(0)
    .max(1_000_000)
    .nullable(),
  traySupportOverrideSchema
]);

const trayPurposeTemplateValueSchema = z.union([
  z.string().trim().uuid(),
  z
    .object({
      fileId: z.string().trim().uuid()
    })
    .strict(),
  z.null()
]);

const cableBundleSpacingSchema = z.enum(['0', '1D', '2D']);

const cableCategorySettingsSchema = z
  .object({
    maxRows: z
      .number()
      .int()
      .min(1)
      .max(1_000)
      .nullable()
      .optional(),
    maxColumns: z
      .number()
      .int()
      .min(1)
      .max(1_000)
      .nullable()
      .optional(),
    bundleSpacing: cableBundleSpacingSchema.nullable().optional(),
    trefoil: z.boolean().nullable().optional(),
    trefoilSpacingBetweenBundles: z.boolean().nullable().optional(),
    applyPhaseRotation: z.boolean().nullable().optional()
  })
  .strict();

const customBundleRangeSchema = z
  .object({
    id: z.string().min(1),
    min: z.number().min(0).max(1000),
    max: z.number().min(0).max(1000)
  })
  .strict()
  .refine((data) => data.max > data.min, {
    message: 'max must be greater than min'
  });

const customBundleRangesSchema = z
  .object({
    mv: z.array(customBundleRangeSchema).optional(),
    power: z.array(customBundleRangeSchema).optional(),
    vfd: z.array(customBundleRangeSchema).optional(),
    control: z.array(customBundleRangeSchema).optional()
  })
  .strict()
  .nullable();

const cableLayoutSchema = z
  .object({
    cableSpacing: z
      .number()
      .min(1)
      .max(5)
      .nullable()
      .optional(),
    considerBundleSpacingAsFree: z.boolean().nullable().optional(),
    minFreeSpacePercent: z
      .number()
      .int()
      .min(1)
      .max(100)
      .nullable()
      .optional(),
    maxFreeSpacePercent: z
      .number()
      .int()
      .min(1)
      .max(100)
      .nullable()
      .optional(),
    mv: cableCategorySettingsSchema.optional(),
    power: cableCategorySettingsSchema.optional(),
    vfd: cableCategorySettingsSchema.optional(),
    control: cableCategorySettingsSchema.optional(),
    customBundleRanges: customBundleRangesSchema.optional()
  })
  .strict()
  .nullable();

const projectFieldSchema = {
  projectNumber: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  customer: z.string().trim().min(1).max(200),
  manager: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  secondaryTrayLength: z
    .number()
    .min(0)
    .max(1_000_000)
    .nullable()
    .optional(),
  supportDistance: z
    .number()
    .min(0)
    .max(1_000_000)
    .nullable()
    .optional(),
  supportWeight: z
    .number()
    .min(0)
    .max(1_000_000)
    .nullable()
    .optional(),
  trayLoadSafetyFactor: z
    .number()
    .min(0)
    .max(1_000_000)
    .nullable()
    .optional(),
    supportDistances: z
      .record(
        z.string().trim().min(1).max(200),
        supportOverrideValueSchema
      )
      .optional(),
    trayPurposeTemplates: z
      .record(
        z.string().trim().min(1).max(200),
        trayPurposeTemplateValueSchema
      )
      .optional(),
    cableLayout: cableLayoutSchema.optional()
  } as const;

export const createProjectSchema = z
  .object(projectFieldSchema)
  .strict();

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
    cableLayout: projectFieldSchema.cableLayout
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
      message: 'At least one field must be provided'
    }
  );

const cableTypeNumericField = z
  .number()
  .min(0)
  .max(1_000_000)
  .nullable()
  .optional();

const cableTypeStringField = z
  .string()
  .trim()
  .max(500)
  .optional();

export const createCableTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    purpose: cableTypeStringField,
    diameterMm: cableTypeNumericField,
    weightKgPerM: cableTypeNumericField
  })
  .strict();

export const updateCableTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    purpose: cableTypeStringField,
    diameterMm: cableTypeNumericField,
    weightKgPerM: cableTypeNumericField
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.purpose !== undefined ||
      value.diameterMm !== undefined ||
      value.weightKgPerM !== undefined,
    { message: 'At least one field must be provided' }
  );

const cableStringField = z
  .string()
  .trim()
  .max(500)
  .optional();

export const createCableSchema = z
  .object({
    cableId: z.number().int().min(0).max(2_147_483_647),
    tag: z.string().trim().max(500).optional(),
    cableTypeId: z.string().trim().uuid(),
    fromLocation: cableStringField,
    toLocation: cableStringField,
    routing: cableStringField,
    designLength: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .nullable()
      .optional(),
    installLength: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .nullable()
      .optional(),
    pullDate: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date'
      })
      .nullable()
      .optional(),
    connectedFrom: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date'
      })
      .nullable()
      .optional(),
    connectedTo: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date'
      })
      .nullable()
      .optional(),
    tested: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date'
      })
      .nullable()
      .optional()
  })
  .strict();

export const updateCableSchema = z
  .object({
    cableId: z.number().int().min(0).max(2_147_483_647).optional(),
    tag: z.string().trim().max(500).optional(),
    cableTypeId: z.string().trim().uuid().optional(),
    fromLocation: cableStringField,
    toLocation: cableStringField,
    routing: cableStringField,
    designLength: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .nullable()
      .optional(),
    installLength: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .nullable()
      .optional(),
    pullDate: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date'
      })
      .nullable()
      .optional(),
    connectedFrom: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date'
      })
      .nullable()
      .optional(),
    connectedTo: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date'
      })
      .nullable()
      .optional(),
    tested: z
      .string()
      .trim()
      .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
        message: 'Invalid date'
      })
      .nullable()
      .optional()
  })
  .strict()
  .refine(
    (value) =>
      value.cableId !== undefined ||
      value.tag !== undefined ||
      value.cableTypeId !== undefined ||
      value.fromLocation !== undefined ||
      value.toLocation !== undefined ||
      value.routing !== undefined ||
      value.designLength !== undefined ||
      value.installLength !== undefined ||
      value.pullDate !== undefined ||
      value.connectedFrom !== undefined ||
      value.connectedTo !== undefined ||
      value.tested !== undefined,
    { message: 'At least one field must be provided' }
  );

const trayStringField = z
  .string()
  .trim()
  .max(500)
  .optional();

const trayNumericField = z
  .number()
  .min(0)
  .max(1_000_000)
  .nullable()
  .optional();

export const createTraySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: trayStringField,
    purpose: trayStringField,
    widthMm: trayNumericField,
    heightMm: trayNumericField,
    lengthMm: trayNumericField
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
    groundingCableTypeId: z
      .union([z.string().trim().uuid(), z.null()])
      .optional()
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
    { message: 'At least one field must be provided' }
  );

const materialNumericField = z
  .number()
  .min(0)
  .max(1_000_000)
  .nullable()
  .optional();

const materialManufacturerField = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .nullable()
  .optional();

const materialImageTemplateField = z
  .union([z.string().trim().uuid(), z.null()])
  .optional();

export const createMaterialTraySchema = z
  .object({
    type: z.string().trim().min(1).max(200),
    manufacturer: materialManufacturerField,
    heightMm: materialNumericField,
    rungHeightMm: materialNumericField,
    widthMm: materialNumericField,
    weightKgPerM: materialNumericField,
    imageTemplateId: materialImageTemplateField
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
    imageTemplateId: materialImageTemplateField
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
    loadCurveId: z.string().uuid().optional().nullable(),
    imageTemplateId: materialImageTemplateField
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
      value.loadCurveId !== undefined ||
      value.imageTemplateId !== undefined,
    { message: 'At least one field must be provided' }
  );

export const updateMaterialSupportSchema = z
  .object({
    type: z.string().trim().min(1).max(200).optional(),
    manufacturer: materialManufacturerField,
    heightMm: materialNumericField,
    widthMm: materialNumericField,
    lengthMm: materialNumericField,
    weightKg: materialNumericField,
    imageTemplateId: materialImageTemplateField
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
      value.imageTemplateId !== undefined,
    { message: 'At least one field must be provided' }
  );

const loadCurvePointNumericField = z
  .number({ invalid_type_error: 'Enter a non-negative number' })
  .refine((value) => Number.isFinite(value) && value >= 0, {
    message: 'Enter a non-negative finite number'
  });

export const loadCurvePointSchema = z
  .object({
    spanM: loadCurvePointNumericField,
    loadKnPerM: loadCurvePointNumericField
  })
  .strict();

export const createMaterialLoadCurveSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional().nullable(),
    trayId: z.string().uuid().optional().nullable(),
    points: z.array(loadCurvePointSchema).max(2000).optional()
  })
  .strict();

export const updateMaterialLoadCurveSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    trayId: z.string().uuid().optional().nullable(),
    points: z.array(loadCurvePointSchema).max(2000).optional()
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.trayId !== undefined ||
      value.points !== undefined,
    { message: 'At least one field must be provided' }
  );
