import { pool } from '../db.js';
import type { ProjectRow } from '../models/project.js';

export const ensureProjectExists = async (
  projectId: string
): Promise<ProjectRow | null> => {
  if (!projectId) {
    return null;
  }

  const result = await pool.query<ProjectRow>(
    `
      SELECT
        p.id,
        p.project_number,
        p.name,
        p.customer,
        p.manager,
        p.description,
        p.secondary_tray_length,
        p.support_distance,
        p.support_weight,
        p.tray_load_safety_factor,
        COALESCE(
          (
            SELECT jsonb_object_agg(
              d.tray_type,
              jsonb_build_object(
                'distance', d.support_distance,
                'supportId', d.support_id,
                'supportType', s.support_type
              )
            )
            FROM project_support_distances d
            LEFT JOIN material_supports s ON s.id = d.support_id
            WHERE d.project_id = p.id
          ),
          '{}'::jsonb
        ) AS support_distances,
        p.created_at,
        p.updated_at
      FROM projects p
      WHERE p.id = $1;
    `,
    [projectId]
  );

  return result.rows[0] ?? null;
};
