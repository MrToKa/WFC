import type { PoolClient } from 'pg';
import { ZodError } from 'zod';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { executionRoutingReasons } from '../../shared/cableRoutingControl.js';
import { cableExecutionFacts, mapRoutingControl } from './cableRoutingControlRepository.js';
import { automaticPairDecimalEqual, createAutomaticPairReceiptProofReader, type AutomaticPairReceiptFact } from './automaticPairReceiptProof.js';
import { PathFinderError } from './errors.js';

type Row = Record<string, any>;
type ProofInput = { projectId: string; cableId: string; receiptId: string };
export type AutomaticRoutingMigrationRepairItem = {
  cableId: string; eligible: boolean; repaired: boolean; reasonCode: string;
  manifest?: { routing: string; designLength: string; cableWriteRevision: string; controlRevision: string;
    manualRevision: string; receiptId: string; receiptSha256: string; originReceiptId: string;
    historyId: string; historyVersion: string };
};
export type AutomaticRoutingMigrationRepairAdapters = { proof?: (input: ProofInput) => Promise<AutomaticPairReceiptFact | null> };

/** Caller owns the transaction and explicit scope. This repairs only untouched
 * bootstrap controls whose older, fully proven automatic write still owns the
 * exact cable revision. It never grants calculation authority or writes routes. */
