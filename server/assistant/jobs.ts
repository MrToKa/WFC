import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { buffer } from 'node:stream/consumers';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from '../db.js';
import { getObjectStream, getProjectBucket } from '../services/objectStorageService.js';
import {
  readCurrentEndpointBindingContext,
  endpointBindingTransaction,
  endpointBindingHash,
  objectEvidence,
} from '../pathfinder/endpointBindingRepository.js';
import { readPreparedNamedEndpointMatches } from '../pathfinder/automaticEndpointCandidates.js';
import { normalizeLocation } from '../pathfinder/matching.js';
import { transaction } from '../pathfinder/transactions.js';
import { analyzeDocument } from './workerTransport.js';
import {
  findingSchema,
  type AssistantFile,
  type AssistantProposal,
  type Finding,
} from '../../shared/projectAssistant.js';
import type { EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { documentsRackPair } from './rackCitation.js';
import { assistantLocalModelEvidence } from './localModelEvidence.js';
import { prepareLocalRackIndex } from './localRackIndex.js';
import { readNeededEndpointBindingHeads } from '../pathfinder/endpointBindingRepository.js';

export async function initializeAssistant() {
  await pool.query(`CREATE TABLE IF NOT EXISTS assistant_rules(project_id uuid PRIMARY KEY REFERENCES projects ON DELETE CASCADE,
    rules text NOT NULL, revision integer NOT NULL);
    CREATE TABLE IF NOT EXISTS assistant_jobs(id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
    author uuid NOT NULL REFERENCES users, created_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'queued',
    rules text NOT NULL, rules_revision integer NOT NULL, instructions text NOT NULL, scope jsonb NOT NULL, files jsonb NOT NULL,
    observations jsonb NOT NULL DEFAULT '[]', progress integer NOT NULL DEFAULT 0, tokens integer NOT NULL DEFAULT 0,
    proposals jsonb NOT NULL DEFAULT '[]', applied jsonb NOT NULL DEFAULT '{}', error text);
    ALTER TABLE assistant_jobs ADD COLUMN IF NOT EXISTS estimated_usd numeric NOT NULL DEFAULT 0;
    ALTER TABLE assistant_jobs ADD COLUMN IF NOT EXISTS previous_job_id uuid;
    ALTER TABLE assistant_jobs ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '[]';
    ALTER TABLE assistant_jobs ADD COLUMN IF NOT EXISTS follow_up_mode text NOT NULL DEFAULT 'documents';
    ALTER TABLE assistant_jobs ADD COLUMN IF NOT EXISTS conversation_answer text;
    ALTER TABLE assistant_jobs ADD COLUMN IF NOT EXISTS workflow_grant jsonb;
    ALTER TABLE assistant_jobs ADD COLUMN IF NOT EXISTS workflow_state text;
    ALTER TABLE assistant_jobs ADD COLUMN IF NOT EXISTS workflow_summary jsonb;
    ALTER TABLE assistant_jobs ADD COLUMN IF NOT EXISTS workflow_mutations jsonb NOT NULL DEFAULT '{}';
    CREATE INDEX IF NOT EXISTS assistant_jobs_project ON assistant_jobs(project_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS assistant_jobs_pending ON assistant_jobs(created_at) WHERE status IN ('queued','running');`);
}
const pagesSchema = z.object({
  pages: z
    .array(
      z.object({
        page: z.number().int().positive(),
        findings: z.array(findingSchema).max(3000),
        answer: z.string().trim().max(4000).optional(),
        estimatedUsd: z.number().finite().nonnegative(),
        usage: z.object({ totalTokens: z.number().int().nonnegative() }),
      }),
    )
    .min(1)
    .max(500),
  usage: z.object({
    tokens: z.number().int().nonnegative(),
    estimatedUsd: z.number().finite().nonnegative(),
  }),
});
export type Observation = Finding & { file: string; sourceIndex: number; page: number };

const meteredUsage = z.object({
  tokens: z.number().int().nonnegative(),
  estimatedUsd: z.number().finite().nonnegative(),
});

async function answerFromResults(
  c: PoolClient,
  project: string,
  job: string,
  previous: string,
  question: string,
) {
  const history = (
    await c.query<{
      instructions: string;
      conversation_answer: string | null;
      proposals: AssistantProposal[] | null;
      applied: Record<string, string>;
      source_count: number;
    }>(
      `WITH RECURSIVE history AS (
       SELECT id,previous_job_id,1 AS depth FROM assistant_jobs WHERE project_id=$1 AND id=$2
       UNION ALL
       SELECT j.id,j.previous_job_id,h.depth+1 FROM history h
       JOIN assistant_jobs j ON j.project_id=$1 AND j.id=h.previous_job_id
     ), analysis AS (
       SELECT h.id FROM history h JOIN assistant_jobs j ON j.id=h.id
       WHERE j.follow_up_mode='documents' ORDER BY h.depth LIMIT 1
     )
     SELECT j.instructions,j.conversation_answer,j.applied,jsonb_array_length(j.files) AS source_count,
       CASE WHEN j.id=(SELECT id FROM analysis) THEN j.proposals END AS proposals
     FROM history h JOIN assistant_jobs j ON j.id=h.id
     WHERE h.depth <= 3 OR j.id=(SELECT id FROM analysis) ORDER BY h.depth`,
      [project, previous],
    )
  ).rows;
  const analysis = history.find((row) => row.proposals !== null);
  const proposals = analysis?.proposals ?? [];
  const applied = analysis?.applied ?? {};
  const reasons = new Map<string, number>();
  const terms =
    question
      .toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}._-]{2,}/gu)
      ?.slice(0, 50) ?? [];
  const ranked = proposals
    .map((proposal) => {
      reasons.set(proposal.reason, (reasons.get(proposal.reason) ?? 0) + 1);
      const label = `${proposal.tag} ${proposal.target}`.toLowerCase();
      return { proposal, score: terms.filter((term) => label.includes(term)).length };
    })
    .sort((a, b) => b.score - a.score);
  const context = {
    recent: history
      .slice(0, 3)
      .reverse()
      .map((row) => ({
        request: row.instructions.slice(0, 400),
        reply: row.conversation_answer?.slice(0, 600),
      })),
    documents: analysis?.source_count,
    proposals: proposals.length,
    pendingConfirmation: proposals.filter(
      (p) => p.locationId && (p.ref || p.localModel) && !applied[p.id],
    ).length,
    applied: Object.keys(applied).length,
    preserved: proposals.filter((p) => p.reason === 'Existing assignment preserved').length,
    manualReview: proposals.filter(
      (p) =>
        !applied[p.id] &&
        p.reason !== 'Existing assignment preserved' &&
        (!p.locationId || (!p.ref && !p.localModel)),
    ).length,
    reasons: [...reasons]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([reason, count]) => [reason.slice(0, 120), count]),
    examples: ranked.slice(0, 10).map(({ proposal: p }) => ({
      tag: p.tag.slice(0, 80),
      target: p.target.slice(0, 80),
      reason: p.reason.slice(0, 120),
      file: p.file.slice(0, 120),
      page: p.page,
      applied: Boolean(applied[p.id]),
    })),
  };
  const secret = (await readFile('/run/secrets/assistant-token', 'utf8')).trim();
  const response = await analyzeDocument(
    new URL('/answer', process.env.WFC_ASSISTANT_URL),
    secret,
    {
      project,
      job,
      instructions: question,
      context,
    },
  );
  if (response.status === 429) return;
  if (response.status !== 200) {
    const failure = z
      .object({ error: z.string(), usage: meteredUsage.optional() })
      .safeParse(response.result);
    if (failure.data?.usage) {
      await c.query('UPDATE assistant_jobs SET tokens=$2,estimated_usd=$3 WHERE id=$1', [
        job,
        failure.data.usage.tokens,
        failure.data.usage.estimatedUsd,
      ]);
    }
    throw Error(
      failure.data?.error ?? `Unable to answer from saved results (HTTP ${response.status})`,
    );
  }
  const { answer, usage } = z
    .object({
      answer: z.string().trim().min(1).max(4000),
      usage: meteredUsage,
    })
    .parse(response.result);
  await c.query(
    "UPDATE assistant_jobs SET status='review',conversation_answer=$2,tokens=$3,estimated_usd=$4 WHERE id=$1",
    [job, answer, usage.tokens, usage.estimatedUsd],
  );
}
export async function resolveFindings(
  c: PoolClient,
  projectId: string,
  scope: EndpointCurrentScope,
  findings: Observation[],
  jobId?: string,
  replaceConflicting = false,
) {
  const current = await readCurrentEndpointBindingContext(c, projectId);
  if (!current || endpointBindingHash(current) !== endpointBindingHash(scope))
    throw Error('Model revision changed. Start a new analysis.');
  const refs = new Map<string, Awaited<ReturnType<typeof readPreparedNamedEndpointMatches>>>();
  const filters = new Map<string, { branch: string; property: string; names: Set<string> }>();
  for (const f of findings) {
    const key = JSON.stringify([f.branch, f.property]);
    const filter = filters.get(key) ?? {
      branch: f.branch,
      property: f.property,
      names: new Set<string>(),
    };
    filter.names.add(normalizeLocation(f.target));
    filters.set(key, filter);
  }
  for (const [key, filter] of filters) {
    refs.set(
      key,
      await readPreparedNamedEndpointMatches(c, {
        projectId,
        current,
        names: [...filter.names],
        filter,
      }),
    );
  }
  const proposals: AssistantProposal[] = [];
  const grouped = new Map<string, Observation[]>();
  for (const f of findings) {
    const key = normalizeLocation(f.tag);
    const group = grouped.get(key) ?? [];
    group.push(f);
    grouped.set(key, group);
  }
  for (const [tag, group] of grouped) {
    const f = group[0];
    const target = normalizeLocation(f.target);
    const proposal: AssistantProposal = {
      id: randomUUID(),
      logicalTag: f.tag,
      tag: f.tag,
      target: f.target,
      file: f.file,
      sourceIndex: f.sourceIndex,
      page: f.page,
      evidence: f.evidence,
      reason: 'Review document evidence',
      ref: null,
      point: null,
      dbId: null,
      locationId: null,
      aliases: [],
      revision: null,
      candidates: [],
    };
    proposals.push(proposal);
    if (
      group.some(
        (other) =>
          normalizeLocation(other.target) !== target ||
          other.relationKind !== f.relationKind ||
          other.branch !== f.branch ||
          other.property !== f.property,
      )
    )
      continue;
    const needsReview = group.some((item) => item.review || item.relationKind === 'uncertain');
    const explicitRackPair =
      tag !== target &&
      group.every(
        (item) =>
          (item.relationKind === 'instrument-on-rack' && !item.review) ||
          (!item.relationKind && documentsRackPair(item)),
      );
    const legacyPair = tag !== target && group.every((item) => item.relationKind === undefined);
    const possibleProof =
      jobId && (explicitRackPair || legacyPair) && !f.branch && !f.property
        ? await assistantLocalModelEvidence(c, projectId, current, tag, target, jobId)
        : null;
    const rackPair =
      explicitRackPair || (legacyPair && possibleProof?.verifiedDocumentPair === true);
    const local = rackPair ? possibleProof : null;
    const {
      rows: [location],
    } = await c.query(
      `SELECT l.id,l.name,l.revision::text,
      (SELECT binding_id FROM pf_endpoint_binding_heads WHERE project_id=l.project_id AND location_id=l.id) AS head_id,
      ARRAY(SELECT display_alias FROM pf_location_aliases WHERE project_id=l.project_id AND location_id=l.id AND display_alias<>l.name) AS aliases,
      EXISTS(SELECT 1 FROM pf_endpoint_binding_heads WHERE project_id=l.project_id AND location_id=l.id)
      OR EXISTS(SELECT 1 FROM pf_location_bindings WHERE project_id=l.project_id AND location_id=l.id) AS assigned
      FROM pf_locations l JOIN pf_location_aliases a ON a.project_id=l.project_id AND a.location_id=l.id
      WHERE l.project_id=$1 AND a.normalized_alias=$2`,
      [projectId, tag],
    );
    if (location?.assigned) {
      if (!location.head_id) {
        proposal.reason = 'Existing assignment preserved';
        continue;
      }
      const head = (
        await readNeededEndpointBindingHeads(c, {
          projectId,
          current,
          locationIds: [location.id],
          deadline: Number.MAX_SAFE_INTEGER,
        })
      ).get(location.id);
      if (!head || head.ready) {
        proposal.reason = 'Existing assignment preserved';
        if (local) {
          proposal.localModel = local;
          proposal.existingModelObjectId = head?.binding.autoMatchEvidence?.sdkObjectId ?? null;
        }
        const previousDbId = proposal.existingModelObjectId;
        if (
          replaceConflicting &&
          local &&
          head?.ready &&
          head.binding.status === 'confirmed' &&
          previousDbId != null &&
          previousDbId !== local.dbId
        ) {
          proposal.replaceHeadId = head.binding.id;
        } else {
          continue;
        }
      } else {
        proposal.staleHeadId = head.binding.id;
      }
    }
    if (!location) {
      const cables = await c.query(
        'SELECT 1 FROM cables WHERE project_id=$1 AND ($2=upper(trim(from_location)) OR $2=upper(trim(to_location))) LIMIT 1',
        [projectId, tag],
      );
      if (!cables.rowCount) {
        proposal.reason = 'Tag outside WFC endpoint inventory';
        continue;
      }
    }
    const match = refs.get(JSON.stringify([f.branch, f.property]))?.get(target);
    if (needsReview || rackPair) {
      proposal.candidates = match?.candidateIds ?? [];
      if (rackPair && !f.branch && !f.property) {
        if (local) {
          Object.assign(proposal, {
            localModel: local,
            dbId: local.dbId,
            point: local.point,
            reason: 'Unique visible instrument on documented rack',
            locationId: location?.id ?? randomUUID(),
            tag: location?.name ?? f.tag,
            aliases: location?.aliases ?? [],
            revision: location?.revision ?? null,
          });
        } else {
          proposal.reason = 'Documented rack; no unique verified visible instrument on that rack';
        }
      } else {
        proposal.reason =
          'Document evidence requires review; prepared model: ' + (match?.status ?? 'missing');
      }
      continue;
    }
    if (!match?.object || match.status !== 'automatic-ready') {
      proposal.reason = match?.status ?? 'missing';
      proposal.candidates = match?.candidateIds ?? [];
      continue;
    }
    const record = await objectEvidence(c, projectId, current, match.object);
    if (
      (f.branch &&
        !record.historicalModel.leafToRootNames.some(
          (n) => normalizeLocation(n) === normalizeLocation(f.branch),
        )) ||
      (f.property &&
        !record.historicalModel.properties.some(
          (p) =>
            normalizeLocation(p.name) === normalizeLocation(f.property) &&
            normalizeLocation(p.value) === target,
        ))
    ) {
      proposal.reason = 'Model properties or hierarchy differ from instructions';
      continue;
    }
    if (!record.geometry.equipmentAnchor) {
      proposal.reason = 'Missing equipment anchor';
      continue;
    }
    Object.assign(proposal, {
      ref: match.object,
      point: record.geometry.equipmentAnchor.pointMetres,
      dbId: record.identity.dbId,
      reason: 'Ready for review',
      locationId: location?.id ?? randomUUID(),
      tag: location?.name ?? f.tag,
      aliases: location?.aliases ?? [],
      revision: location?.revision ?? null,
    });
  }
  return proposals;
}

