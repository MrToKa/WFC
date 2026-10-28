import { createHash } from 'node:crypto';
import { TABLE_KEYS } from '../pathfinder-copied-recovery/audit-lib.mjs';

export const AUDIT_LIMITS = Object.freeze({ rowsPerTable: 100000, totalRows: 300000, rawBytes: 64 * 1024 ** 2, rowBytes: 4 * 1024 ** 2, helperMilliseconds: 120000 });
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const need = (ok, code) => { if (!ok) throw Object.assign(Error(code), { code }); };
const identifier = value => typeof value === 'string' && /^[a-z_]+$/.test(value);
export function auditTables(catalogTables) {
  const tables = { ...TABLE_KEYS };
  for (const table of catalogTables) {
    need(identifier(table.name) && Array.isArray(table.keyColumns) && table.keyColumns.length > 0 && table.keyColumns.every(identifier), 'CATALOG_AUDIT_TABLE');
    if (tables[table.name]) need(JSON.stringify(tables[table.name]) === JSON.stringify(table.keyColumns), 'CATALOG_AUDIT_KEY_CONFLICT');
    tables[table.name] = table.keyColumns;
  }
  return tables;
}

/** Serialized independent read-only projection. Business numbers remain PG JSONB text. */
export async function collectPreservation(config, testContext = {}) {
  const value = { schemaVersion: 'wfc.pf.catalog-preservation.v1', status: 'FAIL', capturedAt: new Date().toISOString(), groups: {}, expected: {}, phase: 'initializing' };
  const requireThat = (ok, code) => { if (!ok) throw Object.assign(Error(code), { safeCode: code }); };
  let client, began = false, lost = false;
  try {
    requireThat(config.target?.owner === '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46' && config.target.project === 'wfc-pathfinder-local-0cba87606e9b' && config.target.port === 5191 && config.target.projectId === '1af0f807-7653-40ea-8391-7eea6c54e7d4' && typeof config.target.serverAddress === 'string', 'CATALOG_AUDIT_TARGET');
    requireThat(config.tables && Object.keys(config.tables).length >= 27 && Object.keys(config.tables).length <= 80, 'CATALOG_AUDIT_TABLES');
    for (const [name, keys] of Object.entries(config.tables)) requireThat(/^[a-z_]+$/.test(name) && Array.isArray(keys) && keys.length > 0 && keys.every(key => /^[a-z_]+$/.test(key)), 'CATALOG_AUDIT_IDENTIFIER');
    if (testContext.client) client = testContext.client;
    else {
      const { Client } = await import('pg'), { parse } = await import('pg-connection-string');
      const parsed = parse(process.env.DATABASE_URL ?? '');
      requireThat(parsed.host === 'postgres' && parsed.port === '5432' && parsed.database === 'wfc_pathfinder_local' && parsed.user === 'pf_local' && /^[a-f0-9]{64}$/.test(parsed.password ?? ''), 'CATALOG_AUDIT_ENDPOINT');
      client = new Client({ host: parsed.host, port: 5432, database: parsed.database, user: parsed.user, password: parsed.password, connectionTimeoutMillis: 5000, query_timeout: 6000, application_name: 'wfc-tray-catalog-preservation', options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=10000' });
    }
    client.on('error', () => { lost = true; }); await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); began = true;
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    value.phase = 'identity';
    const identity = (await client.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('transaction_read_only') AS ro,pg_current_snapshot()::text AS snapshot")).rows[0];
    requireThat(identity?.database === 'wfc_pathfinder_local' && identity.address === config.target.serverAddress && identity.port === 5432 && identity.ro === 'on', 'CATALOG_AUDIT_IDENTITY'); value.identity = identity;
    const quiet = async () => (await client.query("SELECT (SELECT count(*)::text FROM pf_jobs WHERE state IN ('queued','running')) AS jobs,(SELECT count(*)::text FROM model_import_jobs WHERE state NOT IN ('complete','failed')) AS imports")).rows[0];
    value.quiescence = { before: await quiet() };
    requireThat(value.quiescence.before.jobs === '0' && value.quiescence.before.imports === '0', 'CATALOG_AUDIT_BUSY');
    value.phase = 'rows'; let totalRows = 0, totalBytes = 0;
    for (const [table, keys] of Object.entries(config.tables)) {
      const budget = (await client.query('SELECT count(*)::text AS rows,COALESCE(sum(octet_length(to_jsonb(t)::text)),0)::text AS bytes FROM (SELECT * FROM ' + table + ' LIMIT 100001) t')).rows[0];
      requireThat(/^[0-9]{1,9}$/.test(budget?.rows ?? '') && /^[0-9]{1,12}$/.test(budget?.bytes ?? ''), 'CATALOG_AUDIT_BUDGET_SCHEMA');
      requireThat(Number(budget.rows) <= 100000 && (totalRows += Number(budget.rows)) <= 300000 && (totalBytes += Number(budget.bytes)) <= 24 * 1024 ** 2, 'CATALOG_AUDIT_BUDGET');
      const key = 'jsonb_build_array(' + keys.map(column => 't.' + column).join(',') + ')::text';
      const rows = (await client.query('SELECT ' + key + ' AS key,to_jsonb(t)::text AS row_text FROM ' + table + ' t ORDER BY (' + key + ') COLLATE "C" LIMIT 100001')).rows;
      requireThat(rows.length === Number(budget.rows) && rows.every(row => typeof row.key === 'string' && typeof row.row_text === 'string' && Buffer.byteLength(row.row_text) <= 4 * 1024 ** 2), 'CATALOG_AUDIT_ROWS'); value.groups[table] = rows;
    }
    value.phase = 'expectations';
    requireThat(Array.isArray(config.expectations ?? []) && (config.expectations ?? []).length <= 100000, 'CATALOG_AUDIT_EXPECTATIONS');
    for (const item of config.expectations ?? []) {
      const keys = config.tables[item.table];
      requireThat(keys && typeof item.sourceRowText === 'string' && item.overrides && typeof item.overrides === 'object' && !Array.isArray(item.overrides), 'CATALOG_AUDIT_EXPECTATION');
      const key = 'jsonb_build_array(' + keys.map(column => 'r.' + column).join(',') + ')::text';
      let desired;
      if (item.kind === 'project-drawing') {
        requireThat(item.table === 'projects' && typeof item.baselineRowText === 'string' && JSON.parse(item.baselineRowText).id === config.target.projectId && JSON.parse(item.sourceRowText).id === '0c0007c9-d73f-4d13-bc87-601c544727b7', 'CATALOG_AUDIT_PROJECT_DRAWING');
        // The four values, including nested JSON and decimals, are interpreted
        // and merged by PostgreSQL. The host never serializes their values.
        desired = (await client.query("SELECT jsonb_build_array(r.id)::text AS key,to_jsonb(r)::text AS row_text FROM jsonb_populate_record(NULL::projects,$1::jsonb || (SELECT jsonb_build_object('support_distance',d.support_distance,'support_weight',d.support_weight,'tray_load_safety_factor',d.tray_load_safety_factor,'cable_layout_settings',d.cable_layout_settings) FROM jsonb_populate_record(NULL::projects,$2::jsonb) d)) r", [item.baselineRowText, item.sourceRowText])).rows;
      } else {
        requireThat(item.kind === undefined, 'CATALOG_AUDIT_EXPECTATION_KIND');
        desired = (await client.query('SELECT ' + key + ' AS key,to_jsonb(r)::text AS row_text FROM jsonb_populate_record(NULL::' + item.table + ',$1::jsonb || $2::jsonb) r', [item.sourceRowText, JSON.stringify(item.overrides)])).rows;
      }
      requireThat(desired.length === 1 && typeof desired[0].key === 'string' && typeof desired[0].row_text === 'string', 'CATALOG_AUDIT_DESIRED');
      (value.expected[item.table] ??= []).push({ ...desired[0], action: item.action });
    }
    value.quiescence.after = await quiet(); requireThat(value.quiescence.after.jobs === '0' && value.quiescence.after.imports === '0' && !lost, 'CATALOG_AUDIT_CHANGED');
    await client.query('COMMIT'); began = false; value.status = 'PASS'; value.phase = 'complete'; value.totalRows = totalRows;
  } catch (error) {
    if (began) try { await client.query('ROLLBACK'); } catch { /* Read-only failure retained. */ }
    value.error = error.safeCode ?? 'CATALOG_AUDIT_FAILED';
  } finally { if (client) try { await client.end(); } catch { value.status = 'FAIL'; value.error = 'CATALOG_AUDIT_CLOSE'; } }
  if (lost) { value.status = 'FAIL'; value.error = 'CATALOG_AUDIT_CONNECTION_LOST'; }
  return value;
}

export function buildPreservationProgram() {
  return 'const watchdog=setTimeout(()=>process.exit(124),120000);const input=globalThis.__wfcPfR1Input;const result=await (' + collectPreservation.toString() + ')(input);await new Promise(resolve=>process.stdout.write(JSON.stringify(result),resolve));clearTimeout(watchdog);process.exitCode=result.status==="PASS"?0:1;';
}
export function comparePreservation(before, after) {
  need(before?.status === 'PASS' && after?.status === 'PASS' && before.schemaVersion === 'wfc.pf.catalog-preservation.v1' && after.schemaVersion === before.schemaVersion, 'CATALOG_AUDIT_SNAPSHOT');
  need(before.identity?.database === after.identity?.database && before.identity.address === after.identity.address && before.identity.port === after.identity.port && before.identity.ro === 'on' && after.identity.ro === 'on', 'CATALOG_AUDIT_BINDING_CHANGED');
  need(JSON.stringify(Object.keys(before.groups).sort()) === JSON.stringify(Object.keys(after.groups).sort()), 'CATALOG_AUDIT_GROUPS_CHANGED');
  need(after.expected && Object.keys(after.expected).every(table => Object.hasOwn(after.groups, table)), 'CATALOG_AUDIT_UNCOVERED_EXPECTATION');
  const results = {}, failures = [];
  for (const table of Object.keys(before.groups)) {
    const oldRows = before.groups[table], newRows = after.groups[table], expected = after.expected[table] ?? [];
    const maps = [oldRows, newRows, expected].map(rows => new Map(rows.map(row => [row.key, row])));
    need(maps.every((map, i) => map.size === [oldRows, newRows, expected][i].length), 'CATALOG_AUDIT_DUPLICATE_KEY');
    let unchanged = 0, added = 0, enriched = 0; const invalid = [];
    for (const row of oldRows) {
      const next = maps[1].get(row.key), allowed = maps[2].get(row.key);
      if (!next) invalid.push('removed');
      else if (next.row_text === row.row_text) unchanged++;
      else if (allowed?.action === 'enrich' && next.row_text === allowed.row_text) enriched++;
      else invalid.push('changed');
    }
    for (const row of newRows) if (!maps[0].has(row.key)) {
      const allowed = maps[2].get(row.key);
      if (allowed?.action === 'insert' && allowed.row_text === row.row_text) added++;
      else invalid.push('unplanned-addition');
    }
    for (const row of expected) if (!['insert', 'enrich', 'reuse'].includes(row.action) || maps[1].get(row.key)?.row_text !== row.row_text) invalid.push('expected-mismatch');
    if (invalid.length) failures.push(table);
    results[table] = { before: oldRows.length, after: newRows.length, unchanged, added, enriched, invalid: invalid.length, beforeSha256: digest(oldRows), afterSha256: digest(newRows) };
  }
  return { schemaVersion: 'wfc.pf.catalog-preservation-comparison.v1', status: failures.length ? 'FAIL' : 'PASS', failures, tables: results };
}

/** Compare current-object inventories; staged files separately require byte SHA readback. */
export function compareStoragePreservation(before, after, entries = []) {
  const validate = value => {
    need(value?.schemaVersion === 'wfc.pf.catalog-storage-inventory.v1' && value.groups && Object.keys(value.groups).sort().join() === 'model,project,template', 'CATALOG_STORAGE_AUDIT_SCHEMA');
    for (const group of Object.values(value.groups)) {
      need(typeof group.bucket === 'string' && Array.isArray(group.rows) && group.rows.length <= 20000, 'CATALOG_STORAGE_AUDIT_GROUP');
      need(group.rows.every(row => typeof row.key === 'string' && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && typeof row.etag === 'string' && typeof row.lastModified === 'string') && new Set(group.rows.map(row => row.key)).size === group.rows.length, 'CATALOG_STORAGE_AUDIT_ROWS');
    }
  };
  validate(before); validate(after);
  need(Array.isArray(entries) && entries.length <= 512 && new Set(entries.map(e => e.targetObjectKey)).size === entries.length, 'CATALOG_STORAGE_AUDIT_ENTRIES');
  const failures = [], groups = {};
  for (const kind of ['model', 'project', 'template']) {
    const old = before.groups[kind], current = after.groups[kind]; need(old.bucket === current.bucket, 'CATALOG_STORAGE_AUDIT_BUCKET');
    const baseline = new Map(old.rows.map(row => [row.key, row])), updated = new Map(current.rows.map(row => [row.key, row]));
    const allowed = new Map(entries.filter(entry => (entry.table.startsWith('project_') ? 'project' : 'template') === kind).map(entry => [entry.targetObjectKey, entry]));
    let unchanged = 0, added = 0, invalid = 0;
    for (const row of old.rows) if (JSON.stringify(row) === JSON.stringify(updated.get(row.key))) unchanged++; else invalid++;
    for (const row of current.rows) if (!baseline.has(row.key)) { const expected = allowed.get(row.key); if (expected && row.bytes === expected.bytes) added++; else invalid++; }
    for (const [key, entry] of allowed) if (updated.get(key)?.bytes !== entry.bytes || entry.readbackSha256 !== entry.sha256) invalid++;
    if (invalid) failures.push(kind);
    groups[kind] = { before: old.rows.length, after: current.rows.length, unchanged, added, invalid, beforeSha256: digest(old), afterSha256: digest(current) };
  }
  return { schemaVersion: 'wfc.pf.catalog-storage-preservation.v1', status: failures.length ? 'FAIL' : 'PASS', failures, groups, byteReadback: 'checked-separately-per-staged-entry' };
}
