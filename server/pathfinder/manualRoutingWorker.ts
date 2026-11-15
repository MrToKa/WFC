import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool, PoolClient } from 'pg';
import type { EngineInvocation } from './engineSession.js';
import { defaultOptions, engineResponseSchema, optionsSchema, type BarrierDependencySnapshot, type EngineResponse, type JobPrincipal } from './jobContracts.js';
import { readCurrentBarrierAdmissionIntent } from './barrierCalculationScope.js';
import { barrierCalculationEngineIdentity, mixedBarrierCalculationEngineIdentity } from './calculationEngineIdentity.js';
import { collectDependenciesForVersion, hash } from './dependencies.js';
import { buildCableEngineRequest } from './worker.js';
import { readCableRoutingControl } from './cableRoutingControlRepository.js';
import { manualPhysicalCodes, manualRouteConstraintSchema, type ManualRoutingDependencies } from './manualRoutingContracts.js';
import { buildManualRoutingSource, validateManualRoutingResult } from './manualRoutingValidation.js';
import { endpointBindingTransaction } from './endpointBindingRepository.js';
import { schedulerTransaction } from './schedulerTransaction.js';
import { readSnapshot } from './storage.js';
import { readTrayCapacityRouting } from './trayCapacityRouting.js';
import { requireCurrentBarrierWriteScope } from './barrierWrites.js';
import { activeAutomaticGenerationAuthorization, requireAutomaticGenerationOutput } from './automaticGenerationOutput.js';
import type { AutomaticPairSource } from '../../shared/pathfinderAutomaticPair.js';
import { PathFinderError } from './errors.js';
import { writeManualRoutingDesign } from './manualRoutingDesignWriter.js';
export { validateManualRoutingResult } from './manualRoutingValidation.js';

type Row = Record<string, any>;
export type ManualRoutingClaim = { projectId: string; cableId: string; manualRevision: string; generation: string; ownerToken: string;
  principal: JobPrincipal; automaticAuthority: AutomaticPairSource | null; authorityAdminRevision: string; authorityInstallationEpoch: string };
