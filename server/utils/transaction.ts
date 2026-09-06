import type { PoolClient } from 'pg';
import { pool } from '../db.js';

export const withTransaction = async <T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to roll back transaction', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
};
