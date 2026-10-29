import { z } from 'zod';

export const trayLengthSourceSchema = z.enum(['manual', 'auto']);

export const trayAutoLengthReferenceSchema = z.object({
  modelVersionId: z.string().uuid(),
  geometryRevision: z.string().min(1),
  aggregateId: z.string().uuid(),
  traceId: z.string().uuid(),
}).strict();

export const trayAutoLengthMeasurementSchema = trayAutoLengthReferenceSchema.extend({
  lengthMm: z.number().finite().min(0).max(1_000_000),
  elementCount: z.number().int().positive(),
}).strict();

export const trayLengthCalculationSchema = trayAutoLengthMeasurementSchema.extend({
  calculatedAt: z.string().datetime(),
}).strict();

export const trayAutoLengthResponseSchema = z.object({
  autoLength: trayAutoLengthMeasurementSchema,
}).strict();

export type TrayLengthSource = z.infer<typeof trayLengthSourceSchema>;
export type TrayAutoLengthReference = z.infer<typeof trayAutoLengthReferenceSchema>;
export type TrayAutoLengthMeasurement = z.infer<typeof trayAutoLengthMeasurementSchema>;
export type TrayLengthCalculation = z.infer<typeof trayLengthCalculationSchema>;
