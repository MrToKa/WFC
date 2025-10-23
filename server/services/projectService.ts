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
        COALESCE(
          (
            SELECT jsonb_object_agg(d.tray_type, d.support_distance)
            FROM project_support_distances d
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
