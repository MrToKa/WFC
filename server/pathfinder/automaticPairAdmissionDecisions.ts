import type { PoolClient } from 'pg';
import { z } from 'zod';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';

type AdmissionKey = { projectId: string; jobId: string; cableId: string };
const reasonCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/);

/** A retained refusal explains admission; it is never authority for a write. */
export async function readAutomaticPairAdmissionDecision(client: PoolClient, input: AdmissionKey) {
  const row = (await client.query<{ reason_code: string }>(`/* automatic-pair:admission-decision */ SELECT reason_code
    FROM pf_automatic_pair_admission_decisions WHERE project_id=$1 AND job_id=$2 AND cable_id=$3`,
  [input.projectId, input.jobId, input.cableId])).rows[0];
  return row ? { status: 'review-required' as const, reasonCode: reasonCodeSchema.parse(row.reason_code) } : null;
}

/** Caller owns the same admission transaction and cable lock as mandate creation.
 * Deliberately creates neither a mandate nor dispatch work. */
export async function appendAutomaticPairAdmissionDecision(client: PoolClient, input: AdmissionKey & { reasonCode: string }): Promise<void> {
  policyUuidSchema.parse(input.projectId); policyUuidSchema.parse(input.jobId); policyUuidSchema.parse(input.cableId);
  reasonCodeSchema.parse(input.reasonCode);
  await client.query(`INSERT INTO pf_automatic_pair_admission_decisions(project_id,job_id,cable_id,reason_code)
    VALUES($1,$2,$3,$4)`, [input.projectId, input.jobId, input.cableId, input.reasonCode]);
}
