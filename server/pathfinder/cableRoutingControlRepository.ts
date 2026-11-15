import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { revisionResultEnvelopeSchema } from '../../shared/pathfinderRevisionResults.js';
import { autoLengthSourceSchema } from './autoLengthStore.js';
import type { CableRoutingReadView } from '../../shared/cableRoutingView.js';
import type { JobPrincipal } from './jobContracts.js';
import { applyCableRoutingMutation, automaticRoutingWriteAllowed, cableRoutingControlSchema, emptyRoutingControl,
  executionRoutingReasons, latchExecutionRouting, normalizeRouting, releaseExecutionRouting, type CableExecutionFacts, type CableRoutingControl,
  type CableRoutingMutation } from '../../shared/cableRoutingControl.js';
import { policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import { PathFinderError } from './errors.js';
import { requireCurrentLogin } from './auth.js';
import { verifiedManualRoutingReadLength } from './manualRoutingValidation.js';

type Queryable = Pick<PoolClient, 'query'>;
type Row = Record<string, any>;
export const cableExecutionFacts = (row: Row): CableExecutionFacts => ({
  installLength: row.installLength ?? (row.install_length == null ? null : Number(row.install_length)),
  pullDate: date(row.pullDate ?? row.pull_date), connectedFrom: date(row.connectedFrom ?? row.connected_from),
  connectedTo: date(row.connectedTo ?? row.connected_to), tested: date(row.tested),
});
const date = (value: unknown) => value == null || value === '' ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
export type StoredCableRoutingControl = { control: CableRoutingControl; revision: string; manualRevision: string };
export function mapRoutingControl(row: Row): StoredCableRoutingControl {
  return { revision: policyRevisionSchema.parse(String(row.revision)), manualRevision: policyRevisionSchema.parse(String(row.manual_revision ?? row.revision)), control: cableRoutingControlSchema.parse({
    schemaVersion: 'wfc.cable-routing-control.v1', manualRouting: row.manual_routing, manualProtected: row.manual_protected,
    executionLocked: row.execution_locked, executionRouting: row.execution_routing,
  }) };
}
export async function readCableRoutingControl(client: Queryable, projectId: string, cableId: string, lock = false): Promise<StoredCableRoutingControl | null> {
  const rows = (await client.query<Row>(`/* cable-routing:control */ SELECT revision::text,manual_revision::text,manual_routing,manual_protected,execution_locked,execution_routing
    FROM pf_cable_routing_controls WHERE project_id=$1 AND cable_id=$2${lock ? ' FOR UPDATE' : ''}`, [projectId, cableId])).rows;
  return rows[0] ? mapRoutingControl(rows[0]) : null;
}
/** Durable same-transaction seam. A worker only sees this pending revision after COMMIT. */
export async function enqueueManualRouteCalculation(client: Queryable, projectId: string, cableId: string, manualRevision: string, principal?: JobPrincipal) {
  if (principal) await requireCurrentLogin(client as PoolClient, principal);
  await client.query(`/* cable-routing:manual-enqueue */ INSERT INTO pf_manual_route_jobs(project_id,cable_id,manual_revision,state,actor_id,login_id,login_expires_at,
    authority_admin_revision,authority_installation_epoch)
    VALUES($1,$2,$3,'pending',$4,$5,$6,(SELECT pf_admin_revision FROM users WHERE id=$4),(SELECT installation_epoch FROM pf_installation_state WHERE singleton=true)) ON CONFLICT(project_id,cable_id) DO UPDATE SET manual_revision=EXCLUDED.manual_revision,
    actor_id=EXCLUDED.actor_id,login_id=EXCLUDED.login_id,login_expires_at=EXCLUDED.login_expires_at,
    authority_admin_revision=EXCLUDED.authority_admin_revision,authority_installation_epoch=EXCLUDED.authority_installation_epoch,
    generation=pf_manual_route_jobs.generation+1,owner_token=NULL,lease_until=NULL,attempts=0,next_attempt_at=clock_timestamp(),automatic_authority=NULL,
    state=CASE WHEN pf_manual_route_jobs.length_metres IS NULL THEN 'pending' ELSE 'stale' END,diagnostics='[]'::jsonb,updated_at=clock_timestamp()`,
  [projectId, cableId, manualRevision, principal?.userId ?? null, principal?.loginId ?? null, principal ? new Date(principal.loginExpiresAt) : null]);
}
export async function saveCableRoutingControl(client: Queryable, input: { projectId: string; cableId: string; actorId: string;
  previous: StoredCableRoutingControl; next: CableRoutingControl; reason: string; principal?: JobPrincipal }) {
  const manualChanged = input.next.manualRouting !== input.previous.control.manualRouting || input.next.manualProtected !== input.previous.control.manualProtected;
  const result = (await client.query<Row>(`/* cable-routing:update */ UPDATE pf_cable_routing_controls SET manual_routing=$4,manual_protected=$5,
    execution_locked=$6,execution_routing=$7,revision=revision+1,manual_revision=manual_revision+CASE WHEN $8 THEN 1 ELSE 0 END,updated_at=clock_timestamp()
    WHERE project_id=$1 AND cable_id=$2 AND revision=$3 RETURNING revision::text,manual_revision::text`,
  [input.projectId, input.cableId, input.previous.revision, input.next.manualRouting, input.next.manualProtected,
    input.next.executionLocked, input.next.executionRouting, manualChanged])).rows[0];
  if (!result) throw new PathFinderError('ROUTING_CONTROL_CHANGED', 409, 'Routing protection changed. Refresh the cable before saving.');
  await client.query(`/* cable-routing:audit */ INSERT INTO pf_cable_routing_events(project_id,cable_id,actor_id,reason,control_revision,record)
    VALUES($1,$2,$3,$4,$5,$6)`, [input.projectId, input.cableId, input.actorId, input.reason, result.revision,
    { before: input.previous.control, after: input.next }]);
  if (manualChanged) {
    if (input.next.manualRouting) await enqueueManualRouteCalculation(client, input.projectId, input.cableId, result.manual_revision, input.principal);
    else await client.query("/* cable-routing:manual-retire */ DELETE FROM pf_manual_route_jobs WHERE project_id=$1 AND cable_id=$2", [input.projectId, input.cableId]);
  }
  return { control: input.next, revision: String(result.revision), manualRevision: String(result.manual_revision) };
}
/** Only for a row returned by this transaction's fresh INSERT, never an update
 * or an existing conflict. Import protection is chosen before the first freeze. */
export async function initializeImportedCableRoutingControl(client: Queryable, input: { projectId: string; cableId: string; actorId: string;
  after: Row; protect: boolean; principal?: JobPrincipal; reason?: string }) {
  const stored = await readCableRoutingControl(client, input.projectId, input.cableId, true);
  if (!stored || stored.revision !== '1') throw new PathFinderError('ROUTING_IMPORT_INITIALIZATION_CONFLICT', 409);
  const value = normalizeRouting(input.after.routing ?? null);
  const next = latchExecutionRouting({ ...emptyRoutingControl(), manualRouting: value, manualProtected: value !== null && input.protect },
    cableExecutionFacts(input.after), value);
  if (JSON.stringify(next) !== JSON.stringify(stored.control)) return saveCableRoutingControl(client, { ...input, previous: stored, next, reason: input.reason??'Initial Excel routing import' });
  if (value) await enqueueManualRouteCalculation(client, input.projectId, input.cableId, stored.manualRevision, input.principal);
  return stored;
}
/** Caller holds the cable lock; blocked route edits do not reject permitted unrelated fields. */
export async function applyCableRoutingControlInTransaction(client: Queryable, input: { projectId: string; cableId: string; actorId: string;
  before: Row; after: Row; mutation?: CableRoutingMutation; automaticRouting: string | null; expectedRevision?: string; unlockReason?: string; principal?: JobPrincipal }) {
  const stored = await readCableRoutingControl(client, input.projectId, input.cableId, true);
  // New cables are normally initialized by the insertion trigger. Explicitly
  // seed here for trusted migration/test clients that inserted before bootstrap.
  const base = stored ?? { control: { ...emptyRoutingControl(), manualRouting: input.before.routing ?? null,
    manualProtected: Boolean(input.before.routing?.trim()) }, revision: '1', manualRevision: '1' };
  if (!stored) await client.query(`/* cable-routing:initialize */ INSERT INTO pf_cable_routing_controls(project_id,cable_id,manual_routing,manual_protected)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [input.projectId, input.cableId, base.control.manualRouting, base.control.manualProtected]);
  if (input.expectedRevision !== undefined && input.expectedRevision !== base.revision) throw new PathFinderError('ROUTING_CONTROL_CHANGED', 409);
  let next = base.control;
  if (input.unlockReason !== undefined) {
    try { next = releaseExecutionRouting(next, cableExecutionFacts(input.before), input.unlockReason); }
    catch (error) { throw new PathFinderError(error instanceof Error ? error.message : 'ROUTING_UNLOCK_REFUSED', 409); }
  }
  const unchangedManual=input.mutation?.kind==='manual' && input.mutation.routing===next.manualRouting
    && (input.mutation.routing===null?false:input.mutation.manualProtected??true)===next.manualProtected;
  const mutation = input.mutation && !unchangedManual ? applyCableRoutingMutation({ control: next, facts: cableExecutionFacts(input.before),
    automaticRouting: input.automaticRouting, mutation: input.mutation }) : { control: next, changed: false, blockedReasons: [] };
  next = mutation.control;
  const importNoop = input.mutation?.kind === 'import' && (!input.mutation.present || !input.mutation.protect && normalizeRouting(input.mutation.routing) === null);
  const manualNoop=input.mutation?.kind==='manual'&&!mutation.changed&&input.unlockReason===undefined;
  let currentAutomatic: string | null = null;
  const importsProvisional = input.mutation?.kind === 'import' && input.mutation.present && Boolean(input.mutation.routing?.trim());
  if(input.mutation && !mutation.blockedReasons.length && !importNoop && !manualNoop && !next.executionLocked && !next.manualProtected && !importsProvisional) {
    const value=(row:Row,camel:string,snake:string)=>row[camel]??row[snake]??null;
    const inputsChanged=[['fromLocation','from_location'],['toLocation','to_location'],['mto','mto'],['cableTypeId','cable_type_id']]
      .some(([camel,snake])=>value(input.before,camel,snake)!==value(input.after,camel,snake));
    if(!inputsChanged)currentAutomatic=await(await import('./currentAutomaticRouting.js')).readCurrentAutomaticRouting(client,input.projectId,input.cableId);
  }
  const effective = mutation.blockedReasons.length || importNoop || manualNoop ? input.before.routing ?? null : next.executionLocked ? next.executionRouting : input.mutation
    ? next.manualProtected ? next.manualRouting : input.mutation.kind === 'import' && input.mutation.present && input.mutation.routing?.trim()
      ? input.mutation.routing.trim() : currentAutomatic
    : input.after.routing ?? input.before.routing ?? null;
  // A first execution report must freeze the route accepted by the imminent
  // cable UPDATE. Persisting its latch here would make the BEFORE UPDATE fence
  // reject that same permitted route edit. The AFTER UPDATE trigger owns this
  // first latch and audit; already-latched controls remain protected above.
  let saved = base;
  if (JSON.stringify(next) !== JSON.stringify(base.control)) saved = await saveCableRoutingControl(client, { ...input, previous: base, next,
    reason: input.unlockReason ?? (input.mutation?.kind === 'import' ? 'Excel routing import' : 'Cable routing edit') });
  else if(input.mutation?.kind==='manual' && !mutation.blockedReasons.length && next.manualRouting && input.principal){
    // An explicit unchanged Save can legitimately activate a migrated/expired
    // pending check. Reading a cable never mints authority, and a current
    // calculated result is not recalculated merely because it was saved again.
    const job=(await client.query<Row>(`/* cable-routing:manual-authority-renew */ SELECT m.state,m.diagnostics,
      EXISTS(SELECT 1 FROM users u JOIN viewer_login_bindings l ON l.user_id=u.id CROSS JOIN pf_installation_state i
      WHERE u.id=m.actor_id AND u.is_admin AND u.pf_admin_revision=m.authority_admin_revision AND i.singleton=true
      AND i.installation_epoch=m.authority_installation_epoch AND l.login_id=m.login_id AND l.revoked_at IS NULL
      AND l.expires_at=m.login_expires_at AND l.expires_at>clock_timestamp()) AS authority_valid
      FROM pf_manual_route_jobs m WHERE m.project_id=$1 AND m.cable_id=$2 FOR UPDATE OF m`,[input.projectId,input.cableId])).rows[0];
    const authorityRefused=Array.isArray(job?.diagnostics)&&job.diagnostics.some((reason:unknown)=>typeof reason==='string'&&
      /AUTHORITY|LOGIN_(?:EXPIRED|REVOKED)|ADMIN_REQUIRED|AUTOMATIC_OUTPUT_(?:GENERATION|ORIGINAL_ENABLE)/.test(reason));
    if(job?.state!=='calculated'&&(!job || !job.authority_valid || authorityRefused))
      await enqueueManualRouteCalculation(client,input.projectId,input.cableId,base.manualRevision,input.principal);
  }
  return { ...saved, routing: effective, blockedReasons: mutation.blockedReasons };
}
export async function assertAutomaticRoutingControl(client: Queryable, projectId: string, cableId: string, row: Row) {
  const stored = await readCableRoutingControl(client, projectId, cableId, true);
  if (stored && !automaticRoutingWriteAllowed(stored.control, cableExecutionFacts(row)))
    throw new PathFinderError('ROUTING_PROTECTED', 409, executionRoutingReasons(cableExecutionFacts(row), stored.control.executionLocked).join(', ') || 'Manual routing is protected.');
  return stored;
}
export type { CableRoutingReadView } from '../../shared/cableRoutingView.js';
export async function readCableRoutingViews(client: Queryable, projectId: string, cableIds: string[]): Promise<Map<string, CableRoutingReadView>> {
  const output = new Map<string, CableRoutingReadView>();
  for (let at = 0; at < cableIds.length; at += 500) {
    const rows = (await client.query<Row>(`/* cable-routing:views */ SELECT c.cable_id,c.revision::text,c.manual_revision::text AS current_manual_revision,b.cable_write_revision::text,c.manual_routing,c.manual_protected,c.execution_locked,c.execution_routing,
      m.state AS manual_state,m.length_metres,m.diagnostics,m.manual_revision::text,m.generation::text AS manual_generation,m.input_sha256 AS manual_input_sha256,
      m.result_id AS manual_result_id,mr.record_sha256 AS manual_result_sha256,mr.projection_sha256 AS manual_source_sha256,
      CASE WHEN octet_length(mr.projection::text)<=8192 THEN mr.projection ELSE NULL END AS manual_source_record,
      a.source,a.source_sha256,a.proposal_id,p.result#>>'{route,routeText}' AS automatic_routing,p.proposal_hash,p.status AS proposal_status,
      s.record_sha256 AS result_sha256,s.engine_result_sha256,s.ledger_sha256,CASE WHEN octet_length(s.record::text)<=131072 THEN s.record ELSE NULL END AS sealed_record
      FROM pf_cable_routing_controls c JOIN cables b ON b.project_id=c.project_id AND b.id=c.cable_id LEFT JOIN pf_manual_route_jobs m ON m.project_id=c.project_id AND m.cable_id=c.cable_id
      LEFT JOIN pf_manual_route_results mr ON mr.project_id=m.project_id AND mr.cable_id=m.cable_id AND mr.id=m.result_id
      LEFT JOIN pf_auto_lengths a ON a.project_id=c.project_id AND a.cable_id=c.cable_id
      LEFT JOIN pf_proposals p ON p.project_id=a.project_id AND p.id=a.proposal_id AND p.cable_id=a.cable_id
      LEFT JOIN pf_revision_results s ON s.project_id=a.project_id AND s.proposal_id=a.proposal_id AND s.cable_id=a.cable_id
      WHERE c.project_id=$1 AND c.cable_id=ANY($2::uuid[])`, [projectId, cableIds.slice(at, at + 500)])).rows;
    for (const row of rows) {
      const stored = mapRoutingControl(row);
      const legacyDiagnostics: string[] = [];
      for (const [value, reason] of [[stored.control.manualRouting, 'MANUAL_ROUTING_INVALID_TEXT'], [stored.control.executionRouting, 'EXECUTION_ROUTING_INVALID_TEXT']] as const) {
        try { normalizeRouting(value); } catch { legacyDiagnostics.push(reason); }
      }
      // Auto route is a display projection from the same immutable successful
      // result that supplied Auto length. It never grants write authority.
      const parsedSource = autoLengthSourceSchema.safeParse(row.source);
      const source = parsedSource.success ? parsedSource.data : null;
      const parsedSeal = revisionResultEnvelopeSchema.safeParse(row.sealed_record);
      const seal = parsedSeal.success ? parsedSeal.data : null;
      const sealValid = seal && createHash('sha256').update(canonicalPurposeJson(Object.fromEntries(Object.entries(seal).filter(([key]) => key !== 'revisionResultSha256')))).digest('hex') === seal.revisionResultSha256
        && seal.revisionResultSha256 === row.result_sha256 && seal.projectId === projectId && seal.cableId === row.cable_id && seal.proposalId === row.proposal_id;
      const valid = sealValid && source && createHash('sha256').update(canonicalPurposeJson(source)).digest('hex') === row.source_sha256 && source.projectId === projectId && source.cableId === row.cable_id && source.proposalId === row.proposal_id
        && source.proposalHash === row.proposal_hash && source.revisionResultHash === row.result_sha256
        && source.engineResultHash === row.engine_result_sha256 && source.ledgerHash === row.ledger_sha256 && row.proposal_status === 'calculated'
        && source.proposalHash === seal.proposalHash && source.engineResultHash === seal.engineResultSha256 && source.dependencyHash === seal.dependencyHash
        && source.ledgerHash === seal.ledgerHash && source.admissionId === seal.admissionId && source.jobId === seal.jobId
        && source.calculatedAt === seal.createdAt && source.lengthMetersText === seal.summary.designLengthMeters && seal.summary.calculationMode === 'calculate';
      const manualLengthVerified = row.manual_state==='calculated'?verifiedManualRoutingReadLength(row,projectId):null;
      const manualUnverified = row.manual_state==='calculated' && manualLengthVerified===null;
      output.set(row.cable_id, { routingControl: stored.control, routingControlRevision: stored.revision, cableWriteRevision: String(row.cable_write_revision),
        autoCalculatedRouting: valid && typeof seal.summary.routeText === 'string' ? seal.summary.routeText : null,
        autoRoutingStatus: valid ? 'last-successful' : source ? 'unavailable' : 'not-calculated',
        autoRoutingCalculatedAt: valid ? source.calculatedAt : null, manualRouteLength: row.length_metres ?? null,
        manualRouteLengthStatus: !row.manual_state ? 'not-calculated' : (row.manual_revision !== row.current_manual_revision || manualUnverified) && row.manual_state === 'calculated' ? 'stale' : row.manual_state === 'running' ? 'pending' : row.manual_state,
        routingDiagnostics: [...(Array.isArray(row.diagnostics) ? row.diagnostics : []), ...legacyDiagnostics,...(manualUnverified?['MANUAL_ROUTE_RESULT_UNVERIFIED']:[])] });
    }
  }
  return output;
}
