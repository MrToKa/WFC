import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { pool as databasePool } from '../db.js';
import { materialAuditActor } from './materialAuditContext.js';

// Scope actor metadata to the transaction so a pooled connection cannot leak identity.
const setActor = (client: PoolClient, userId: string) =>
  client.query("SELECT set_config('wfc.material_actor', $1, true)", [userId]);

export const createMaterialAuditPool = (base: Pick<Pool, 'query' | 'connect'>) => ({
  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    const actor = materialAuditActor.getStore();
    if (!actor || /^\s*SELECT\b/i.test(sql)) {
      return values === undefined ? base.query<T>(sql) : base.query<T>(sql, values);
    }
    const client = await base.connect();
    try {
      await client.query('BEGIN');
      await setActor(client, actor);
      const result = await client.query<T>(sql, values);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
  async connect(): Promise<PoolClient> {
    const client = await base.connect();
    const actor = materialAuditActor.getStore();
    if (!actor) return client;
    // Existing import and composition services own BEGIN/COMMIT/ROLLBACK.
    return new Proxy(client, {
      get(target, property) {
        if (property === 'query') {
          return async (sql: string, values?: unknown[]) => {
            const result = await target.query(sql, values);
            if (/^\s*BEGIN\s*;?\s*$/i.test(sql)) await setActor(target, actor);
            return result;
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  },
});

export const materialAuditPool = createMaterialAuditPool(databasePool);

export const withMaterialTransaction = async <T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await materialAuditPool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};
