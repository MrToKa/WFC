import { pool } from '../db.js';
import { transaction } from '../pathfinder/transactions.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { assertLoginNotExpired } from '../pathfinder/auth.js';
import {
  endpointBindingTransaction,
  confirmMatchedEndpointInTransaction,
  readNeededEndpointBindingHeads,
  endpointBindingHash,
  confirmEndpointBindingChangeInTransaction,
  readCurrentEndpointBindingContext,
} from '../pathfinder/endpointBindingRepository.js';
import { appendLocationImpactInTransaction } from '../pathfinder/locationImpactRepository.js';
import { ENDPOINT_ANCHOR_RULE } from '../../shared/pathfinderEndpointBindings.js';
import {
  backgroundRecalculationPreferencesSchema,
  recalculationTimeoutSchema,
} from '../../shared/pathfinderRecalculation.js';
import type { AssistantProposal } from '../../shared/projectAssistant.js';

import { resolveFindings, type Observation } from './jobs.js';
import { assistantLocalModelEvidence } from './localModelEvidence.js';
import { prepareLocalRackIndex } from './localRackIndex.js';
import { requestModelDecisions } from './providerModelReview.js';
import { normalizeLocation } from '../pathfinder/matching.js';
import type { JobPrincipal } from '../pathfinder/jobContracts.js';

const conflict = (message: string): never => {
  throw new PathFinderError('ASSISTANT_CONFLICT', 409, message);
};

