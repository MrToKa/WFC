import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';

export const LOSSLESS_INVENTORY_LIMITS = Object.freeze({ tables: 500, rowsPerTable: 1_000_000, totalRows: 2_000_000,
  rowBytes: 32 * 1024 ** 2, keyBytes: 16 * 1024, tableRawBytes: 256 * 1024 ** 2, totalRawBytes: 512 * 1024 ** 2,
  outputBytes: 1024 * 1024 ** 2, schemaBytes: 1024 * 1024, totalSchemaBytes: 8 * 1024 ** 2,
  batchRows: 128, milliseconds: 120_000, acquireMilliseconds: 5_000 });
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const FENCE_COLUMNS = { viewer_login_bindings: ['revoked_at'], viewer_resource_sessions: ['revoked_at', 'revoke_reason'],
  pf_installation_state: ['installation_epoch', 'updated_at'] } as const;
type FenceTable = keyof typeof FENCE_COLUMNS;
export type LosslessColumn = { name: string; type: string; notNull: boolean; defaultSql: string | null; collation: string | null; identity: string; generated: string };
export type LosslessDefinitions = { constraints: { name: string; definition: string; validated: boolean }[];
  indexes: { name: string; definition: string; valid: boolean; ready: boolean }[];
  triggers: { name: string; definition: string; enabled: string }[];
  rls: { enabled: boolean; forced: boolean; policies: { name: string; command: string; roles: string[]; permissive: boolean; usingSql: string | null; withCheckSql: string | null }[] } };
export type LosslessTableMetadata = { table: string; columns: LosslessColumn[]; primaryKey: string[];
  keyMode: 'primary-key' | 'row-multiset'; definitions: LosslessDefinitions };
export type LosslessInventoryRow = { key: string | null; rowText: string; protectedText?: string;
  mutable?: { revokedAt: string | null; revokeReason?: string | null } | { installationEpoch: string; updatedAt: string } };
export type LosslessInventoryTable = LosslessTableMetadata & { rows: string; rawBytes: string; schemaSha256: string;
  rowSha256: string; keySetSha256: string | null; file: { path: string; bytes: string; sha256: string };
  fencing: null | { columns: readonly string[]; protectedSha256: string } };
export type LosslessInventoryManifest = { schemaVersion: 'wfc.operations.lossless-inventory.v1'; status: 'PASS'; scope: 'public';
  projection: 'postgresql-jsonb-text.v1'; ownerId: string; inventoryId: string;
  database: { name: string; encoding: string; serverVersionNum: string }; tables: LosslessInventoryTable[];
  catalogSha256: string; contentSha256: string };
export type LosslessInventoryLimits = { [Key in keyof typeof LOSSLESS_INVENTORY_LIMITS]: number };
export type LosslessInventoryOptions = { allowedRoot: string; directory: string; ownerId: string; inventoryId?: string;
  signal?: AbortSignal; limits?: Partial<LosslessInventoryLimits> };
