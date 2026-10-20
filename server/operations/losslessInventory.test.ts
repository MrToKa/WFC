import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Pool } from 'pg';
import { captureLosslessInventory, losslessMetadataHash, type LosslessColumn, type LosslessInventoryOptions, type LosslessInventoryRow, type LosslessTableMetadata } from './losslessInventory.js';

const ownerId = '64d07773-3220-49b4-93fc-98f8c61b5f9c', inventoryId = 'fa19b473-f810-4f54-ad68-b7b1d1d60109';
type RawMetadata = Omit<LosslessTableMetadata, 'table' | 'keyMode'>;
type Table = { metadata: RawMetadata; rows: LosslessInventoryRow[]; kind?: string };
const column = (name: string, type = 'text'): LosslessColumn => ({ name, type, notNull: true, defaultSql: null, collation: null, identity: '', generated: '' });
const schema = (columns = [column('id'), column('amount', 'numeric')], primaryKey = ['id']): RawMetadata => ({ columns, primaryKey,
  definitions: { constraints: [], indexes: [], triggers: [], rls: { enabled: false, forced: false, policies: [] } } });
const table = (rows: LosslessInventoryRow[] = [{ key: '["1"]', rowText: '{"id": 1, "amount": 1.00000000000000001}' }], metadata = schema()): Table => ({ metadata, rows });
const roots: string[] = [];
async function destination(): Promise<LosslessInventoryOptions> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'wfc-u7-inventory-'))); roots.push(root);
  return { allowedRoot: root, directory: path.join(root, 'capture-' + roots.length), ownerId, inventoryId, limits: { batchRows: 2 } };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const real = await fs.realpath(root), parent = await fs.realpath(os.tmpdir());
    if (path.dirname(real) !== parent || !path.basename(real).startsWith('wfc-u7-inventory-')) throw Error('Synthetic cleanup escaped its owned temporary parent');
    await fs.rm(real, { recursive: true, force: true });
  }
});
function database(tables: Record<string, Table>, options: { onQuery?: (sql: string) => Promise<void>; unsorted?: boolean; statsRows?: string; hang?: string } = {}) {
  let selected: Table | undefined, offset = 0;
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    await options.onQuery?.(sql);
    if (options.hang && sql.startsWith(options.hang)) return await new Promise<never>(() => {});
    if (sql.includes('/* lossless:identity */')) return { rows: [{ name: 'synthetic_u7', encoding: 'UTF8', serverVersionNum: '160000', readOnly: 'on' }] };
    if (sql.includes('/* lossless:tables */')) return { rows: Object.keys(tables).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(name => ({ table: name, kind: tables[name].kind ?? 'r' })) };
    if (sql.includes('/* lossless:schema */')) return { rows: [{ metadata: structuredClone(tables[String(values?.[0])].metadata) }] };
    if (sql.includes('/* lossless:stats */')) {
      const name = /FROM \(SELECT \* FROM public\."((?:[^"]|"")+)" LIMIT/.exec(sql)?.[1]?.replaceAll('""', '"');
      if (!name) throw Error('Unexpected synthetic SQL table');
      const rows = tables[name].rows, bytes = rows.map(row => Buffer.byteLength(row.rowText));
      return { rows: [{ rows: options.statsRows ?? String(rows.length), raw_bytes: String(bytes.reduce((sum, size) => sum + size, 0)), max_row_bytes: String(Math.max(0, ...bytes)) }] };
    }
    if (sql.startsWith('DECLARE')) {
      const name = /FROM public\."((?:[^"]|"")+)" t ORDER BY/.exec(sql)?.[1]?.replaceAll('""', '"');
      if (!name) throw Error('Unexpected synthetic cursor SQL'); selected = structuredClone(tables[name]); offset = 0;
      if (!options.unsorted) selected.rows.sort((a, b) => Buffer.compare(Buffer.from(a.key ?? a.rowText), Buffer.from(b.key ?? b.rowText)));
    }
    if (sql.startsWith('FETCH')) { if (!selected) throw Error('No cursor'); const size = Number(/^FETCH FORWARD (\d+)/.exec(sql)?.[1]); const rows = selected.rows.slice(offset, offset + size); offset += rows.length; return { rows }; }
    return { rows: [] };
  });
  const connect = vi.fn(async () => ({ query, release }));
  return { pool: { connect } as unknown as Pick<Pool, 'connect'>, query, release, connect };
}
async function rows(options: LosslessInventoryOptions, name = 'table-0000.ndjson') {
  return (await fs.readFile(path.join(options.directory, name), 'utf8')).trimEnd().split('\n').filter(Boolean).map(value => JSON.parse(value) as LosslessInventoryRow);
}
const noPass = async (options: LosslessInventoryOptions) => expect(fs.stat(path.join(options.directory, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });

describe('dynamic lossless inventory', () => {
  it('closes nested catalog JSON constructors before naming the CTE projection', async () => {
    const db = database({ probe: table([]) });
    await captureLosslessInventory(db.pool, await destination());
    const sql = db.query.mock.calls.find(([statement]) => statement.includes('/* lossless:schema */'))?.[0];
    expect(sql).toBeTypeOf('string');
    // This is a lexical guard for the actual emitted catalog statement, not a
    // PostgreSQL parser or a substitute for ROOT's separate actual SQL gate.
    // Literals/identifiers/comments must not contribute syntax parentheses.
    const syntax = sql!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:''|[^'])*'/g, "''").replace(/"(?:""|[^"])*"/g, '""');
    let depth = 0, minimum = 0;
    const projectionAt = syntax.indexOf(' AS metadata\n FROM pg_class');
    expect(projectionAt).toBeGreaterThan(0);
    for (const char of syntax.slice(0, projectionAt)) { if (char === '(') depth++; if (char === ')') depth--; minimum = Math.min(minimum, depth); }
    expect(depth).toBe(1); // Only WITH facts AS ( remains open at this alias.
    for (const char of syntax.slice(projectionAt)) { if (char === '(') depth++; if (char === ')') depth--; minimum = Math.min(minimum, depth); }
    expect({ depth, minimum }).toEqual({ depth: 0, minimum: 0 });
  });
  it('streams immutable private files with exact numeric text/string keys and stable framed hashes', async () => {
    const options = await destination(), input = table([{ key: '["9007199254740993"]', rowText: '{"id": 9007199254740993, "amount": 1.00000000000000001}' }]);
    const db = database({ cables: input }), result = await captureLosslessInventory(db.pool, options), record = result.tables[0];
    expect(result.status).toBe('PASS'); expect(result.scope).toBe('public'); expect(record.rows).toBe('1'); expect(await rows(options)).toEqual(input.rows);
    const hash = createHash('sha256').update('wfc.lossless.table-rows.v1\n');
    for (const value of [input.rows[0].key!, input.rows[0].rowText]) { const bytes = Buffer.from(value), prefix = Buffer.alloc(4); prefix.writeUInt32BE(bytes.length); hash.update(prefix).update(bytes); }
    expect(record.rowSha256).toBe(hash.digest('hex'));
    expect(record.file.sha256).toBe(createHash('sha256').update(await fs.readFile(path.join(options.directory, record.file.path))).digest('hex'));
    const { contentSha256, ...body } = result; expect(contentSha256).toBe(losslessMetadataHash(body));
    expect(db.query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT'); expect(db.release).toHaveBeenCalledExactlyOnceWith();
    const statements = db.query.mock.calls.map(([sql]) => sql).join('\n'); expect(statements).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP)\s+(?:TABLE|INTO|FROM|public\.)/i); expect(statements).not.toContain('ctid');
    expect(statements).toContain('jsonb_build_array(t."id"::text)::text');
    expect(statements).toContain('k.position<=i.indnkeyatts');
  });
  it.each(['decimal', 'bigint'] as const)('distinguishes a %s alteration hidden by a JavaScript numeric round trip', async kind => {
    const a = kind === 'decimal' ? '1.00000000000000001' : '9007199254740992', b = kind === 'decimal' ? '1.00000000000000002' : '9007199254740993';
    expect(JSON.parse(a)).toBe(JSON.parse(b));
    const first = await captureLosslessInventory(database({ exact: table([{ key: '["x"]', rowText: '{"id": "x", "amount": ' + a + '}' }]) }).pool, await destination());
    const second = await captureLosslessInventory(database({ exact: table([{ key: '["x"]', rowText: '{"id": "x", "amount": ' + b + '}' }]) }).pool, await destination());
    expect(first.tables[0].rowSha256).not.toBe(second.tables[0].rowSha256);
  });
  it('discovers a new empty table and fingerprints schema changes independently of row data', async () => {
    const a = await captureLosslessInventory(database({ original: table([]) }).pool, await destination());
    const changed = schema(); changed.columns[1].defaultSql = '1.00000000000000001'; changed.definitions.triggers = [{ name: 'user_trigger', definition: 'CREATE TRIGGER user_trigger BEFORE UPDATE ON public.original EXECUTE FUNCTION audit_row()', enabled: 'D' }];
    const b = await captureLosslessInventory(database({ original: table([], changed), newly_added: table([]) }).pool, await destination());
    expect(b.tables.map(item => item.table)).toEqual(['newly_added', 'original']); expect(a.catalogSha256).not.toBe(b.catalogSha256);
    expect(a.tables[0].schemaSha256).not.toBe(b.tables[1].schemaSha256); expect(b.tables[0].rows).toBe('0');
  });
  it('keeps no-PK duplicate multiplicity and ignores physical input ordering without ctid', async () => {
    const one = { key: null, rowText: '{"amount": 1.00000000000000001}' }, two = { key: null, rowText: '{"amount": 2}' };
    const input = [two, one, one], metadata = schema([column('amount', 'numeric')], []);
    const firstOptions = await destination(), first = await captureLosslessInventory(database({ bag: table(input, metadata) }).pool, firstOptions);
    const second = await captureLosslessInventory(database({ bag: table([...input].reverse(), metadata) }).pool, await destination());
    const missing = await captureLosslessInventory(database({ bag: table([one, two], metadata) }).pool, await destination());
    expect(first.tables[0].keyMode).toBe('row-multiset'); expect(first.tables[0].keySetSha256).toBeNull(); expect(first.tables[0].rows).toBe('3');
    expect(first.tables[0].rowSha256).toBe(second.tables[0].rowSha256); expect(first.tables[0].rowSha256).not.toBe(missing.tables[0].rowSha256); expect(await rows(firstOptions)).toEqual([one, one, two]);
  });
  it('retains lossless SQL protected projections and typed fence metadata without numeric reserialization', async () => {
    const epoch = 'f952e814-53c9-46cf-a795-f47e538656ec', row: LosslessInventoryRow = { key: '["t"]', rowText: '{"singleton": true, "extra": 1.00000000000000001, "updated_at": "2026-10-20T00:00:00+00:00", "installation_epoch": "' + epoch + '"}',
      protectedText: '{"extra": 1.00000000000000001, "singleton": true}', mutable: { installationEpoch: epoch, updatedAt: '2026-10-20T00:00:00+00:00' } };
    const metadata = schema([column('singleton', 'boolean'), column('extra', 'numeric'), column('updated_at', 'timestamp with time zone'), column('installation_epoch', 'uuid')], ['singleton']);
    const options = await destination(), db = database({ pf_installation_state: table([row], metadata) }), result = await captureLosslessInventory(db.pool, options);
    expect(await rows(options)).toEqual([row]); expect(result.tables[0].fencing?.columns).toEqual(['installation_epoch', 'updated_at']);
    expect(db.query.mock.calls.some(([sql]) => sql.includes("to_jsonb(t)-ARRAY['installation_epoch','updated_at']"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(row.protectedText!);
  });
  it.each(['p', 'm', 'f'])('refuses unsupported public relation %s instead of omitting it', async kind => {
    const options = await destination(), db = database({ unsupported: { ...table([]), kind } });
    await expect(captureLosslessInventory(db.pool, options)).rejects.toMatchObject({ code: 'LOSSLESS_INVENTORY_TABLES' }); await noPass(options);
  });
  it('refuses source order violations and duplicate primary keys', async () => {
    for (const input of [[{ key: '["2"]', rowText: '{}' }, { key: '["1"]', rowText: '{}' }], [{ key: '["1"]', rowText: '{}' }, { key: '["1"]', rowText: '{}' }]]) {
      const options = await destination(); await expect(captureLosslessInventory(database({ bad: table(input) }, { unsorted: true }).pool, options)).rejects.toMatchObject({ code: 'LOSSLESS_INVENTORY_ROW_ORDER' }); await noPass(options);
    }
  });
  it('fails explicit row limits without writing a complete manifest', async () => {
    const options = await destination(), db = database({ big: table() }, { statsRows: '1000001' });
    await expect(captureLosslessInventory(db.pool, options)).rejects.toMatchObject({ code: 'LOSSLESS_INVENTORY_LIMIT' }); await noPass(options);
  });
  it('detects same-size private row tampering before returning a manifest', async () => {
    const options = await destination(), db = database({ tamper: table() }, { onQuery: async sql => {
      if (sql === 'CLOSE wfc_lossless_rows') { const filename = path.join(options.directory, 'table-0000.ndjson'), bytes = await fs.readFile(filename, 'utf8'); await fs.writeFile(filename, bytes.replace('1.00000000000000001', '1.00000000000000002')); }
    } });
    await expect(captureLosslessInventory(db.pool, options)).rejects.toMatchObject({ code: 'LOSSLESS_DESTINATION_CHANGED' }); await noPass(options);
  });
  it('never overwrites an existing destination or writes outside its canonical parent', async () => {
    const options = await destination(); await fs.mkdir(options.directory); await fs.writeFile(path.join(options.directory, 'keep'), 'owned prior file');
    await expect(captureLosslessInventory(database({}).pool, options)).rejects.toMatchObject({ code: 'EEXIST' }); expect(await fs.readFile(path.join(options.directory, 'keep'), 'utf8')).toBe('owned prior file');
    await expect(captureLosslessInventory(database({}).pool, { ...options, directory: path.join(options.allowedRoot, 'nested', 'escape') })).rejects.toMatchObject({ code: 'LOSSLESS_DESTINATION' });
  });
  it('bounds a hung transaction and destroys its owned connection without committing', async () => {
    const options = await destination(), db = database({}, { hang: 'BEGIN' }); options.limits = { milliseconds: 100 };
    await expect(captureLosslessInventory(db.pool, options)).rejects.toMatchObject({ code: 'LOSSLESS_INVENTORY_DEADLINE' });
    expect(db.release).toHaveBeenCalledExactlyOnceWith(true); expect(db.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false); await noPass(options);
  });
  it('destroys a late acquired connection after bounded acquisition expiry', async () => {
    const options = await destination(), release = vi.fn(); let resolve!: (value: unknown) => void;
    const pool = { connect: () => new Promise(value => { resolve = value; }) } as unknown as Pick<Pool, 'connect'>; options.limits = { acquireMilliseconds: 30 };
    await expect(captureLosslessInventory(pool, options)).rejects.toMatchObject({ code: 'LOSSLESS_INVENTORY_ACQUIRE_TIMEOUT' });
    resolve({ query: vi.fn(), release }); await new Promise(value => setTimeout(value, 0)); expect(release).toHaveBeenCalledExactlyOnceWith(true); await noPass(options);
  });
  it('rejects pre-aborted work and malformed fence schema without invented authority', async () => {
    const options = await destination(), controller = new AbortController(), reason = Error('Explicit synthetic cancellation'); controller.abort(reason);
    const db = database({}); await expect(captureLosslessInventory(db.pool, { ...options, signal: controller.signal })).rejects.toBe(reason); expect(db.connect).not.toHaveBeenCalled();
    const other = await destination(); await expect(captureLosslessInventory(database({ viewer_login_bindings: table([]) }).pool, other)).rejects.toMatchObject({ code: 'LOSSLESS_FENCE_SCHEMA' }); await noPass(other);
  });
});