export function startAssistantJobs() {
  if (!process.env.WFC_ASSISTANT_URL) return;
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    let c: PoolClient | undefined;
    let jobId: string | undefined;
    let locked = false;
    try {
      c = await pool.connect();
      locked = (
        await c.query("SELECT pg_try_advisory_lock(hashtext('wfc.project-assistant.worker')) AS ok")
      ).rows[0].ok;
      if (!locked) return;
      const {
        rows: [job],
      } = await c.query(
        "SELECT * FROM assistant_jobs WHERE status IN ('queued','running') OR (status='review' AND workflow_state='running') ORDER BY created_at LIMIT 1",
      );
      if (!job) return;
      jobId = job.id;
      const allowed = await c.query(
        "SELECT 1 FROM users u WHERE id=$1 AND (is_admin OR (role='engineer' AND EXISTS(SELECT 1 FROM user_project_access WHERE project_id=$2 AND user_id=u.id)))",
        [job.author, job.project_id],
      );
      if (!allowed.rowCount) throw Error('Project permission revoked');
      const grant = job.workflow_grant
        ? z
            .object({
              loginId: z.string().uuid(),
              loginExpiresAt: z.number().int(),
              replaceConflicting: z.boolean(),
            })
            .parse(job.workflow_grant)
        : null;
      const who = grant
        ? { userId: job.author, loginId: grant.loginId, loginExpiresAt: grant.loginExpiresAt }
        : null;
      if (who)
        await endpointBindingTransaction(
          pool,
          job.project_id,
          who,
          async () => {},
          undefined,
          'persisted-grant',
        );
      if (job.status !== 'review')
        await c.query("UPDATE assistant_jobs SET status='running' WHERE id=$1", [job.id]);
      if (job.follow_up_mode === 'results') {
        await answerFromResults(c, job.project_id, job.id, job.previous_job_id, job.instructions);
        return;
      }
      const files = job.files as AssistantFile[];
      if (job.progress < files.length) {
        const f = files[job.progress];
        const data = await buffer(await getObjectStream(getProjectBucket(), f.key));
        const secret = (await readFile('/run/secrets/assistant-token', 'utf8')).trim();
        const previous = job.previous_job_id
          ? (
              await c.query<{
                instructions: string;
                proposals: AssistantProposal[];
                applied: Record<string, string>;
                files: AssistantFile[];
              }>(
                'SELECT instructions,proposals,applied,files FROM assistant_jobs WHERE project_id=$1 AND id=$2',
                [job.project_id, job.previous_job_id],
              )
            ).rows[0]
          : undefined;
        const previousFindings = previous?.proposals
          .filter((proposal) => previous.files[proposal.sourceIndex]?.key === f.key)
          .slice(0, 150)
          .map(({ id, page, tag, target, reason }) => ({
            page,
            tag: tag.slice(0, 160),
            target: target.slice(0, 160),
            reason: reason.slice(0, 160),
            applied: Boolean(previous.applied[id]),
          }));
        const earlierInstructions = previous
          ? (
              await c.query<{ instructions: string }>(
                `WITH RECURSIVE history AS (
                 SELECT instructions,previous_job_id,1 AS depth FROM assistant_jobs WHERE project_id=$1 AND id=$2
                 UNION ALL
                 SELECT j.instructions,j.previous_job_id,h.depth + 1
                 FROM history h JOIN assistant_jobs j ON j.project_id=$1 AND j.id=h.previous_job_id
                 WHERE h.depth < 6
               )
               SELECT instructions FROM history WHERE depth > 1 ORDER BY depth DESC`,
                [job.project_id, job.previous_job_id],
              )
            ).rows.map(({ instructions }) => instructions.slice(0, 2000))
          : undefined;
        const { status, result } = await analyzeDocument(
          new URL('/analyze', process.env.WFC_ASSISTANT_URL),
          secret,
          {
            project: job.project_id,
            job: job.id,
            key: f.key,
            ext: extname(f.name).toLowerCase(),
            name: f.name,
            data: data.toString('base64'),
            rules: job.rules,
            instructions: job.instructions,
            previousInstructions: previous?.instructions,
            previousResultSummary: previous && {
              proposals: previous.proposals.length,
              manualReview: previous.proposals.filter((proposal) => !proposal.ref).length,
              applied: Object.keys(previous.applied).length,
            },
            earlierInstructions,
            previousFindings,
          },
        );
        if (status === 429) return;
        if (status < 200 || status >= 300) {
          const failure = z
            .object({ error: z.string().optional(), usage: z.unknown() })
            .safeParse(result);
          const usage = z
            .object({
              tokens: z.number().int().nonnegative(),
              estimatedUsd: z.number().finite().nonnegative(),
              unconfirmed: z.number().int().nonnegative(),
            })
            .safeParse(failure.data?.usage);
          if (usage.success)
            await c.query(
              'UPDATE assistant_jobs SET tokens=GREATEST(tokens,$2),estimated_usd=GREATEST(estimated_usd,$3) WHERE id=$1',
              [job.id, usage.data.tokens, usage.data.estimatedUsd],
            );
          throw Error(
            (failure.data?.error || `Document analysis failed (HTTP ${status})`) +
              (usage.success && usage.data.unconfirmed
                ? ' · Unconfirmed provider requests: ' + usage.data.unconfirmed
                : ''),
          );
        }
        const { pages, usage } = pagesSchema.parse(result);
        const observations = pages.flatMap((page) =>
          page.findings.map((finding) => ({
            ...finding,
            file: f.name,
            sourceIndex: job.progress,
            page: page.page,
          })),
        );
        const answers = pages.flatMap(({ page, answer }) =>
          answer ? [{ file: f.name, page, text: answer }] : [],
        );
        await c.query(
          'UPDATE assistant_jobs SET observations=observations || $2::jsonb,progress=progress+1,tokens=$3,estimated_usd=$4,answers=answers || $5::jsonb WHERE id=$1',
          [
            job.id,
            JSON.stringify(observations),
            usage.tokens,
            usage.estimatedUsd,
            JSON.stringify(answers),
          ],
        );
      } else if (who && grant) {
        await c.query(
          "UPDATE assistant_jobs SET status='review',workflow_state='running' WHERE id=$1",
          [job.id],
        );
        const { runLocalAssignment } = await import('./assignmentWorkflow.js');
        const result = await runLocalAssignment(
          job.project_id,
          job.id,
          who,
          { autoApply: true, providerReview: true, replaceConflicting: grant.replaceConflicting },
          true,
        );
        const {
          rows: [row],
        } = await c.query('SELECT workflow_mutations FROM assistant_jobs WHERE id=$1', [job.id]);
        const writes = Object.values(row.workflow_mutations);
        const summary = {
          checked: result.checked,
          assigned: writes.length,
          replaced: writes.filter(Boolean).length,
          preserved: Math.max(0, result.preserved - Math.max(0, writes.length - result.assigned)),
          review: result.review,
          failed: result.failed,
        };
        await c.query(
          "UPDATE assistant_jobs SET workflow_state='complete',workflow_summary=$2,status='review' WHERE id=$1",
          [job.id, summary],
        );
      } else {
        await prepareLocalRackIndex(job.project_id, job.id);
        await transaction(pool, async (tx) => {
          const proposals = await resolveFindings(
            tx,
            job.project_id,
            job.scope,
            job.observations,
            job.id,
          );
          await tx.query("UPDATE assistant_jobs SET status='review',proposals=$2 WHERE id=$1", [
            job.id,
            JSON.stringify(proposals),
          ]);
        });
      }
    } catch (error) {
      if (c && jobId)
        await c.query(
          "UPDATE assistant_jobs SET status='failed',workflow_state=CASE WHEN workflow_grant IS NULL THEN NULL ELSE 'failed' END,error=$2 WHERE id=$1",
          [jobId, error instanceof Error ? error.message.slice(0, 400) : 'Assistant failed'],
        );
      else console.error('Assistant worker failed', error);
    } finally {
      try {
        if (c && locked)
          await c.query("SELECT pg_advisory_unlock(hashtext('wfc.project-assistant.worker'))");
      } finally {
        c?.release();
        busy = false;
      }
    }
  }
  setInterval(() => {
    void tick().catch((e) => console.error('Assistant job persistence failed', e));
  }, 2500).unref();
}
