import type { PoolClient } from 'pg';
import { cableObstacleLinksSchema, type CableObstacleLinks } from '../../shared/pathfinderCableObstacleLinks.js';
import { supportedBarrierExecutionSchema } from '../../shared/pathfinderBarrierSupported.js';
import { policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { readAcceptedCableApply, revisionResultHash } from './revisionResultRepository.js';
import { buildManualRoutingSource, manualRoutingSourceSchema, validateManualRoutingResult } from './manualRoutingValidation.js';
import { routeObstacleRemarks } from './obstacleRemarks.js';
import { PathFinderError } from './errors.js';
import { engineResponseSchema } from './jobContracts.js';
import type { ManualRoutingDependencies } from './manualRoutingContracts.js';

type Row = Record<string, any>;
const object = (value: unknown): Row | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
const managedLine = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const lines = value.replace(/\r\n/g, '\n').match(/^\[PathFinder obstacles\] [^\r\n]*$/gm);
  return lines?.length === 1 ? lines[0] : null;
};
export type CableObstacleLinksAdapters = { accepted?: typeof readAcceptedCableApply };

/** Caller owns ordinary project read authorization and a coherent read-only
 * transaction. Stored Remarks never become object IDs without immutable saved
 * calculation evidence; newer unsaved calculations are deliberately ignored. */
