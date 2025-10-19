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
    .optional()
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
    secondaryTrayLength: projectFieldSchema.secondaryTrayLength
  })
  .strict()
  .refine(
    (value) =>
      value.projectNumber !== undefined ||
      value.name !== undefined ||
      value.customer !== undefined ||
      value.manager !== undefined ||
      value.description !== undefined ||
      value.secondaryTrayLength !== undefined,
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
    cableId: z.string().trim().min(1).max(200),
    tag: z.string().trim().max(500).optional(),
    cableTypeId: z.string().trim().uuid(),
    fromLocation: cableStringField,
    toLocation: cableStringField,
    routing: cableStringField,
    installLength: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
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
    cableId: z.string().trim().min(1).max(200).optional(),
    tag: z.string().trim().max(500).optional(),
    cableTypeId: z.string().trim().uuid().optional(),
    fromLocation: cableStringField,
    toLocation: cableStringField,
    routing: cableStringField,
    installLength: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
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
      value.installLength !== undefined ||
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
    lengthMm: trayNumericField
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.type !== undefined ||
      value.purpose !== undefined ||
      value.widthMm !== undefined ||
      value.heightMm !== undefined ||
      value.lengthMm !== undefined,
    { message: 'At least one field must be provided' }
  );
