import { createHash, randomUUID } from 'node:crypto';
import { TABLES, validateSourceProjection, sourceProjectionHashes } from './source-lib.mjs';

export { TABLES };
export const PROJECT_DRAWING_COLUMNS = Object.freeze(['support_distance', 'support_weight', 'tray_load_safety_factor', 'cable_layout_settings']);
export const TRANSFER_LIMITS = Object.freeze({ planBytes: 80 * 1024 ** 2, outputBytes: 64 * 1024 ** 2, rows: 200000,
  groupRows: 100000, rowBytes: 4 * 1024 ** 2, childMilliseconds: 35000, hostMilliseconds: 45000, stderrBytes: 32768 });
export const TRANSFER_TARGET = Object.freeze({ owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46', project: 'wfc-pathfinder-local-0cba87606e9b',
  port: 5191, projectId: '1af0f807-7653-40ea-8391-7eea6c54e7d4', modelVersionId: 'a613151e-c370-45c5-80f3-42ae58603b9a',
  contentFingerprint: 'b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34' });

// Serialized into the fixed operator helper. TABLES/limits/target are emitted
// by buildTransferProgram, never accepted as configurable SQL identifiers.
function transferKernel(tables, limits, targetFixed) {
  const demand = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { safeCode: code, code }); };
  const canonical = x => x === null || typeof x !== 'object' ? JSON.stringify(x) : Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
  const sha = x => createHash('sha256').update(x).digest('hex');
  const same = (a, b) => canonical(a) === canonical(b);
  const exact = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) && same(Object.keys(x).sort(), [...keys].sort());
  const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
  const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
  const byTable = new Map(tables.map(t => [t.table, t]));
  const metadata = ['id', 'created_at', 'updated_at', 'uploaded_at', 'uploaded_by'];
  const fileTables = ['project_files', 'project_file_versions', 'template_files', 'template_file_versions'];
  const projectDrawingColumns = ['support_distance', 'support_weight', 'tray_load_safety_factor', 'cable_layout_settings'];
  const sourceProjectColumns = ['id', 'project_number', 'name', 'secondary_tray_length', 'end_connection_length', 'additional_bending_percent', ...projectDrawingColumns];
  const ownedChildren = [
    ['material_cable_types', 'material_cable_type_standard_materials', 'cable_type_id'],
    ['material_trays', 'material_tray_standard_materials', 'tray_id'],
    ['material_supports', 'material_support_standard_materials', 'support_id'],
    ['material_load_curves', 'material_load_curve_points', 'load_curve_id'],
    ['material_cable_installation_materials', 'material_cable_installation_standard_materials', 'cable_installation_material_id'],
  ];
  const rowId = (t, values) => t.keyColumns.length === 1 && t.keyColumns[0] === 'id' ? values[0] : canonical(values);
  const minimalSeed = row => byTable.get('cable_types').columns.every(k => {
    if (['id', 'project_id', 'name', 'created_at', 'updated_at'].includes(k)) return true;
    return k === 'change_log' ? Array.isArray(row[k]) && row[k].length === 0 : row[k] === null;
  });
  const parseRow = (table, entry) => {
    demand(exact(entry, ['key', 'rowText']) && Array.isArray(entry.key) && entry.key.length === table.keyColumns.length && entry.key.every(x => typeof x === 'string' && x.length <= 65536) && typeof entry.rowText === 'string' && Buffer.byteLength(entry.rowText) <= limits.rowBytes, 'TRANSFER_ROW_SHAPE');
    let row; try { row = JSON.parse(entry.rowText); } catch { demand(false, 'TRANSFER_ROW_JSON'); }
    demand(exact(row, table.columns) && table.keyColumns.every((key, i) => row[key] === entry.key[i]), 'TRANSFER_ROW_KEYS');
    demand(table.numericTextColumns.every(key => row[key] === null || typeof row[key] === 'string' && row[key].length <= 4096 && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(row[key])), 'TRANSFER_NUMERIC_TEXT');
    if (table.columns.includes('id')) demand(uuid(row.id), 'TRANSFER_ROW_UUID');
    demand((table.booleanColumns ?? []).every(key => typeof row[key] === 'boolean') && (table.integerColumns ?? []).every(key => Number.isSafeInteger(row[key]) && row[key] >= -2147483648 && row[key] <= 2147483647), 'TRANSFER_SCALAR_VALUE');
    for (const fk of table.foreignKeys) demand(fk.nullable && row[fk.column] === null || uuid(row[fk.column]), 'TRANSFER_FK_VALUE');
    return row;
  };
  function validateTarget(target) {
    demand(target && Object.entries(targetFixed).every(([k, v]) => target[k] === v) && typeof target.serverAddress === 'string' && /^172\.(?:1[6-9]|2[0-9]|3[01])\.(?:[0-9]{1,3})\.(?:[0-9]{1,3})$/.test(target.serverAddress), 'TRANSFER_TARGET_SCOPE');
    return target;
  }
  function validateGroups(groups) {
    demand(exact(groups, tables.map(t => t.table)), 'TRANSFER_GROUP_SET'); let total = 0;
    for (const t of tables) {
      const g = groups[t.table];
      demand(exact(g, ['keyColumns', 'columns', 'numericTextColumns', 'rows']) && same(g.keyColumns, t.keyColumns) && same(g.columns, t.columns) && same(g.numericTextColumns, t.numericTextColumns) && Array.isArray(g.rows) && g.rows.length <= limits.groupRows, 'TRANSFER_GROUP_SHAPE');
      total += g.rows.length; demand(total <= limits.rows, 'TRANSFER_ROW_BUDGET');
      const keys = new Set();
      for (const e of g.rows) { parseRow(t, e); const key = canonical(e.key); demand(!keys.has(key), 'TRANSFER_DUPLICATE_ROW'); keys.add(key); }
    }
    return groups;
  }
  function validateBaseline(baseline) {
    demand(exact(baseline, ['schemaVersion', 'target', 'actorId', 'projectRowText', 'modelSelection', 'groups', 'transaction']) && baseline.schemaVersion === 'wfc.pf.tray-catalog-target-baseline.v1', 'TRANSFER_BASELINE_SCHEMA');
    validateTarget(baseline.target); demand(uuid(baseline.actorId) && typeof baseline.projectRowText === 'string' && Buffer.byteLength(baseline.projectRowText) <= limits.rowBytes, 'TRANSFER_BASELINE_OWNER');
    let p; try { p = JSON.parse(baseline.projectRowText); } catch { demand(false, 'TRANSFER_PROJECT_JSON'); }
    demand(p.id === targetFixed.projectId && baseline.modelSelection?.active_model_version_id === targetFixed.modelVersionId && baseline.modelSelection.content_fingerprint === targetFixed.contentFingerprint && baseline.modelSelection.state === 'ready' && baseline.modelSelection.health === 'healthy' && typeof baseline.modelSelection.selection_revision === 'string', 'TRANSFER_BASELINE_MODEL');
    const tx = baseline.transaction;
    demand(exact(tx, ['mode', 'status', 'identity', 'commitConfirmed', 'transportError']) && tx.mode === 'repeatable-read-read-only' && tx.status === 'observed' && tx.commitConfirmed === true && tx.transportError === false && exact(tx.identity, ['database', 'address', 'port', 'ro']) && tx.identity.database === 'wfc_pathfinder_local' && tx.identity.address === baseline.target.serverAddress && tx.identity.port === 5432 && tx.identity.ro === 'on', 'TRANSFER_BASELINE_UNCONFIRMED');
    validateGroups(baseline.groups); return baseline;
  }
  function validateFiles(planFiles, rows, owner) {
    demand(exact(planFiles, ['status', 'owner', 'prefix', 'entries', 'manifestSha256', 'receiptSha256']) && planFiles.status === 'PASS' && uuid(planFiles.owner) && planFiles.owner === owner && planFiles.prefix === 'pathfinder-tray-catalog/' + owner + '/' && Array.isArray(planFiles.entries) && planFiles.entries.length <= 4096 && hash(planFiles.receiptSha256) && hash(planFiles.manifestSha256), 'TRANSFER_FILES_NOT_STAGED');
    demand(sha(canonical({ owner: planFiles.owner, prefix: planFiles.prefix, entries: planFiles.entries })) === planFiles.manifestSha256, 'TRANSFER_FILE_MANIFEST_HASH');
    const keys = new Set(), ids = new Set(); let total = 0;
    const planned = rows.filter(r => fileTables.includes(r.table));
    demand(planned.length === planFiles.entries.length, 'TRANSFER_FILE_CLOSURE');
    for (const f of planFiles.entries) {
      demand(exact(f, ['table', 'sourceId', 'targetId', 'sourceObjectKey', 'targetObjectKey', 'bytes', 'sha256', 'readbackSha256']) && fileTables.includes(f.table) && uuid(f.sourceId) && uuid(f.targetId) && Number.isSafeInteger(f.bytes) && f.bytes >= 0 && f.bytes <= 2147483648 && hash(f.sha256) && f.readbackSha256 === f.sha256 && typeof f.sourceObjectKey === 'string' && f.sourceObjectKey.length > 0 && f.targetObjectKey === planFiles.prefix + f.table + '/' + f.targetId && f.sourceObjectKey !== f.targetObjectKey, 'TRANSFER_FILE_IDENTITY');
      const r = planned.find(r => r.table === f.table && r.sourceId === f.sourceId), value = r && parseRow(byTable.get(r.table), { key: r.sourceKey, rowText: r.sourceRowText });
      demand(r && r.targetId === f.targetId && r.overrides.object_key === f.targetObjectKey && value.object_key === f.sourceObjectKey && (value.size_bytes === null || BigInt(value.size_bytes) === BigInt(f.bytes)), 'TRANSFER_FILE_ROW_BINDING');
      demand(!keys.has(f.targetObjectKey) && !ids.has(f.table + ':' + f.sourceId), 'TRANSFER_FILE_DUPLICATE'); keys.add(f.targetObjectKey); ids.add(f.table + ':' + f.sourceId);
      total += f.bytes; demand(total <= 8 * 1024 ** 3, 'TRANSFER_FILE_TOTAL_BUDGET');
    }
  }
  function validatePlan(plan) {
    demand(exact(plan, ['schemaVersion', 'id', 'createdAt', 'target', 'actorId', 'source', 'seed', 'baseline', 'filePlan', 'projectDrawing', 'rows']) && plan.schemaVersion === 'wfc.pf.tray-catalog-transfer-plan.v1' && uuid(plan.id) && typeof plan.createdAt === 'string' && Number.isFinite(Date.parse(plan.createdAt)), 'TRANSFER_PLAN_SCHEMA');
    validateTarget(plan.target); validateBaseline(plan.baseline);
    demand(uuid(plan.actorId) && plan.actorId === plan.baseline.actorId && same(plan.target, plan.baseline.target), 'TRANSFER_PLAN_OWNER');
    demand(exact(plan.source, ['projectId', 'projectionSha256', 'ref']) && exact(plan.seed, ['ref', 'types']), 'TRANSFER_INPUT_REFERENCE');
    for (const ref of [plan.source.ref, plan.seed.ref]) demand(exact(ref, ['path', 'bytes', 'sha256']) && typeof ref.path === 'string' && ref.path.length > 0 && Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && ref.bytes <= limits.planBytes && hash(ref.sha256), 'TRANSFER_INPUT_REFERENCE');
    demand(plan.source.projectId === '0c0007c9-d73f-4d13-bc87-601c544727b7' && hash(plan.source.projectionSha256) && Array.isArray(plan.seed.types) && plan.seed.types.length === 50, 'TRANSFER_SOURCE_BINDING');
    const drawing = plan.projectDrawing;
    demand(exact(drawing, ['columns', 'sourceRowText', 'targetExpectedRowText']) && same(drawing.columns, projectDrawingColumns) && typeof drawing.sourceRowText === 'string' && Buffer.byteLength(drawing.sourceRowText) <= limits.rowBytes && drawing.targetExpectedRowText === plan.baseline.projectRowText, 'TRANSFER_PROJECT_DRAWING_SCOPE');
    let sourceProject, targetProject;
    try { sourceProject = JSON.parse(drawing.sourceRowText); targetProject = JSON.parse(drawing.targetExpectedRowText); } catch { demand(false, 'TRANSFER_PROJECT_DRAWING_JSON'); }
    demand(exact(sourceProject, sourceProjectColumns) && sourceProject.id === plan.source.projectId && typeof sourceProject.project_number === 'string' && typeof sourceProject.name === 'string', 'TRANSFER_PROJECT_DRAWING_SOURCE');
    demand(projectDrawingColumns.every(k => Object.hasOwn(targetProject, k) && targetProject[k] === null), 'TRANSFER_PROJECT_DRAWING_NOT_INITIAL_NULL');
    demand(projectDrawingColumns.slice(0, 3).every(k => typeof sourceProject[k] === 'string' && sourceProject[k].length <= 4096 && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(sourceProject[k])) && sourceProject.cable_layout_settings !== null && typeof sourceProject.cable_layout_settings === 'object' && !Array.isArray(sourceProject.cable_layout_settings), 'TRANSFER_PROJECT_DRAWING_SOURCE_VALUE');
    const mapped = new Map(), all = new Set(), targetKeys = new Set(), insertedIds = new Set();
    demand(Array.isArray(plan.rows) && plan.rows.length <= limits.rows, 'TRANSFER_PLAN_ROW_BUDGET');
    for (const r of plan.rows) {
      demand(exact(r, ['table', 'sourceId', 'targetId', 'sourceKey', 'targetKey', 'action', 'sourceRowText', 'overrides', 'targetExpectedRowText']) && byTable.has(r.table) && ['insert', 'enrich', 'reuse'].includes(r.action), 'TRANSFER_PLAN_ROW_SCHEMA');
      const t = byTable.get(r.table), value = parseRow(t, { key: r.sourceKey, rowText: r.sourceRowText });
      demand(r.sourceId === rowId(t, r.sourceKey) && Array.isArray(r.targetKey) && r.targetKey.length === t.keyColumns.length && r.targetKey.every(x => typeof x === 'string') && r.targetId === rowId(t, r.targetKey) && r.overrides && typeof r.overrides === 'object' && !Array.isArray(r.overrides) && Object.keys(r.overrides).every(k => t.columns.includes(k)), 'TRANSFER_PLAN_MAPPING');
      demand(!mapped.has(r.table + ':' + r.sourceId) && !targetKeys.has(r.table + ':' + r.targetId), 'TRANSFER_MAPPING_DUPLICATE');
      mapped.set(r.table + ':' + r.sourceId, r); targetKeys.add(r.table + ':' + r.targetId);
      if (t.columns.includes('id')) {
        demand(uuid(r.targetId) && r.overrides.id === r.targetId, 'TRANSFER_TARGET_UUID'); all.add(r.sourceId);
        if (r.action === 'insert') { demand(!insertedIds.has(r.targetId), 'TRANSFER_UUID_COLLISION'); insertedIds.add(r.targetId); }
      }
      if (t.scope === 'project') demand(value.project_id === plan.source.projectId && r.overrides.project_id === targetFixed.projectId, 'TRANSFER_FOREIGN_PROJECT');
      demand(t.keyColumns.every((k, i) => (Object.hasOwn(r.overrides, k) ? r.overrides[k] : value[k]) === r.targetKey[i]), 'TRANSFER_TARGET_KEY');
      demand(r.action === 'insert' ? r.targetExpectedRowText === null : typeof r.targetExpectedRowText === 'string' && Buffer.byteLength(r.targetExpectedRowText) <= limits.rowBytes, 'TRANSFER_EXPECTED_ROW');
      if (r.action === 'enrich') {
        demand(r.table === 'cable_types' && plan.seed.types.some(x => x.sourceId === r.sourceId && x.id === r.targetId && x.name === value.name), 'TRANSFER_ENRICH_SCOPE');
        const expected = parseRow(t, { key: r.targetKey, rowText: r.targetExpectedRowText });
        demand(expected.project_id === targetFixed.projectId && expected.name === value.name && minimalSeed(expected), 'TRANSFER_SEED_TYPE_NOT_MINIMAL');
      }
      demand(r.action !== 'reuse' || t.scope !== 'project', 'TRANSFER_PROJECT_REUSE_REFUSED');
      const allowed = new Set(['id', ...t.foreignKeys.map(f => f.column), ...(fileTables.includes(r.table) ? ['object_key'] : []), ...(r.action === 'reuse' ? metadata : [])]);
      demand(Object.keys(r.overrides).every(k => allowed.has(k)), 'TRANSFER_OVERRIDE_SCOPE');
      if (t.columns.includes('uploaded_by') && r.action !== 'reuse') demand(r.overrides.uploaded_by === plan.actorId, 'TRANSFER_UPLOAD_ACTOR');
    }
    demand(new Set(plan.seed.types.map(s => s.sourceId)).size === 50 && new Set(plan.seed.types.map(s => s.id)).size === 50 && plan.rows.filter(r => r.action === 'enrich').length === 50 && plan.seed.types.every(s => exact(s, ['sourceId', 'id', 'name']) && uuid(s.sourceId) && uuid(s.id) && typeof s.name === 'string' && mapped.get('cable_types:' + s.sourceId)?.targetId === s.id), 'TRANSFER_SEED_MAP');
    for (const r of plan.rows) {
      const t = byTable.get(r.table), value = parseRow(t, { key: r.sourceKey, rowText: r.sourceRowText });
      if (t.columns.includes('id') && r.action === 'insert') demand(!all.has(r.targetId) && r.targetId !== plan.actorId && r.targetId !== plan.id && !tables.some(other => plan.baseline.groups[other.table].rows.some(e => other.columns.includes('id') && e.key[0] === r.targetId)), 'TRANSFER_SOURCE_ID_REUSED');
      for (const f of t.foreignKeys) {
        const source = value[f.column], desired = Object.hasOwn(r.overrides, f.column) ? r.overrides[f.column] : source;
        demand(source === null && f.nullable && desired === null || f.table === 'projects' && source === plan.source.projectId && desired === targetFixed.projectId || f.table === 'users' && (r.action === 'reuse' || desired === plan.actorId) || source !== null && mapped.get(f.table + ':' + source)?.targetId === desired, 'TRANSFER_FOREIGN_KEY_MAPPING');
      }
    }
    // A global parent also owns its defaults/curve points. Reusing only the
    // parent's scalar row must never add to or reinterpret another project's
    // shared child collection. Both directions of that collection are exact.
    for (const [parent, child, column] of ownedChildren) for (const p of plan.rows.filter(r => r.table === parent && r.action === 'reuse')) {
      const selected = plan.rows.filter(r => r.table === child && JSON.parse(r.sourceRowText)[column] === p.sourceId);
      const existing = plan.baseline.groups[child].rows.filter(e => JSON.parse(e.rowText)[column] === p.targetId);
      demand(selected.every(r => r.action === 'reuse') && selected.length === existing.length && existing.every(e => selected.some(r => same(r.targetKey, e.key))), 'TRANSFER_GLOBAL_CHILD_CLOSURE');
    }
    demand(!plan.baseline.groups.cable_type_default_materials.rows.some(e => plan.seed.types.some(s => JSON.parse(e.rowText).cable_type_id === s.id)), 'TRANSFER_SEED_CHILD_NOT_MINIMAL');
    validateFiles(plan.filePlan, plan.rows, plan.id);
    demand(Buffer.byteLength(JSON.stringify(plan)) <= limits.planBytes, 'TRANSFER_PLAN_BYTES'); return plan;
  }
  const normalizedGroups = groups => Object.fromEntries(tables.map(t => [t.table, groups[t.table].rows.map(e => ({ key: e.key, rowText: e.rowText })).sort((a, b) => canonical(a.key) < canonical(b.key) ? -1 : canonical(a.key) > canonical(b.key) ? 1 : 0)]));
  const groupDigest = groups => sha(canonical(normalizedGroups(groups)));
  const quoted = x => { demand(/^[a-z_][a-z0-9_]*$/.test(x), 'TRANSFER_SQL_IDENTIFIER'); return '"' + x + '"'; };
  const projected = (t, alias) => `jsonb_build_object(${t.columns.flatMap(k => ["'" + k + "'", `${alias}.${quoted(k)}${t.numericTextColumns.includes(k) ? '::text' : ''}`]).join(',')})`;
  async function database(config, testing) {
    let client, began = false, writes = false, commitAttempted = false, commitConfirmed = false, transportError = false, phase = 'scope', statementTag = 'configuration', result;
    const failConnection = () => { transportError = true; };
    const query = (sql, parameters) => {
      statementTag = /^\/\* pf-tray:([a-z][a-z_:-]{0,79}) \*\//.exec(sql)?.[1] ?? (/^(BEGIN|SET|LOCK|COMMIT|ROLLBACK)\b/.exec(sql)?.[1].toLowerCase() ?? 'fixed-statement');
      return client.query(sql, parameters);
    };
    try {
      demand(['baseline', 'apply', 'verify'].includes(config.mode) && uuid(config.actorId), 'TRANSFER_HELPER_SCOPE'); validateTarget(config.target);
      if (config.mode !== 'baseline') { validatePlan(config.plan); demand(config.actorId === config.plan.actorId && same(config.target, config.plan.target), 'TRANSFER_CONFIG_PLAN'); }
      if (testing) client = testing.client;
      else {
        const { Client } = await import('pg'), { parse } = await import('pg-connection-string');
        const uri = process.env.DATABASE_URL ?? '', parsed = parse(uri), url = new URL(uri);
        demand(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === 'postgres' && (url.port || '5432') === '5432' && decodeURIComponent(url.pathname.slice(1)) === 'wfc_pathfinder_local' && url.search === '' && parsed.host === 'postgres' && parsed.port === '5432' && parsed.database === 'wfc_pathfinder_local' && parsed.user === 'pf_local' && /^[a-f0-9]{64}$/.test(parsed.password ?? ''), 'TRANSFER_HELPER_ENDPOINT');
        client = new Client({ host: 'postgres', port: 5432, database: 'wfc_pathfinder_local', user: 'pf_local', password: parsed.password, connectionTimeoutMillis: 5000, query_timeout: 10000,
          application_name: 'wfc-pf-tray-catalog-transfer', options: '-c statement_timeout=8000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=10000 -c default_transaction_read_only=' + (config.mode === 'apply' ? 'off' : 'on') });
      }
      client.on('error', failConnection); await client.connect();
      began = true; await query(config.mode === 'apply' ? 'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await query("SET LOCAL statement_timeout='8s'"); await query("SET LOCAL lock_timeout='3s'"); await query("SET LOCAL idle_in_transaction_session_timeout='10s'"); await query("SET LOCAL TIME ZONE 'UTC'");
      const identity = (await query("/* pf-tray:identity */ SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('transaction_read_only') AS ro")).rows[0];
      demand(identity?.database === 'wfc_pathfinder_local' && identity.address === config.target.serverAddress && identity.port === 5432 && identity.ro === (config.mode === 'apply' ? 'off' : 'on') && !transportError, 'TRANSFER_SQL_IDENTITY');
      phase = 'locking';
      demand((await query('/* pf-tray:advisory */ SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', ['wfc-pf-tray-catalog:' + targetFixed.projectId])).rows[0]?.locked === true, 'TRANSFER_BUSY');
      const suffix = config.mode === 'apply' ? ' FOR NO KEY UPDATE' : '';
      const project = (await query('/* pf-tray:project */ SELECT to_jsonb(p)::text AS "rowText" FROM projects p WHERE p.id=$1' + suffix, [targetFixed.projectId])).rows;
      demand(project.length === 1, 'TRANSFER_PROJECT_REQUIRED');
      const admin = (await query('/* pf-tray:admin */ SELECT id,is_admin FROM users WHERE id=$1' + (config.mode === 'apply' ? ' FOR SHARE' : ''), [config.actorId])).rows;
      demand(admin.length === 1 && admin[0].id === config.actorId && admin[0].is_admin === true, 'TRANSFER_ADMIN_REQUIRED');
      const modelSelection = (await query(`/* pf-tray:model */ SELECT s.active_model_version_id,s.selection_revision::text AS selection_revision,v.content_fingerprint,v.state,v.health FROM project_model_selections s JOIN model_versions v ON v.project_id=s.project_id AND v.id=s.active_model_version_id WHERE s.project_id=$1${config.mode === 'apply' ? ' FOR SHARE OF s,v' : ''}`, [targetFixed.projectId])).rows[0];
      demand(modelSelection?.active_model_version_id === targetFixed.modelVersionId && modelSelection.content_fingerprint === targetFixed.contentFingerprint && modelSelection.state === 'ready' && modelSelection.health === 'healthy', 'TRANSFER_MODEL_CHANGED');
      demand((await query('/* pf-tray:synthetic */ SELECT project_id FROM pf_synthetic_projects WHERE project_id=$1', [targetFixed.projectId])).rows.length === 0, 'TRANSFER_SYNTHETIC_PROJECT_REFUSED');
      if (config.mode === 'apply') await query('LOCK TABLE ' + tables.map(t => quoted(t.table)).sort().join(',') + ' IN SHARE ROW EXCLUSIVE MODE');
      async function readGroups() {
        const groups = {}; let totalBytes = 0, rows = 0;
        for (const t of tables) {
          const budget = (await query(`/* pf-tray:budget:${t.table} */ SELECT count(*)::text AS count,COALESCE(sum(octet_length(${projected(t, 't')}::text)),0)::text AS bytes,COALESCE(max(octet_length(${projected(t, 't')}::text)),0)::text AS "maxRowBytes" FROM ${quoted(t.table)} t`)).rows[0];
          demand(budget && ['count', 'bytes', 'maxRowBytes'].every(k => typeof budget[k] === 'string' && /^(?:0|[1-9][0-9]*)$/.test(budget[k])) && BigInt(budget.count) <= BigInt(limits.groupRows) && BigInt(budget.maxRowBytes) <= BigInt(limits.rowBytes) && BigInt(budget.bytes) + BigInt(totalBytes) <= BigInt(limits.outputBytes), 'TRANSFER_TARGET_PRETRANSFER_BUDGET');
          const order = t.keyColumns.map(k => `t.${quoted(k)}::text COLLATE "C"`).join(',');
          const values = (await query(`/* pf-tray:group:${t.table} */ SELECT ARRAY[${t.keyColumns.map(k => `t.${quoted(k)}::text`).join(',')}] AS key,${projected(t, 't')}::text AS "rowText" FROM ${quoted(t.table)} t ORDER BY ${order} LIMIT ${limits.groupRows + 1}`)).rows;
          demand(values.length <= limits.groupRows, 'TRANSFER_TARGET_GROUP_BUDGET'); rows += values.length; demand(rows <= limits.rows, 'TRANSFER_TARGET_ROW_BUDGET');
          totalBytes += Buffer.byteLength(JSON.stringify(values)); demand(totalBytes <= limits.outputBytes, 'TRANSFER_TARGET_OUTPUT_BUDGET');
          groups[t.table] = { keyColumns: t.keyColumns, columns: t.columns, numericTextColumns: t.numericTextColumns, rows: values };
        }
        validateGroups(groups); demand(!transportError, 'TRANSFER_CONNECTION_LOST'); return groups;
      }
      phase = 'snapshot'; const beforeGroups = await readGroups();
      if (config.mode === 'baseline') {
        result = { schemaVersion: 'wfc.pf.tray-catalog-target-baseline.v1', target: config.target, actorId: config.actorId, projectRowText: project[0].rowText, modelSelection, groups: beforeGroups,
          transaction: { mode: 'repeatable-read-read-only', status: 'observed', identity } };
      } else {
        const plan = config.plan;
        demand(same(modelSelection, plan.baseline.modelSelection), 'TRANSFER_PROJECT_OR_MODEL_STALE');
        // PostgreSQL alone reconstructs typed project values. In particular,
        // neither NUMERIC text nor nested JSON numbers pass through JS output.
        const desiredProject = (await query(`/* pf-tray:project-desired */ SELECT (to_jsonb(b)||jsonb_build_object(${projectDrawingColumns.flatMap(k => ["'" + k + "'", 's.' + quoted(k)]).join(',')}))::text AS "rowText" FROM jsonb_populate_record(NULL::projects,$1::jsonb) b CROSS JOIN jsonb_populate_record(NULL::projects,$2::jsonb) s`, [plan.projectDrawing.targetExpectedRowText, plan.projectDrawing.sourceRowText])).rows;
        demand(desiredProject.length === 1 && typeof desiredProject[0].rowText === 'string' && Buffer.byteLength(desiredProject[0].rowText) <= limits.rowBytes, 'TRANSFER_PROJECT_DRAWING_DESIRED');
        const finalProjectRowText = desiredProject[0].rowText;
        const projectIsBefore = project[0].rowText === plan.projectDrawing.targetExpectedRowText, projectIsFinal = project[0].rowText === finalProjectRowText;
        demand(projectIsBefore || projectIsFinal, 'TRANSFER_PROJECT_OR_MODEL_STALE');
        const desired = new Map(), expectedFinal = structuredClone(plan.baseline.groups);
        for (const r of plan.rows) {
          const t = byTable.get(r.table);
          const comparison = (await query(`/* pf-tray:desired:${r.table} */ SELECT ${projected(t, 'd')}::text AS "desiredRowText",(${projected(t, 'd')}-$3::text[])::text AS "desiredBusinessRowText",($4::jsonb-$3::text[])::text AS "expectedBusinessRowText" FROM jsonb_populate_record(NULL::${quoted(t.table)},$1::jsonb||$2::jsonb) d`, [r.sourceRowText, JSON.stringify(r.overrides), metadata.filter(k => t.columns.includes(k)), r.targetExpectedRowText ?? '{}'])).rows[0];
          demand(comparison && typeof comparison.desiredRowText === 'string', 'TRANSFER_DESIRED_PROJECTION');
          parseRow(t, { key: r.targetKey, rowText: comparison.desiredRowText });
          if (r.action === 'reuse') demand(comparison.desiredBusinessRowText === comparison.expectedBusinessRowText && comparison.desiredRowText === r.targetExpectedRowText, 'TRANSFER_GLOBAL_COLLISION');
          desired.set(r.table + ':' + r.targetId, comparison.desiredRowText);
          const entries = expectedFinal[r.table].rows, index = entries.findIndex(e => same(e.key, r.targetKey));
          if (r.action === 'insert') { demand(index === -1, 'TRANSFER_BASELINE_INSERT_COLLISION'); entries.push({ key: r.targetKey, rowText: comparison.desiredRowText }); }
          else { demand(index >= 0 && entries[index].rowText === r.targetExpectedRowText, 'TRANSFER_BASELINE_CAS'); entries[index] = { key: r.targetKey, rowText: comparison.desiredRowText }; }
        }
        if (projectIsFinal && groupDigest(beforeGroups) === groupDigest(expectedFinal)) {
          result = { schemaVersion: 'wfc.pf.tray-catalog-transfer-result.v1', status: 'PASS', mode: config.mode, operation: 'already_transferred', projectId: targetFixed.projectId, planId: plan.id, groupsSha256: groupDigest(beforeGroups), counts: Object.fromEntries(tables.map(t => [t.table, beforeGroups[t.table].rows.length])) };
        } else {
          demand(config.mode === 'apply', 'TRANSFER_VERIFY_NOT_FINAL');
          demand(projectIsBefore && groupDigest(beforeGroups) === groupDigest(plan.baseline.groups), 'TRANSFER_PARTIAL_OR_CHANGED_TARGET');
          phase = 'writing';
          const pending = plan.rows.filter(r => r.action === 'insert'), done = new Set(), cycleFields = new Map();
          const inserted = new Set();
          while (pending.length) {
            let progressed = false;
            for (let i = 0; i < pending.length;) {
              const r = pending[i], t = byTable.get(r.table), source = parseRow(t, { key: r.sourceKey, rowText: r.sourceRowText }), cycle = {};
              const waiting = t.foreignKeys.some(f => {
                const v = Object.hasOwn(r.overrides, f.column) ? r.overrides[f.column] : source[f.column];
                if (v === null || ['projects', 'users'].includes(f.table)) return false;
                const dependency = plan.rows.find(p => p.table === f.table && p.targetId === v);
                if (!dependency || dependency.action !== 'insert' || done.has(dependency.table + ':' + dependency.targetId)) return false;
                if (f.nullable && (r.table === 'material_trays' && f.column === 'load_curve_id' || r.table === 'material_load_curves' && f.column === 'tray_id')) { cycle[f.column] = null; return false; }
                return true;
              });
              if (waiting) { i++; continue; }
              demand(!transportError, 'TRANSFER_CONNECTION_LOST'); writes = true;
              const desiredText = desired.get(r.table + ':' + r.targetId);
              const insertedResult = await query(`/* pf-tray:insert:${r.table} */ INSERT INTO ${quoted(t.table)} (${t.columns.map(quoted).join(',')}) SELECT ${t.columns.map(k => 'd.' + quoted(k)).join(',')} FROM jsonb_populate_record(NULL::${quoted(t.table)},$1::jsonb||$2::jsonb) d`, [desiredText, JSON.stringify(cycle)]);
              demand(insertedResult.rowCount === 1, 'TRANSFER_INSERT_COUNT');
              if (Object.keys(cycle).length) cycleFields.set(r.table + ':' + r.targetId, { r, cycle });
              done.add(r.table + ':' + r.targetId); inserted.add(r.table + ':' + r.targetId); pending.splice(i, 1); progressed = true;
            }
            demand(progressed, 'TRANSFER_UNRESOLVED_DEPENDENCY_CYCLE');
          }
          for (const { r, cycle } of cycleFields.values()) {
            demand(inserted.has(r.table + ':' + r.targetId), 'TRANSFER_CYCLE_NOT_NEW_OWNED'); const t = byTable.get(r.table), columns = Object.keys(cycle);
            const where = t.keyColumns.map((k, i) => `t.${quoted(k)}::text=$${i + 3}`).join(' AND ');
            const update = await query(`/* pf-tray:cycle:${r.table} */ UPDATE ${quoted(t.table)} t SET ${columns.map(k => quoted(k) + '=d.' + quoted(k)).join(',')} FROM jsonb_populate_record(NULL::${quoted(t.table)},$1::jsonb) d WHERE ${where} AND ${projected(t, 't')}=(${projected(t, 'd')}||$2::jsonb)`, [desired.get(r.table + ':' + r.targetId), JSON.stringify(cycle), ...r.targetKey]);
            demand(update.rowCount === 1, 'TRANSFER_CYCLE_CAS');
          }
          for (const r of plan.rows.filter(r => r.action === 'enrich')) {
            demand(!transportError, 'TRANSFER_CONNECTION_LOST'); const t = byTable.get(r.table); writes = true;
            const update = await query(`/* pf-tray:enrich:${r.table} */ UPDATE ${quoted(t.table)} t SET ${t.columns.filter(k => k !== 'id').map(k => quoted(k) + '=d.' + quoted(k)).join(',')} FROM jsonb_populate_record(NULL::${quoted(t.table)},$1::jsonb) d WHERE t.id=$2::uuid AND ${projected(t, 't')}=$3::jsonb`, [desired.get(r.table + ':' + r.targetId), r.targetId, r.targetExpectedRowText]);
            demand(update.rowCount === 1, 'TRANSFER_ENRICH_CAS');
          }
          phase = 'project-drawing'; demand(!transportError, 'TRANSFER_CONNECTION_LOST'); writes = true;
          const projectUpdate = await query(`/* pf-tray:project-drawing */ UPDATE projects t SET ${projectDrawingColumns.map(k => quoted(k) + '=s.' + quoted(k)).join(',')} FROM jsonb_populate_record(NULL::projects,$1::jsonb) s WHERE t.id=$2::uuid AND to_jsonb(t)=$3::jsonb AND ${projectDrawingColumns.map(k => 't.' + quoted(k) + ' IS NULL').join(' AND ')}`, [plan.projectDrawing.sourceRowText, targetFixed.projectId, plan.projectDrawing.targetExpectedRowText]);
          demand(projectUpdate.rowCount === 1, 'TRANSFER_PROJECT_DRAWING_CAS');
          phase = 'fidelity'; const actual = await readGroups(); demand(groupDigest(actual) === groupDigest(expectedFinal), 'TRANSFER_FINAL_FIDELITY');
          const projectFinal = (await query('/* pf-tray:project-final */ SELECT to_jsonb(p)::text AS "rowText" FROM projects p WHERE p.id=$1', [targetFixed.projectId])).rows;
          demand(projectFinal.length === 1 && projectFinal[0].rowText === finalProjectRowText, 'TRANSFER_PROJECT_DRAWING_FIDELITY');
          result = { schemaVersion: 'wfc.pf.tray-catalog-transfer-result.v1', status: 'PASS', mode: config.mode, operation: 'transferred', projectId: targetFixed.projectId, planId: plan.id, groupsSha256: groupDigest(actual), counts: Object.fromEntries(tables.map(t => [t.table, actual[t.table].rows.length])) };
        }
        result.projectDrawing = { columns: projectDrawingColumns, beforeSha256: sha(plan.projectDrawing.targetExpectedRowText), afterSha256: sha(finalProjectRowText) };
      }
      demand(!transportError, 'TRANSFER_CONNECTION_LOST'); phase = 'commit'; commitAttempted = true;
      await query('COMMIT'); began = false; commitConfirmed = true;
      result = config.mode === 'baseline' ? { ...result, transaction: { ...result.transaction, commitConfirmed: true, transportError: false } } : { ...result, commitConfirmed: true, transportError: false };
    } catch (error) {
      const failedStatementTag = statementTag, databaseCode = /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : undefined;
      let rollbackConfirmed = false; if (began) try { await query('ROLLBACK'); began = false; rollbackConfirmed = true; } catch { /* Preserve uncertainty. */ }
      result = { schemaVersion: 'wfc.pf.tray-catalog-transfer-result.v1', status: 'FAIL', error: error.safeCode ?? 'TRANSFER_DATABASE_FAILURE', phase, databaseCode, statementTag: failedStatementTag, writesAttempted: writes, commitAttempted, commitConfirmed, rollbackConfirmed, transportError, outcome: commitAttempted && !commitConfirmed ? 'unknown' : rollbackConfirmed || !writes ? 'not_committed' : 'unknown' };
    } finally {
      if (client) try { await client.end(); } catch { transportError = true; result = { ...result, status: 'FAIL', error: 'TRANSFER_CLOSE_FAILED', outcome: commitConfirmed ? 'committed' : 'unknown' }; }
    }
    if (transportError) result = { ...result, status: 'FAIL', error: result.error ?? 'TRANSFER_CONNECTION_LOST', transportError: true, outcome: commitConfirmed ? 'committed' : result.outcome ?? 'unknown' };
    return result;
  }
  return { canonical, sha, same, exact, uuid, hash, parseRow, rowId, minimalSeed, validateTarget, validateGroups, validateBaseline, validatePlan, validateFiles, database, metadata, fileTables };
}
const kernel = transferKernel(TABLES, TRANSFER_LIMITS, TRANSFER_TARGET);
export const canonical = kernel.canonical;
export const sha256 = kernel.sha;
export const validateTransferPlan = kernel.validatePlan;
export const validateTargetBaseline = kernel.validateBaseline;
export const transferDatabase = kernel.database;
export const captureTargetBaseline = (config, testing) => kernel.database({ ...config, mode: 'baseline' }, testing);

