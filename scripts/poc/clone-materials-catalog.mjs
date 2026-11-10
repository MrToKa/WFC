import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const SOURCE = 'wfc-app-backend-1';
export const TARGET = 'wfc-aalborg-poc-api-1';
export const columns = Object.freeze({
  material_trays: ['id', 'tray_type', 'manufacturer', 'height_mm', 'rung_height_mm', 'width_mm', 'weight_kg_per_m', 'unit_price', 'minimum_order_quantity', 'order_measurement', 'packaging', 'source', 'load_curve_id', 'image_template_id', 'created_at', 'updated_at'],
  material_load_curves: ['id', 'name', 'description', 'tray_id', 'created_at', 'updated_at'],
  material_load_curve_points: ['id', 'load_curve_id', 'point_order', 'span_m', 'load_kn_per_m', 'created_at', 'updated_at'],
  template_files: ['id', 'object_key', 'file_name', 'content_type', 'size_bytes', 'uploaded_at'],
});

export function assertContainerIdentity(value, expectedName, project, service) {
  if (value?.name !== '/' + expectedName || value?.labels?.['com.docker.compose.project'] !== project ||
      value?.labels?.['com.docker.compose.service'] !== service) throw new Error('CONTAINER_IDENTITY_MISMATCH');
}

export function assertTargetEnvironment(env) {
  const database = new URL(env.DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== 'postgres' ||
      database.pathname !== '/wfc_poc' || database.username !== 'wfc_poc' ||
      (database.port && database.port !== '5432') || env.WFC_CAD_DESIGN_ENABLED !== 'true' ||
      env.WFC_CAD_ISOLATED_STACK !== 'true' || env.MINIO_ENDPOINT !== 'minio' || env.MINIO_PORT !== '9000' ||
      env.MINIO_BUCKET_TEMPLATES !== 'wfc-poc-template-files' ||
      env.MINIO_BUCKET_PROJECTS !== 'wfc-poc-project-files' || env.WFC_MODEL_BUCKET !== 'wfc-poc-models') {
    throw new Error('TARGET_ISOLATION_REQUIRED');
  }
}

export function snapshotDigest(snapshot) {
  return createHash('sha256').update(JSON.stringify({ tables: snapshot.tables,
    images: snapshot.images.map(({ id, sha256, bytes }) => ({ id, sha256, bytes })) })).digest('hex');
}

