// Root-only actual SQL/HTTP controls, executed through the explicitly bound owned5191 API.
// The host operator persists raw output privately before reading any result.
const { randomUUID, createHash } = await import('node:crypto');
const { default: httpNode } = await import('node:http');
const { pool } = await import('/app/server/dist/server/db.js');
const { signAccessToken, verifyAccessToken } = await import('/app/server/dist/server/auth.js');
const { readRoutingPolicyScope } = await import('/app/server/dist/server/pathfinder/purposePolicy.js');
const { readPurposePolicyState } = await import('/app/server/dist/server/pathfinder/policySchema.js');
const { readCatalogPage } = await import('/app/server/dist/server/pathfinder/catalog.js');
const { drawingPurposePolicySchema, drawingPolicySaveSchema, drawingErrorSchema } = await import('/app/server/dist/shared/pathfinderDrawingPolicy.js');
const { policyErrorSchema, policyUuidSchema } = await import('/app/server/dist/shared/pathfinderPurposePolicy.js');
const { trayDrawingResponseSchema, projectDrawingMetricsSchema, drawingExportReceiptSchema, DRAWING_EXPORT_BODY_BYTES } = await import('/app/server/dist/shared/trayDrawingSnapshot.js');
const { parseTrayDrawingLayout } = await import('/app/server/dist/shared/trayDrawing/index.js');
const { deleteObject, getProjectBucket } = await import('/app/server/dist/server/services/objectStorageService.js');
const input = globalThis.__wfcPfR1Input;
// All cleanup identities are generated and durably recorded by the host before execution.
const owned = input?.owned ?? {};
const demoProject = '1af0f807-7653-40ea-8391-7eea6c54e7d4';
const report = { schemaVersion: 'pathfinder.drawing-positioning.actual-controls.v1', status: 'FAIL', checks: [], cleanup: 'NOT_RUN', startedAt: new Date().toISOString() };
let authorized = false, projectAttempted = false;
const usersAttempted = new Set();
const demand = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
const check = async (name, run) => { await run(); report.checks.push({ name, status: 'PASS' }); };
const principal = token => { const v = verifyAccessToken(token); return { userId: v.sub, loginId: v.jti, loginExpiresAt: v.exp * 1000 }; };
const path = suffix => 'http://web/api/projects/' + owned.projectId + suffix;
let admin, engineer, basic, technician, firstSnapshot, firstPolicy, latestPolicy;
async function request(suffix, { token = admin, body, raw, method = body === undefined && raw === undefined ? 'GET' : 'PUT' } = {}) {
  const res = await fetch(path(suffix), { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body === undefined && raw === undefined ? {} : { body: raw ?? JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const content = res.headers.get('content-type') ?? '';
  if (!content.includes('application/json')) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
  const value = await res.json();
  if (!res.ok) (suffix.includes('/pathfinder/') ? policyErrorSchema : drawingErrorSchema).parse(value);
  return { status: res.status, value };
}
async function snapshot(token = admin, trayId = owned.trayA) {
  const r = await request('/trays/' + trayId + '/drawing-snapshot', { token }); demand(r.status === 200, 'SNAPSHOT_READ');
  const value = trayDrawingResponseSchema.parse(r.value); value.layout = parseTrayDrawingLayout(value.layout); return value;
}
async function policy() { const r = await request('/pathfinder/drawing-positioning'); demand(r.status === 200, 'POLICY_READ'); return drawingPurposePolicySchema.parse(r.value); }
function command(policyValue, modes, key = randomUUID()) { return { schemaVersion: 'pathfinder.drawing-purpose-policy.write.v1', expectedCatalogRevision: policyValue.catalogRevision, expectedRevision: policyValue.drawingPolicyRevision, idempotencyKey: key, changes: [{ purposeKey: 'Synthetic shared purpose', categoryModes: modes }] }; }
async function routing() { const c = await pool.connect(); try { return await readRoutingPolicyScope(c, owned.projectId); } finally { c.release(); } }
async function headerOnly(token, suffix, size) {
  return new Promise((resolve, reject) => {
    const req = httpNode.request(path(suffix), { method: suffix.endsWith('drawing-export') ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': size, Connection: 'close', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, res => {
      let text = ''; res.on('data', bytes => { text += bytes; if (text.length > 8192) req.destroy(Error('ERROR_BOUND')); }); res.on('end', () => { try { const value = JSON.parse(text); (suffix.includes('/pathfinder/') ? policyErrorSchema : drawingErrorSchema).parse(value); resolve({ status: res.statusCode, value }); } catch (error) { reject(error); } });
    }); req.setTimeout(8000, () => req.destroy(Error('HEADER_TIMEOUT'))); req.on('error', reject); req.flushHeaders();
  });
}
const defaults = { mv: 'use-default', power: 'use-default', vfd: 'use-default', control: 'use-default' };
const smallFiles = () => [
  { kind: 'bundles', fileName: 'synthetic-bundles.png', contentType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f1sAAAAASUVORK5CYII=' },
  { kind: 'load-curve', fileName: 'synthetic-curve.png', contentType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/f1sAAAAASUVORK5CYII=' },
];
async function exportCommand(snap, key = randomUUID()) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic export transport control</w:t></w:r></w:p></w:body></w:document>');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  return { schemaVersion: 'pathfinder.tray-drawing-export.write.v1', snapshotId: snap.snapshot.snapshotId, expectedContentSha256: snap.snapshot.contentSha256, idempotencyKey: key, files: [...smallFiles(), { kind: 'report', fileName: 'synthetic-report.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: bytes.toString('base64') }] };
}
try {
  const ids = [owned.projectId, owned.adminId, owned.engineerId, owned.basicId, owned.technicianId, owned.trayA, owned.trayB, ...(Array.isArray(owned.types) ? owned.types : [])];
  demand(input?.owner === '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46' && process.env.PF_LOCAL_DEMO === 'true' && process.env.PF_ENGINE_MODE === 'oneshot' && process.env.PF_ROOT === '/var/lib/wfc/pathfinder' && ids.length === 11 && ids.every(id => policyUuidSchema.safeParse(id).success) && new Set(ids).size === ids.length && /^PF-R2a-[a-f0-9-]{36}$/.test(owned.marker ?? ''), 'ISOLATED_RUNTIME_REQUIRED');
  demand((await pool.query('SELECT id FROM projects WHERE id=$1', [demoProject])).rows.length === 1 && (await pool.query('SELECT id FROM projects WHERE id=$1', [owned.projectId])).rows.length === 0, 'OWNED_PROJECT_REQUIRED'); authorized = true;
  projectAttempted = true;
  await pool.query('INSERT INTO projects(id,project_number,name,customer,secondary_tray_length,end_connection_length,additional_bending_percent,connection_gap,cable_layout_settings) VALUES($1,$2,$3,$4,7,5,10,1,$5)', [owned.projectId, owned.marker, 'Synthetic drawing controls', 'Synthetic', { cableSpacing: 1, considerBundleSpacingAsFree: false, mv: { maxRows: 2, maxColumns: 3, bundleSpacing: '0', trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false }, power: { maxRows: 2, maxColumns: 3, bundleSpacing: '0', trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false }, vfd: { maxRows: 2, maxColumns: 3, bundleSpacing: '0', trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false }, control: { maxRows: 2, maxColumns: 3, bundleSpacing: '0', trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false } }]);
  for (const [id, isAdmin, role] of [[owned.adminId, true, 'admin'], [owned.engineerId, false, 'engineer'], [owned.basicId, false, 'basic'], [owned.technicianId, false, 'technician']]) { usersAttempted.add(id); await pool.query('INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,$2,$3,$4,$5)', [id, id + '@pfr2a.invalid', 'unusable-synthetic-hash', isAdmin, role]); }
  for (const id of [owned.engineerId, owned.basicId, owned.technicianId]) await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [id, owned.projectId]);
  admin = signAccessToken(owned.adminId, owned.adminId + '@pfr2a.invalid', true).token; engineer = signAccessToken(owned.engineerId, owned.engineerId + '@pfr2a.invalid', true).token; basic = signAccessToken(owned.basicId, owned.basicId + '@pfr2a.invalid', false).token; technician = signAccessToken(owned.technicianId, owned.technicianId + '@pfr2a.invalid', false).token;
  await pool.query("INSERT INTO trays(id,project_id,name,purpose,width_mm,height_mm,length_mm) VALUES($1,$2,'B001','Synthetic shared purpose',600,200,10000),($3,$2,'BC001','Synthetic shared purpose',600,200,10000)", [owned.trayA, owned.projectId, owned.trayB]);
  for (let i = 0; i < 4; i++) await pool.query('INSERT INTO cable_types(id,project_id,name,purpose,diameter_mm,weight_kg_per_m) VALUES($1,$2,$3,$4,10,0.1)', [owned.types[i], owned.projectId, 'Synthetic type ' + i, ['Power', 'Control', 'VFD', 'MV'][i]]);
  for (let i = 0; i < 7; i++) await pool.query('INSERT INTO cables(id,project_id,cable_id,cable_type_id,from_location,to_location,routing,design_length,install_length) VALUES($1,$2,$3,$4,$5,$6,$7,123,456)', [randomUUID(), owned.projectId, i + 1, owned.types[i < 2 ? 0 : i < 4 ? 1 : i === 4 ? 2 : i === 5 ? 3 : 1], 'Synthetic from', 'Synthetic to', i < 5 ? '/B001' : '/BC001']);
  await check('strict current admin authoring; ordinary assigned drawing readers do not gain PF access', async () => {
    for (const token of [engineer, basic, technician]) { const denied = await request('/pathfinder/drawing-positioning', { token }); demand(denied.status === 403 && denied.value.currentRevisions === null, 'ADMIN_BOUNDARY'); }
    const anonymous = await request('/trays/' + owned.trayA + '/drawing-snapshot', { token: null }); demand(anonymous.status === 401 && anonymous.value.currentRevisions === null, 'DRAWING_ANONYMOUS');
  });
  await check('shared immutable layout snapshot has same identity for admin engineer basic and technician', async () => {
    firstSnapshot = await snapshot();
    for (const token of [engineer, basic, technician]) { const read = await snapshot(token); demand(read.snapshot.snapshotId === firstSnapshot.snapshot.snapshotId && JSON.stringify(read.layout) === JSON.stringify(firstSnapshot.layout), 'SHARED_LAYOUT_IDENTITY'); demand(read.permissions.canEdit === (token === engineer), 'EXISTING_EDIT_RIGHTS'); }
    demand(firstSnapshot.snapshot.state === 'ready' && firstSnapshot.data.reportTrays.length === 2 && firstSnapshot.data.trayCables.length === 5, 'FROZEN_COMPLETE_INPUT');
    demand(firstSnapshot.layout.placements.filter(p => p.category === 'power').every(p => p.side === 'left') && firstSnapshot.layout.placements.filter(p => p.category === 'control').every(p => p.side === 'right'), 'DEFAULT_SIDES');
  });
  await check('early authenticated policy and export bounds through nginx without body bytes', async () => {
    demand((await headerOnly(null, '/pathfinder/drawing-positioning', 1048577)).status === 401, 'PREBODY_401'); demand((await headerOnly(engineer, '/pathfinder/drawing-positioning', 1048577)).status === 403, 'PREBODY_403'); demand((await headerOnly(admin, '/pathfinder/drawing-positioning', 1048577)).status === 413, 'PREBODY_POLICY_413'); demand((await headerOnly(admin, '/trays/' + owned.trayA + '/drawing-export', DRAWING_EXPORT_BODY_BYTES + 1)).status === 413, 'PREBODY_EXPORT_413');
  });
  await check('duplicate escaped keys unknown fields and cross-category booleans fail closed', async () => {
    firstPolicy = await policy(); const body = command(firstPolicy, defaults);
    for (const raw of [JSON.stringify(body).replace('"changes":', '"changes":[],"ch\\u0061nges":'), JSON.stringify({ ...body, actorId: owned.adminId }), JSON.stringify({ ...body, changes: [{ purposeKey: 'Synthetic shared purpose', categoryModes: { ...defaults, power: true } }] })]) demand((await request('/pathfinder/drawing-positioning', { raw })).status === 400, 'STRICT_WRITE');
  });
  await check('same-side mixed purposes pool jointly and drawing revision cannot change routing scope', async () => {
    const before = await routing(); const saved = await request('/pathfinder/drawing-positioning', { body: command(firstPolicy, { ...defaults, control: 'left' }) }); demand(saved.status === 200, 'SAVE_SIDE'); drawingPolicySaveSchema.parse(saved.value);
    const after = await routing(); demand(JSON.stringify(before) === JSON.stringify(after), 'DRAWING_ROUTING_LEAK');
    const read = await snapshot(); demand(read.snapshot.snapshotId !== firstSnapshot.snapshot.snapshotId && read.layout.placements.filter(p => ['power', 'control'].includes(p.category)).every(p => p.side === 'left'), 'LEFT_POOL');
    demand(read.layout.summary.centralFreeGapMm > 0 && read.layout.summary.occupiedWidthWithBundleSpacingMm < 100, 'CENTRAL_GAP_NOT_OCCUPIED'); latestPolicy = await policy();
  });
  await check('concurrent policy CAS and exact-key replay save one command without duplicate history', async () => {
    const a = command(latestPolicy, { ...defaults, power: 'right', control: 'right' });
    const results = await Promise.all([request('/pathfinder/drawing-positioning', { body: a }), request('/pathfinder/drawing-positioning', { body: a })]); demand(results.every(r => r.status === 200) && results.filter(r => r.value.duplicate).length === 1, 'IDEMPOTENT_CONCURRENCY');
    const replay = await request('/pathfinder/drawing-positioning', { body: a }); demand(replay.status === 200 && replay.value.duplicate, 'HISTORICAL_REPLAY');
    demand((await request('/pathfinder/drawing-positioning', { body: { ...a, changes: [{ purposeKey: 'Synthetic shared purpose', categoryModes: defaults }] } })).status === 409, 'REPLAY_PAYLOAD_CONFLICT');
    demand((await request('/pathfinder/drawing-positioning', { body: command(latestPolicy, defaults) })).status === 409, 'STALE_CAS');
    latestPolicy = await policy();
  });
  await check('default reset and MV plus another occupied side use the same verified layout', async () => {
    demand((await request('/pathfinder/drawing-positioning', { body: command(latestPolicy, defaults) })).status === 200, 'RESET_DEFAULT');
    const read = await snapshot(admin, owned.trayB); demand(read.layout.placements.some(v => v.category === 'mv' && v.side === 'left') && read.layout.placements.some(v => v.category === 'control' && v.side === 'right') && read.layout.summary.centralFreeGapMm > 0, 'MV_SIDES');
    demand((await policy()).rules.length === 0, 'RESET_UNAUTHORED');
  });
  await check('assigned engineer tray overrides persist and do not permit basic or technician writes', async () => {
    const before = await snapshot(engineer); const body = { schemaVersion: 'pathfinder.tray-drawing-settings.write.v1', expectedDrawingInputRevision: before.snapshot.drawingInputRevision, expectedRevision: before.override.revision, idempotencyKey: randomUUID(), value: { useCustom: true, categories: { power: { maxRows: 1, maxColumns: 3, bundleSpacing: '0', trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false } } } };
    for (const token of [basic, technician]) demand((await request('/trays/' + owned.trayA + '/drawing-settings', { body, token })).status === 403, 'READONLY_OVERRIDE');
    const saved = await request('/trays/' + owned.trayA + '/drawing-settings', { body, token: engineer }); demand(saved.status === 200 && saved.value.override.revision === '1', 'ENGINEER_SETTINGS');
    demand((await request('/trays/' + owned.trayA + '/drawing-settings', { body, token: engineer })).status === 200, 'SETTINGS_EXACT_REPLAY');
    demand((await request('/trays/' + owned.trayA + '/drawing-settings', { body: { ...body, idempotencyKey: randomUUID() }, token: engineer })).status === 409, 'SETTINGS_STALE');
  });
  await check('ordinary list and XLSX ignore arbitrary client occupancy and use current layout proof', async () => {
    const normal = await request('/trays?drawingMetrics=1', { token: basic }); demand(normal.status === 200, 'METRICS_READ'); const metrics = projectDrawingMetricsSchema.parse(normal.value);
    demand(metrics.trays.length === 2 && metrics.provenance.length === 2 && metrics.freeSpaceByTrayId[owned.trayA] > 0, 'METRICS_COMPLETE');
    const exported = await request('/trays/export', { token: technician, method: 'POST', body: { freeSpaceByTrayId: { [owned.trayA]: 0 } } }); demand(exported.status === 200 && exported.bytes?.subarray(0, 2).toString() === 'PK', 'XLSX_EXPORT');
    const { default: JSZip } = await import('jszip'); const zip = await JSZip.loadAsync(exported.bytes); const workbook = await zip.file('xl/workbook.xml').async('string'); demand(workbook.includes('Drawing provenance'), 'XLSX_PROVENANCE');
    const XLSX = await import('xlsx'); const parsed = XLSX.read(exported.bytes, { type: 'buffer' }); const rows = XLSX.utils.sheet_to_json(parsed.Sheets.Trays, { header: 1 }); const trayRow = rows.find(row => row[0] === 'B001');
    demand(trayRow?.[6] === Math.round(metrics.freeSpaceByTrayId[owned.trayA] * 100) / 100 && trayRow[6] !== 0, 'XLSX_SERVER_OCCUPANCY');
  });
  await check('atomic three-file export provenance exact replay and generated output does not stale itself', async () => {
    const before = await snapshot(), body = await exportCommand(before); const route = '/trays/' + owned.trayA + '/drawing-export';
    const exported = await request(route, { method: 'POST', body }); demand(exported.status === 200, 'ATOMIC_EXPORT'); const receipt = drawingExportReceiptSchema.parse(exported.value); demand(receipt.files.length === 3 && !receipt.duplicate, 'EXPORT_RECEIPT');
    const after = await snapshot(); demand(before.snapshot.snapshotId === after.snapshot.snapshotId && before.snapshot.contentSha256 === after.snapshot.contentSha256, 'EXPORT_SELF_STALE');
    const replay = await request(route, { method: 'POST', body }); demand(replay.status === 200 && replay.value.duplicate, 'EXPORT_REPLAY');
    demand((await pool.query('SELECT id FROM project_files WHERE project_id=$1', [owned.projectId])).rows.length === 3, 'EXPORT_ATOMIC_FILE_COUNT');
    demand((await request(route, { method: 'POST', body: { ...body, files: body.files.map(f => f.kind === 'report' ? { ...f, fileName: 'changed.docx' } : f) } })).status === 409, 'EXPORT_CHANGED_PAYLOAD');
  });
  await check('generated output replacement is scoped to tray and kind', async () => {
    const other = await snapshot(admin, owned.trayB), body = await exportCommand(other); demand((await request('/trays/' + owned.trayB + '/drawing-export', { method: 'POST', body })).status === 409, 'CROSS_TRAY_OUTPUT_CONFLICT');
  });
  await check('changed tray revision stales prior report without changing cable lengths or routing', async () => {
    const before = await snapshot(), body = await exportCommand(before), routingBefore = await routing();
    await pool.query('UPDATE trays SET width_mm=650 WHERE project_id=$1 AND id=$2', [owned.projectId, owned.trayA]);
    demand((await request('/trays/' + owned.trayA + '/drawing-export', { method: 'POST', body })).status === 409, 'STALE_EXPORT'); const after = await snapshot(); demand(after.snapshot.snapshotId !== before.snapshot.snapshotId && JSON.stringify(await routing()) === JSON.stringify(routingBefore), 'DRAWING_DEPENDENCY_SPLIT');
    const cables = (await pool.query('SELECT routing,design_length::text,install_length::text FROM cables WHERE project_id=$1', [owned.projectId])).rows; demand(cables.every(v => v.design_length === '123' && v.install_length === '456'), 'LENGTH_PRESERVATION');
  });
  await check('purpose remove and readd cannot revive authored side modes', async () => {
    const p = await policy(); demand((await request('/pathfinder/drawing-positioning', { body: command(p, { ...defaults, control: 'left' }) })).status === 200, 'ABA_AUTHOR');
    await pool.query("UPDATE trays SET purpose='Temporary synthetic purpose' WHERE project_id=$1", [owned.projectId]); await pool.query("UPDATE trays SET purpose='Synthetic shared purpose' WHERE project_id=$1", [owned.projectId]); demand((await policy()).rules.length === 0, 'DRAWING_INCARNATION_ABA');
  });
  await check('current role login and assignment revocation fence reads writes and historical replay', async () => {
    const p = await policy(), body = command(p, defaults); demand((await request('/pathfinder/drawing-positioning', { body })).status === 200, 'REVOKE_SETUP');
    await pool.query('UPDATE users SET is_admin=false,role=$2 WHERE id=$1', [owned.adminId, 'basic']); const denied = await request('/pathfinder/drawing-positioning', { body }); demand(denied.status === 403 && denied.value.currentRevisions === null, 'CURRENT_ADMIN_REVOKED'); await pool.query("UPDATE users SET is_admin=true,role='admin' WHERE id=$1", [owned.adminId]);
    await pool.query('DELETE FROM user_project_access WHERE project_id=$1 AND user_id=$2', [owned.projectId, owned.basicId]); demand((await request('/trays/' + owned.trayA + '/drawing-snapshot', { token: basic })).status === 403, 'ASSIGNMENT_REVOKED');
    await pool.query('UPDATE viewer_login_bindings SET revoked_at=now() WHERE login_id=$1', [principal(engineer).loginId]); demand((await request('/trays/' + owned.trayA + '/drawing-snapshot', { token: engineer })).status === 401, 'LOGIN_REVOKED');
  });
  await check('real copied project settings routing masks bindings scopes and engineering lengths remain unmodified', async () => {
    const real = (await pool.query('SELECT secondary_tray_length::text,end_connection_length::text,additional_bending_percent::text,connection_gap::text FROM projects WHERE id=$1', [demoProject])).rows[0]; demand(real.secondary_tray_length === '7' && real.end_connection_length === '5' && real.additional_bending_percent === '10' && real.connection_gap === '1', 'REAL_DETAILS');
    for (const table of ['pf_routing_purpose_rules', 'pf_drawing_purpose_rules', 'pf_location_bindings', 'pf_artifact_routing_scopes']) demand((await pool.query('SELECT 1 FROM ' + table + ' WHERE project_id=$1', [demoProject])).rows.length === 0, 'NO_INVENTED_REAL_DATA');
  });
  report.status = 'PASS';
} catch (error) { report.code = /^[A-Z][A-Z0-9_]{0,95}$/.test(error?.code ?? '') ? error.code : 'ACTUAL_DRAWING_CONTROL_FAILED'; }
finally {
  try {
    if (authorized && projectAttempted) {
      const current = (await pool.query('SELECT project_number FROM projects WHERE id=$1', [owned.projectId])).rows[0]; demand(current?.project_number === owned.marker, 'CLEANUP_PROJECT_OWNERSHIP');
      const stages = (await pool.query('SELECT id,stage FROM pf_drawing_exports WHERE project_id=$1', [owned.projectId])).rows;
      const keys = new Set(); for (const entry of stages) for (const file of entry.stage.files) { demand(file.objectKey.startsWith('projects/' + owned.projectId + '/drawing-exports/' + entry.id + '/'), 'CLEANUP_OBJECT_SCOPE'); keys.add(file.objectKey); }
      const fileKeys = (await pool.query('SELECT object_key FROM project_files WHERE project_id=$1 UNION SELECT v.object_key FROM project_file_versions v JOIN project_files f ON f.id=v.project_file_id WHERE f.project_id=$1', [owned.projectId])).rows; for (const row of fileKeys) { demand(row.object_key.startsWith('projects/' + owned.projectId + '/drawing-exports/'), 'CLEANUP_FILE_SCOPE'); keys.add(row.object_key); }
      demand((await pool.query('DELETE FROM projects WHERE id=$1 AND project_number=$2', [owned.projectId, owned.marker])).rowCount === 1, 'CLEANUP_PROJECT_DELETE');
      for (const key of keys) { demand((await pool.query('SELECT 1 FROM project_files WHERE object_key=$1 UNION SELECT 1 FROM project_file_versions WHERE object_key=$1 UNION SELECT 1 FROM pf_drawing_export_files WHERE object_key=$1', [key])).rows.length === 0, 'CLEANUP_REFERENCED_OBJECT'); await deleteObject(getProjectBucket(), key); }
    }
    if (authorized) for (const id of usersAttempted) { const current = (await pool.query('SELECT email FROM users WHERE id=$1', [id])).rows[0]; if (!current) continue; demand(current.email === id + '@pfr2a.invalid', 'CLEANUP_USER_OWNERSHIP'); demand((await pool.query('DELETE FROM users WHERE id=$1 AND email=$2', [id, id + '@pfr2a.invalid'])).rowCount === 1, 'CLEANUP_USER_DELETE'); }
    report.cleanup = authorized ? 'PASS' : 'NOT_NEEDED';
  } catch { report.cleanup = 'FAIL'; report.status = 'FAIL'; report.code ??= 'OWNED_FIXTURE_CLEANUP_FAILED'; }
  await pool.end(); report.finishedAt = new Date().toISOString(); process.stdout.write(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
}