/** Pure allocation only; root supplies immutable, verified private source bytes. */
export function createTransferPlan({ sourceProjection, seedPlan, targetBaseline, filePlan, actorId, sourceRef, seedRef }, { makeUuid = randomUUID, now = new Date().toISOString() } = {}) {
  validateSourceProjection(sourceProjection); kernel.validateBaseline(targetBaseline);
  const demand = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code, safeCode: code }); };
  const sourceProject = sourceProjection.project.id, target = targetBaseline.target;
  demand(kernel.uuid(actorId) && actorId === targetBaseline.actorId && seedPlan?.schemaVersion === 'pathfinder.copied-project.seed-plan.v1' && seedPlan.id === target.projectId && seedPlan.source?.projectId === sourceProject && Array.isArray(seedPlan.types) && seedPlan.types.length === 50, 'TRANSFER_SEED_REQUIRED');
  demand(filePlan?.status === 'PASS' && kernel.uuid(filePlan.owner), 'TRANSFER_FILES_REQUIRED');
  const baselineRows = new Map(TABLES.map(t => [t.table, targetBaseline.groups[t.table].rows.map(e => ({ entry: e, value: kernel.parseRow(t, e) }))]));
  const sourceRows = TABLES.flatMap(t => sourceProjection.groups[t.table].rows.map(e => ({ t, entry: e, value: kernel.parseRow(t, e) })));
  const forbidden = new Set([sourceProject, actorId, filePlan.owner, ...sourceRows.filter(r => r.t.columns.includes('id')).map(r => r.value.id), ...[...baselineRows.values()].flat().filter(r => r.value.id).map(r => r.value.id)]), generated = new Set();
  const fresh = () => { const id = makeUuid(); demand(kernel.uuid(id) && !forbidden.has(id) && !generated.has(id), 'TRANSFER_UUID_COLLISION'); generated.add(id); return id; };
  const mapped = new Map(), actions = new Map();
  for (const { t, entry, value } of sourceRows) {
    const sourceId = kernel.rowId(t, entry.key), seed = t.table === 'cable_types' && seedPlan.types.find(x => x.sourceId === sourceId), file = kernel.fileTables.includes(t.table) && filePlan.entries.find(f => f.table === t.table && f.sourceId === sourceId);
    let id = t.columns.includes('id') ? seed ? seed.id : file ? file.targetId : fresh() : null, action = seed ? 'enrich' : 'insert', existing;
    if (seed) {
      existing = baselineRows.get(t.table).find(r => r.value.id === seed.id);
      demand(existing && value.name === seed.name && existing.value.project_id === target.projectId && existing.value.name === seed.name && kernel.minimalSeed(existing.value), 'TRANSFER_SEED_TYPE_NOT_MINIMAL');
    } else if (t.scope === 'global' && t.columns.includes('id') && baselineRows.get(t.table).some(r => r.value.id === sourceId)) {
      existing = baselineRows.get(t.table).find(r => r.value.id === sourceId); id = existing.value.id; action = 'reuse';
    } else if (t.uniqueNameColumn) {
      const name = value[t.uniqueNameColumn];
      const candidates = baselineRows.get(t.table).filter(r => (t.scope !== 'project' || r.value.project_id === target.projectId) && typeof name === 'string' && typeof r.value[t.uniqueNameColumn] === 'string' && r.value[t.uniqueNameColumn].toLowerCase() === name.toLowerCase());
      demand(candidates.length <= 1, 'TRANSFER_GLOBAL_NAME_AMBIGUOUS');
      if (candidates.length) { existing = candidates[0]; demand(!file || file.targetId === existing.value.id, 'TRANSFER_FILE_NAME_COLLISION'); id = existing.value.id; action = 'reuse'; }
    }
    if (t.columns.includes('id')) demand(kernel.uuid(id), 'TRANSFER_MAPPED_UUID');
    mapped.set(t.table + ':' + sourceId, id); actions.set(t.table + ':' + sourceId, { action, existing });
  }
  // Unique parent/order or parent/child dependency rows can be reused only under
  // exact desired business equality later in PostgreSQL, never by name alone.
  for (const item of sourceRows) {
    const { t, entry, value } = item, sourceId = kernel.rowId(t, entry.key), state = actions.get(t.table + ':' + sourceId);
    if (state.action !== 'insert' || !t.uniqueKeys?.length) continue;
    for (const unique of t.uniqueKeys) {
      const wanted = Object.fromEntries(unique.columns.map(k => {
        const ref = t.foreignKeys.find(f => f.column === k); return [k, ref && value[k] !== null ? mapped.get(ref.table + ':' + value[k]) : value[k]];
      }));
      const candidates = baselineRows.get(t.table).filter(r => unique.columns.every(k => r.value[k] === wanted[k]));
      demand(candidates.length <= 1, 'TRANSFER_UNIQUE_DEPENDENCY_AMBIGUOUS');
      if (candidates.length) { state.action = 'reuse'; state.existing = candidates[0]; mapped.set(t.table + ':' + sourceId, candidates[0].value.id); break; }
    }
  }
  const rows = sourceRows.map(({ t, entry, value }) => {
    const sourceId = kernel.rowId(t, entry.key), state = actions.get(t.table + ':' + sourceId), overrides = {};
    if (t.columns.includes('id')) overrides.id = mapped.get(t.table + ':' + sourceId);
    for (const fk of t.foreignKeys) {
      const id = value[fk.column];
      overrides[fk.column] = fk.table === 'projects' ? target.projectId : fk.table === 'users' ? actorId : id === null ? null : mapped.get(fk.table + ':' + id);
      demand(overrides[fk.column] !== undefined, 'TRANSFER_DEPENDENCY_UNMAPPED');
    }
    const file = kernel.fileTables.includes(t.table) && filePlan.entries.find(f => f.table === t.table && f.sourceId === sourceId);
    if (kernel.fileTables.includes(t.table)) { demand(file, 'TRANSFER_FILE_MAPPING_REQUIRED'); overrides.object_key = file.targetObjectKey; }
    const targetKey = t.keyColumns.map(k => Object.hasOwn(overrides, k) ? overrides[k] : value[k]);
    if (state.action === 'insert' && !t.columns.includes('id')) {
      const collision = baselineRows.get(t.table).find(r => kernel.same(r.entry.key, targetKey));
      if (collision) { state.action = 'reuse'; state.existing = collision; }
    }
    if (state.action === 'reuse') for (const k of kernel.metadata) if (t.columns.includes(k)) overrides[k] = state.existing.value[k];
    return { table: t.table, sourceId, targetId: kernel.rowId(t, targetKey), sourceKey: entry.key, targetKey, action: state.action, sourceRowText: entry.rowText, overrides, targetExpectedRowText: state.existing?.entry.rowText ?? null };
  });
  const plan = { schemaVersion: 'wfc.pf.tray-catalog-transfer-plan.v1', id: filePlan.owner, createdAt: now, target, actorId,
    source: { projectId: sourceProject, projectionSha256: sourceProjectionHashes(sourceProjection).sha256, ref: sourceRef },
    seed: { ref: seedRef, types: seedPlan.types.map(t => ({ sourceId: t.sourceId, id: t.id, name: t.name })) }, baseline: targetBaseline, filePlan,
    projectDrawing: { columns: PROJECT_DRAWING_COLUMNS, sourceRowText: sourceProjection.project.rowText, targetExpectedRowText: targetBaseline.projectRowText }, rows };
  return kernel.validatePlan(plan);
}

