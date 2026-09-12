import { pool } from '../db.js';
import type { PoolClient } from 'pg';
import type { ProjectRow } from '../models/project.js';

export const ensureProjectExists = async (
  projectId: string,
  database: Pick<PoolClient, 'query'> = pool,
): Promise<ProjectRow | null> => {
  if (!projectId) {
    return null;
  }

  const result = await database.query<ProjectRow>(
    `
      SELECT
        p.id,
        COALESCE((SELECT revision FROM mutation_revisions mr WHERE mr.resource_type = 'project-materials' AND mr.resource_id = p.id), 0) AS mutation_revision,
        p.project_number,
        p.name,
        p.customer,
        p.manager,
        p.description,
        p.secondary_tray_length,
        p.support_distance,
        p.support_weight,
        p.tray_load_safety_factor,
        p.cable_layout_settings,
        COALESCE(
          (
            SELECT jsonb_object_agg(
              d.tray_type,
              jsonb_build_object(
                'distance', d.support_distance,
                'supportId', COALESCE(d.support_snapshot->'material'->>'id', d.support_id::text),
                'supportType', d.support_snapshot->'material'->>'type',
                'supportSnapshot', d.support_snapshot->'material'
              )
            )
            FROM project_support_distances d
            WHERE d.project_id = p.id
          ),
          '{}'::jsonb
        ) AS support_distances,
        COALESCE(
          (
            SELECT jsonb_object_agg(
              t.tray_purpose,
              jsonb_build_object(
                'fileId', t.project_file_id,
                'fileName', f.file_name,
                'contentType', f.content_type
              )
            )
            FROM project_tray_purpose_templates t
            LEFT JOIN project_files f ON f.id = t.project_file_id
            WHERE t.project_id = p.id
          ),
          '{}'::jsonb
        ) AS tray_purpose_templates,
        p.created_at,
        p.updated_at
      FROM projects p
      WHERE p.id = $1;
    `,
    [projectId],
  );

  return result.rows[0] ?? null;
};
