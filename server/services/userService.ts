import type { z } from 'zod';
import { hashPassword } from '../auth.js';
import { pool } from '../db.js';
import type { UserRow } from '../models/user.js';
import type { updateProfileSchema } from '../validators.js';

export const updateUserProfile = async (
  userId: string,
  updates: z.infer<typeof updateProfileSchema>,
): Promise<UserRow | null> => {
  const fields: string[] = [];
  const values: string[] = [];
  const addField = (column: string, value: string) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  if (updates.email !== undefined) addField('email', updates.email.toLowerCase());
  if (updates.firstName !== undefined) addField('first_name', updates.firstName);
  if (updates.lastName !== undefined) addField('last_name', updates.lastName);
  if (updates.password !== undefined) {
    addField('password_hash', await hashPassword(updates.password));
  }
  fields.push('updated_at = NOW()');
  values.push(userId);

  const result = await pool.query<UserRow>(
    `UPDATE users
     SET ${fields.join(', ')}
     WHERE id = $${values.length}
     RETURNING id, email, password_hash, first_name, last_name, is_admin, ARRAY(SELECT pe.project_id FROM project_engineers pe WHERE pe.user_id=users.id ORDER BY pe.project_id) AS engineer_project_ids, created_at, updated_at`,
    values,
  );
  return result.rows[0] ?? null;
};
