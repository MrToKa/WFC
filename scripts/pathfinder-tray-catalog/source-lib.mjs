import { createHash } from 'node:crypto';
import {
  EXPECTED as ORIGINAL, validateBinding, canonical, parseOutput,
} from '../pathfinder-current-inputs/source-lib.mjs';

export { canonical, parseOutput };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const SCHEMA_VERSION = 'wfc.pf.catalog-copy-projection.v1';
export const EXPECTED = ORIGINAL;
export const LIMITS = Object.freeze({ rows: 100000, totalRows: 200000, outputBytes: 64 * 1024 ** 2,
  rowBytes: 4 * 1024 ** 2, childMilliseconds: 35000, processMilliseconds: 45000, stderrBytes: 32768, receiptBytes: 128 * 1024 });

const fk = (column, table, nullable = false) => ({ column, table, nullable });
const spec = (table, scope, columns, numericTextColumns = [], foreignKeys = [], options = {}) => Object.freeze({
  table, scope, columns: Object.freeze(columns.split(' ')), numericTextColumns: Object.freeze(numericTextColumns),
  keyColumns: Object.freeze(options.keyColumns ?? ['id']), foreignKeys: Object.freeze(foreignKeys.map(Object.freeze)),
  ...options,
});
const standards = (table, owner, ownerTable) => spec(table, 'global',
  `id ${owner} referenced_material_id quantity unit remarks created_at updated_at`, ['quantity'],
  [fk(owner, ownerTable), fk('referenced_material_id', 'material_cable_installation_materials')],
  { uniqueKeys: [{ columns: [owner, 'referenced_material_id'], caseInsensitive: false }] });

/** Closed source schema; consumers may project these columns, never arbitrary table/column input. */
export const TABLES = Object.freeze([
  spec('trays', 'project', 'id project_id name tray_type purpose width_mm height_mm length_mm created_at updated_at change_log include_grounding_cable grounding_cable_type_id use_trefoil_clamps trefoil_clamp_spacing_mm',
    ['width_mm', 'height_mm', 'length_mm', 'trefoil_clamp_spacing_mm'], [fk('project_id', 'projects'), fk('grounding_cable_type_id', 'cable_types', true)],
    { uniqueNameColumn: 'name', booleanColumns: ['include_grounding_cable', 'use_trefoil_clamps'], jsonColumns: ['change_log'] }),
  spec('cable_types', 'project', 'id project_id name tag purpose diameter_mm weight_kg_per_m from_location to_location routing created_at updated_at change_log material description manufacturer part_no remarks source_material_cable_type_id',
    ['diameter_mm', 'weight_kg_per_m'], [fk('project_id', 'projects'), fk('source_material_cable_type_id', 'material_cable_types', true)],
    { uniqueNameColumn: 'name', jsonColumns: ['change_log'] }),
  spec('cable_type_default_materials', 'dependent', 'id cable_type_id name quantity unit remarks created_at updated_at', ['quantity'], [fk('cable_type_id', 'cable_types')]),
  spec('material_cable_types', 'global', 'id name purpose material description manufacturer part_no remarks diameter_mm weight_kg_per_m unit_price created_at updated_at minimum_order_quantity order_measurement packaging source',
    ['diameter_mm', 'weight_kg_per_m', 'unit_price', 'minimum_order_quantity']),
  spec('material_trays', 'global', 'id tray_type manufacturer height_mm rung_height_mm width_mm weight_kg_per_m unit_price load_curve_id created_at updated_at image_template_id minimum_order_quantity order_measurement packaging source',
    ['height_mm', 'rung_height_mm', 'width_mm', 'weight_kg_per_m', 'unit_price', 'minimum_order_quantity'],
    [fk('load_curve_id', 'material_load_curves', true), fk('image_template_id', 'template_files', true)], { uniqueNameColumn: 'tray_type' }),
  spec('project_support_distances', 'project', 'project_id tray_type support_distance created_at updated_at support_id', ['support_distance'],
    [fk('project_id', 'projects'), fk('support_id', 'material_supports', true)], { keyColumns: ['project_id', 'tray_type'] }),
  spec('material_supports', 'global', 'id support_type manufacturer height_mm width_mm length_mm weight_kg unit_price created_at updated_at image_template_id minimum_order_quantity order_measurement packaging source',
    ['height_mm', 'width_mm', 'length_mm', 'weight_kg', 'unit_price', 'minimum_order_quantity'], [fk('image_template_id', 'template_files', true)], { uniqueNameColumn: 'support_type' }),
  spec('material_load_curves', 'global', 'id name description tray_id created_at updated_at', [], [fk('tray_id', 'material_trays', true)], { uniqueNameColumn: 'name' }),
  spec('material_load_curve_points', 'dependent', 'id load_curve_id point_order span_m load_kn_per_m created_at updated_at', ['span_m', 'load_kn_per_m'],
    [fk('load_curve_id', 'material_load_curves')], { integerColumns: ['point_order'], uniqueKeys: [{ columns: ['load_curve_id', 'point_order'], caseInsensitive: false }] }),
  standards('material_cable_type_standard_materials', 'cable_type_id', 'material_cable_types'),
  standards('material_tray_standard_materials', 'tray_id', 'material_trays'),
  standards('material_support_standard_materials', 'support_id', 'material_supports'),
  spec('material_cable_installation_materials', 'global', 'id type purpose material description manufacturer part_no dimension_mm weight_kg unit_price created_at updated_at minimum_order_quantity order_measurement packaging source',
    ['weight_kg', 'unit_price', 'minimum_order_quantity']),
  standards('material_cable_installation_standard_materials', 'cable_installation_material_id', 'material_cable_installation_materials'),
  spec('project_tray_purpose_templates', 'project', 'project_id tray_purpose project_file_id created_at updated_at', [],
    [fk('project_id', 'projects'), fk('project_file_id', 'project_files')], { keyColumns: ['project_id', 'tray_purpose'] }),
  spec('project_files', 'project', 'id project_id object_key file_name content_type size_bytes uploaded_by uploaded_at', ['size_bytes'],
    [fk('project_id', 'projects'), fk('uploaded_by', 'users', true)], { uniqueNameColumn: 'file_name' }),
  spec('project_file_versions', 'dependent', 'id project_file_id version_number object_key file_name content_type size_bytes uploaded_by created_at', ['size_bytes'],
    [fk('project_file_id', 'project_files'), fk('uploaded_by', 'users', true)], { integerColumns: ['version_number'], uniqueKeys: [{ columns: ['project_file_id', 'version_number'], caseInsensitive: false }] }),
  spec('template_files', 'global', 'id object_key file_name content_type size_bytes uploaded_by uploaded_at', ['size_bytes'],
    [fk('uploaded_by', 'users', true)], { uniqueNameColumn: 'file_name' }),
  spec('template_file_versions', 'dependent', 'id template_id version_number object_key file_name content_type size_bytes uploaded_by created_at', ['size_bytes'],
    [fk('template_id', 'template_files'), fk('uploaded_by', 'users', true)], { integerColumns: ['version_number'], uniqueKeys: [{ columns: ['template_id', 'version_number'], caseInsensitive: false }] }),
]);