const fail = (code: string): never => { throw Object.assign(Error(code), { code }); };
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, names: readonly string[]): value is Record<string, unknown> => plain(value) && Object.keys(value).sort().join('\0') === [...names].sort().join('\0');
const text = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0') && Buffer.byteLength(value) <= LOSSLESS_INVENTORY_LIMITS.schemaBytes;
const nullableText = (value: unknown) => value === null || text(value);
const identifier = (value: unknown): value is string => text(value) && value.length > 0 && Buffer.byteLength(value) <= 63;
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const order = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
export const losslessCanonicalJson = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(losslessCanonicalJson).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + losslessCanonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
export const losslessMetadataHash = (value: unknown) => createHash('sha256').update(losslessCanonicalJson(value)).digest('hex');
function frame(hash: ReturnType<typeof createHash>, value: string) {
  const bytes = Buffer.from(value), size = Buffer.alloc(4); size.writeUInt32BE(bytes.length); hash.update(size); hash.update(bytes);
}
function count(value: unknown, maximum: number): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value) || value.length > 20 || BigInt(value) > BigInt(maximum)) return fail('LOSSLESS_INVENTORY_LIMIT');
  return Number(value); // Only already-bounded metadata, never a stored business value.
}
function sortedNamed(value: unknown, fields: readonly string[], validate: (value: Record<string, unknown>) => boolean): boolean {
  return Array.isArray(value) && value.length <= 10_000 && value.every((item, at) => exact(item, fields) && identifier(item.name) && validate(item)
    && (at === 0 || order(value[at - 1].name, item.name) < 0));
}
function metadata(table: string, raw: unknown): LosslessTableMetadata {
  if (!exact(raw, ['columns', 'primaryKey', 'definitions'])) return fail('LOSSLESS_INVENTORY_SCHEMA');
  const columns = raw.columns, primaryKey = raw.primaryKey;
  if (!Array.isArray(columns) || !columns.length || columns.length > 1600 ||
    !columns.every(column => exact(column, ['name', 'type', 'notNull', 'defaultSql', 'collation', 'identity', 'generated']) && identifier(column.name) && text(column.type)
      && typeof column.notNull === 'boolean' && nullableText(column.defaultSql) && nullableText(column.collation) && typeof column.identity === 'string' && ['', 'a', 'd'].includes(column.identity)
      && typeof column.generated === 'string' && ['', 's', 'v'].includes(column.generated)) || new Set(columns.map(column => column.name)).size !== columns.length ||
    !Array.isArray(primaryKey) || primaryKey.length > columns.length || primaryKey.some(key => !identifier(key) || !columns.some(column => column.name === key)) || new Set(primaryKey).size !== primaryKey.length)
    return fail('LOSSLESS_INVENTORY_SCHEMA');
  const definitions = raw.definitions;
  if (!exact(definitions, ['constraints', 'indexes', 'triggers', 'rls']) ||
    !sortedNamed(definitions.constraints, ['name', 'definition', 'validated'], item => text(item.definition) && typeof item.validated === 'boolean') ||
    !sortedNamed(definitions.indexes, ['name', 'definition', 'valid', 'ready'], item => text(item.definition) && typeof item.valid === 'boolean' && typeof item.ready === 'boolean') ||
    !sortedNamed(definitions.triggers, ['name', 'definition', 'enabled'], item => text(item.definition) && typeof item.enabled === 'string' && ['O', 'D', 'R', 'A'].includes(item.enabled)) ||
    !exact(definitions.rls, ['enabled', 'forced', 'policies']) || typeof definitions.rls.enabled !== 'boolean' || typeof definitions.rls.forced !== 'boolean' ||
    !sortedNamed(definitions.rls.policies, ['name', 'command', 'roles', 'permissive', 'usingSql', 'withCheckSql'], item => typeof item.command === 'string' && ['r', 'a', 'w', 'd', '*'].includes(item.command)
      && typeof item.permissive === 'boolean' && nullableText(item.usingSql) && nullableText(item.withCheckSql) && Array.isArray(item.roles) && item.roles.length <= 10000
      && item.roles.every((role, at) => identifier(role) && (at === 0 || order((item.roles as string[])[at - 1], role) < 0)))) return fail('LOSSLESS_INVENTORY_SCHEMA');
  return { table, columns: columns as LosslessColumn[], primaryKey: primaryKey as string[],
    keyMode: primaryKey.length ? 'primary-key' : 'row-multiset', definitions: definitions as LosslessDefinitions };
}
const TABLE_SCHEMA_SQL = `/* lossless:schema */ WITH facts AS (SELECT jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
   'notNull',a.attnotnull,'defaultSql',pg_get_expr(d.adbin,d.adrelid,true),'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE quote_ident(cn.nspname)||'.'||quote_ident(co.collname) END,
   'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_attribute a
   LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
   WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'primaryKey',COALESCE((SELECT jsonb_agg(a.attname ORDER BY k.position) FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,position)
   JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE i.indrelid=c.oid AND i.indisprimary AND k.position<=i.indnkeyatts),'[]'::jsonb),
 'definitions',jsonb_build_object(
   'constraints',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid,true),'validated',x.convalidated) ORDER BY x.conname COLLATE "C") FROM pg_constraint x WHERE x.conrelid=c.oid),'[]'::jsonb),
   'indexes',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready) ORDER BY ic.relname COLLATE "C") FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),'[]'::jsonb),
   'triggers',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled) ORDER BY t.tgname COLLATE "C") FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),'[]'::jsonb),
   'rls',jsonb_build_object('enabled',c.relrowsecurity,'forced',c.relforcerowsecurity,'policies',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,
     'roles',(SELECT jsonb_agg(role_name ORDER BY role_name COLLATE "C") FROM (SELECT CASE WHEN role_id=0 THEN 'public' ELSE pg_get_userbyid(role_id)::text END AS role_name FROM unnest(p.polroles) role_id) roles),
     'permissive',p.polpermissive,'usingSql',pg_get_expr(p.polqual,p.polrelid,true),'withCheckSql',pg_get_expr(p.polwithcheck,p.polrelid,true)) ORDER BY p.polname COLLATE "C") FROM pg_policy p WHERE p.polrelid=c.oid),'[]'::jsonb)))) AS metadata
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1)
 SELECT CASE WHEN octet_length(metadata::text)<=$2 THEN metadata ELSE NULL END AS metadata FROM facts`;