export type ManualRoutingCollection = { dependencies: ManualRoutingDependencies; request: EngineInvocation; adminRevision: string; installationEpoch: string };
export type ManualRoutingAdapters = {
  execute: (request: EngineInvocation, signal: AbortSignal) => Promise<EngineResponse>;
  collect?: (client: PoolClient, claim: ManualRoutingClaim, requestId: string, signal: AbortSignal) => Promise<ManualRoutingCollection>;
  validate?: typeof validateManualRoutingResult;
};
const bounded = (value: unknown, limit = 4194304) => { if (Buffer.byteLength(JSON.stringify(value)) > limit) throw new PathFinderError('MANUAL_ROUTE_RESULT_LIMIT', 413); return value; };
const mathematicalHash=(d:ManualRoutingDependencies)=>hash({...d,protected:{...d.protected,cableWriteRevision:'0'}});
export async function collectManualRoutingInputs(client: PoolClient, claim: ManualRoutingClaim, requestId: string, signal: AbortSignal): Promise<ManualRoutingCollection> {
  signal.throwIfAborted();
  await client.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='30000ms'");
  const authority = (await client.query<Row>(`/* manual-routing:authority */ SELECT u.pf_admin_revision::text AS admin_revision,i.installation_epoch
    FROM users u CROSS JOIN pf_installation_state i WHERE u.id=$1 AND u.is_admin AND i.singleton=true FOR SHARE OF u,i`, [claim.principal.userId])).rows[0];
  if (!authority || authority.admin_revision!==claim.authorityAdminRevision || authority.installation_epoch!==claim.authorityInstallationEpoch)
    throw new PathFinderError('MANUAL_ROUTE_AUTHORITY_CHANGED', 403);
  if (claim.automaticAuthority) await requireAutomaticGenerationOutput(client, claim.automaticAuthority,
    { projectId: claim.projectId, actorId: claim.principal.userId, loginId: claim.principal.loginId, jobId: requestId, admission: true });
  const preferences = (await client.query<Row>('SELECT preferences FROM pf_recalculation_state WHERE project_id=$1', [claim.projectId])).rows[0]?.preferences;
  const { barrierRouting: _old, ...math } = preferences && typeof preferences === 'object' ? preferences : {};
  const intent = await readCurrentBarrierAdmissionIntent(client, claim.projectId, false, { signal });
  const identity = await (intent.schemaVersion === 'wfc.pf.barrier-admission-intent.v2' ? mixedBarrierCalculationEngineIdentity : barrierCalculationEngineIdentity)({ force: true });
  const options = optionsSchema.parse({ ...defaultOptions, ...math, barrierRouting: intent });
  const collected = await collectDependenciesForVersion(client, claim.projectId, claim.cableId, options, 'pathfinder.dependencies.v8', true, identity);
  if (!collected.dependencies || collected.dependencies.schemaVersion !== 'pathfinder.dependencies.v8')
    throw new PathFinderError('MANUAL_ROUTE_' + collected.status.toUpperCase(), 409, collected.message);
  const control = await readCableRoutingControl(client, claim.projectId, claim.cableId, true);
  if (!control || control.manualRevision !== claim.manualRevision || !control.control.manualRouting) throw new PathFinderError('MANUAL_ROUTE_SUPERSEDED', 409);
  const constraint = manualRouteConstraintSchema.parse({ schemaVersion: 'pathfinder.manual-ordered-route.v1', routeText: control.control.manualRouting });
  const codes = manualPhysicalCodes(constraint.routeText);
  const capacity = await readTrayCapacityRouting(client, { projectId: claim.projectId, cableId: claim.cableId, jobId: requestId });
  const assessment = capacity?.evaluate(codes);
  if (capacity?.restrictionEnabled && (!assessment || assessment.policyIssue || assessment.unavailableRouteCodes.length || assessment.blockedRouteCodes.length))
    throw new PathFinderError('MANUAL_ROUTE_CAPACITY_UNAVAILABLE', 409, 'The required manual trays do not satisfy the current capacity policy: ' +
      [...(assessment?.blockedRouteCodes ?? []), ...(assessment?.unavailableRouteCodes ?? [])].join(', '));
  const dependencies: ManualRoutingDependencies = { schemaVersion: 'pathfinder.manual-route.dependencies.v1', manualRevision: claim.manualRevision,
    constraint, protected: collected.dependencies, capacity: capacity ? { occupancySha256: capacity.occupancySha256,
      restrictionEnabled: capacity.restrictionEnabled, excludedRouteCodes: assessment?.blockedRouteCodes ?? [] } : null };
  const request = buildCableEngineRequest(collected.dependencies, requestId, 60000);
  delete request.directSecondaryPolicy;
  request.manualRouteConstraint = constraint;
  if (dependencies.capacity?.excludedRouteCodes.length) request.excludedRouteCodes = dependencies.capacity.excludedRouteCodes;
  await requireCurrentBarrierWriteScope(client, collected.dependencies, { signal });
  await readSnapshot(collected.dependencies.artifact.id, collected.dependencies.artifact.sha256);
  bounded(dependencies, 1048576); signal.throwIfAborted();
  return { dependencies, request, adminRevision: authority.admin_revision, installationEpoch: authority.installation_epoch };
}
function claimFrom(row: Row, ownerToken: string): ManualRoutingClaim {
  return { projectId: row.project_id, cableId: row.cable_id, manualRevision: String(row.manual_revision), generation: String(row.generation), ownerToken,
    principal: { userId: row.actor_id, loginId: row.login_id, loginExpiresAt: new Date(row.login_expires_at).getTime() }, automaticAuthority: row.automatic_authority ?? null,
    authorityAdminRevision:String(row.authority_admin_revision),authorityInstallationEpoch:row.authority_installation_epoch };
}
export function createManualRoutingWorker(pool: Pool, adapters: ManualRoutingAdapters) {
  const collect = adapters.collect ?? collectManualRoutingInputs, validate = adapters.validate ?? validateManualRoutingResult;
  const controller = new AbortController(); let loop: Promise<void> | undefined, ticking: Promise<void> | undefined;
  async function activateAutomaticOwner() {
    const candidates = (await pool.query<Row>(`/* manual-routing:automatic-candidates */ SELECT s.* FROM pf_recalculation_state s
      WHERE s.enabled AND NOT s.paused AND s.authority_expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM pf_manual_route_jobs m
      WHERE m.project_id=s.project_id AND (m.actor_id IS NULL OR m.login_expires_at<=clock_timestamp() OR m.automatic_authority IS NOT NULL AND
      (m.automatic_authority->>'generation' IS DISTINCT FROM s.desired_generation::text OR m.automatic_authority->>'controlRevision' IS DISTINCT FROM s.control_revision::text
      OR m.automatic_authority->>'authorityEpoch' IS DISTINCT FROM s.authority_epoch::text))) ORDER BY s.project_id LIMIT 1`)).rows;
    for (const state of candidates) {
      const a = activeAutomaticGenerationAuthorization(state); if (!a) continue;
      const source: AutomaticPairSource = { kind: 'automatic-generation', generation: String(state.desired_generation), controlRevision: String(state.control_revision),
        authorityEpoch: String(state.authority_epoch), authorization: a };
      const who = { userId: a.actorId, loginId: a.loginId, loginExpiresAt: Date.parse(a.loginExpiresAt) };
      try { await endpointBindingTransaction(pool, state.project_id, who, async client => {
        await requireAutomaticGenerationOutput(client, source, { projectId: state.project_id, actorId: a.actorId, loginId: a.loginId, jobId: randomUUID(), admission: true });
        await client.query(`/* manual-routing:activate */ UPDATE pf_manual_route_jobs SET actor_id=$2,login_id=$3,login_expires_at=$4,
          automatic_authority=$5,authority_admin_revision=$6,authority_installation_epoch=$7,generation=generation+1,owner_token=NULL,lease_until=NULL,attempts=0,next_attempt_at=clock_timestamp(),
          state=CASE WHEN length_metres IS NULL THEN 'pending' ELSE 'stale' END,diagnostics='[]'::jsonb
          WHERE project_id=$1 AND cable_id IN(SELECT cable_id FROM pf_manual_route_jobs WHERE project_id=$1
          AND (actor_id IS NULL OR login_expires_at<=clock_timestamp() OR automatic_authority IS NOT NULL AND automatic_authority IS DISTINCT FROM $5::jsonb)
          ORDER BY cable_id LIMIT 100)`, [state.project_id, a.actorId, a.loginId, new Date(who.loginExpiresAt), source,a.actorAdminRevision,a.installationEpoch]);
      }); } catch { /* Remain awaiting legitimate authority; no service principal. */ }
    }
  }
  async function claim(): Promise<ManualRoutingClaim | null> {
    return schedulerTransaction(pool, async client => {
      await client.query(`/* manual-routing:recovery-limit */ UPDATE pf_manual_route_jobs SET state='invalid',owner_token=NULL,lease_until=NULL,
        diagnostics='["MANUAL_ROUTE_RECOVERY_LIMIT"]'::jsonb WHERE (project_id,cable_id) IN(SELECT project_id,cable_id FROM pf_manual_route_jobs
        WHERE state='running' AND lease_until<clock_timestamp() AND attempts>=3 ORDER BY project_id,cable_id LIMIT 100)`);
      await client.query(`/* manual-routing:authority-status */ UPDATE pf_manual_route_jobs m SET diagnostics='["MANUAL_CALCULATION_AUTHORITY_REQUIRED"]'::jsonb
        WHERE m.cable_id IN(SELECT q.cable_id FROM pf_manual_route_jobs q WHERE q.state IN('pending','stale','running') AND
        q.diagnostics IS DISTINCT FROM '["MANUAL_CALCULATION_AUTHORITY_REQUIRED"]'::jsonb AND
        (q.actor_id IS NULL OR q.login_expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM users u JOIN viewer_login_bindings l ON l.user_id=u.id CROSS JOIN pf_installation_state i
        WHERE u.id=q.actor_id AND u.is_admin AND u.pf_admin_revision=q.authority_admin_revision AND i.singleton=true AND i.installation_epoch=q.authority_installation_epoch
        AND l.login_id=q.login_id AND l.revoked_at IS NULL AND l.expires_at=q.login_expires_at)) ORDER BY q.cable_id LIMIT 100)
        AND diagnostics IS DISTINCT FROM '["MANUAL_CALCULATION_AUTHORITY_REQUIRED"]'::jsonb`);
      const row = (await client.query<Row>(`/* manual-routing:claim */ SELECT m.*,m.manual_revision::text,m.generation::text FROM pf_manual_route_jobs m
        WHERE (m.state IN('pending','stale') OR m.state='running' AND m.lease_until<clock_timestamp()) AND m.attempts<3 AND m.next_attempt_at<=clock_timestamp()
        AND m.login_expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM users u JOIN viewer_login_bindings l ON l.user_id=u.id CROSS JOIN pf_installation_state i
        WHERE u.id=m.actor_id AND u.is_admin AND u.pf_admin_revision=m.authority_admin_revision AND i.singleton=true AND i.installation_epoch=m.authority_installation_epoch
        AND l.login_id=m.login_id AND l.revoked_at IS NULL AND l.expires_at=m.login_expires_at)
        ORDER BY m.next_attempt_at,m.project_id,m.cable_id LIMIT 1 FOR UPDATE OF m SKIP LOCKED`)).rows[0];
      if (!row) return null;
      const owner = randomUUID();
      await client.query(`/* manual-routing:own */ UPDATE pf_manual_route_jobs SET owner_token=$3,lease_until=clock_timestamp()+interval '180 seconds',
        state='running',attempts=attempts+1,updated_at=clock_timestamp() WHERE project_id=$1 AND cable_id=$2`, [row.project_id, row.cable_id, owner]);
      return claimFrom(row, owner);
    }, controller.signal);
  }
  async function fence(client: PoolClient, c: ManualRoutingClaim) {
    const row = (await client.query<Row>(`/* manual-routing:fence */ SELECT manual_revision::text,generation::text,owner_token,lease_until,actor_id,login_id,login_expires_at,automatic_authority
      FROM pf_manual_route_jobs WHERE project_id=$1 AND cable_id=$2 FOR UPDATE`, [c.projectId, c.cableId])).rows[0];
    if (!row || row.manual_revision !== c.manualRevision || row.generation !== c.generation || row.owner_token !== c.ownerToken || new Date(row.lease_until).getTime() <= Date.now()
      || row.actor_id !== c.principal.userId || row.login_id !== c.principal.loginId || new Date(row.login_expires_at).getTime() !== c.principal.loginExpiresAt
      || hash(row.automatic_authority ?? null) !== hash(c.automaticAuthority)) throw new PathFinderError('MANUAL_ROUTE_SUPERSEDED', 409);
  }
  async function fail(c: ManualRoutingClaim, error: unknown) {
    const code = error instanceof PathFinderError ? error.code : controller.signal.aborted ? 'MANUAL_ROUTE_CANCELLED' : 'MANUAL_ROUTE_CALCULATION_FAILED';
    const message = error instanceof Error ? error.message.slice(0, 2048) : code;
    const temporary = /BUSY|UNAVAILABLE|DEADLINE|CANCELLED|SUPERSEDED|INPUTS_CHANGED|STALE|DATABASE|COMMIT_OUTCOME_UNKNOWN/.test(code);
    const busy=/DATABASE_BUSY|ENGINE_BUSY/.test(code);
    await schedulerTransaction(pool, async client => { await client.query(`/* manual-routing:fail */ UPDATE pf_manual_route_jobs SET
      state=CASE WHEN $7 OR $6 AND attempts<3 THEN CASE WHEN length_metres IS NULL THEN 'pending' ELSE 'stale' END ELSE 'invalid' END,
      attempts=CASE WHEN $7 THEN greatest(0,attempts-1) ELSE attempts END,
      owner_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+interval '5 seconds',diagnostics=$5,updated_at=clock_timestamp()
      WHERE project_id=$1 AND cable_id=$2 AND generation=$3 AND owner_token=$4`, [c.projectId, c.cableId, c.generation, c.ownerToken, JSON.stringify([code, message]), temporary,busy]); });
  }
  async function process(c: ManualRoutingClaim) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(100000)]), requestId = randomUUID();
    const authorityFence=async(client:PoolClient)=>{
      const authority=(await client.query<Row>(`/* manual-routing:authority-fence */ SELECT u.pf_admin_revision::text AS admin_revision,i.installation_epoch
        FROM users u CROSS JOIN pf_installation_state i WHERE u.id=$1 AND u.is_admin AND i.singleton=true FOR SHARE OF u,i`,[c.principal.userId])).rows[0];
      if(!authority || authority.admin_revision!==c.authorityAdminRevision || authority.installation_epoch!==c.authorityInstallationEpoch)
        throw new PathFinderError('MANUAL_ROUTE_AUTHORITY_CHANGED',403);
    };
    try {
      const admitted = await endpointBindingTransaction(pool, c.projectId, c.principal, async client => { await authorityFence(client);const value = await collect(client, c, requestId, signal); await fence(client, c);
        await client.query('/* manual-routing:input */ UPDATE pf_manual_route_jobs SET input_sha256=$3 WHERE project_id=$1 AND cable_id=$2', [c.projectId, c.cableId, hash(value.dependencies)]); return value; },signal);
      signal.throwIfAborted();
      const response = engineResponseSchema.parse(await adapters.execute(admitted.request, signal));
      const length = validate(response, admitted.dependencies, requestId);
      signal.throwIfAborted();
      await endpointBindingTransaction(pool, c.projectId, c.principal, async client => {
        await authorityFence(client);const current = await collect(client, c, requestId, signal); await fence(client, c);
        if (mathematicalHash(current.dependencies) !== mathematicalHash(admitted.dependencies) || current.adminRevision !== admitted.adminRevision || current.installationEpoch !== admitted.installationEpoch)
          throw new PathFinderError('MANUAL_ROUTE_INPUTS_CHANGED', 409);
        const designWrite=length===null?null:await writeManualRoutingDesign(client,{projectId:c.projectId,cableId:c.cableId,actorId:c.principal.userId,
          manualRevision:c.manualRevision,manualRouting:admitted.dependencies.constraint.routeText,lengthMetres:length});
        const id = randomUUID(), diagnostics = length === null ? [response.schemaVersion === 'pathfinder.model.response.v3' ? response.barriers.diagnostics.reasonCode : response.status, response.message] : [];
        const record = { schemaVersion: 'pathfinder.manual-route.result.v1', id, projectId: c.projectId, cableId: c.cableId, manualRevision: c.manualRevision,
          generation: c.generation, inputSha256: hash(admitted.dependencies), dependencies: admitted.dependencies, response, lengthMetres: length,
          actorId: c.principal.userId, loginId: c.principal.loginId, adminRevision: admitted.adminRevision, installationEpoch: admitted.installationEpoch,
          designWrite,calculatedAt: new Date().toISOString() };
        bounded(record);
        const recordSha256=hash(record),source=buildManualRoutingSource(record,recordSha256);
        await client.query(`/* manual-routing:result */ INSERT INTO pf_manual_route_results(id,project_id,cable_id,manual_revision,generation,actor_id,login_id,input_sha256,record_sha256,record,projection,projection_sha256)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, c.projectId, c.cableId, c.manualRevision, c.generation, c.principal.userId, c.principal.loginId, record.inputSha256, recordSha256, record,source,hash(source)]);
        await client.query(`/* manual-routing:publish */ UPDATE pf_manual_route_jobs SET state=$5,length_metres=COALESCE($6,length_metres),diagnostics=$7,
          result_id=$8,owner_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE project_id=$1 AND cable_id=$2 AND generation=$3 AND owner_token=$4`,
        [c.projectId, c.cableId, c.generation, c.ownerToken, length === null ? 'invalid' : 'calculated', length, JSON.stringify(diagnostics), id]);
      },signal);
    } catch (error) { await fail(c, error); }
  }
  function tick() {
    if (controller.signal.aborted) return Promise.resolve();
    return ticking ??= (async () => { await activateAutomaticOwner(); const c = await claim(); if (c) await process(c); })()
      .catch(() => undefined).finally(() => { ticking = undefined; });
  }
  return { tick, claim, process, start() { loop ??= (async () => { while (!controller.signal.aborted) { await tick(); await delay(1000, undefined, { signal: controller.signal }).catch(() => undefined); } })(); },
    async stop() { controller.abort(); await loop; await ticking; } };
}
