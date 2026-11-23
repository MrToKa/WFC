// An explicit OpenAI review sends only a short document citation and identifying
// facts for candidates. Geometry, credentials and document files stay on the WFC side.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { AssistantProposal } from '../../shared/projectAssistant.js';
import type { EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { pool } from '../db.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { endpointBindingHash } from '../pathfinder/endpointBindingRepository.js';
import { analyzeDocument } from './workerTransport.js';

type Decision = { objectId: number | null; reason: string };
type Candidate = {
  objectId: number;
  modelName: string;
  role: string;
  acceptable: boolean;
  reason: string;
  rackName?: string;
  rackDbId?: number;
};
type Item = {
  id: string;
  tag: string;
  target: string;
  evidence: string;
  page: number;
  candidates: Candidate[];
  existingObjectId?: number;
};
const usageSchema = z.object({
  tokens: z.number().int().nonnegative(),
  estimatedUsd: z.number().finite().nonnegative(),
});
const receipt = z.object({
  decisions: z.array(
    z.object({
      id: z.string(),
      objectId: z.number().int().positive().nullable(),
      reason: z.string().min(1).max(2000),
    }),
  ),
  usage: usageSchema,
  requestUsage: usageSchema,
});
const upper = (value: string) => value.normalize('NFC').trim().toUpperCase();

export async function requestModelDecisions(
  pid: string,
  jobId: string,
  scope: EndpointCurrentScope,
  proposals: AssistantProposal[],
  assertCurrentAuthority?: () => Promise<void>,
) {
  const decisions = new Map<string, Decision>();
  const requestUsage = { tokens: 0, estimatedUsd: 0 };
  const reviewResult = { decisions, requestUsage };
  const reviewable = proposals.filter((p) => p.localModel || (p.ref && p.dbId != null));
  if (!reviewable.length) return reviewResult;
  if (!process.env.WFC_ASSISTANT_URL) throw new PathFinderError('ASSISTANT_OFFLINE', 503);
  const [oldBindings, records] = await Promise.all([
    pool.query<{ tag: string; object_id: number; model_name: string }>(
      `SELECT a.normalized_alias AS tag,(r.record->'autoMatchEvidence'->>'sdkObjectId')::int AS object_id,
          r.record->'autoMatchEvidence'->>'objectName' AS model_name
       FROM pf_location_aliases a JOIN pf_endpoint_binding_heads h USING(project_id,location_id)
       JOIN pf_endpoint_binding_revisions r ON r.project_id=h.project_id AND r.location_id=h.location_id AND r.id=h.binding_id
       WHERE a.project_id=$1 AND a.normalized_alias=ANY($2::text[]) AND r.record->'autoMatchEvidence'->>'sdkObjectId' IS NOT NULL
         AND r.record->'autoMatchEvidence'->'current'=$3::jsonb`,
      [pid, reviewable.map((p) => upper(p.logicalTag ?? p.tag)), JSON.stringify(scope)],
    ),
    pool.query<{ id: string; name: string }>(
      `SELECT id,record->'historicalModel'->>'name' AS name FROM pf_geometry_object_revisions
      WHERE project_id=$1 AND trace_id=$2 AND id=ANY($3::uuid[])`,
      [pid, scope.traceId, reviewable.flatMap((p) => (p.ref ? [p.ref.objectRevisionId] : []))],
    ),
  ]);
  const existing = new Map(oldBindings.rows.map((row) => [row.tag, row]));
  const names = new Map(records.rows.map((row) => [row.id, row.name]));
  const ids = new Map<string, string>();
  const items: Item[] = [];
  for (const p of reviewable) {
    const tag = p.logicalTag ?? p.tag;
    const id = createHash('sha256').update(upper(tag)).digest('hex').slice(0, 32);
    const old = existing.get(upper(tag));
    const candidates: Candidate[] = [];
    const local = p.localModel;
    if (local) {
      candidates.push({
        objectId: local.dbId,
        modelName: local.modelName,
        role: 'instrument',
        acceptable: true,
        reason: local.verifiedDocumentPair
          ? 'Visible geometry intersects the named rack. The local check also found this instrument and rack on the cited original layout, directly or through its explicit repeated-unit note.'
          : 'Visible geometry intersects the named rack in the current project model.',
        rackName: local.rackName,
        rackDbId: local.rackDbId,
      });
      candidates.push({
        objectId: local.rackDbId,
        modelName: local.rackName,
        role: 'rack',
        acceptable: false,
        reason: 'Mounting rack for the instrument. The endpoint requires the mounted instrument.',
      });
      for (const other of local.alternatives ?? []) {
        if (candidates.some((candidate) => candidate.objectId === other.objectId)) continue;
        candidates.push({
          objectId: other.objectId,
          modelName: other.modelName,
          role: other.role,
          acceptable: false,
          reason: [
            other.visible ? 'Visible in the model.' : 'Visibility not confirmed.',
            other.intersectsRack
              ? 'Geometry intersects this rack.'
              : 'Geometry is outside this rack.',
            'This object did not meet the instrument matching criteria.',
          ].join(' '),
        });
      }
    } else if (p.ref && p.dbId != null && names.has(p.ref.objectRevisionId)) {
      candidates.push({
        objectId: p.dbId,
        modelName: names.get(p.ref.objectRevisionId)!,
        role: 'prepared-equipment',
        acceptable: true,
        reason:
          'Unique object in the active prepared index matching the documented target, with a validated endpoint anchor.',
      });
    }
    if (!candidates.length) continue;
    if (old && !candidates.some((c) => c.objectId === old.object_id)) {
      candidates.push({
        objectId: old.object_id,
        modelName: old.model_name,
        role: 'existing-binding',
        acceptable: false,
        reason:
          'Currently assigned object. The local search did not qualify it for this documented endpoint.',
      });
    }
    ids.set(id, p.id);
    items.push({
      id,
      tag,
      target: p.target,
      evidence: p.evidence,
      page: p.page,
      candidates,
      ...(old && { existingObjectId: old.object_id }),
    });
  }
  if (!items.length) return reviewResult;
  const secret = (await readFile('/run/secrets/assistant-token', 'utf8')).trim();
  const endpoint = new URL('/model-decisions', process.env.WFC_ASSISTANT_URL);
  const scopeHash = endpointBindingHash(scope);
  const envelope = (batch: Item[]) => ({ project: pid, job: jobId, scopeHash, items: batch });
  // Sort by stable tag identity so retries with unchanged evidence can replay cached batches.
  items.sort((a, b) => a.id.localeCompare(b.id));
  async function review(batch: Item[]) {
    await assertCurrentAuthority?.();
    const { status, result } = await analyzeDocument(endpoint, secret, envelope(batch));
    if (status !== 200) {
      const failure = z.object({ error: z.string().max(240) }).safeParse(result);
      throw new PathFinderError(
        'ASSISTANT_MODEL_REVIEW_UNAVAILABLE',
        status === 429 ? 429 : 422,
        failure.success ? failure.data.error : 'Model review unavailable',
      );
    }
    const { decisions: answers, usage, requestUsage: batchUsage } = receipt.parse(result);
    requestUsage.tokens += batchUsage.tokens;
    requestUsage.estimatedUsd += batchUsage.estimatedUsd;
    const returned = new Set(answers.map((a) => a.id));
    if (answers.length !== batch.length || returned.size !== batch.length)
      throw Error('Incomplete model decision receipt');
    for (const item of batch) {
      const answer = answers.find((a) => a.id === item.id);
      if (
        !answer ||
        (answer.objectId !== null &&
          !item.candidates.some((c) => c.acceptable && c.objectId === answer.objectId))
      ) {
        throw Error('Model decision does not match the qualified candidates');
      }
      decisions.set(ids.get(item.id)!, { objectId: answer.objectId, reason: answer.reason });
    }
    await pool.query(
      'UPDATE assistant_jobs SET tokens=GREATEST(tokens,$3),estimated_usd=GREATEST(estimated_usd,$4) WHERE project_id=$1 AND id=$2',
      [pid, jobId, usage.tokens, usage.estimatedUsd],
    );
  }
  let batch: Item[] = [];
  for (const item of items) {
    if (
      batch.length &&
      (batch.length >= 15 ||
        Buffer.byteLength(JSON.stringify(envelope([...batch, item]))) > 47 * 1024)
    ) {
      await review(batch);
      batch = [];
    }
    batch.push(item);
  }
  if (batch.length) await review(batch);
  return reviewResult;
}
