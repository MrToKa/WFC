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