export const PROJECT_COLUMNS = Object.freeze(['id', 'project_number', 'name', 'secondary_tray_length', 'end_connection_length',
  'additional_bending_percent', 'support_distance', 'support_weight', 'tray_load_safety_factor', 'cable_layout_settings']);
export const PROJECT_NUMERIC_TEXT_COLUMNS = Object.freeze(['secondary_tray_length', 'end_connection_length', 'additional_bending_percent', 'support_distance', 'support_weight', 'tray_load_safety_factor']);
const FILE_TABLES = Object.freeze(['project_files', 'project_file_versions', 'template_files', 'template_file_versions']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const equal = (left, right) => canonical(left) === canonical(right);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const decimal = value => value === null || typeof value === 'string' && value.length <= 4096 && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value);
const demand = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const parsedRow = entry => { try { return JSON.parse(entry.rowText); } catch { demand(false, 'CATALOG_ROW_JSON'); } };

/** Inventory is derived from retained relational rows, never accepted as an independent key request. */
export function fileInventory(groups) {
  return FILE_TABLES.flatMap(table => groups[table].rows.map(entry => {
    const row = parsedRow(entry);
    return { table, id: row.id, storageKind: table.startsWith('project_') ? 'project' : 'template',
      objectKey: row.object_key, fileName: row.file_name, contentType: row.content_type, sizeBytes: row.size_bytes };
  }));
}