export async function repairAutomaticRoutingMigrationControls(client: PoolClient,
  input: { projectId: string; cableIds: string[]; dryRun?: boolean }, check: () => void = () => undefined,
  adapters: AutomaticRoutingMigrationRepairAdapters = {}) {
  const projectId = policyUuidSchema.parse(input.projectId).toLowerCase(), dryRun = input.dryRun !== false;
  if (!input.cableIds.length || input.cableIds.length > 500)
    throw new PathFinderError('AUTOMATIC_ROUTING_MIGRATION_SCOPE_INVALID', 400);
  const cableIds = input.cableIds.map(id => policyUuidSchema.parse(id).toLowerCase()).sort();
  if (new Set(cableIds).size !== cableIds.length)
    throw new PathFinderError('AUTOMATIC_ROUTING_MIGRATION_SCOPE_INVALID', 400);
  check();
  const project = (await client.query(`/* routing-migration:project */ SELECT id FROM projects WHERE id=$1${dryRun ? '' : ' FOR NO KEY UPDATE'}`, [projectId])).rows;
  if (project.length !== 1) throw new PathFinderError('PROJECT_NOT_FOUND', 404);
  const items: AutomaticRoutingMigrationRepairItem[] = [];
  for (const cableId of cableIds) {
    check();
    const retain = (reasonCode: string) => items.push({ cableId, eligible: false, repaired: false, reasonCode });
    const current = (await client.query<Row>(`/* routing-migration:cable */ SELECT CASE WHEN octet_length(to_jsonb(c)::text)<=1048576
      THEN to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,'install_length',c.install_length::text,
        'cable_write_revision',c.cable_write_revision::text) ELSE NULL END AS snapshot
      FROM cables c WHERE project_id=$1 AND id=$2${dryRun ? '' : ' FOR UPDATE'}`, [projectId, cableId])).rows[0]?.snapshot;
    if (!current || current.id !== cableId || current.project_id !== projectId) { retain('AUTOMATIC_ROUTING_MIGRATION_CABLE_UNAVAILABLE'); continue; }
    const rawControl = (await client.query<Row>(`/* routing-migration:control */ SELECT revision::text,manual_revision::text,
      manual_routing,manual_protected,execution_locked,execution_routing,updated_at
      FROM pf_cable_routing_controls WHERE project_id=$1 AND cable_id=$2${dryRun ? '' : ' FOR UPDATE'}`, [projectId, cableId])).rows[0];
    if (!rawControl) { retain('AUTOMATIC_ROUTING_MIGRATION_CONTROL_UNAVAILABLE'); continue; }
    const stored = mapRoutingControl(rawControl), before = stored.control;
    if (executionRoutingReasons(cableExecutionFacts(current), before.executionLocked).length || before.executionRouting !== null) {
      retain('ROUTING_EXECUTION_PROTECTED'); continue;
    }
    if (stored.revision !== '1' || stored.manualRevision !== '1' || !before.manualProtected
      || typeof current.routing !== 'string' || !current.routing.trim() || before.manualRouting !== current.routing.trim()) {
      retain('AUTOMATIC_ROUTING_MIGRATION_CONTROL_NOT_UNTOUCHED'); continue;
    }
    const events = (await client.query('/* routing-migration:events */ SELECT id FROM pf_cable_routing_events WHERE project_id=$1 AND cable_id=$2 LIMIT 1',
      [projectId, cableId])).rows;
    if (events.length) { retain('AUTOMATIC_ROUTING_MIGRATION_CONTROL_EVENT_PRESENT'); continue; }
    const receipt = (await client.query<Row>(`/* routing-migration:latest-receipt */ SELECT r.id,
      r.applied_at<c.updated_at AS predates_control FROM pf_apply_receipts r
      JOIN pf_cable_routing_controls c ON c.project_id=r.project_id AND c.cable_id=r.cable_id
      WHERE r.project_id=$1 AND r.cable_id=$2 ORDER BY r.applied_at DESC,r.id DESC LIMIT 1`, [projectId, cableId])).rows[0];
    if (!receipt || receipt.predates_control !== true) { retain('AUTOMATIC_ROUTING_MIGRATION_OLDER_RECEIPT_REQUIRED'); continue; }
    check();
    // Keep the existing bounded historical proof, including its retained seals,
    // complete lineage, snapshots, history and original barrier/length evidence.
    let fact: AutomaticPairReceiptFact | null;
    try {
      fact = await (adapters.proof ?? createAutomaticPairReceiptProofReader(client, check))({ projectId, cableId, receiptId: receipt.id });
    } catch (error) {
      if (error instanceof ZodError || error instanceof PathFinderError && /^AUTOMATIC_PAIR_(?:PROOF_|RECEIPT_|ORIGIN_)/.test(error.code)) {
        check(); retain(error instanceof PathFinderError ? error.code : 'AUTOMATIC_ROUTING_MIGRATION_AUTOMATIC_PROOF_INVALID'); continue;
      }
      throw error;
    }
    check();
    if (!fact || fact.receiptId !== receipt.id || fact.clearedForCapacity) { retain('AUTOMATIC_ROUTING_MIGRATION_AUTOMATIC_PROOF_REQUIRED'); continue; }
    if (fact.after.id !== cableId || fact.after.project_id !== projectId || fact.after.cable_write_revision !== current.cable_write_revision
      || fact.after.routing !== current.routing || !automaticPairDecimalEqual(fact.after.design_length, current.design_length)) {
      retain('AUTOMATIC_ROUTING_MIGRATION_CURRENT_SNAPSHOT_CHANGED'); continue;
    }
    const history = (await client.query<Row>(`/* routing-migration:latest-history */ SELECT id,version_number::text AS version,change_source
      FROM cable_versions WHERE cable_id=$1 ORDER BY version_number DESC,id DESC LIMIT 1`, [cableId])).rows[0];
    if (!history || history.change_source !== 'pathfinder' || history.id !== fact.history.id || history.version !== fact.history.version) {
      retain('AUTOMATIC_ROUTING_MIGRATION_HISTORY_CHANGED'); continue;
    }
    const manifest = { routing: current.routing as string, designLength: current.design_length as string,
      cableWriteRevision: current.cable_write_revision as string, controlRevision: stored.revision, manualRevision: stored.manualRevision,
      receiptId: fact.receiptId, receiptSha256: fact.receiptSha256, originReceiptId: fact.originReceiptId,
      historyId: fact.history.id, historyVersion: fact.history.version };
    if (!dryRun) {
      check();
      const updated = await client.query(`/* routing-migration:repair-control */ UPDATE pf_cable_routing_controls
        SET manual_routing=NULL,manual_protected=false,revision=revision+1,manual_revision=manual_revision+1,updated_at=clock_timestamp()
        WHERE project_id=$1 AND cable_id=$2 AND revision=1 AND manual_revision=1 AND manual_protected=true
          AND execution_locked=false AND execution_routing IS NULL AND manual_routing=$3 RETURNING revision::text`,
      [projectId, cableId, before.manualRouting]);
      if (updated.rows.length !== 1) throw new PathFinderError('AUTOMATIC_ROUTING_MIGRATION_CONTROL_CHANGED', 409);
      const after = { ...before, manualRouting: null, manualProtected: false };
      await client.query(`/* routing-migration:audit */ INSERT INTO pf_cable_routing_events(project_id,cable_id,actor_id,reason,control_revision,record)
        VALUES($1,$2,NULL,$3,$4,$5)`, [projectId, cableId, 'Restore verified automatic ownership after routing-control bootstrap migration',
        updated.rows[0].revision, { schemaVersion: 'wfc.automatic-routing-migration-repair.v1', before, after, proof: manifest }]);
      // Same retirement operation as saving a null manual route. Any running
      // manual worker loses its row/revision fence; no new job is scheduled.
      await client.query('/* routing-migration:manual-retire */ DELETE FROM pf_manual_route_jobs WHERE project_id=$1 AND cable_id=$2', [projectId, cableId]);
    }
    items.push({ cableId, eligible: true, repaired: !dryRun,
      reasonCode: dryRun ? 'AUTOMATIC_ROUTING_MIGRATION_PROVEN' : 'AUTOMATIC_ROUTING_MIGRATION_REPAIRED', manifest });
  }
  check();
  return { dryRun, eligible: items.filter(item => item.eligible).length, repaired: items.filter(item => item.repaired).length, items };
}
