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
        id,
        project_number,
        name,
        customer,
        manager,
        description,
        secondary_tray_length,
        created_at,
        updated_at
      FROM projects
      WHERE id = $1;
    `,
    [projectId]
  );

  return result.rows[0] ?? null;
};
