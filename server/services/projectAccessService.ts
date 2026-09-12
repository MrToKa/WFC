import { withTransaction } from '../utils/transaction.js';
import { MutationError } from './mutationService.js';

export const replaceEngineerProjects = async (userId: string, projectIds: string[], actorId: string) =>
  withTransaction(async (client) => {
    const user = await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    if (!user.rows[0]) throw new MutationError(404, 'USER_NOT_FOUND', 'User not found');
    const projects = await client.query('SELECT id FROM projects WHERE id=ANY($1::uuid[]) FOR KEY SHARE', [projectIds]);
    if (projects.rows.length !== projectIds.length) throw new MutationError(400, 'PROJECT_NOT_FOUND', 'One or more projects no longer exist. Reload the project list.');
    await client.query('DELETE FROM project_engineers WHERE user_id=$1 AND NOT(project_id=ANY($2::uuid[]))', [userId, projectIds]);
    await client.query(`INSERT INTO project_engineers(project_id,user_id,assigned_by)
      SELECT unnest($1::uuid[]), $2::uuid, $3::uuid ON CONFLICT DO NOTHING`, [projectIds, userId, actorId]);
    return { engineerProjectIds: projectIds };
  });
