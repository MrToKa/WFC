import type { Pool } from 'pg';
import { markRecalculationDirty } from '../pathfinder/recalculationSchema.js';

export const CAD_CONNECTIVITY_POLICY = 'wfc.cad.automatic-connection-gap.v3';
/** Adopt the current view once, before workers start. Published JSON, receipts,
 * enabled state and finite authority remain unchanged. Marker and event commit together. */
export async function initializeCadAutomaticConnectivity(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let committing = false,
    discard = false;
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('wfc-cad-automatic-connectivity-v3'))",
    );
    const changed = await client.query<{ project_id: string }>(
      `UPDATE pf_recalculation_state s SET cad_connectivity_policy=$1
      WHERE s.cad_connectivity_policy IS DISTINCT FROM $1 AND EXISTS(
        SELECT 1 FROM cad_route_groups g WHERE g.project_id=s.project_id AND g.status='published') RETURNING s.project_id`,
      [CAD_CONNECTIVITY_POLICY],
    );
    for (const { project_id: projectId } of changed.rows.sort((a, b) =>
      a.project_id.localeCompare(b.project_id),
    ))
      await markRecalculationDirty(client, {
        projectId,
        domain: 'geometry',
        reason: 'CAD_CONNECTIVITY_POLICY_CHANGED',
        sourceRevision: CAD_CONNECTIVITY_POLICY,
      });
    committing = true;
    await client.query('COMMIT');
  } catch (error) {
    discard = committing;
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard ? true : undefined);
  }
}