/** Validates raw transport without reserializing any PostgreSQL rowText. */
export function validateSourceProjection(snapshot, phase) {
  if (object(phase)) { validateBinding(phase); phase = undefined; }
  demand(exact(snapshot, ['schemaVersion', 'project', 'groups', 'files', 'transaction', 'source']) && snapshot.schemaVersion === SCHEMA_VERSION, 'CATALOG_SOURCE_SCHEMA');
  demand(Buffer.byteLength(JSON.stringify(snapshot)) <= LIMITS.outputBytes, 'CATALOG_SOURCE_OUTPUT_BUDGET');
  const project = snapshot.project;
  demand(exact(project, ['id', 'projectNumber', 'name', 'rowText']) && project.id === EXPECTED.projectId && project.projectNumber === EXPECTED.projectNumber &&
    typeof project.name === 'string' && project.name.normalize('NFC').trim().toUpperCase() === EXPECTED.projectName.toUpperCase() && typeof project.rowText === 'string' && Buffer.byteLength(project.rowText) <= LIMITS.rowBytes, 'CATALOG_SOURCE_PROJECT');
  const row = parsedRow(project);
  demand(exact(row, PROJECT_COLUMNS) && row.id === project.id && row.project_number === project.projectNumber && row.name === project.name && PROJECT_NUMERIC_TEXT_COLUMNS.every(key => decimal(row[key])), 'CATALOG_PROJECT_ROW');
  demand(exact(snapshot.groups, TABLES.map(table => table.table)), 'CATALOG_SOURCE_GROUPS');
  const parsed = new Map(), ids = new Map(); let count = 0;
  for (const table of TABLES) {
    const group = snapshot.groups[table.table];
    demand(exact(group, ['keyColumns', 'columns', 'numericTextColumns', 'rows']) && equal(group.keyColumns, table.keyColumns) && equal(group.columns, table.columns) && equal(group.numericTextColumns, table.numericTextColumns) &&
      Array.isArray(group.rows) && group.rows.length <= LIMITS.rows, 'CATALOG_GROUP_SCHEMA');
    count += group.rows.length; demand(count <= LIMITS.totalRows, 'CATALOG_SOURCE_ROW_BUDGET');
    const seen = new Set(), values = [];
    for (const entry of group.rows) {
      demand(exact(entry, ['key', 'rowText']) && Array.isArray(entry.key) && entry.key.length === table.keyColumns.length && entry.key.every(key => typeof key === 'string' && key.length <= 65536) &&
        typeof entry.rowText === 'string' && Buffer.byteLength(entry.rowText) <= LIMITS.rowBytes, 'CATALOG_ROW_SCHEMA');
      const value = parsedRow(entry), key = canonical(entry.key);
      demand(!seen.has(key) && exact(value, table.columns) && table.keyColumns.every((column, index) => value[column] === entry.key[index]), 'CATALOG_ROW_IDENTITY');
      seen.add(key); values.push(value);
      demand(table.numericTextColumns.every(column => decimal(value[column])), 'CATALOG_NUMERIC_TEXT');
      demand((table.booleanColumns ?? []).every(column => typeof value[column] === 'boolean') && (table.integerColumns ?? []).every(column => Number.isSafeInteger(value[column]) && value[column] >= -2147483648 && value[column] <= 2147483647), 'CATALOG_ROW_VALUE');
      if ('id' in value) demand(uuid(value.id), 'CATALOG_ROW_UUID');
      for (const column of ['name', 'type', 'tray_type', 'support_type'].filter(column => table.columns.includes(column))) {
        const nullable = table.table === 'trays' && column === 'tray_type';
        demand(nullable && value[column] === null || typeof value[column] === 'string', 'CATALOG_REQUIRED_TEXT');
      }
      for (const column of table.columns.filter(column => column.endsWith('_at'))) demand(typeof value[column] === 'string' && value[column].length > 0 && value[column].length <= 128, 'CATALOG_TIMESTAMP_TEXT');
      if (table.jsonColumns?.includes('change_log')) demand(Array.isArray(value.change_log), 'CATALOG_CHANGE_LOG');
      if (table.scope === 'project') demand(value.project_id === project.id, 'CATALOG_FOREIGN_PROJECT');
      for (const reference of table.foreignKeys) demand(reference.nullable && value[reference.column] === null || uuid(value[reference.column]), 'CATALOG_FOREIGN_KEY_VALUE');
      for (const column of table.columns) {
        if (table.numericTextColumns.includes(column) || (table.booleanColumns ?? []).includes(column) || (table.integerColumns ?? []).includes(column) || (table.jsonColumns ?? []).includes(column)) continue;
        demand(value[column] === null || typeof value[column] === 'string', 'CATALOG_TEXT_TRANSPORT');
      }
    }
    parsed.set(table.table, values); ids.set(table.table, new Set(values.map(value => value.id)));
  }
  for (const table of TABLES) for (const row of parsed.get(table.table)) for (const reference of table.foreignKeys) {
    const value = row[reference.column];
    if (value === null && reference.nullable || reference.table === 'users') continue;
    demand(reference.table === 'projects' ? value === project.id : ids.get(reference.table)?.has(value), 'CATALOG_DEPENDENCY_MISSING');
  }
  // A row in a file table is not itself authority to read its storage object.
  // Header rows must be exactly the files referenced by the admitted project/material closure.
  const sameSet = (left, right) => left.size === right.size && [...left].every(value => right.has(value));
  demand(sameSet(ids.get('project_files'), new Set(parsed.get('project_tray_purpose_templates').map(row => row.project_file_id))) &&
    sameSet(ids.get('template_files'), new Set([...parsed.get('material_trays'), ...parsed.get('material_supports')].map(row => row.image_template_id).filter(value => value !== null))), 'CATALOG_UNREFERENCED_FILE');
  demand(sameSet(ids.get('material_cable_types'), new Set(parsed.get('cable_types').map(row => row.source_material_cable_type_id).filter(value => value !== null))) &&
    sameSet(ids.get('material_supports'), new Set(parsed.get('project_support_distances').map(row => row.support_id).filter(value => value !== null))), 'CATALOG_UNREFERENCED_DEPENDENCY');
  const requiredInstallations = new Set(['material_cable_type_standard_materials', 'material_tray_standard_materials', 'material_support_standard_materials'].flatMap(table => parsed.get(table).map(row => row.referenced_material_id)));
  const installationChildren = new Map();
  for (const row of parsed.get('material_cable_installation_standard_materials')) {
    const children = installationChildren.get(row.cable_installation_material_id) ?? [];
    children.push(row.referenced_material_id); installationChildren.set(row.cable_installation_material_id, children);
  }
  const queue = [...requiredInstallations];
  for (let index = 0; index < queue.length; index++) for (const id of installationChildren.get(queue[index]) ?? []) if (!requiredInstallations.has(id)) { requiredInstallations.add(id); queue.push(id); }
  demand(sameSet(ids.get('material_cable_installation_materials'), requiredInstallations), 'CATALOG_UNREFERENCED_DEPENDENCY');
  demand(Array.isArray(snapshot.files) && equal(snapshot.files, fileInventory(snapshot.groups)), 'CATALOG_FILE_INVENTORY');
  for (const file of snapshot.files) demand(typeof file.objectKey === 'string' && file.objectKey.length > 0 && file.objectKey.length <= 4096 && !file.objectKey.includes('\0') &&
    typeof file.fileName === 'string' && file.fileName.length > 0 && (file.contentType === null || typeof file.contentType === 'string') &&
    (file.sizeBytes === null || /^(?:0|[1-9][0-9]*)$/.test(file.sizeBytes)), 'CATALOG_FILE_METADATA');
  demand(exact(snapshot.source, ['backendId', 'postgresId', 'revision', 'databaseHost', 'databasePort', 'database']) && equal(snapshot.source,
    { backendId: EXPECTED.backend.id, postgresId: EXPECTED.postgres.id, revision: EXPECTED.revision, databaseHost: EXPECTED.endpoint.host, databasePort: EXPECTED.endpoint.port, database: EXPECTED.endpoint.database }), 'CATALOG_SOURCE_PROVENANCE');
  const transaction = snapshot.transaction;
  demand(exact(transaction, ['database', 'serverAddress', 'serverPort', 'readOnly', 'defaultReadOnly', 'isolation', 'snapshot', 'capturedAt', 'phase']) &&
    transaction.database === EXPECTED.endpoint.database && transaction.serverAddress === EXPECTED.endpoint.serverAddress && transaction.serverPort === EXPECTED.endpoint.serverPort &&
    transaction.readOnly === 'on' && transaction.defaultReadOnly === 'on' && transaction.isolation === 'repeatable read' &&
    ['before', 'copy', 'after'].includes(transaction.phase) && (!phase || transaction.phase === phase) && typeof transaction.snapshot === 'string' && transaction.snapshot.length <= 1024 &&
    typeof transaction.capturedAt === 'string' && transaction.capturedAt.length <= 128, 'CATALOG_SOURCE_TRANSACTION');
  return snapshot;
}