function providerApproved(p: AssistantProposal) {
  return (
    !p.providerDecision ||
    (p.providerDecision.objectId != null && p.providerDecision.objectId === p.dbId)
  );
}
export async function applySavedProposal(
  pid: string,
  jobId: string,
  id: string,
  who: JobPrincipal,
  automatic: boolean,
  replaceConflicting = false,
  background = false,
) {
  return endpointBindingTransaction(
    pool,
    pid,
    who,
    async (c) => {
      const job = (
        await c.query(
          'SELECT scope,proposals,applied,status,workflow_grant IS NOT NULL AS automatic,workflow_state,rules_revision,COALESCE((SELECT revision FROM assistant_rules WHERE project_id=$2),0) AS active_rules_revision FROM assistant_jobs WHERE id=$1 AND project_id=$2 FOR UPDATE',
          [jobId, pid],
        )
      ).rows[0];
      if (!job || job.status !== 'review') return conflict('Review unavailable');
      if (job.applied[id]) return { impact: job.applied[id], duplicate: true, replaced: false };
      if (job.rules_revision !== job.active_rules_revision)
        return conflict('Project rules changed since this document analysis');
      const p = (job.proposals as AssistantProposal[]).find((p) => p.id === id);
      if (!p?.locationId || (!p.ref && !p.localModel))
        return conflict('A unique qualified object is required');
      if (
        job.automatic &&
        ((!background && job.workflow_state === 'running') || !p.providerDecision)
      )
        return conflict('This task requires the automatic verification workflow');
      if (!providerApproved(p))
        return conflict('The provider has not selected the locally verified object');
      if (
        p.replaceHeadId &&
        (!replaceConflicting || !automatic || !p.localModel || p.existingModelObjectId == null)
      )
        return conflict('Explicit replacement authority and verified model evidence are required');
      const current = await readCurrentEndpointBindingContext(c, pid);
      if (!current || endpointBindingHash(current) !== endpointBindingHash(job.scope))
        return conflict('The model changed. Run the analysis again.');
      const registry = (
        await c.query(
          'SELECT registry_revision::text AS revision FROM pf_project_state WHERE project_id=$1 FOR UPDATE',
          [pid],
        )
      ).rows[0];
      if (!registry) return conflict('Project registry unavailable');
      if (
        !p.staleHeadId &&
        !p.replaceHeadId &&
        (
          await c.query(
            'SELECT 1 FROM pf_location_bindings WHERE project_id=$1 AND location_id=$2',
            [pid, p.locationId],
          )
        ).rowCount
      )
        return conflict('Location was already assigned');
      if (p.staleHeadId) {
        const head = (
          await readNeededEndpointBindingHeads(c, {
            projectId: pid,
            current,
            locationIds: [p.locationId],
            deadline: Number.MAX_SAFE_INTEGER,
          })
        ).get(p.locationId);
        if (!head || head.ready || head.binding.id !== p.staleHeadId)
          return conflict('Assignment changed since the local check');
      }
      if (p.replaceHeadId) {
        const head = (
          await readNeededEndpointBindingHeads(c, {
            projectId: pid,
            current,
            locationIds: [p.locationId],
            deadline: Number.MAX_SAFE_INTEGER,
          })
        ).get(p.locationId);
        if (
          !head?.ready ||
          head.binding.id !== p.replaceHeadId ||
          head.binding.autoMatchEvidence?.sdkObjectId !== p.existingModelObjectId ||
          p.existingModelObjectId === p.localModel?.dbId
        )
          return conflict('Confirmed model object changed since the local check');
      }
      const cables = await c.query(
        'SELECT id FROM cables WHERE project_id=$1 AND (upper(trim(from_location))=ANY($2) OR upper(trim(to_location))=ANY($2)) FOR SHARE',
        [pid, [p.tag, ...p.aliases].map((n) => n.trim().toUpperCase())],
      );
      if (!cables.rows.length) return conflict('Location is no longer a cable endpoint');
      const reason = p.replaceHeadId
        ? `Verified instrument on documented rack: replaced model object ${p.existingModelObjectId} with ${p.localModel!.dbId} - ${jobId}`
        : (automatic
            ? 'Automatic assignment after local verification · '
            : 'Engineer accepted document evidence · ') + jobId;
      const base = {
        locationId: p.locationId,
        location: { name: p.tag, aliases: p.aliases },
        expectedRegistryRevision: registry.revision,
        expectedLocationRevision: p.revision,
        expectedHeadId: p.replaceHeadId ?? p.staleHeadId ?? null,
        reason,
      };
      const commandSha256 = endpointBindingHash({
        projectId: pid,
        jobId,
        proposal: p,
        scope: current,
      });
      let binding;
      if (p.localModel) {
        const proof = await assistantLocalModelEvidence(
          c,
          pid,
          current,
          p.logicalTag ?? p.tag,
          p.target,
          jobId,
        );
        if (!proof || endpointBindingHash(proof) !== endpointBindingHash(p.localModel))
          return conflict('Local instrument or rack evidence changed');
        binding = await confirmMatchedEndpointInTransaction(c, pid, who, {
          ...base,
          current,
          replaceVerifiedRackBinding: p.replaceHeadId
            ? { expectedObjectId: p.existingModelObjectId! }
            : undefined,
          evidence: {
            schemaVersion: 'wfc.pf.model-location-match-evidence.v1',
            operationId: id,
            commandSha256,
            scanSha256: endpointBindingHash(proof),
            namesSha256: endpointBindingHash([p.tag, p.target]),
            current,
            logicalKey: normalizeLocation(p.tag),
            sdkObjectId: proof.dbId,
            objectName: proof.modelName,
            bounds: proof.bounds,
            bottomCentre: proof.point,
            visibilityScopeSha256: proof.visibilityScopeSha256,
            matchingPolicyVersion: 'wfc.assistant.visible-instrument-on-rack.v1',
            approximate: true,
            engineeringAccepted: false,
          },
        });
      } else {
        binding = await confirmEndpointBindingChangeInTransaction(c, pid, who, p.locationId, {
          schemaVersion: 'wfc.pf.endpoint-binding-write.v1',
          expectedRegistryRevision: base.expectedRegistryRevision,
          expectedLocationRevision: base.expectedLocationRevision,
          expectedHeadId: base.expectedHeadId,
          expectedSelectionRevision: current.selectionRevision,
          modelVersionId: current.modelVersionId,
          aggregateId: current.aggregateId,
          projectionSha256: current.projectionSha256,
          captureFrameId: current.captureFrameId,
          idempotencyKey: id,
          reason,
          location: base.location,
          mode: 'object-derived',
          anchorRule: ENDPOINT_ANCHOR_RULE,
          object: p.ref,
        });
      }

      const options = (
        await c.query(
          "SELECT options FROM pf_jobs WHERE project_id=$1 AND state='complete' AND options->'barrierRouting' IS NOT NULL ORDER BY created_at DESC LIMIT 1",
          [pid],
        )
      ).rows[0]?.options;
      const pref =
        options &&
        backgroundRecalculationPreferencesSchema.safeParse({
          secondaryDistanceMeters: options.secondaryDistanceMeters,
          preferVerticalApproach: options.preferVerticalApproach,
          barrierRouting: options.barrierRouting,
        });
      const impact = await appendLocationImpactInTransaction(
        c,
        {
          projectId: pid,
          principal: who,
          idempotencyKey: id,
          commandSha256,
          binding,
          current,
          affectedCableIds: cables.rows.map((r) => r.id),
          calculation: pref?.success
            ? { preferences: pref.data, timeoutMilliseconds: recalculationTimeoutSchema.maxValue! }
            : null,
        },
        () => assertLoginNotExpired(who),
      );
      await c.query('UPDATE assistant_jobs SET applied=applied || $2::jsonb WHERE id=$1', [
        jobId,
        JSON.stringify({ [id]: impact.id }),
      ]);
      if (background)
        await c.query(
          'UPDATE assistant_jobs SET workflow_mutations=workflow_mutations || $2::jsonb WHERE id=$1',
          [
            jobId,
            JSON.stringify({ [normalizeLocation(p.logicalTag ?? p.tag)]: !!p.replaceHeadId }),
          ],
        );
      return { impact: impact.id, duplicate: false, replaced: !!p.replaceHeadId };
    },
    undefined,
    background ? 'persisted-grant' : 'request',
  );
}

