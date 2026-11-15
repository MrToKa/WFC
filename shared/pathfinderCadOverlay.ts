import { z } from 'zod';

const point = z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const port = z.object({ pointMetres: point, outward: point, u: point, v: point,
  widthMetres: z.number().finite().positive(), heightMetres: z.number().finite().positive() }).strict();
export const cadOverlaySegmentSchema = z.object({
  id: z.string().regex(/^cad:[a-f0-9-]{36}$/), name: z.string().regex(/^\/[A-Z0-9][A-Z0-9_.-]{0,199}$/),
  allowedCategoryMask: z.number().int().min(1).max(7), pointsMetres: z.array(point).min(2).max(16385),
  ports: z.array(port).min(1).max(2),
}).strict();
export type CadOverlaySegment = z.infer<typeof cadOverlaySegmentSchema>;
export const cadOverlayPayloadSchema = z.object({ schemaVersion: z.literal('wfc.pf.cad-overlay-payload.v1'),
  projectId: z.string().uuid(), modelVersionId: z.string().uuid(), baseSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
  segments: z.array(cadOverlaySegmentSchema).min(1).max(32),
}).strict();
export const cadOverlayEnvelopeSchema = z.object({ schemaVersion: z.literal('wfc.pf.cad-overlay.v1'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), payloadBase64: z.string().min(1).max(512*1024).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export type CadOverlayEnvelope = z.infer<typeof cadOverlayEnvelopeSchema>;