export function sourceProjectionHashes(snapshot) {
  validateSourceProjection(snapshot);
  const projections = { project: { count: 1, sha256: sha256(snapshot.project.rowText) },
    ...Object.fromEntries(TABLES.map(table => [table.table, { count: snapshot.groups[table.table].rows.length, sha256: sha256(canonical(snapshot.groups[table.table].rows)) }])),
    files: { count: snapshot.files.length, sha256: sha256(canonical(snapshot.files)) } };
  return { projections, sha256: sha256(canonical(projections)) };
}
export const projectionHashes = sourceProjectionHashes;
export function compareSourceProjections(...snapshots) {
  demand(snapshots.length === 2 || snapshots.length === 3, 'CATALOG_COMPARE_ARGUMENTS');
  snapshots.forEach((snapshot, index) => validateSourceProjection(snapshot, snapshots.length === 3 ? ['before', 'copy', 'after'][index] : undefined));
  const hashes = snapshots.map(sourceProjectionHashes);
  demand(hashes.every(value => value.sha256 === hashes[0].sha256), 'CATALOG_SOURCE_CHANGED');
  return { status: 'PASS', phases: snapshots.map(snapshot => snapshot.transaction.phase), ...hashes[0] };
}

/** Serialized, raw-pg, READ ONLY helper. Its only injection seam is an explicit fake Client in tests. */
export async function readSourceDatabase(config, testing) {
  const require = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { safeCode: code }); };
  const quote = name => { require(/^[a-z_][a-z0-9_]*$/.test(name), 'CATALOG_FIXED_IDENTIFIER'); return '"' + name + '"'; };
  let client, began = false, transportError = false, phase = 'configuration', result;
  const groups = {}, started = Date.now(); let totalRows = 0, estimatedBytes = 65536;
  try {
    require(config.schemaVersion === 'wfc.pf.catalog-copy-projection.v1' && ['before', 'copy', 'after'].includes(config.phase) &&
      config.projectId === '0c0007c9-d73f-4d13-bc87-601c544727b7' && config.projectName === 'HPU Aalborg 2023' && config.projectNumber === 'P230039 / H.7500062' &&
      config.endpoint?.host === 'host.docker.internal' && config.endpoint.port === '5434' && config.endpoint.database === 'wfc_app' &&
      config.endpoint.serverAddress === '172.17.0.2' && config.endpoint.serverPort === 5432 &&
      config.limits?.rows === 100000 && config.limits.totalRows === 200000 && config.limits.outputBytes === 67108864 && config.limits.rowBytes === 4194304 &&
      config.limits.childMilliseconds === 35000 && Array.isArray(config.tables) && config.tables.length === 19, 'CATALOG_HELPER_SCOPE');
    const parser = testing?.parse ?? (await import('pg-connection-string')).parse;
    const pg = testing?.pg ?? (await import('pg')).default;
    const uri = testing ? testing.uri : process.env.DATABASE_URL;
    require(typeof uri === 'string' && uri.length > 0 && uri.length <= 8192, 'CATALOG_CONNECTION_CONFIGURATION');
    const url = new URL(uri);
    require(['postgres:', 'postgresql:'].includes(url.protocol), 'CATALOG_CONNECTION_PROTOCOL');
    require(url.hostname === config.endpoint.host && (url.port || '5432') === config.endpoint.port && decodeURIComponent(url.pathname.slice(1)) === config.endpoint.database, 'CATALOG_CONNECTION_ENDPOINT');
    require([...url.searchParams.keys()].every(key => ['sslmode', 'uselibpqcompat'].includes(key)), 'CATALOG_CONNECTION_PARAMETERS');
    const parsed = parser(uri);
    require(parsed && parsed.host === config.endpoint.host && String(parsed.port || '5432') === config.endpoint.port && parsed.database === config.endpoint.database && !('connectionString' in parsed), 'CATALOG_PARSED_ENDPOINT');
    client = new pg.Client({ ...parsed, options: '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=20000',
      connectionTimeoutMillis: 5000, query_timeout: 20000, application_name: 'wfc-pfr1-readonly-tray-catalog' });
    client.on('error', () => { transportError = true; });
    await client.connect(); phase = 'transaction';
    const query = async (sql, values) => {
      require(!transportError, 'CATALOG_CONNECTION_LOST');
      require(Date.now() - started < config.limits.childMilliseconds, 'CATALOG_SOURCE_DEADLINE');
      const value = await client.query(sql, values);
      require(!transportError, 'CATALOG_CONNECTION_LOST');
      require(Date.now() - started < config.limits.childMilliseconds, 'CATALOG_SOURCE_DEADLINE');
      return value;
    };
    // Mark a possibly opened transaction before awaiting its acknowledgement so a
    // timeout/transport error immediately after BEGIN still attempts RO cleanup.
    began = true; await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await query("SET LOCAL statement_timeout = '15s'");
    await query("SET LOCAL lock_timeout = '2s'");
    await query("SET LOCAL idle_in_transaction_session_timeout = '20s'");
    await query("SET LOCAL TIME ZONE 'UTC'");
    const identitySql = `SELECT current_database() AS database,host(inet_server_addr()) AS "serverAddress",inet_server_port() AS "serverPort",
      current_setting('transaction_read_only') AS "readOnly",current_setting('default_transaction_read_only') AS "defaultReadOnly",
      current_setting('transaction_isolation') AS isolation,pg_current_snapshot()::text AS snapshot,CURRENT_TIMESTAMP::text AS "capturedAt"`;
    const identity = (await query(identitySql)).rows[0];
    const assertIdentity = value => require(value && value.database === config.endpoint.database && value.serverAddress === config.endpoint.serverAddress && value.serverPort === config.endpoint.serverPort &&
      value.readOnly === 'on' && value.defaultReadOnly === 'on' && value.isolation === 'repeatable read' && typeof value.snapshot === 'string' && typeof value.capturedAt === 'string', 'CATALOG_SQL_IDENTITY');
    assertIdentity(identity);
    const expression = (columns, numeric) => 'jsonb_build_object(' + columns.map(column => "'" + column + "',t." + quote(column) + (numeric.includes(column) || column.endsWith('_at') ? '::text' : '')).join(',') + ')::text';
    phase = 'project';
    const projectExpression = expression(config.projectColumns, config.projectNumericTextColumns);
    const projectRows = (await query(`SELECT ${projectExpression} AS "rowText" FROM projects t WHERE t.id=$1::uuid LIMIT 2`, [config.projectId])).rows;
    require(projectRows.length === 1 && typeof projectRows[0].rowText === 'string' && Buffer.byteLength(projectRows[0].rowText) <= config.limits.rowBytes, 'CATALOG_SOURCE_PROJECT');
    const projectRow = JSON.parse(projectRows[0].rowText);
    require(projectRow.id === config.projectId && projectRow.project_number === config.projectNumber && typeof projectRow.name === 'string' && projectRow.name.normalize('NFC').trim().toUpperCase() === config.projectName.toUpperCase(), 'CATALOG_SOURCE_PROJECT');
    estimatedBytes += 6 * Buffer.byteLength(projectRows[0].rowText);
    const read = async (tableName, predicate, parameters) => {
      phase = tableName;
      const table = config.tables.find(value => value.table === tableName);
      require(table && !groups[tableName], 'CATALOG_FIXED_TABLE');
      const rowExpression = expression(table.columns, table.numericTextColumns);
      const body = `FROM ${quote(tableName)} t WHERE ${predicate}`;
      const budget = (await query(`SELECT count(*)::text AS count,COALESCE(sum(1024+6*octet_length("rowText")),0)::text AS bytes,COALESCE(max(octet_length("rowText")),0)::text AS "maxRowBytes"
        FROM (SELECT ${rowExpression} AS "rowText" ${body} LIMIT ${config.limits.rows + 1}) bounded`, parameters)).rows[0];
      require(budget && ['count', 'bytes', 'maxRowBytes'].every(key => typeof budget[key] === 'string' && /^(?:0|[1-9][0-9]*)$/.test(budget[key])), 'CATALOG_SOURCE_BUDGET_SCHEMA');
      require(BigInt(budget.count) <= BigInt(config.limits.rows) && BigInt(totalRows) + BigInt(budget.count) <= BigInt(config.limits.totalRows), 'CATALOG_SOURCE_ROW_BUDGET');
      require(BigInt(budget.maxRowBytes) <= BigInt(config.limits.rowBytes) && BigInt(estimatedBytes) + BigInt(budget.bytes) <= BigInt(config.limits.outputBytes), 'CATALOG_SOURCE_BYTE_BUDGET');
      const keys = 'jsonb_build_array(' + table.keyColumns.map(column => 't.' + quote(column) + '::text').join(',') + ')';
      const ordering = table.keyColumns.map(column => 't.' + quote(column) + '::text COLLATE "C"').join(',');
      const rows = (await query(`SELECT ${keys} AS key,${rowExpression} AS "rowText" ${body} ORDER BY ${ordering} LIMIT ${config.limits.rows + 1}`, parameters)).rows;
      require(rows.length === Number(budget.count) && rows.length <= config.limits.rows, 'CATALOG_SOURCE_COUNT_MISMATCH');
      totalRows += rows.length; estimatedBytes += Number(budget.bytes);
      groups[tableName] = { keyColumns: table.keyColumns, columns: table.columns, numericTextColumns: table.numericTextColumns, rows };
      return rows.map(row => JSON.parse(row.rowText));
    };
    const ids = values => [...new Set(values.filter(value => value !== null))];
    const rows = name => groups[name].rows.map(row => JSON.parse(row.rowText));
    await read('trays', 't.project_id=$1::uuid', [config.projectId]);
    const cableTypes = await read('cable_types', 't.project_id=$1::uuid', [config.projectId]);
    await read('cable_type_default_materials', 't.cable_type_id=ANY($1::uuid[])', [cableTypes.map(row => row.id)]);
    const materialCableTypes = await read('material_cable_types', 't.id=ANY($1::uuid[])', [ids(cableTypes.map(row => row.source_material_cable_type_id))]);
    const distances = await read('project_support_distances', 't.project_id=$1::uuid', [config.projectId]);
    const supports = await read('material_supports', 't.id=ANY($1::uuid[])', [ids(distances.map(row => row.support_id))]);
    // Follow actual tray->curve->tray foreign keys, including reverse curve ownership, to a bounded fixed point.
    const materialTrays = await read('material_trays', `t.id IN (
      WITH RECURSIVE required(id) AS (
        SELECT mt.id FROM material_trays mt WHERE EXISTS (SELECT 1 FROM trays source_tray WHERE source_tray.project_id=$1::uuid AND LOWER(TRIM(source_tray.tray_type))=LOWER(TRIM(mt.tray_type)))
        UNION
        SELECT lc.tray_id FROM required r JOIN material_trays mt ON mt.id=r.id JOIN material_load_curves lc ON lc.id=mt.load_curve_id OR lc.tray_id=mt.id WHERE lc.tray_id IS NOT NULL
      ) SELECT id FROM required LIMIT ${config.limits.rows + 1})`, [config.projectId]);
    const curves = await read('material_load_curves', 't.id=ANY($1::uuid[]) OR t.tray_id=ANY($2::uuid[])', [ids(materialTrays.map(row => row.load_curve_id)), materialTrays.map(row => row.id)]);
    await read('material_load_curve_points', 't.load_curve_id=ANY($1::uuid[])', [curves.map(row => row.id)]);
    await read('material_cable_type_standard_materials', 't.cable_type_id=ANY($1::uuid[])', [materialCableTypes.map(row => row.id)]);
    await read('material_tray_standard_materials', 't.tray_id=ANY($1::uuid[])', [materialTrays.map(row => row.id)]);
    await read('material_support_standard_materials', 't.support_id=ANY($1::uuid[])', [supports.map(row => row.id)]);
    const materialRoots = ids(['material_cable_type_standard_materials', 'material_tray_standard_materials', 'material_support_standard_materials'].flatMap(table => rows(table).map(row => row.referenced_material_id)));
    const installationMaterials = await read('material_cable_installation_materials', `t.id IN (
      WITH RECURSIVE required(id) AS (
        SELECT unnest($1::uuid[]) UNION
        SELECT child.referenced_material_id FROM required r JOIN material_cable_installation_standard_materials child ON child.cable_installation_material_id=r.id
      ) SELECT id FROM required LIMIT ${config.limits.rows + 1})`, [materialRoots]);
    await read('material_cable_installation_standard_materials', 't.cable_installation_material_id=ANY($1::uuid[])', [installationMaterials.map(row => row.id)]);
    const purposeTemplates = await read('project_tray_purpose_templates', 't.project_id=$1::uuid', [config.projectId]);
    const projectFiles = await read('project_files', 't.project_id=$1::uuid AND t.id=ANY($2::uuid[])', [config.projectId, ids(purposeTemplates.map(row => row.project_file_id))]);
    await read('project_file_versions', 't.project_file_id=ANY($1::uuid[])', [projectFiles.map(row => row.id)]);
    const templateFiles = await read('template_files', 't.id=ANY($1::uuid[])', [ids([...materialTrays, ...supports].map(row => row.image_template_id))]);
    await read('template_file_versions', 't.template_id=ANY($1::uuid[])', [templateFiles.map(row => row.id)]);
    const orderedGroups = Object.fromEntries(config.tables.map(table => [table.table, groups[table.table]]));
    const files = ['project_files', 'project_file_versions', 'template_files', 'template_file_versions'].flatMap(table => rows(table).map(row => ({ table, id: row.id,
      storageKind: table.startsWith('project_') ? 'project' : 'template', objectKey: row.object_key, fileName: row.file_name, contentType: row.content_type, sizeBytes: row.size_bytes })));
    phase = 'final-identity'; assertIdentity((await query(identitySql)).rows[0]);
    phase = 'commit'; await query('COMMIT'); began = false;
    result = { schemaVersion: config.schemaVersion, project: { id: projectRow.id, projectNumber: projectRow.project_number, name: projectRow.name, rowText: projectRows[0].rowText },
      groups: orderedGroups, files,
      transaction: { ...identity, phase: config.phase }, source: config.source };
    require(Buffer.byteLength(JSON.stringify(result)) <= config.limits.outputBytes, 'CATALOG_SOURCE_OUTPUT_BUDGET');
  } catch (error) {
    let rollbackConfirmed = false;
    if (began && client) try { await client.query('ROLLBACK'); rollbackConfirmed = true; began = false; } catch { /* Preserve sanitized failure. */ }
    result = { schemaVersion: 'wfc.pf.tray-catalog-source-error.v1', status: 'FAIL', phase,
      code: /^[A-Z0-9_]{1,80}$/.test(error.safeCode ?? '') ? error.safeCode : 'CATALOG_SOURCE_READ_FAILED', rollbackConfirmed, transportError };
  } finally {
    if (client) try { await client.end(); } catch {
      result = { schemaVersion: 'wfc.pf.tray-catalog-source-error.v1', status: 'FAIL', phase: 'close', code: result?.code ?? 'CATALOG_SOURCE_CLOSE_FAILED', closeFailed: true, transportError };
    }
  }
  if (transportError && result?.status !== 'FAIL') result = { schemaVersion: 'wfc.pf.tray-catalog-source-error.v1', status: 'FAIL', phase: 'close', code: 'CATALOG_CONNECTION_LOST', transportError: true };
  return result;
}