export async function runLocalAssignment(
  pid: string,
  jobId: string,
  who: JobPrincipal,
  input: { autoApply: boolean; providerReview: boolean; replaceConflicting: boolean; tag?: string },
  background = false,
) {
  const preflight = await pool.query(
    `SELECT j.scope->>'modelVersionId' AS prior_model,s.active_model_version_id AS active_model,j.workflow_grant IS NOT NULL AS automatic,j.workflow_state
      FROM assistant_jobs j JOIN project_model_selections s ON s.project_id=j.project_id
      WHERE j.project_id=$1 AND j.id=$2 AND j.status='review' AND j.follow_up_mode='documents'`,
    [pid, jobId],
  );
  if (!preflight.rows[0]?.active_model)
    return conflict('Choose a completed document analysis and an active model');
  if (
    background &&
    (!preflight.rows[0].automatic || preflight.rows[0].workflow_state !== 'running')
  )
    return conflict('The automatic assignment is no longer running');
  if (!background && preflight.rows[0].automatic && preflight.rows[0].workflow_state === 'running')
    return conflict('The automatic assignment is already running');
  if (preflight.rows[0].automatic && input.autoApply && !input.providerReview)
    return conflict('This task requires a provider decision before assignment');
  if (input.tag && preflight.rows[0].prior_model !== preflight.rows[0].active_model)
    return conflict('Recheck the full job against the new model revision first');
  await prepareLocalRackIndex(pid, jobId);
  const { proposals, currentScope } = await transaction(pool, async (c) => {
    const job = (
      await c.query(
        `SELECT j.status,j.scope,j.observations,j.proposals,j.applied,j.follow_up_mode,j.rules_revision,
       COALESCE(r.revision,0) AS active_rules_revision FROM assistant_jobs j
       LEFT JOIN assistant_rules r ON r.project_id=j.project_id
       WHERE j.project_id=$1 AND j.id=$2 FOR UPDATE OF j`,
        [pid, jobId],
      )
    ).rows[0];
    if (!job || job.status !== 'review' || job.follow_up_mode !== 'documents')
      return conflict('Choose a completed document analysis');
    if (job.rules_revision !== job.active_rules_revision)
      return conflict('Project rules changed since this document analysis');
    const current = await readCurrentEndpointBindingContext(c, pid);
    if (!current?.traceId)
      return conflict('Prepare the current project model before checking locations');
    const sameScope = endpointBindingHash(current) === endpointBindingHash(job.scope);
    if (!sameScope && input.tag)
      return conflict('Recheck the full job against the new model revision first');
    const key = input.tag ? normalizeLocation(input.tag) : null;
    const findings = (job.observations as Observation[]).filter(
      (f) => !key || normalizeLocation(f.tag) === key,
    );
    if (key && !findings.length) return conflict('The tag is absent from this job');
    const checked = await resolveFindings(
      c,
      pid,
      current,
      findings,
      jobId,
      input.replaceConflicting,
    );
    const prev = job.proposals as AssistantProposal[];
    const priorByKey = new Map(prev.map((p) => [normalizeLocation(p.logicalTag ?? p.tag), p]));
    for (const p of checked) {
      const prior = priorByKey.get(normalizeLocation(p.logicalTag ?? p.tag));
      // A pending decision fences individual /apply calls while metadata is reviewed.
      const pending = {
        objectId: null,
        reason: 'Awaiting a decision for this local model candidate',
      };
      if (input.providerReview || prior?.providerDecision) {
        const objectId = p.localModel?.dbId ?? p.dbId;
        const sameProof =
          prior &&
          sameScope &&
          prior.target === p.target &&
          prior.evidence === p.evidence &&
          prior.file === p.file &&
          prior.sourceIndex === p.sourceIndex &&
          prior.page === p.page &&
          (prior.localModel?.dbId ?? prior.dbId) === objectId &&
          prior.existingModelObjectId === p.existingModelObjectId &&
          endpointBindingHash(prior.localModel ?? prior.ref) ===
            endpointBindingHash(p.localModel ?? p.ref);
        const previous = sameProof ? prior.providerDecision : undefined;
        p.providerDecision =
          previous &&
          (!input.providerReview || (objectId != null && previous.objectId === objectId))
            ? previous
            : pending;
      }
      if (!prior) continue;
      if (sameScope && p.reason === 'Existing assignment preserved' && job.applied[prior.id]) {
        // Keep the immutable receipt associated with the original assignment.
        p.id = prior.id;
      } else if (
        !input.providerReview &&
        sameScope &&
        !job.applied[prior.id] &&
        prior.revision === p.revision &&
        prior.staleHeadId === p.staleHeadId &&
        prior.replaceHeadId === p.replaceHeadId &&
        prior.tag === p.tag &&
        prior.target === p.target &&
        prior.reason === p.reason &&
        endpointBindingHash(prior.localModel ?? prior.ref) ===
          endpointBindingHash(p.localModel ?? p.ref) &&
        (prior.locationId === p.locationId ||
          (p.revision === null && prior.locationId && p.locationId))
      ) {
        p.id = prior.id;
        p.locationId = prior.locationId;
      }
    }
    const next = key
      ? prev.filter((p) => normalizeLocation(p.logicalTag ?? p.tag) !== key).concat(checked)
      : checked;
    await c.query('UPDATE assistant_jobs SET scope=$3,proposals=$4 WHERE project_id=$1 AND id=$2', [
      pid,
      jobId,
      current,
      JSON.stringify(next),
    ]);
    return { proposals: checked, currentScope: current };
  });
  let requestUsage = { tokens: 0, estimatedUsd: 0 };
  const pendingProviderChecks = input.providerReview
    ? proposals.filter((p) => p.providerDecision?.objectId == null)
    : [];
  if (pendingProviderChecks.length) {
    const original = new Map(pendingProviderChecks.map((p) => [p.id, endpointBindingHash(p)]));
    const assertCurrentAuthority = () =>
      endpointBindingTransaction(
        pool,
        pid,
        who,
        async () => {},
        undefined,
        background ? 'persisted-grant' : 'request',
      );
    await assertCurrentAuthority();
    const reviewResult = await requestModelDecisions(
      pid,
      jobId,
      currentScope,
      pendingProviderChecks,
      assertCurrentAuthority,
    );
    const { decisions } = reviewResult;
    requestUsage = reviewResult.requestUsage;
    await endpointBindingTransaction(
      pool,
      pid,
      who,
      async (c) => {
        const job = (
          await c.query(
            'SELECT scope,proposals,status,rules_revision,COALESCE((SELECT revision FROM assistant_rules WHERE project_id=$2),0) AS active_rules_revision FROM assistant_jobs WHERE id=$1 AND project_id=$2 FOR UPDATE',
            [jobId, pid],
          )
        ).rows[0];
        const active = await readCurrentEndpointBindingContext(c, pid);
        if (
          !job ||
          job.status !== 'review' ||
          !active ||
          endpointBindingHash(active) !== endpointBindingHash(currentScope) ||
          endpointBindingHash(job.scope) !== endpointBindingHash(currentScope)
        )
          return conflict('The active model changed during provider review');
        if (job.rules_revision !== job.active_rules_revision)
          return conflict('Project rules changed during provider review');
        const stored = job.proposals as AssistantProposal[];
        const byId = new Map(stored.map((p) => [p.id, p]));
        for (const p of pendingProviderChecks) {
          const row = byId.get(p.id);
          if (!row || endpointBindingHash(row) !== original.get(p.id))
            return conflict('Proposals changed during provider review');
          p.providerDecision = decisions.get(p.id) ?? {
            objectId: null,
            reason: 'No eligible verified model object',
          };
          row.providerDecision = p.providerDecision;
        }
        await c.query('UPDATE assistant_jobs SET proposals=$3 WHERE project_id=$1 AND id=$2', [
          pid,
          jobId,
          JSON.stringify(stored),
        ]);
      },
      undefined,
      background ? 'persisted-grant' : 'request',
    );
  }
  let assigned = 0,
    replaced = 0,
    preserved = 0,
    review = 0,
    failed = 0;
  const errors: { id: string; code: string }[] = [];
  for (const proposal of proposals) {
    if (proposal.reason === 'Existing assignment preserved') {
      preserved++;
      continue;
    }
    if (
      !proposal.locationId ||
      (!proposal.ref && !proposal.localModel) ||
      !providerApproved(proposal)
    ) {
      review++;
      continue;
    }
    if (!input.autoApply) continue;
    try {
      const result = await applySavedProposal(
        pid,
        jobId,
        proposal.id,
        who,
        true,
        input.replaceConflicting,
        background,
      );
      if (result.duplicate) preserved++;
      else {
        assigned++;
        if (result.replaced) replaced++;
      }
    } catch (error) {
      // A conflict for one endpoint is isolated. Permission, scope or an unknown
      // commit outcome must be reconciled before dispatching additional writes.
      if (!(error instanceof PathFinderError) || error.status !== 409) throw error;
      failed++;
      errors.push({ id: proposal.id, code: error.code });
    }
  }
  return {
    checked: proposals.length,
    requestUsage,
    assigned,
    replaced,
    preserved,
    review,
    failed,
    errors,
    proposals,
  };
}
