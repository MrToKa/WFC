import type { PoolClient } from 'pg';
import { MutationError } from './mutationService.js';
import {
  mapMaterialTrayRow,
  type MaterialTrayRow,
  type PublicMaterialTray,
} from '../models/materialTray.js';
import {
  mapMaterialSupportRow,
  type MaterialSupportRow,
  type PublicMaterialSupport,
} from '../models/materialSupport.js';
import {
  mapMaterialLoadCurveRow,
  mapMaterialLoadCurvePointRow,
  type MaterialLoadCurveRow,
  type MaterialLoadCurvePointRow,
  type PublicMaterialLoadCurve,
} from '../models/materialLoadCurve.js';

export type TrayMaterialSnapshot = {
  schemaVersion: 1;
  capturedAt: string;
  material: PublicMaterialTray;
  loadCurve: PublicMaterialLoadCurve | null;
  imageObjectKey: string | null;
};

export type SupportMaterialSnapshot = {
  schemaVersion: 1;
  capturedAt: string;
  material: PublicMaterialSupport;
  imageObjectKey: string | null;
};

/** Capture only on a new, explicit assignment, never while reading legacy project rows. */
export const captureTrayMaterialSnapshot = async (
  client: PoolClient,
  trayType: string | null,
): Promise<TrayMaterialSnapshot | null> => {
  if (!trayType) return null;
  // Template deletion uses this same transaction lock before retiring stored objects.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc:project-snapshot-images'))");
  const result = await client.query<
    MaterialTrayRow & {
      image_object_key: string | null;
      obsolete_at?: string | null;
      curve: MaterialLoadCurveRow | null;
      points: MaterialLoadCurvePointRow[];
    }
  >(
    `SELECT mt.*, tf.file_name AS image_template_file_name,
      tf.content_type AS image_template_content_type, tf.object_key AS image_object_key,
      lc.name AS load_curve_name, to_jsonb(lc) AS curve,
      COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.point_order, p.id)
        FROM material_load_curve_points p WHERE p.load_curve_id = lc.id), '[]'::jsonb) AS points
    FROM material_trays mt
    LEFT JOIN template_files tf ON tf.id = mt.image_template_id
    LEFT JOIN material_load_curves lc ON lc.id = mt.load_curve_id
    WHERE lower(mt.tray_type) = lower($1) LIMIT 2`,
    [trayType],
  );
  // A missing/ambiguous name is explicitly unknown, not an inferred historical identity.
  if (result.rows.length !== 1) return null;
  const row = result.rows[0];
  if (row.obsolete_at) throw new MutationError(409, 'MATERIAL_OBSOLETE', 'This tray is obsolete and cannot be newly assigned. Existing project values are preserved.');
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    material: mapMaterialTrayRow(row),
    loadCurve: row.curve
      ? mapMaterialLoadCurveRow(row.curve, row.points.map(mapMaterialLoadCurvePointRow))
      : null,
    imageObjectKey: row.image_object_key ?? null,
  };
};

export const captureSupportMaterialSnapshot = async (
  client: PoolClient,
  supportId: string | null,
): Promise<SupportMaterialSnapshot | null> => {
  if (!supportId) return null;
  await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc:project-snapshot-images'))");
  const result = await client.query<MaterialSupportRow & { image_object_key: string | null; obsolete_at?: string | null }>(
    `SELECT ms.*, tf.file_name AS image_template_file_name,
      tf.content_type AS image_template_content_type, tf.object_key AS image_object_key
     FROM material_supports ms LEFT JOIN template_files tf ON tf.id = ms.image_template_id
     WHERE ms.id = $1`,
    [supportId],
  );
  const row = result.rows[0];
  if (row?.obsolete_at) throw new MutationError(409, 'MATERIAL_OBSOLETE', 'This support is obsolete and cannot be newly assigned. Existing project values are preserved.');
  return row
    ? {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        material: mapMaterialSupportRow(row),
        imageObjectKey: row.image_object_key ?? null,
      }
    : null;
};

export const sameTraySelection = (left: string | null, right: string | null): boolean =>
  (left?.trim().toLowerCase() ?? '') === (right?.trim().toLowerCase() ?? '');

export const syncProjectSupportSnapshots = async (
  client: PoolClient,
  projectId: string,
  overrides: Record<string, { distance: number | null; supportId: string | null }>,
): Promise<void> => {
  const existing = await client.query<{
    tray_type: string;
    support_id: string | null;
    support_snapshot: SupportMaterialSnapshot | null;
  }>(
    'SELECT tray_type, support_id, support_snapshot FROM project_support_distances WHERE project_id = $1 FOR UPDATE',
    [projectId],
  );
  const previous = new Map(existing.rows.map((row) => [row.tray_type, row]));
  const entries = Object.entries(overrides)
    .map(([name, value]) => [name.trim(), value] as const)
    .filter(
      ([name, value]) => name !== '' && (value.distance !== null || value.supportId !== null),
    );
  await client.query(
    'DELETE FROM project_support_distances WHERE project_id = $1 AND NOT (tray_type = ANY($2::text[]))',
    [projectId, entries.map(([name]) => name)],
  );
  for (const [trayType, value] of entries) {
    const old = previous.get(trayType);
    // Snapshot identity survives an ON DELETE SET NULL catalog foreign key.
    const unchanged =
      old && (old.support_snapshot?.material.id ?? old.support_id) === value.supportId;
    const snapshot = unchanged
      ? old.support_snapshot
      : await captureSupportMaterialSnapshot(client, value.supportId);
    await client.query(
      `INSERT INTO project_support_distances
      (project_id, tray_type, support_distance, support_id, support_snapshot, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
      ON CONFLICT (project_id,tray_type) DO UPDATE SET
        support_distance=EXCLUDED.support_distance, support_id=EXCLUDED.support_id,
        support_snapshot=EXCLUDED.support_snapshot, updated_at=NOW()`,
      [projectId, trayType, value.distance, unchanged ? old.support_id : value.supportId, snapshot],
    );
  }
};
