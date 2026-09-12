import type { PoolClient } from 'pg';

export type Queryable = Pick<PoolClient, 'query'>;
export type SchemaShape = {
  columns: { table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string }[];
  constraints: { table_name: string; constraint_type: string; definition: string }[];
};

export const inspectSchema = async (client: Queryable): Promise<SchemaShape> => {
  const columns = await client.query<SchemaShape['columns'][number]>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name NOT LIKE 'wfc_schema_%'
    ORDER BY table_name, ordinal_position
  `);
  const constraints = await client.query<SchemaShape['constraints'][number]>(`
    SELECT c.relname AS table_name, k.contype::text AS constraint_type,
           pg_get_constraintdef(k.oid, true) AS definition
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname NOT LIKE 'wfc_schema_%'
    ORDER BY c.relname, k.contype, pg_get_constraintdef(k.oid, true)
  `);
  return { columns: columns.rows, constraints: constraints.rows };
};

export const assertBaselineShape = (expected: SchemaShape, actual: SchemaShape): void => {
  const columns = new Map(actual.columns.map((column) => [`${column.table_name}.${column.column_name}`, column]));
  const problems: string[] = [];
  for (const column of expected.columns) {
    const key = `${column.table_name}.${column.column_name}`;
    const found = columns.get(key);
    if (!found || found.data_type !== column.data_type || found.udt_name !== column.udt_name || found.is_nullable !== column.is_nullable) {
      problems.push(key);
    }
  }
  const constraints = new Set(actual.constraints.map((item) => JSON.stringify(item)));
  for (const constraint of expected.constraints) {
    if (!constraints.has(JSON.stringify(constraint))) problems.push(`${constraint.table_name} constraint ${constraint.definition}`);
  }
  if (problems.length > 0) {
    throw new Error(`Existing database cannot adopt baseline; schema differs: ${problems.slice(0, 12).join('; ')}. Restore/test an explicit upgrade; the legacy initializer will not run.`);
  }
};
