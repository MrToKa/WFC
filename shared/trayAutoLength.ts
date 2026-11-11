import { z } from 'zod';

export const trayLengthSourceSchema = z.enum(['manual', 'auto']);

const publishedReferenceSchema = z
  .object({
    modelVersionId: z.string().uuid(),
    geometryRevision: z.string().min(1),
    aggregateId: z.string().uuid(),
    traceId: z.string().uuid(),
  })
  .strict();
const captureReferenceSchema = z
  .object({
    source: z.literal('tray-capture'),
    modelVersionId: z.string().uuid(),
    selectionRevision: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
    assignmentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    measurementId: z.string().uuid(),
  })
  .strict();
export const trayAutoLengthReferenceSchema = z.union([
  publishedReferenceSchema,
  captureReferenceSchema,
]);

const measuredFields = {
  lengthMm: z.number().finite().min(0).max(1_000_000),
  elementCount: z.number().int().positive(),
};
export const trayAutoLengthMeasurementSchema = z.union([
  publishedReferenceSchema.extend(measuredFields).strict(),
  captureReferenceSchema.extend(measuredFields).strict(),
]);

export const trayLengthCalculationSchema = z.union([
  publishedReferenceSchema
    .extend({ ...measuredFields, calculatedAt: z.string().datetime() })
    .strict(),
  captureReferenceSchema
    .extend({ ...measuredFields, calculatedAt: z.string().datetime() })
    .strict(),
  // Server-derived route measurements are display provenance only. Do not add
  // this shape to the request reference/measurement schemas: the existing
  // automatic-length service cannot authenticate a client-supplied CAD proof.
  z
    .object({
      source: z.literal('cad-route'),
      designId: z.string().uuid(),
      routeId: z.string().uuid(),
      routeRevision: z.number().int().positive().max(2147483647),
      centerlineSha256: z.string().regex(/^[a-f0-9]{64}$/),
      ...measuredFields,
      lengthMm: measuredFields.lengthMm.positive(),
      calculatedAt: z.string().datetime(),
    })
    .strict(),
]);

export const trayAutoLengthCaptureContextSchema = z
  .object({
    projectId: z.string().uuid(),
    trayId: z.string().uuid(),
    modelVersionId: z.string().uuid(),
    selectionRevision: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
    contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    rootObjectIds: z
      .array(z.number().int().positive().max(2147483647))
      .min(1)
      .max(512)
      .refine((ids) => new Set(ids).size === ids.length),
    assignmentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const trayAutoLengthResponseSchema = z
  .object({
    autoLength: trayAutoLengthMeasurementSchema,
  })
  .strict();

export type TrayLengthSource = z.infer<typeof trayLengthSourceSchema>;
export type TrayAutoLengthReference = z.infer<typeof trayAutoLengthReferenceSchema>;
export type TrayAutoLengthMeasurement = z.infer<typeof trayAutoLengthMeasurementSchema>;
export type TrayLengthCalculation = z.infer<typeof trayLengthCalculationSchema>;
export type TrayAutoLengthCaptureContext = z.infer<typeof trayAutoLengthCaptureContextSchema>;
