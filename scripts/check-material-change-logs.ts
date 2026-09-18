// Run against a disposable database only:
// WFC_MATERIAL_AUDIT_TEST_DATABASE_URL=postgres://.../wfc_audit_test npx tsx scripts/check-material-change-logs.ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import * as XLSX from 'xlsx';

const databaseUrl = process.env.WFC_MATERIAL_AUDIT_TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/wfc_audit_test') {
  throw new Error(
    'Set WFC_MATERIAL_AUDIT_TEST_DATABASE_URL to a disposable wfc_audit_test database.',
  );
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  JWT_SECRET: 'material-audit-integration-test',
  MINIO_ACCESS_KEY: 'test-only',
  MINIO_SECRET_KEY: 'test-only',
});
const { pool, initializeDatabase } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { signAccessToken } = await import('../server/auth.js');
const { materialAuditActor } = await import('../server/services/materialAuditContext.js');
const { withMaterialTransaction } = await import('../server/services/materialAuditPool.js');
await initializeDatabase();
// Verify that startup can safely run again against an existing schema.
await initializeDatabase();
const userId = randomUUID();
await pool.query(
  `INSERT INTO users (id, email, password_hash, first_name, last_name, is_admin, role)
  VALUES ($1, $2, 'test', 'Audit', 'Tester', true, 'admin')`,
  [userId, `${userId}@test.invalid`],
);
const token = signAccessToken(userId, `${userId}@test.invalid`, true).token;
const server = createApp().listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}/api/materials`;
const request = async (path: string, method = 'GET', data?: unknown, expected = 200) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
    body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
};
type Entry = { userId: string; userName: string; changedAt: string; changes: string[] };
const history = async (category: string, id: string): Promise<Entry[]> =>
  (await request(`/change-logs/${category}/${id}`)).changeLog;
const categories = [
  ['cable-type', 'cable-types', 'cableType'],
  ['cable-installation-material', 'cable-installation-materials', 'cableInstallationMaterial'],
  ['tray-installation-material', 'tray-installation-materials', 'trayInstallationMaterial'],
  ['instrument', 'instruments', 'instrument'],
  [
    'instrument-installation-material',
    'instrument-installation-materials',
    'instrumentInstallationMaterial',
  ],
  ['tray', 'trays', 'tray'],
  ['support', 'supports', 'support'],
] as const;
try {
  const created = new Map<string, { id: string; path: string; name: string }>();
  for (const [category, path, item] of categories) {
    const name = `${category}-${randomUUID()}`;
    const data = { [category === 'cable-type' ? 'name' : 'type']: name, unitPrice: 2 };
    const result = await request(`/${path}`, 'POST', data, 201);
    const id: string = result[item].id;
    created.set(category, { id, path, name });
    let log = await history(category, id);
    assert.equal(log.length, 1);
    assert.equal(log[0].userId, userId);
    assert.equal(log[0].userName, 'Audit Tester');
    assert(!Number.isNaN(Date.parse(log[0].changedAt)));
    await request(`/${path}/${id}`, 'PATCH', { unitPrice: 3, manufacturer: 'New maker' });
    log = await history(category, id);
    assert.equal(log.length, 2);
    assert(log[0].changes.includes('Price: 2 → 3'));
    assert(log[0].changes.includes('Manufacturer: Not specified → New maker'));
    await request(`/${path}/${id}`, 'PATCH', { unitPrice: 3 });
    assert.equal((await history(category, id)).length, 2, `${category}: no-op edit`);
  }
  for (const [category] of categories) {
    const owner = created.get(category)!;
    const referenceCategory = category.startsWith('instrument')
      ? 'instrument-installation-material'
      : category === 'tray-installation-material'
        ? 'tray-installation-material'
        : 'cable-installation-material';
    // Composition owners cannot reference themselves; create a separate child.
    const childPath = created.get(referenceCategory)!.path;
    const childItem = categories.find(([key]) => key === referenceCategory)![2];
    const child = await request(`/${childPath}`, 'POST', { type: `Child-${randomUUID()}` }, 201);
    const assignment = await request(
      `/${owner.path}/${owner.id}/standard-materials`,
      'POST',
      {
        referencedMaterialId: child[childItem].id,
        quantity: 2,
        unit: 'pcs',
        remarks: 'Initial',
      },
      201,
    );
    assert(
      (await history(category, owner.id))[0].changes.some((change) => change.includes('created.')),
    );
    const assignmentPath = `/${owner.path}/${owner.id}/standard-materials/${assignment.standardMaterial.id}`;
    await request(assignmentPath, 'PATCH', { quantity: 4, remarks: null });
    assert(
      (await history(category, owner.id))[0].changes.some((change) =>
        change.endsWith('Quantity: 2 → 4'),
      ),
    );
    await request(assignmentPath, 'DELETE', undefined, 204);
    assert(
      (await history(category, owner.id))[0].changes.some((change) => change.includes('deleted.')),
    );
  }
  for (const [category] of categories) {
    const owner = created.get(category)!;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          Type: owner.name,
          Manufacturer: 'New maker',
          Price: 7,
          'Height [mm]': 10,
          'Rung height [mm]': 5,
          'Width [mm]': 20,
          'Length [mm]': 100,
          'Weight [kg/m]': 2,
          'Weight [kg]': 2,
        },
      ]),
    );
    const upload = new FormData();
    upload.append(
      'file',
      new Blob([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })]),
      'materials.xlsx',
    );
    await request('/' + owner.path + '/import', 'POST', upload);
    assert(
      (await history(category, owner.id))[0].changes.includes('Price: 3 → 7'),
      category + ': import price history',
    );
  }
  const cable = created.get('cable-type')!;

  const curve = (
    await request(
      '/load-curves',
      'POST',
      {
        name: `Curve-${randomUUID()}`,
        points: [{ spanM: 2, loadKnPerM: 3 }],
      },
      201,
    )
  ).loadCurve;
  assert.equal((await history('load-curve', curve.id)).length, 1);
  await request(`/load-curves/${curve.id}`, 'PATCH', { points: [{ spanM: 2, loadKnPerM: 3 }] });
  assert.equal((await history('load-curve', curve.id)).length, 1, 'Identical replacement points');
  await request(`/load-curves/${curve.id}`, 'PATCH', { points: [{ spanM: 2, loadKnPerM: 5 }] });
  assert(
    (await history('load-curve', curve.id))[0].changes.includes('Point 1 / Load [kN/m]: 3 → 5'),
  );

  const pointWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    pointWorkbook,
    XLSX.utils.json_to_sheet([{ 'L [m]': 2, 'q(L) [kN/m]': 6 }]),
    'CurveData',
  );
  const pointUpload = new FormData();
  pointUpload.append(
    'file',
    new Blob([XLSX.write(pointWorkbook, { type: 'buffer', bookType: 'xlsx' })]),
    'curve.xlsx',
  );
  await request(`/load-curves/${curve.id}/import`, 'POST', pointUpload);
  assert(
    (await history('load-curve', curve.id))[0].changes.includes('Point 1 / Load [kN/m]: 5 → 6'),
  );

  const beforeRollback = await history('cable-type', cable.id);
  await assert.rejects(
    materialAuditActor.run(userId, () =>
      withMaterialTransaction(async (client) => {
        await client.query('UPDATE material_cable_types SET unit_price = 99 WHERE id = $1', [
          cable.id,
        ]);
        throw new Error('Intentional rollback');
      }),
    ),
    /Intentional rollback/,
  );
  assert.deepEqual(await history('cable-type', cable.id), beforeRollback);
  assert.equal(
    (await pool.query('SELECT unit_price FROM material_cable_types WHERE id = $1', [cable.id]))
      .rows[0].unit_price,
    '7',
  );
  const systemActor = await pool.query(
    "SELECT NULLIF(current_setting('wfc.material_actor', true), '') AS actor",
  );
  assert.equal(systemActor.rows[0].actor, null, 'No actor leaks through the pool');
  await request(`/change-logs/unknown/${cable.id}`, 'GET', undefined, 400);
  await request(`/change-logs/cable-type/${randomUUID()}`, 'GET', undefined, 404);
  const unauthenticated = await fetch(`${base}/change-logs/cable-type/${cable.id}`);
  assert.equal(unauthenticated.status, 401);
  console.log(
    'PASS: all 8 categories, creation, edits, no-op edits, Standard Materials, Excel import, curve points, actor attribution, rollback and access control.',
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
}
