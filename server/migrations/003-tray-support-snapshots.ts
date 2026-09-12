import type { PoolClient } from 'pg';

export const applyTraySupportSnapshots = async (client: Pick<PoolClient, 'query'>): Promise<void> => {
  // Existing physical values remain unchanged. Today's catalog cannot supply a
  // trustworthy historical snapshot for a legacy project, so no backfill runs.
  await client.query(`
    ALTER TABLE trays ADD COLUMN material_snapshot JSONB;
    ALTER TABLE project_support_distances ADD COLUMN support_snapshot JSONB;
  `);
};
