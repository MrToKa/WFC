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
  description: z.string().trim().max(2000).optional()
} as const;

export const createProjectSchema = z
  .object(projectFieldSchema)
  .strict();

export const updateProjectSchema = z
  .object({
    projectNumber: projectFieldSchema.projectNumber.optional(),
    name: projectFieldSchema.name.optional(),
    customer: projectFieldSchema.customer.optional(),
    description: projectFieldSchema.description.optional()
  })
  .strict()
  .refine(
    (value) =>
      value.projectNumber !== undefined ||
      value.name !== undefined ||
      value.customer !== undefined ||
      value.description !== undefined,
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
    tag: cableTypeStringField,
    purpose: cableTypeStringField,
    diameterMm: cableTypeNumericField,
    weightKgPerM: cableTypeNumericField,
    fromLocation: cableTypeStringField,
    toLocation: cableTypeStringField,
    routing: cableTypeStringField
  })
  .strict();

export const updateCableTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    tag: cableTypeStringField,
    purpose: cableTypeStringField,
    diameterMm: cableTypeNumericField,
    weightKgPerM: cableTypeNumericField,
    fromLocation: cableTypeStringField,
    toLocation: cableTypeStringField,
    routing: cableTypeStringField
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.tag !== undefined ||
      value.purpose !== undefined ||
      value.diameterMm !== undefined ||
      value.weightKgPerM !== undefined ||
      value.fromLocation !== undefined ||
      value.toLocation !== undefined ||
      value.routing !== undefined,
    { message: 'At least one field must be provided' }
  );
