import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

/** The caller owns the transaction. Delete storage objects only after commit. */
export const removeTemplateMetadata = async (
  client: Queryable, templateId: string, versionId?: string,
): Promise<string[] | null> => {
  // Capture uses this same lock before reading a template object key, so a
  // concurrent first project capture cannot lose its image during deletion.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc:project-snapshot-images'))");
  const file = versionId
    ? await client.query<{ object_key: string }>(
      'SELECT object_key FROM template_file_versions WHERE template_id = $1 AND id = $2 FOR UPDATE', [templateId, versionId])
    : await client.query<{ object_key: string }>(
      'SELECT object_key FROM template_files WHERE id = $1 FOR UPDATE', [templateId]);
  if (!file.rows.length) return null;
  const versions = versionId ? [] : (await client.query<{ object_key: string }>(
    'SELECT object_key FROM template_file_versions WHERE template_id = $1 FOR UPDATE', [templateId])).rows;
  const removable: string[] = [];
  for (const key of new Set([...file.rows, ...versions].map((row) => row.object_key))) {
    const references = await client.query<{ retained: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM trays WHERE material_snapshot->>'imageObjectKey' = $1
        UNION ALL
        SELECT 1 FROM project_support_distances WHERE support_snapshot->>'imageObjectKey' = $1
        UNION ALL
        SELECT 1 FROM mutation_history WHERE jsonb_path_exists(snapshot,
          '$.**.imageObjectKey ? (@ == $key)', jsonb_build_object('key', $1::text))
      ) AS retained`, [key]);
    if (!references.rows[0]?.retained) removable.push(key);
  }
  if (versionId) await client.query(
    'DELETE FROM template_file_versions WHERE template_id = $1 AND id = $2', [templateId, versionId]);
  else await client.query('DELETE FROM template_files WHERE id = $1', [templateId]);
  return removable;
};