// Executed inside SOURCE. No SQL mutation, PUT, DELETE, local files or credentials leave it.
async function captureRuntime(tableColumns) {
  const { Client: PgClient } = await import('pg');
  const { Client: MinioClient } = await import('minio');
  const { createHash: hash } = await import('node:crypto');
  const pg = new PgClient({ connectionString: process.env.DATABASE_URL, statement_timeout: 15000 });
  const store = new MinioClient({ endPoint: process.env.MINIO_ENDPOINT, port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true', accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
  const bucket = process.env.MINIO_BUCKET_TEMPLATES ?? 'wfc-template-files';
  const sha = bytes => hash('sha256').update(bytes).digest('hex');
  const read = async key => {
    const before = await store.statObject(bucket, key);
    if (!Number.isSafeInteger(before.size) || before.size < 1 || before.size > 8 * 1024 * 1024) throw new Error('IMAGE_SIZE_LIMIT');
    const stream = await store.getObject(bucket, key), chunks = [];
    let size = 0;
    for await (const chunk of stream) { size += chunk.length; if (size > 8 * 1024 * 1024) { stream.destroy(); throw new Error('IMAGE_SIZE_LIMIT'); } chunks.push(chunk); }
    const bytes = Buffer.concat(chunks), after = await store.statObject(bucket, key);
    if (size !== before.size || after.size !== before.size || after.etag !== before.etag) throw new Error('SOURCE_IMAGE_CHANGED');
    return bytes;
  };
  const select = async (table, condition = '') => (await pg.query(`SELECT ${tableColumns[table].map(name => `"${name}"::text AS "${name}"`).join(',')}
    FROM "${table}" ${condition} ORDER BY id`)).rows;
  await pg.connect();
  try {
    await pg.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await pg.query("SET LOCAL TIME ZONE 'UTC'");
    if ((await pg.query('SHOW transaction_read_only')).rows[0].transaction_read_only !== 'on') throw new Error('SOURCE_READ_ONLY_REQUIRED');
    const tables = {
      material_trays: await select('material_trays'),
      material_load_curves: await select('material_load_curves', 'WHERE id IN (SELECT load_curve_id FROM material_trays WHERE load_curve_id IS NOT NULL)'),
      material_load_curve_points: await select('material_load_curve_points', 'WHERE load_curve_id IN (SELECT load_curve_id FROM material_trays WHERE load_curve_id IS NOT NULL)'),
      template_files: await select('template_files', 'WHERE id IN (SELECT image_template_id FROM material_trays WHERE image_template_id IS NOT NULL)'),
    };
    if (!tables.material_trays.length || tables.material_trays.length > 5000 || tables.material_load_curve_points.length > 50000) throw new Error('CATALOG_SIZE_LIMIT');
    const images = [];
    let imageBytes = 0;
    for (const image of tables.template_files) {
      if (!image.content_type?.startsWith('image/')) throw new Error('NON_IMAGE_TEMPLATE_REFERENCE');
      const bytes = await read(image.object_key);
      if (image.size_bytes !== null && BigInt(image.size_bytes) !== BigInt(bytes.length)) throw new Error('SOURCE_IMAGE_SIZE_MISMATCH');
      imageBytes += bytes.length;
      if (imageBytes > 32 * 1024 * 1024) throw new Error('CATALOG_IMAGE_BUDGET');
      if (sha(await read(image.object_key)) !== sha(bytes)) throw new Error('SOURCE_IMAGE_CHANGED');
      images.push({ id: image.id, sha256: sha(bytes), bytes: bytes.length, base64: bytes.toString('base64') });
    }
    await pg.query('COMMIT');
    return { schemaVersion: 1, tables, images };
  } catch (error) { await pg.query('ROLLBACK').catch(() => {}); throw error; }
  finally { await pg.end(); }
}

// Executed only inside guarded TARGET; credentials stay in its process environment.
async function applyRuntime(tableColumns, assertEnvironment, expectedDigest) {
  assertEnvironment(process.env);
  const { Client: PgClient } = await import('pg');
  const { Client: MinioClient } = await import('minio');
  const { createHash: hash } = await import('node:crypto');
  const sha = bytes => hash('sha256').update(bytes).digest('hex');
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 64 * 1024 * 1024) throw new Error('SNAPSHOT_SIZE_LIMIT'); }
  const snapshot = JSON.parse(input);
  const digest = sha(JSON.stringify({ tables: snapshot.tables, images: snapshot.images.map(({ id, sha256, bytes }) => ({ id, sha256, bytes })) }));
  if (snapshot.schemaVersion !== 1 || digest !== expectedDigest) throw new Error('SNAPSHOT_IDENTITY_MISMATCH');
  const pg = new PgClient({ connectionString: process.env.DATABASE_URL, statement_timeout: 15000 });
  const store = new MinioClient({ endPoint: 'minio', port: 9000, useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
  const bucket = 'wfc-poc-template-files', uploaded = [], inserted = Object.fromEntries(Object.keys(tableColumns).map(name => [name, []]));
  const mapped = structuredClone(snapshot.tables);
  for (const image of mapped.template_files) image.object_key = `poc-catalog-clone/${digest}/${image.id}`;
  const readImage = async key => {
    const stream = await store.getObject(bucket, key), chunks = []; let bytes = 0;
    for await (const chunk of stream) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) { stream.destroy(); throw new Error('TARGET_IMAGE_SIZE_LIMIT'); } chunks.push(chunk); }
    return Buffer.concat(chunks);
  };
  const readRow = async (table, id) => (await pg.query(`SELECT ${tableColumns[table].map(name => `"${name}"::text AS "${name}"`).join(',')}
    FROM "${table}" WHERE id=$1`, [id])).rows[0];
  const same = (a, b) => tableColumns[a.table].every(name => a.row[name] === b[name]);
  const insert = async (table, row) => {
    const names = tableColumns[table];
    await pg.query(`INSERT INTO "${table}"(${names.map(name => `"${name}"`).join(',')}) VALUES(${names.map((_, index) => '$' + (index + 1)).join(',')})`, names.map(name => row[name]));
  };
  let committed = false;
  await pg.connect();
  try {
    await pg.query('BEGIN');
    await pg.query("SET LOCAL TIME ZONE 'UTC'");
    await pg.query("SELECT pg_advisory_xact_lock(hashtext('wfc-poc-materials-clone-v1'))");
    await pg.query('LOCK TABLE material_trays,material_load_curves,material_load_curve_points,template_files IN SHARE ROW EXCLUSIVE MODE');
    const existing = {};
    for (const table of Object.keys(tableColumns)) {
      existing[table] = new Set();
      for (const row of mapped[table]) {
        const current = await readRow(table, row.id);
        if (current) {
          if (!same({ table, row }, current)) throw new Error('TARGET_ROW_MISMATCH');
          existing[table].add(row.id);
        }
      }
    }
    for (const image of snapshot.images) {
      const row = mapped.template_files.find(value => value.id === image.id), bytes = Buffer.from(image.base64, 'base64');
      if (!row || bytes.length !== image.bytes || sha(bytes) !== image.sha256) throw new Error('SNAPSHOT_IMAGE_MISMATCH');
      let found = false;
      try {
        await store.statObject(bucket, row.object_key); found = true;
        if (sha(await readImage(row.object_key)) !== image.sha256) throw new Error('TARGET_IMAGE_MISMATCH');
      } catch (error) { if (!['NotFound', 'NoSuchKey', 'NoSuchObject'].includes(error.code)) throw error; }
      if (!found) {
        if (existing.template_files.has(image.id)) throw new Error('TARGET_IMAGE_MISSING');
        await store.putObject(bucket, row.object_key, bytes, bytes.length, { 'Content-Type': row.content_type }); uploaded.push(row.object_key);
        if (sha(await readImage(row.object_key)) !== image.sha256) throw new Error('TARGET_IMAGE_READBACK_MISMATCH');
      }
    }
    for (const table of ['template_files', 'material_load_curves', 'material_trays', 'material_load_curve_points']) {
      for (const row of mapped[table]) {
        if (existing[table].has(row.id)) continue;
        // Break the existing tray/curve FK cycle without disabling integrity checks.
        await insert(table, table === 'material_load_curves' ? { ...row, tray_id: null } : row);
        inserted[table].push(row.id);
      }
    }
    for (const row of mapped.material_load_curves) {
      if (inserted.material_load_curves.includes(row.id) && row.tray_id !== null) {
        await pg.query('UPDATE material_load_curves SET tray_id=$1 WHERE id=$2', [row.tray_id, row.id]);
      }
    }
    for (const table of Object.keys(tableColumns)) for (const row of mapped[table]) {
      if (!same({ table, row }, await readRow(table, row.id))) throw new Error('TARGET_READBACK_MISMATCH');
    }
    await pg.query('COMMIT'); committed = true;
    return { status: 'PASS', digest, rows: Object.fromEntries(Object.entries(mapped).map(([name, rows]) => [name, rows.length])),
      inserted: Object.fromEntries(Object.entries(inserted).map(([name, ids]) => [name, ids.length])),
      images: snapshot.images.map(({ id, sha256, bytes }) => ({ id, sha256, bytes })), uploadedObjects: uploaded.length,
      sourceReadOnly: true, sourceOwnershipOmitted: true };
  } catch (error) {
    await pg.query('ROLLBACK').catch(() => {});
    if (!committed) for (const key of uploaded) await store.removeObject(bucket, key).catch(() => {});
    throw error;
  } finally { await pg.end(); }
}

