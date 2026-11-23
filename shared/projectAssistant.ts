import { z } from 'zod';

export const assistantText = z.string().trim().max(12000);
export const assistantMaxJobFiles = 25;
const uuid = z.string().uuid();
export const assistantStart = z
  .object({
    id: uuid,
    instructions: assistantText,
    automaticAssignment: z.object({ replaceConflicting: z.boolean() }).strict().optional(),
    rulesRevision: z.number().int().nonnegative(),
    modelVersionId: uuid,
    previousJobId: uuid.optional(),
    followUpMode: z.enum(['results', 'documents']).optional(),
    files: z
      .array(
        z.object({
          id: uuid,
          versionId: uuid.nullable(),
          uploadedAt: z.string().datetime().optional(),
        }),
      )
      .max(assistantMaxJobFiles),
  })
  .strict()
  .refine((input) =>
    input.previousJobId
      ? (input.followUpMode !== 'results' || input.files.length === 0) && input.instructions.length > 0
      : input.files.length > 0 && input.followUpMode === undefined,
  );
export const findingSchema = z.object({
  tag: z.string().trim().min(1).max(500),
  target: z.string().trim().min(1).max(500),
  evidence: z.string().trim().min(1).max(2000),
  branch: z.string().max(500),
  property: z.string().max(500),
  review: z.boolean(),
  relationKind: z
    .enum(['self', 'signal-on-equipment', 'instrument-on-rack', 'uncertain'])
    .optional(),
});
export type Finding = z.infer<typeof findingSchema>;
export type AssistantFile = { id: string; versionId: string | null; name: string; key: string; taskDocument?: true };
export type AssistantProposal = {
  logicalTag?: string;
  existingModelObjectId?: number | null;
  staleHeadId?: string;
  replaceHeadId?: string;
  providerDecision?: { objectId: number | null; reason: string };
  localModel?: {
    dbId: number;
    modelName: string;
    rackName: string;
    rackDbId: number;
    point: [number, number, number];
    bounds: { minimum: [number, number, number]; maximum: [number, number, number] };
    visibilityScopeSha256: string;
    verifiedDocumentPair?: boolean;
    alternatives?: {
      objectId: number;
      modelName: string;
      hierarchy: string[];
      visible: boolean;
      intersectsRack: boolean;
      role: string;
    }[];
  };
  id: string;
  tag: string;
  target: string;
  evidence: string;
  file: string;
  sourceIndex: number;
  page: number;
  reason: string;
  locationId: string | null;
  revision: string | null;
  aliases: string[];
  candidates: string[];
  ref: { traceId: string; objectRevisionId: string; recordSha256: string } | null;
  point: number[] | null;
  dbId: number | null;
};
export type AssistantJob = {
  id: string;
  model_id: string;
  author: string;
  status: string;
  instructions: string;
  rules: string;
  created_at: string;
  error: string | null;
  proposals: AssistantProposal[];
  applied: Record<string, string>;
  progress: number;
  current_file?: string | null;
  automatic_assignment?: boolean;
  workflow_state?: null | 'pending' | 'running' | 'complete' | 'failed';
  workflow_summary?: null | {
    checked: number;
    assigned: number;
    replaced: number;
    preserved: number;
    review: number;
    failed: number;
  };
  previous_job_id?: string | null;
  follow_up_mode?: 'results' | 'documents';
  conversation_answer?: string | null;
  answers?: { file: string; page: number; text: string }[];
  total: number;
  tokens: number;
  estimated_usd: number;
};
export type WorkspaceState = {
  rules: string;
  revision: number;
  modelVersionId: string | null;
  jobs: AssistantJob[];
};