async function canonicalDirectory(value: string) {
  if (!path.isAbsolute(value) || path.resolve(value) !== value) return fail('LOSSLESS_DESTINATION');
  const parsed = path.parse(value); let current = parsed.root;
  for (const part of value.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return fail('LOSSLESS_DESTINATION');
  }
  if (path.resolve(await fs.realpath(value)) !== value) return fail('LOSSLESS_DESTINATION');
}
function rowValue(value: unknown, fence: FenceTable | null, hasPrimaryKey: boolean, rowLimit: number, keyLimit: number): LosslessInventoryRow {
  if (!exact(value, fence ? ['key', 'rowText', 'protectedText', 'mutable'] : ['key', 'rowText']) || typeof value.rowText !== 'string' || Buffer.byteLength(value.rowText) > rowLimit ||
    (hasPrimaryKey ? typeof value.key !== 'string' || !value.key || Buffer.byteLength(value.key) > keyLimit : value.key !== null)) return fail('LOSSLESS_INVENTORY_ROW');
  const row: LosslessInventoryRow = { key: value.key as string | null, rowText: value.rowText };
  if (fence) {
    if (typeof value.protectedText !== 'string' || Buffer.byteLength(value.protectedText) > rowLimit) return fail('LOSSLESS_INVENTORY_ROW');
    const mutable = value.mutable;
    if (fence === 'pf_installation_state') {
      if (!exact(mutable, ['installationEpoch', 'updatedAt']) || typeof mutable.installationEpoch !== 'string' || !UUID.test(mutable.installationEpoch) || typeof mutable.updatedAt !== 'string' || mutable.updatedAt.length > 64) return fail('LOSSLESS_INVENTORY_ROW');
    } else if (!exact(mutable, fence === 'viewer_resource_sessions' ? ['revokedAt', 'revokeReason'] : ['revokedAt']) ||
      mutable.revokedAt !== null && (typeof mutable.revokedAt !== 'string' || mutable.revokedAt.length > 64) ||
      fence === 'viewer_resource_sessions' && mutable.revokeReason !== null && (typeof mutable.revokeReason !== 'string' || mutable.revokeReason.length > 256)) return fail('LOSSLESS_INVENTORY_ROW');
    row.protectedText = value.protectedText; row.mutable = mutable as NonNullable<LosslessInventoryRow['mutable']>;
  }
  return row;
}

/** Cold caller pins the database/runtime and stops every writer. This helper
 * does not initialize schema, run a lifecycle hook, mutate rows or delete files.
 * Only table-level schema facts are inventoried; pg_dump qualifies global DDL.
 */
