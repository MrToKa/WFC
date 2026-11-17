import { z } from 'zod';

// Branched CAD routes use multiple ordinary segments for their measured arms.
// Keep the composite bounded independently of the route/component counts.
export const MAX_CAD_OVERLAY_SEGMENTS = 256;

const point = z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const port = z.object({ pointMetres: point, outward: point, u: point, v: point,
  widthMetres: z.number().finite().positive(), heightMetres: z.number().finite().positive() }).strict();
export const cadOverlaySegmentSchema = z.object({
  id: z.string().regex(/^cad:[a-f0-9-]{36}$/), name: z.string().regex(/^\/[A-Z0-9][A-Z0-9_.-]{0,199}$/),
  allowedCategoryMask: z.number().int().min(1).max(7), pointsMetres: z.array(point).min(2).max(16385),
  ports: z.array(port).min(1).max(2),
  independent: z.literal(true).optional(),
}).strict();
export type CadOverlaySegment = z.infer<typeof cadOverlaySegmentSchema>;
export const cadOverlayPayloadSchema = z.object({ schemaVersion: z.enum(['wfc.pf.cad-overlay-payload.v1','wfc.pf.cad-overlay-payload.v2','wfc.pf.cad-overlay-payload.v3']),
  projectId: z.string().uuid(), modelVersionId: z.string().uuid(), baseSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
  segments: z.array(cadOverlaySegmentSchema).min(1).max(MAX_CAD_OVERLAY_SEGMENTS),
}).strict().superRefine((payload,ctx)=>{
  for(const [index,segment] of payload.segments.entries())if(segment.independent){
    if(payload.schemaVersion!=='wfc.pf.cad-overlay-payload.v2')ctx.addIssue({code:z.ZodIssueCode.custom,path:['schemaVersion'],message:'Independent CAD networks require the version 2 payload.'});
    if(segment.ports.length!==2)ctx.addIssue({code:z.ZodIssueCode.custom,path:['segments',index,'ports'],message:'An independent CAD chain requires its two verified physical endpoint ports.'});
  }
});
export const cadOverlayEnvelopeSchema = z.object({ schemaVersion: z.literal('wfc.pf.cad-overlay.v1'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), payloadBase64: z.string().min(1).max(512*1024).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export type CadOverlayEnvelope = z.infer<typeof cadOverlayEnvelopeSchema>;
