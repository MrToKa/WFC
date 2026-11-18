import type { PoolClient } from 'pg';
import { automaticRoutingWriteAllowed, emptyRoutingControl } from '../../shared/cableRoutingControl.js';
import { isPathFinderCableEligible } from '../../shared/pathfinderCableEligibility.js';
import { canonicalDecimalString } from '../../shared/pathfinderLengthLedger.js';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';
import { cableExecutionFacts } from './cableRoutingControlRepository.js';
import { PathFinderError } from './errors.js';

type Cable = { id: string; mto: string | null; routing: string | null; design_length: string | null };
type ScopeRow = {
  id: string; has_control: boolean; manual_protected: boolean; execution_locked: boolean;
  pull_date: string | null; connected_from: string | null; connected_to: string | null;
  tested: string | null; install_length: string | null;
  receipt_kind: string | null; saved_design_length: string | null; calculated_design_length: string | null;
};
type Exclusion = { status: string; message: string };

function matchingLength(value: string | null, saved: string | null, calculated: string | null) {
  if (value === null || saved === null || calculated === null) return false;
  try {
    const expected = canonicalDecimalString(value);
    return expected === canonicalDecimalString(saved) && expected === canonicalDecimalString(calculated);
  } catch {
    return false;
  }
}

/** The caller holds the sorted cable locks. An immutable receipt and its sealed
 * calculated result establish an existing Path Finder value without requiring
 * old calculation inputs to still be current. The writer rechecks its own authority. */
export async function readContinuousCableExclusions(client: PoolClient, projectId: string, cables: readonly Cable[], check: () => void) {
  const excluded = new Map<string, Exclusion>();
  for (let offset = 0; offset < cables.length; offset += RECALCULATION_LIMITS.cableChunk) {
    check();
    const chunk = cables.slice(offset, offset + RECALCULATION_LIMITS.cableChunk);
    const rows = (await client.query<ScopeRow>(`/* continuous-cable-scope */ SELECT c.id,ctrl.cable_id IS NOT NULL AS has_control,
      COALESCE(ctrl.manual_protected,false) AS manual_protected,COALESCE(ctrl.execution_locked,false) AS execution_locked,
      c.pull_date,c.connected_from,c.connected_to,c.tested,c.install_length::text,
      receipt.provenance->>'schemaVersion' AS receipt_kind,
      LEFT(receipt.after_snapshot->>'design_length',128) AS saved_design_length,
      LEFT(p.result#>>'{design,designLengthMeters}',128) AS calculated_design_length
      FROM cables c
      LEFT JOIN pf_cable_routing_controls ctrl ON ctrl.project_id=c.project_id AND ctrl.cable_id=c.id
      LEFT JOIN LATERAL (
        SELECT r.proposal_id,r.provenance,r.after_snapshot,r.applied_at FROM pf_apply_receipts r
        WHERE r.project_id=c.project_id AND r.cable_id=c.id AND c.mto IS DISTINCT FROM 'MV'
          AND NOT COALESCE(ctrl.manual_protected,false) AND NOT COALESCE(ctrl.execution_locked,false)
          AND NULLIF(btrim(c.routing),'') IS NOT NULL
        ORDER BY r.applied_at DESC,r.id DESC LIMIT 1
      ) latest ON true
      LEFT JOIN pf_proposals p ON p.project_id=c.project_id AND p.cable_id=c.id AND p.id=latest.proposal_id
        AND p.status='calculated' AND p.result#>>'{route,routeText}'=c.routing AND p.result#>'{route,success}'='true'::jsonb
      LEFT JOIN pf_revision_results s ON s.project_id=c.project_id AND s.cable_id=c.id AND s.proposal_id=p.id
        AND s.record_sha256=latest.provenance#>>'{revisionResult,revisionResultSha256}'
        AND s.dependency_sha256=p.dependency_hash AND s.ledger_sha256 IS NOT NULL
        AND s.record#>>'{summary,routeText}'=c.routing
      LEFT JOIN LATERAL (
        SELECT latest.provenance,latest.after_snapshot WHERE s.proposal_id IS NOT NULL
          AND latest.after_snapshot->>'id'=c.id::text AND latest.after_snapshot->>'project_id'=c.project_id::text
          AND latest.after_snapshot->>'routing'=c.routing
          AND (ctrl.manual_routing IS DISTINCT FROM c.routing OR latest.applied_at>=ctrl.updated_at)
          AND octet_length(latest.after_snapshot->>'design_length')<=128
          AND octet_length(p.result#>>'{design,designLengthMeters}')<=128
      ) receipt ON true
      WHERE c.project_id=$1 AND c.id=ANY($2::uuid[]) ORDER BY c.id`, [projectId, chunk.map(cable => cable.id)])).rows;
    check();
    if (rows.length !== chunk.length || rows.some((row, i) => row.id !== chunk[i].id))
      throw new PathFinderError('RECALCULATION_CABLE_INTEGRITY', 409);
    for (const [i, cable] of chunk.entries()) {
      const row = rows[i];
      if (!isPathFinderCableEligible(cable.mto)) {
        excluded.set(cable.id, { status: 'category_required', message: 'MV cables are excluded from Path Finder calculations.' });
        continue;
      }
      const control = { ...emptyRoutingControl(), manualProtected: row.manual_protected, executionLocked: row.execution_locked };
      if (!automaticRoutingWriteAllowed(control, cableExecutionFacts(row))) {
        excluded.set(cable.id, { status: 'routing_protected', message: 'This cable has a protected manual or execution route.' });
        continue;
      }
      if (!cable.routing?.trim()) continue;
      const fromPathFinder = row.receipt_kind === 'pathfinder.automatic-pair.v1'
        || row.receipt_kind === 'pathfinder.initial-fill.v1' || row.receipt_kind === 'pathfinder.initial-fill.v2'
        || row.has_control && row.receipt_kind === 'pathfinder.apply.v3';
      if (!fromPathFinder || !matchingLength(cable.design_length, row.saved_design_length, row.calculated_design_length))
        excluded.set(cable.id, { status: 'automatic_route_out_of_scope', message: 'The existing route is not a verified Path Finder route.' });
    }
  }
  return excluded;
}