function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }), chunks = [], errors = [];
    let total = 0, failed = false;
    const timer = setTimeout(() => { failed = true; child.kill(); reject(new Error('DOCKER_OPERATION_TIMEOUT')); }, 120000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', bytes => { total += bytes.length; if (total > 64 * 1024 * 1024) { failed = true; child.kill(); reject(new Error('DOCKER_OUTPUT_LIMIT')); } else chunks.push(bytes); });
    child.stderr.on('data', bytes => { if (errors.reduce((sum, chunk) => sum + chunk.length, 0) < 4096) errors.push(bytes); });
    child.on('close', code => { clearTimeout(timer); if (!failed) { if (code !== 0) reject(new Error('DOCKER_OPERATION_FAILED')); else resolve(Buffer.concat(chunks).toString('utf8')); } });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}
const safeEnd = `.then(value=>console.log(JSON.stringify(value))).catch(()=>{console.error('CATALOG_CLONE_REFUSED');process.exitCode=1;})`;

export async function cloneMaterials({ apply = false } = {}) {
  for (const [name, project, service] of [[SOURCE, 'wfc-app', 'backend'], [TARGET, 'wfc-aalborg-poc', 'api']]) {
    const value = JSON.parse(await docker(['inspect', '--format', '{"name":{{json .Name}},"labels":{{json .Config.Labels}}}', name]));
    assertContainerIdentity(value, name, project, service);
  }
  const code = `(${captureRuntime.toString()})(${JSON.stringify(columns)})${safeEnd}`;
  const snapshot = JSON.parse(await docker(['exec', '-i', SOURCE, 'node', '--input-type=module', '-e', code]));
  const digest = snapshotDigest(snapshot);
  if (!apply) return { status: 'READ_ONLY_SNAPSHOT', digest,
    rows: Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) => [name, rows.length])),
    images: snapshot.images.map(({ id, sha256, bytes }) => ({ id, sha256, bytes })) };
  const targetCode = `(${applyRuntime.toString()})(${JSON.stringify(columns)},${assertTargetEnvironment.toString()},${JSON.stringify(digest)})${safeEnd}`;
  return JSON.parse(await docker(['exec', '-i', TARGET, 'node', '--input-type=module', '-e', targetCode], JSON.stringify(snapshot)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some(value => value !== '--apply') || args.length > 1) throw new Error('Only optional --apply is supported.');
  cloneMaterials({ apply: args.includes('--apply') }).then(value => console.log(JSON.stringify(value)))
    .catch(() => { console.error('CATALOG_CLONE_REFUSED'); process.exitCode = 1; });
}