export function sourceConfig(binding, phase) {
  validateBinding(binding); demand(['before', 'copy', 'after'].includes(phase), 'CATALOG_SOURCE_PHASE');
  return { schemaVersion: SCHEMA_VERSION, phase, projectId: EXPECTED.projectId, projectName: EXPECTED.projectName, projectNumber: EXPECTED.projectNumber,
    endpoint: EXPECTED.endpoint, limits: LIMITS, tables: TABLES, projectColumns: PROJECT_COLUMNS, projectNumericTextColumns: PROJECT_NUMERIC_TEXT_COLUMNS,
    source: { backendId: EXPECTED.backend.id, postgresId: EXPECTED.postgres.id, revision: EXPECTED.revision, databaseHost: EXPECTED.endpoint.host, databasePort: EXPECTED.endpoint.port, database: EXPECTED.endpoint.database } };
}

/** Does not import the application, install code or accept caller SQL; the program uses only raw pg. */
export function buildReadProgram(binding, phase) {
  const config = sourceConfig(binding, phase);
  const definitions = `const TABLES=${JSON.stringify(TABLES)},PROJECT_COLUMNS=${JSON.stringify(PROJECT_COLUMNS)},PROJECT_NUMERIC_TEXT_COLUMNS=${JSON.stringify(PROJECT_NUMERIC_TEXT_COLUMNS)},FILE_TABLES=${JSON.stringify(FILE_TABLES)},EXPECTED=${JSON.stringify(EXPECTED)},LIMITS=${JSON.stringify(LIMITS)},SCHEMA_VERSION=${JSON.stringify(SCHEMA_VERSION)};
const canonical=${canonical.toString()},object=${object.toString()},exact=${exact.toString()},equal=${equal.toString()},uuid=${uuid.toString()},decimal=${decimal.toString()},demand=${demand.toString()},parsedRow=${parsedRow.toString()};
const fileInventory=${fileInventory.toString()},validateSourceProjection=${validateSourceProjection.toString()};`;
  return `const __wfcPfR1SourceTimer=setTimeout(()=>{process.stdout.write(JSON.stringify({schemaVersion:'wfc.pf.tray-catalog-source-error.v1',status:'FAIL',phase:'deadline',code:'CATALOG_SOURCE_HARD_DEADLINE'})+String.fromCharCode(10),()=>process.exit(2));setTimeout(()=>process.exit(2),100);},${LIMITS.childMilliseconds});
try{${definitions}
let result=await (${readSourceDatabase.toString()})(${JSON.stringify(config)});
if(result.status!=='FAIL'){try{validateSourceProjection(result,${JSON.stringify(phase)});}catch(error){result={schemaVersion:'wfc.pf.tray-catalog-source-error.v1',status:'FAIL',phase:'validation',code:/^[A-Z0-9_]{1,80}$/.test(error.code??'')?error.code:'CATALOG_SOURCE_VALIDATION_FAILED'};}}
let output=JSON.stringify(result);if(Buffer.byteLength(output)>${LIMITS.outputBytes}){result={schemaVersion:'wfc.pf.tray-catalog-source-error.v1',status:'FAIL',phase:'output',code:'CATALOG_SOURCE_OUTPUT_BUDGET'};output=JSON.stringify(result);}
await new Promise((resolve,reject)=>process.stdout.write(output+String.fromCharCode(10),error=>error?reject(error):resolve()));if(result.status==='FAIL')process.exitCode=2;
}catch{await new Promise(resolve=>process.stdout.write(JSON.stringify({schemaVersion:'wfc.pf.tray-catalog-source-error.v1',status:'FAIL',phase:'program',code:'CATALOG_SOURCE_PROGRAM_FAILED'})+String.fromCharCode(10),resolve));process.exitCode=2;}finally{clearTimeout(__wfcPfR1SourceTimer);}`;
}