export async function readCableObstacleLinks(client: PoolClient, projectId: string, cableId: string,
  adapters: CableObstacleLinksAdapters = {}): Promise<CableObstacleLinks> {
  policyUuidSchema.parse(projectId); policyUuidSchema.parse(cableId);
  const cable = (await client.query<Row>(`/* cable-obstacles:cable */ SELECT b.id,b.project_id,b.routing,b.remarks,b.cable_write_revision::text,
    c.manual_protected AND c.manual_routing=b.routing AS used_manual
    FROM cables b LEFT JOIN pf_cable_routing_controls c ON c.project_id=b.project_id AND c.cable_id=b.id
    WHERE b.project_id=$1 AND b.id=$2`, [projectId, cableId])).rows[0];
  if (!cable) throw new PathFinderError('CABLE_NOT_FOUND', 404, 'Cable not found.');
  const base = { schemaVersion: 'wfc.pf.cable-obstacle-links.v1' as const, projectId, cableId,
    cableWriteRevision: policyRevisionSchema.parse(cable.cable_write_revision), remarks: cable.remarks ?? null };
  const unavailable = (status: 'none' | 'unverified') => cableObstacleLinksSchema.parse({ ...base, status, source: null, scope: null, obstacles: [] });
  if (typeof cable.remarks !== 'string' || !/^\[PathFinder obstacles\] /m.test(cable.remarks)) return unavailable('none');
  if (!managedLine(cable.remarks) || typeof cable.routing !== 'string') return unavailable('unverified');
  const resolve = (raw: unknown, source: NonNullable<CableObstacleLinks['source']>): CableObstacleLinks | null => {
    const result = object(raw);
    if (!result || result.status !== 'calculated' || result.route?.success !== true || result.route.routeText !== cable.routing) return null;
    const execution = supportedBarrierExecutionSchema.safeParse(result.barriers);
    if (!execution.success || execution.data.context.binding.scope.projectId !== projectId) return null;
    const report = execution.data.obstacleReport;
    if (!report?.crossedParentSelectionIds.length || managedLine(routeObstacleRemarks(null, result)) !== managedLine(cable.remarks)) return null;
    const ids = new Set(report.crossedParentSelectionIds);
    return cableObstacleLinksSchema.parse({ ...base, status: 'recorded', source, scope: execution.data.context.binding.scope,
      obstacles: report.selectedParents.filter(parent => ids.has(parent.selectionId)).map(({ selectionId, dbId, name, kind }) => ({ selectionId, dbId, name, kind })) });
  };
  // The current used protected manual revision can have later comparison-only
  // rechecks. Search a small immutable history for its actual successful write.
  const manual = cable.used_manual ? (await client.query<Row>(`/* cable-obstacles:manual */ SELECT r.id,r.manual_revision::text,r.record_sha256,r.projection,r.projection_sha256,
    CASE WHEN octet_length(r.record::text)<=4194304 THEN r.record ELSE NULL END AS record
    FROM pf_manual_route_results r JOIN pf_cable_routing_controls c ON c.project_id=r.project_id AND c.cable_id=r.cable_id
    WHERE r.project_id=$1 AND r.cable_id=$2 AND c.manual_protected AND c.manual_routing=$3 AND r.manual_revision=c.manual_revision
    ORDER BY r.created_at DESC,r.id DESC LIMIT 8`, [projectId, cableId, cable.routing])).rows : [];
  for (const row of manual) {
    try {
      const record = object(row.record);
      if (!record || revisionResultHash(record) !== row.record_sha256 || record.id !== row.id || record.projectId !== projectId || record.cableId !== cableId
        || record.schemaVersion !== 'pathfinder.manual-route.result.v1' || record.designWrite?.status !== 'written'
        || record.manualRevision !== row.manual_revision
        || !policyRevisionSchema.safeParse(record.designWrite.afterCableWriteRevision).success
        || !policyRevisionSchema.safeParse(record.designWrite.beforeCableWriteRevision).success
        || BigInt(record.designWrite.afterCableWriteRevision) !== BigInt(record.designWrite.beforeCableWriteRevision) + 1n
        || BigInt(record.designWrite.afterCableWriteRevision) > BigInt(base.cableWriteRevision)
        || revisionResultHash(record.dependencies) !== record.inputSha256) continue;
      const projection = manualRoutingSourceSchema.parse(row.projection);
      if (revisionResultHash(projection) !== row.projection_sha256
        || revisionResultHash(buildManualRoutingSource(record, row.record_sha256)) !== row.projection_sha256) continue;
      const dependencies = record.dependencies as ManualRoutingDependencies;
      if (dependencies.protected.projectId !== projectId || dependencies.protected.cableId !== cableId
        || dependencies.manualRevision !== record.manualRevision || dependencies.protected.cableWriteRevision !== record.designWrite.beforeCableWriteRevision) continue;
      const response = engineResponseSchema.parse(record.response);
      if (validateManualRoutingResult(response, dependencies, response.requestId) !== record.lengthMetres) continue;
      const history = record.designWrite.history;
      if (!policyUuidSchema.safeParse(history?.id).success || !policyRevisionSchema.safeParse(String(history?.versionNumber)).success) continue;
      const written = (await client.query<Row>(`/* cable-obstacles:manual-history */ SELECT routing,remarks FROM cable_versions
        WHERE cable_id=$1 AND id=$2 AND version_number=$3 AND change_source='pathfinder'`, [cableId, history.id, history.versionNumber])).rows;
      if (written.length !== 1 || written[0].routing !== cable.routing || managedLine(written[0].remarks) !== managedLine(cable.remarks)) continue;
      const resolved = resolve(record.response, { kind: 'manual-result', id: row.id });
      if (resolved) return resolved;
    } catch { /* A failed or inconsistent historical record is not a link. */ }
  }
  if (cable.used_manual) return unavailable('unverified');
  const accepted = await (adapters.accepted ?? readAcceptedCableApply)(client, projectId, cableId);
  if (!accepted || accepted.afterRouting !== cable.routing || accepted.afterCableWriteRevision === null
    || BigInt(accepted.afterCableWriteRevision) > BigInt(base.cableWriteRevision)) return unavailable('unverified');
  const saved = (await client.query<Row>(`/* cable-obstacles:saved */ SELECT r.id,r.after_snapshot->>'remarks' AS remarks,
    CASE WHEN octet_length(p.result::text)<=4194304 THEN p.result ELSE NULL END AS result
    FROM pf_apply_receipts r JOIN pf_proposals p ON p.project_id=r.project_id AND p.cable_id=r.cable_id AND p.id=r.proposal_id
    WHERE r.project_id=$1 AND r.cable_id=$2 AND r.id=$3 AND p.id=$4`, [projectId, cableId, accepted.receiptId, accepted.proposalId])).rows[0];
  if (!saved || managedLine(saved.remarks) !== managedLine(cable.remarks) || !saved.result
    || revisionResultHash(saved.result) !== accepted.engineResultSha256) return unavailable('unverified');
  return resolve(saved.result, { kind: 'apply-receipt', id: accepted.receiptId, proposalId: accepted.proposalId }) ?? unavailable('unverified');
}
