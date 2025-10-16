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