export function buildTransferProgram() {
  return `const timer=setTimeout(()=>{process.stdout.write(JSON.stringify({schemaVersion:'wfc.pf.tray-catalog-transfer-result.v1',status:'FAIL',error:'TRANSFER_HARD_DEADLINE',outcome:'unknown'})+String.fromCharCode(10),()=>process.exit(2));setTimeout(()=>process.exit(2),200);},${TRANSFER_LIMITS.childMilliseconds});\ntry{const {createHash}=await import('node:crypto');const kernel=(${transferKernel.toString()})(${JSON.stringify(TABLES)},${JSON.stringify(TRANSFER_LIMITS)},${JSON.stringify(TRANSFER_TARGET)});const config=globalThis.__wfcPfR1Input;if(!config||Buffer.byteLength(JSON.stringify(config))>${TRANSFER_LIMITS.planBytes + 65536})throw Error('TRANSFER_INPUT_LIMIT');const result=await kernel.database(config);const bytes=Buffer.from(JSON.stringify(result)+String.fromCharCode(10));if(bytes.length>${TRANSFER_LIMITS.outputBytes})throw Error('TRANSFER_OUTPUT_LIMIT');await new Promise((resolve,reject)=>process.stdout.write(bytes,e=>e?reject(e):resolve()));clearTimeout(timer);process.exitCode=result.status==='FAIL'?2:0;}catch{process.stdout.write(JSON.stringify({schemaVersion:'wfc.pf.tray-catalog-transfer-result.v1',status:'FAIL',error:'TRANSFER_HELPER_FAILURE',outcome:'unknown'})+String.fromCharCode(10),()=>process.exit(2));setTimeout(()=>process.exit(2),200);}`;
}