export async function captureLosslessInventory(pool: Pick<Pool, 'connect'>, options: LosslessInventoryOptions): Promise<LosslessInventoryManifest> {
  if (!UUID.test(options.ownerId) || options.inventoryId !== undefined && !UUID.test(options.inventoryId)) return fail('LOSSLESS_OWNER');
  const limits = { ...LOSSLESS_INVENTORY_LIMITS, ...options.limits };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) if (!Object.hasOwn(LOSSLESS_INVENTORY_LIMITS, key) || !Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > LOSSLESS_INVENTORY_LIMITS[key]) return fail('LOSSLESS_INVENTORY_LIMIT');
  const inventoryId = options.inventoryId ?? randomUUID(), controller = new AbortController();
  let terminal: unknown, client: PoolClient | undefined, released = false, transaction = false;
  const abort = (error: unknown) => { terminal ??= error; controller.abort(); if (client && !released) { released = true; client.release(true); } };
  const externalAbort = () => abort(options.signal?.reason ?? Object.assign(Error('LOSSLESS_INVENTORY_ABORTED'), { code: 'LOSSLESS_INVENTORY_ABORTED' }));
  const timer = setTimeout(() => abort(Object.assign(Error('LOSSLESS_INVENTORY_DEADLINE'), { code: 'LOSSLESS_INVENTORY_DEADLINE' })), limits.milliseconds);
  options.signal?.addEventListener('abort', externalAbort, { once: true }); if (options.signal?.aborted) externalAbort();
  const check = () => { if (terminal !== undefined) throw terminal; controller.signal.throwIfAborted(); };
  async function bounded<T>(work: Promise<T>): Promise<T> {
    try { check(); } catch (error) { void work.catch(() => undefined); throw error; }
    let listener: (() => void) | undefined;
    const stopped = new Promise<never>((_, reject) => { listener = () => reject(terminal ?? Error('LOSSLESS_INVENTORY_ABORTED')); controller.signal.addEventListener('abort', listener, { once: true }); });
    try { return await Promise.race([work, stopped]); } finally { if (listener) controller.signal.removeEventListener('abort', listener); }
  }
  let activeFile: Awaited<ReturnType<typeof fs.open>> | undefined;
  const openBounded = (filename: string, flags: string) => bounded(fs.open(filename, flags, 0o600).then(async handle => {
    if (controller.signal.aborted) { await handle.close(); throw terminal; } return handle;
  }));
  try {
    await bounded(canonicalDirectory(options.allowedRoot));
    if (!path.isAbsolute(options.directory) || path.resolve(options.directory) !== options.directory || path.dirname(options.directory) !== options.allowedRoot || path.basename(options.directory) === '.' || path.basename(options.directory) === '..') return fail('LOSSLESS_DESTINATION');
    await bounded(fs.mkdir(options.directory, { mode: 0o700 })); await bounded(canonicalDirectory(options.directory));
    const directoryIdentity = await bounded(fs.lstat(options.directory));
    const verifyDirectory = async () => { check(); const current = await bounded(fs.lstat(options.directory));
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== directoryIdentity.dev || current.ino !== directoryIdentity.ino || path.resolve(await bounded(fs.realpath(options.directory))) !== options.directory) fail('LOSSLESS_DESTINATION_CHANGED'); };
    const writeNew = async (name: string, value: unknown) => {
      await verifyDirectory(); const handle = await openBounded(path.join(options.directory, name), 'wx');
      try { await bounded(handle.writeFile(losslessCanonicalJson(value) + '\n')); await bounded(handle.sync()); } finally { await handle.close(); }
    };
    await writeNew('.owner.json', { schemaVersion: 'wfc.operations.lossless-owner.v1', ownerId: options.ownerId, inventoryId });
    let acquireTimer: ReturnType<typeof setTimeout> | undefined;
    const connection = pool.connect().then(value => { if (controller.signal.aborted) { value.release(true); throw terminal; } client = value; return value; });
    const acquireTimeout = new Promise<never>((_, reject) => { acquireTimer = setTimeout(() => { const error = Object.assign(Error('LOSSLESS_INVENTORY_ACQUIRE_TIMEOUT'), { code: 'LOSSLESS_INVENTORY_ACQUIRE_TIMEOUT' }); abort(error); reject(error); }, limits.acquireMilliseconds); });
    try { client = await bounded(Promise.race([connection, acquireTimeout])); } finally { clearTimeout(acquireTimer); }
    const query = async <T extends Record<string, unknown>>(sql: string, values?: unknown[]): Promise<T[]> => {
      check(); const response = await bounded(client!.query<T>(sql, values)); check(); return response.rows;
    };
    await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); transaction = true;
    await query(`SET LOCAL statement_timeout='${limits.milliseconds}ms';SET LOCAL lock_timeout='3000ms';SET LOCAL idle_in_transaction_session_timeout='${limits.milliseconds}ms';SET LOCAL timezone='UTC';SET LOCAL datestyle='ISO, YMD';SET LOCAL intervalstyle='postgres';SET LOCAL extra_float_digits=3;SET LOCAL search_path=pg_catalog,public;SET LOCAL row_security=off`);
    const identities = await query('/* lossless:identity */ SELECT current_database() AS name,current_setting(\'server_encoding\') AS encoding,current_setting(\'server_version_num\') AS "serverVersionNum",current_setting(\'transaction_read_only\') AS "readOnly"');
    const identity = identities[0];
    if (identities.length !== 1 || !text(identity.name) || !identity.name || identity.encoding !== 'UTF8' || typeof identity.serverVersionNum !== 'string' || !/^[1-9][0-9]{4,7}$/.test(identity.serverVersionNum) || identity.readOnly !== 'on') return fail('LOSSLESS_DATABASE_IDENTITY');
    const discovered = await query<{ table: string; kind: string }>(`/* lossless:tables */ SELECT c.relname AS table,c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','m','f') ORDER BY c.relname COLLATE "C" LIMIT ${limits.tables + 1}`);
    // Detect unsupported public partitions/materialized/foreign relations rather
    // than silently omit their storage or claim incomplete schema qualification.
    if (discovered.length > limits.tables || discovered.some((table, index) => !identifier(table.table) || table.kind !== 'r' || index > 0 && order(discovered[index - 1].table, table.table) >= 0)) return fail('LOSSLESS_INVENTORY_TABLES');
    const tables: LosslessInventoryTable[] = [], catalog: LosslessTableMetadata[] = [];
    let totalRows = 0, totalRawBytes = 0, totalOutputBytes = 0, totalSchemaBytes = 0;
    for (const [index, discoveredTable] of discovered.entries()) {
      const table = discoveredTable.table, facts = await query(TABLE_SCHEMA_SQL, [table, limits.schemaBytes]);
      if (facts.length !== 1 || facts[0].metadata === null) return fail('LOSSLESS_INVENTORY_SCHEMA');
      const meta = metadata(table, facts[0].metadata), schemaBytes = Buffer.byteLength(losslessCanonicalJson(meta));
      if (schemaBytes > limits.schemaBytes || (totalSchemaBytes += schemaBytes) > limits.totalSchemaBytes) return fail('LOSSLESS_INVENTORY_LIMIT');
      const fence = Object.hasOwn(FENCE_COLUMNS, table) ? table as FenceTable : null;
      if (fence && (meta.primaryKey.length !== 1 || meta.primaryKey[0] !== (fence === 'viewer_login_bindings' ? 'login_id' : fence === 'viewer_resource_sessions' ? 'id' : 'singleton') || FENCE_COLUMNS[fence].some(column => !meta.columns.some(value => value.name === column)))) return fail('LOSSLESS_FENCE_SCHEMA');
      const relation = 'public.' + quote(table), statsRows = await query(`/* lossless:stats */ SELECT count(*)::text AS rows,COALESCE(sum(octet_length(to_jsonb(t)::text)),0)::text AS raw_bytes,COALESCE(max(octet_length(to_jsonb(t)::text)),0)::text AS max_row_bytes FROM (SELECT * FROM ${relation} LIMIT ${limits.rowsPerTable + 1}) t`);
      if (statsRows.length !== 1) return fail('LOSSLESS_INVENTORY_ROW_COUNT');
      const expectedRows = count(statsRows[0].rows, limits.rowsPerTable), expectedBytes = count(statsRows[0].raw_bytes, limits.tableRawBytes);
      count(statsRows[0].max_row_bytes, limits.rowBytes);
      if ((totalRows += expectedRows) > limits.totalRows || (totalRawBytes += expectedBytes) > limits.totalRawBytes) return fail('LOSSLESS_INVENTORY_LIMIT');
      const keyExpression = meta.primaryKey.length ? 'jsonb_build_array(' + meta.primaryKey.map(key => 't.' + quote(key) + '::text').join(',') + ')::text' : 'NULL::text';
      const protectedExpression = fence ? `(to_jsonb(t)-ARRAY[${FENCE_COLUMNS[fence].map(column => "'" + column + "'").join(',')}])::text AS "protectedText",jsonb_build_object(${fence === 'pf_installation_state' ? "'installationEpoch',to_jsonb(t)->>'installation_epoch','updatedAt',to_jsonb(t)->>'updated_at'" : "'revokedAt',to_jsonb(t)->>'revoked_at'" + (fence === 'viewer_resource_sessions' ? ",'revokeReason',to_jsonb(t)->>'revoke_reason'" : '')}) AS mutable` : '';
      await query(`DECLARE wfc_lossless_rows NO SCROLL CURSOR FOR SELECT ${keyExpression} AS key,to_jsonb(t)::text AS "rowText"${fence ? ',' + protectedExpression : ''} FROM ${relation} t ORDER BY (${meta.primaryKey.length ? keyExpression : 'to_jsonb(t)::text'}) COLLATE "C"`);
      const filename = `table-${String(index).padStart(4, '0')}.ndjson`;
      await verifyDirectory(); activeFile = await openBounded(path.join(options.directory, filename), 'wx');
      const rowHash = createHash('sha256').update('wfc.lossless.table-rows.v1\n'), keyHash = createHash('sha256').update('wfc.lossless.table-keys.v1\n'), protectedHash = createHash('sha256').update('wfc.lossless.table-protected.v1\n'), fileHash = createHash('sha256');
      let observedRows = 0, observedRawBytes = 0, outputBytes = 0, prior: string | undefined;
      // Keep the exact NDJSON bytes while avoiding one host-filesystem request
      // per row. Small rows retain at most 64 KiB; an already bounded large row
      // is written directly without concatenating another copy of it.
      const writeBufferBytes = 64 * 1024;
      let pendingRows: Buffer[] = [], pendingBytes = 0;
      const flushRows = async () => {
        if (!pendingBytes) return;
        const bytes = pendingRows.length === 1 ? pendingRows[0] : Buffer.concat(pendingRows, pendingBytes);
        pendingRows = []; pendingBytes = 0;
        check(); await bounded(activeFile!.writeFile(bytes));
      };
      for (;;) {
        const rows = await query(`FETCH FORWARD ${limits.batchRows} FROM wfc_lossless_rows`);
        if (rows.length > limits.batchRows) return fail('LOSSLESS_INVENTORY_ROW_COUNT');
        if (!rows.length) break;
        for (const candidate of rows) {
          check(); const row = rowValue(candidate, fence, meta.primaryKey.length > 0, limits.rowBytes, limits.keyBytes), ordering = row.key ?? row.rowText;
          if (prior !== undefined && (order(prior, ordering) > 0 || row.key !== null && order(prior, ordering) === 0)) return fail('LOSSLESS_INVENTORY_ROW_ORDER');
          prior = ordering; if (++observedRows > expectedRows) return fail('LOSSLESS_INVENTORY_ROW_COUNT');
          observedRawBytes += Buffer.byteLength(row.rowText); if (observedRawBytes > expectedBytes) return fail('LOSSLESS_INVENTORY_ROW_COUNT');
          frame(rowHash, row.key ?? ''); frame(rowHash, row.rowText); if (row.key !== null) frame(keyHash, row.key);
          if (row.protectedText !== undefined) { frame(protectedHash, row.key ?? ''); frame(protectedHash, row.protectedText); }
          const bytes = Buffer.from(JSON.stringify(row) + '\n'); outputBytes += bytes.length; totalOutputBytes += bytes.length;
          if (totalOutputBytes > limits.outputBytes) return fail('LOSSLESS_INVENTORY_LIMIT');
          if (pendingBytes && pendingBytes + bytes.length > writeBufferBytes) await flushRows();
          pendingRows.push(bytes); pendingBytes += bytes.length;
          if (pendingBytes >= writeBufferBytes) await flushRows();
          fileHash.update(bytes);
        }
      }
      await flushRows();
      await query('CLOSE wfc_lossless_rows');
      if (observedRows !== expectedRows || observedRawBytes !== expectedBytes) return fail('LOSSLESS_INVENTORY_ROW_COUNT');
      await bounded(activeFile.sync()); await activeFile.close(); activeFile = undefined; await verifyDirectory();
      const stat = await bounded(fs.lstat(path.join(options.directory, filename)));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== outputBytes) return fail('LOSSLESS_DESTINATION_CHANGED');
      const expectedFileHash = fileHash.digest('hex'), verification = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
      activeFile = await openBounded(path.join(options.directory, filename), 'r');
      const opened = await bounded(activeFile.stat());
      if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) return fail('LOSSLESS_DESTINATION_CHANGED');
      let verifiedBytes = 0;
      for (;;) {
        const chunk = await bounded(activeFile.read(buffer, 0, buffer.length, null)); if (!chunk.bytesRead) break;
        if ((verifiedBytes += chunk.bytesRead) > outputBytes) return fail('LOSSLESS_DESTINATION_CHANGED'); verification.update(buffer.subarray(0, chunk.bytesRead));
      }
      await activeFile.close(); activeFile = undefined;
      if (verifiedBytes !== outputBytes || verification.digest('hex') !== expectedFileHash) return fail('LOSSLESS_DESTINATION_CHANGED');
      catalog.push(meta); tables.push({ ...meta, rows: String(observedRows), rawBytes: String(observedRawBytes), schemaSha256: losslessMetadataHash(meta),
        rowSha256: rowHash.digest('hex'), keySetSha256: meta.primaryKey.length ? keyHash.digest('hex') : null,
        file: { path: filename, bytes: String(outputBytes), sha256: expectedFileHash },
        fencing: fence ? { columns: FENCE_COLUMNS[fence], protectedSha256: protectedHash.digest('hex') } : null });
    }
    await query('COMMIT'); transaction = false; check();
    const body = { schemaVersion: 'wfc.operations.lossless-inventory.v1' as const, status: 'PASS' as const, scope: 'public' as const,
      projection: 'postgresql-jsonb-text.v1' as const, ownerId: options.ownerId, inventoryId,
      database: { name: identity.name as string, encoding: identity.encoding as string, serverVersionNum: identity.serverVersionNum as string }, tables, catalogSha256: losslessMetadataHash(catalog) };
    const manifest: LosslessInventoryManifest = { ...body, contentSha256: losslessMetadataHash(body) };
    await writeNew('manifest.json', manifest); check(); return manifest;
  } catch (error) {
    if (client && !released && transaction) {
      try { await bounded(client.query('ROLLBACK')); } catch { if (!released) { released = true; client.release(true); } }
    }
    throw error;
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', externalAbort);
    if (activeFile) await activeFile.close().catch(() => undefined);
    if (client && !released) { released = true; client.release(); }
  }
}
