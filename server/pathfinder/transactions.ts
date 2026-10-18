import type { Pool, PoolClient } from 'pg';

export async function transaction<T>(pool:Pool,operation:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await pool.connect();
  try {await client.query('BEGIN');const value=await operation(client);await client.query('COMMIT');return value;}
  catch(error) {await client.query('ROLLBACK').catch(()=>undefined);throw error;} finally {client.release();}
}
