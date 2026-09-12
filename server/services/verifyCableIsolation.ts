/** Opt-in routed integration check. Uses committed fixtures only in a guarded isolated database; cleans them in finally. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import type { Request, Response, Router } from 'express';
import type { PublicCableMaterial as CableMaterial } from '../models/cableMaterial.js';
type CableDetails = {
  mutationRevision: number;
  cableMaterials: CableMaterial[];
  materialCableType: { manufacturer: string | null } | null;
};
type CableTypeDetails = {
  mutationRevision: number;
  materialCableType: { manufacturer: string | null } | null;
};

const databaseName = process.argv[2];
if (!databaseName || !/^wfc_verify_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Pass an isolated wfc_verify_* database. Production databases are refused.');
}
const settings = parse(readFileSync('server/.env'));
const connection = new URL(process.env.WFC_TEST_DATABASE_URL ?? settings.DATABASE_URL);
connection.pathname = `/${databaseName}`;
process.env.DATABASE_URL = connection.toString();
const { pool } = await import('../db.js');
const { cablesRouter } = await import('../routes/cablesRoutes.js');
const { cableTypesRouter } = await import('../routes/cableTypesRoutes.js');
const actorId = randomUUID();
const projectId = randomUUID();
const otherProjectId = randomUUID();
const sourceA = randomUUID();
const sourceB = randomUUID();
const pin = randomUUID();
const gland = randomUUID();
const clamp = randomUUID();
const cableId = randomUUID();
let revision = 0;
let initialized = false;
type Handler = (request: Request, response: Response) => Promise<void>;
type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] };
};

async function invoke<T extends { mutationRevision?: number }>(
  router: Router,
  method: string,
  path: string,
  params: Record<string, string>,
  body: Record<string, unknown> = {},
  options: { key?: string; revision?: number } = {},
): Promise<{ status: number; body: T & { code?: string; error?: unknown } }> {
  const route = (router as unknown as { stack: Layer[] }).stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method.toLowerCase()],
  )?.route;
  const handler = route?.stack.at(-1)?.handle;
  assert(handler, `Missing route ${method} ${path}`);
  const key = options.key ?? randomUUID();
  const request = {
    method,
    route: { path },
    userId: actorId,
    params: { projectId, ...params },
    body,
    query: {},
    header: (name: string) =>
      name.toLowerCase() === 'if-match'
        ? String(options.revision ?? revision)
        : name.toLowerCase() === 'idempotency-key'
          ? key
          : undefined,
  } as unknown as Request;
  let status = 200;
  let payload: unknown;
  const response = {
    status(value: number) {
      status = value;
      return response;
    },
    json(value: unknown) {
      payload = value;
      return response;
    },
    setHeader() {
      return response;
    },
  };
  await handler(request, response as unknown as Response);
  assert(payload, `${method} ${path} did not produce JSON`);
  return { status, body: payload as T & { code?: string; error?: unknown } };
}

async function save<T extends { mutationRevision?: number }>(
  router: Router,
  method: string,
  path: string,
  params: Record<string, string>,
  body: Record<string, unknown>,
): Promise<T> {
  const result = await invoke<T>(router, method, path, params, body);
  assert([200, 201].includes(result.status), JSON.stringify(result));
  assert.equal(result.body.mutationRevision, revision + 1);
  revision = result.body.mutationRevision!;
  return result.body;
}

async function fingerprint(): Promise<string> {
  const payload = [];
  for (const [sql, args] of [
    ['SELECT * FROM cable_types WHERE project_id=$1 ORDER BY id', [projectId]],
    [
      'SELECT dm.* FROM cable_type_default_materials dm JOIN cable_types ct ON ct.id=dm.cable_type_id WHERE ct.project_id=$1 ORDER BY dm.id',
      [projectId],
    ],
    ['SELECT * FROM cables WHERE project_id=$1 ORDER BY id', [projectId]],
    [
      'SELECT cm.* FROM cable_materials cm JOIN cables c ON c.id=cm.cable_id WHERE c.project_id=$1 ORDER BY cm.id',
      [projectId],
    ],
    ['SELECT * FROM mutation_revisions WHERE resource_id=$1 ORDER BY resource_type', [projectId]],
    ['SELECT * FROM mutation_history WHERE resource_id=$1 ORDER BY revision', [projectId]],
    ['SELECT * FROM mutation_receipts WHERE resource_id=$1 ORDER BY idempotency_key', [projectId]],
  ] as [string, string[]][])
    payload.push((await pool.query(sql, args)).rows);
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

try {
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, databaseName);
  initialized = true;
  await pool.query('INSERT INTO users(id,email,password_hash,is_admin) VALUES ($1,$2,$3,TRUE)', [
    actorId,
    `synthetic-${actorId}@example.invalid`,
    'not-a-login-hash',
  ]);
  for (const id of [projectId, otherProjectId])
    await pool.query('INSERT INTO projects(id,project_number,name,customer) VALUES ($1,$2,$3,$4)', [
      id,
      `synthetic-${id}`,
      'Isolated cable verification',
      'Synthetic customer',
    ]);
  for (const [id, name] of [
    [sourceA, 'A'],
    [sourceB, 'B'],
  ])
    await pool.query(
      'INSERT INTO material_cable_types(id,name,manufacturer,diameter_mm,weight_kg_per_m) VALUES ($1,$2,$3,12,0.5)',
      [id, `Synthetic cable ${name} ${id}`, `Captured maker ${name}`],
    );
  for (const [id, name] of [
    [pin, 'Pin'],
    [gland, 'Gland'],
    [clamp, 'Clamp'],
  ])
    await pool.query(
      'INSERT INTO material_cable_installation_materials(id,type,purpose,manufacturer,unit_price,packaging) VALUES ($1,$2,$3,$4,4,$5)',
      [id, `Synthetic ${name} ${id}`, 'Captured purpose', 'Captured maker', 'Box'],
    );
  for (const [id, quantity] of [
    [sourceA, 2],
    [sourceB, 5],
  ] as const)
    await pool.query(
      'INSERT INTO material_cable_type_standard_materials(id,cable_type_id,referenced_material_id,quantity,unit) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), id, pin, quantity, 'pcs/m'],
    );

  const created = await save<{ mutationRevision: number; cableType: { id: string } }>(
    cableTypesRouter,
    'POST',
    '/',
    {},
    { name: `Synthetic cable A ${sourceA}`, sourceMaterialCableTypeId: sourceA },
  );
  const cableTypeId = created.cableType.id;
  await save(
    cableTypesRouter,
    'POST',
    '/:cableTypeId/default-materials',
    { cableTypeId },
    { name: `Synthetic Gland ${gland}`, currentMaterialId: gland, quantity: 1, unit: 'pcs' },
  );
  // An intentionally uninitialized legacy cable exercises virtual rows on a pure read.
  await pool.query(
    'INSERT INTO cables(id,project_id,cable_id,cable_type_id,design_length,materials_initialized,materials_customized) VALUES ($1,$2,1,$3,10,FALSE,FALSE)',
    [cableId, projectId, cableTypeId],
  );
  const beforeReads = await fingerprint();
  const first = await invoke<CableDetails>(cablesRouter, 'GET', '/:cableId/details', { cableId });
  const second = await invoke<CableDetails>(cablesRouter, 'GET', '/:cableId/details', { cableId });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, second.body);
  assert.equal(
    await fingerprint(),
    beforeReads,
    'Opening/refreshing changed persisted rows, revisions, history or receipts',
  );
  assert.equal(first.body.cableMaterials.length, 2);
  assert(first.body.cableMaterials.every((row) => row.isVirtual));
  assert.equal(first.body.materialCableType?.manufacturer, 'Captured maker A');
  assert.equal(first.body.cableMaterials[0].materialSnapshot?.values.purpose, 'Captured purpose');

  await pool.query('UPDATE material_cable_installation_materials SET unit_price=77 WHERE id=$1', [
    clamp,
  ]);
  const addition = await save<{ mutationRevision: number; cableMaterial: CableMaterial }>(
    cablesRouter,
    'POST',
    '/:cableId/materials',
    { cableId },
    { name: `Synthetic Clamp ${clamp}`, currentMaterialId: clamp, quantity: 1, unit: 'pcs' },
  );
  assert.equal(Number(addition.cableMaterial.materialSnapshot?.values.unit_price), 77);
  const afterAdd = await invoke<CableDetails>(cablesRouter, 'GET', '/:cableId/details', {
    cableId,
  });
  for (const virtual of first.body.cableMaterials)
    assert(afterAdd.body.cableMaterials.some((row) => row.id === virtual.id && !row.isVirtual));
  assert.equal(afterAdd.body.cableMaterials.length, 3);

  const blockedDelete = await invoke(cableTypesRouter, 'DELETE', '/:cableTypeId', { cableTypeId });
  assert.equal(blockedDelete.status, 409);
  assert.equal(blockedDelete.body.code, 'CABLE_TYPE_IN_USE');
  const foreign = await invoke(
    cableTypesRouter,
    'DELETE',
    '/:cableTypeId',
    { projectId: otherProjectId, cableTypeId },
    {},
    { revision: 0 },
  );
  assert.equal(foreign.status, 404);

  await save(
    cableTypesRouter,
    'PATCH',
    '/:cableTypeId',
    { cableTypeId },
    { name: `Synthetic cable B ${sourceB}`, sourceMaterialCableTypeId: sourceB },
  );
  const replaced = await invoke<CableDetails>(cablesRouter, 'GET', '/:cableId/details', {
    cableId,
  });
  assert.equal(replaced.body.cableMaterials.length, 3);
  assert.equal(
    replaced.body.cableMaterials.filter((row) => row.originKind === 'catalog-inherited').length,
    1,
  );
  assert.equal(
    replaced.body.cableMaterials.find((row) => row.originKind === 'catalog-inherited')?.quantity,
    5,
  );
  assert.equal(
    replaced.body.cableMaterials.find((row) => row.originKind === 'project-added')?.id,
    first.body.cableMaterials.find((row) => row.originKind === 'project-added')?.id,
  );
  assert(replaced.body.cableMaterials.some((row) => row.id === addition.cableMaterial.id));

  const report = await invoke<{
    mutationRevision?: number;
    summary: { cableTypeSummaries: { materials: { name: string; totalQuantity: number }[] }[] };
  }>(cablesRouter, 'GET', '/report-summary', {}, {});
  assert.equal(report.status, 200);
  assert.equal(
    report.body.summary.cableTypeSummaries[0].materials.find(
      (row) => row.name === 'Synthetic Pin ' + pin,
    )?.totalQuantity,
    50,
    'The captured per-metre rate must multiply the 10m cable exactly once',
  );
  await save(cablesRouter, 'POST', '/:cableId/materials/sync-defaults', { cableId }, {});

  const raceRevision = revision;
  const race = await Promise.all(
    ['first', 'second'].map((tag) =>
      invoke(cablesRouter, 'PATCH', '/:cableId', { cableId }, { tag }, { revision: raceRevision }),
    ),
  );
  assert.deepEqual(race.map((row) => row.status).sort(), [200, 409]);
  assert.equal(race.find((row) => row.status === 409)?.body.code, 'REVISION_CONFLICT');
  revision += 1;

  const payload = {
    name: `Synthetic Clamp ${clamp}`,
    currentMaterialId: clamp,
    quantity: 2,
    unit: 'pcs',
  };
  const retryRevision = revision;
  const original = await invoke<{ mutationRevision: number; cableMaterial: CableMaterial }>(
    cablesRouter,
    'POST',
    '/:cableId/materials',
    { cableId },
    payload,
    { key: 'exact-retry', revision: retryRevision },
  );
  const retried = await invoke<{ mutationRevision: number; cableMaterial: CableMaterial }>(
    cablesRouter,
    'POST',
    '/:cableId/materials',
    { cableId },
    payload,
    { key: 'exact-retry', revision: retryRevision },
  );
  assert.equal(original.status, 201);
  assert.deepEqual(original.body, retried.body);
  revision = original.body.mutationRevision;
  assert.equal(
    (
      await pool.query(
        'SELECT COUNT(*)::int AS count FROM cable_materials WHERE cable_id=$1 AND origin_kind=$2',
        [cableId, 'cable-added'],
      )
    ).rows[0].count,
    2,
  );

  const inherited = replaced.body.cableMaterials.find(
    (row) => row.originKind === 'catalog-inherited',
  )!;
  await save(
    cablesRouter,
    'PATCH',
    '/:cableId/materials/:materialId',
    { cableId, materialId: inherited.id },
    { quantity: 42 },
  );
  await save(cableTypesRouter, 'PATCH', '/:cableTypeId', { cableTypeId },
    { name: `Synthetic cable A ${sourceA}`, sourceMaterialCableTypeId: sourceA });
  await save(cablesRouter, 'POST', '/:cableId/materials/sync-defaults', { cableId }, {});
  const preserved = await invoke<CableDetails>(cablesRouter, 'GET', '/:cableId/details', { cableId });
  assert.equal(preserved.body.cableMaterials.find((row) => row.id === inherited.id)?.quantity, 42);
  const unchangedOther = await pool.query('SELECT count(*)::int AS count FROM cables WHERE project_id=$1', [otherProjectId]);
  assert.equal(unchangedOther.rows[0].count, 0);

  await pool.query('UPDATE material_cable_types SET obsolete_at=NOW() WHERE id = ANY($1::uuid[])', [
    [sourceA, sourceB],
  ]);
  await pool.query('UPDATE material_cable_installation_materials SET obsolete_at=NOW() WHERE id=$1', [pin]);
  const historical = await invoke<CableDetails>(cablesRouter, 'GET', '/:cableId/details', {
    cableId,
  });
  const typeDetails = await invoke<CableTypeDetails>(
    cableTypesRouter,
    'GET',
    '/:cableTypeId/details',
    { cableTypeId },
  );
  assert.equal(historical.body.materialCableType?.manufacturer, 'Captured maker A');
  assert.equal(typeDetails.body.materialCableType?.manufacturer, 'Captured maker A');
  const historicalPin = historical.body.cableMaterials.find((row) => row.id === inherited.id)!;
  assert.equal(historicalPin.currentMaterialId, pin);
  assert.equal(historicalPin.materialSnapshot?.originMaterialId, pin);
  assert.equal(historicalPin.quantity, 42);
  const initial = await pool.query(
    'SELECT snapshot FROM mutation_history WHERE resource_type=$1 AND resource_id=$2 AND revision=0',
    ['project-materials', projectId],
  );
  assert.equal(initial.rows.length, 1);
  assert.deepEqual(initial.rows[0].snapshot.cableTypes, []);
  const legacyTypeId = randomUUID();
  await pool.query('INSERT INTO cable_types(id,project_id,name) VALUES ($1,$2,$3)', [
    legacyTypeId,
    otherProjectId,
    'Legacy captured type',
  ]);
  const legacyDelete = await invoke(
    cableTypesRouter,
    'DELETE',
    '/:cableTypeId',
    { projectId: otherProjectId, cableTypeId: legacyTypeId },
    {},
    { revision: 0 },
  );
  assert.equal(legacyDelete.status, 200);
  const legacyHistory = await pool.query(
    'SELECT revision,snapshot FROM mutation_history WHERE resource_type=$1 AND resource_id=$2 ORDER BY revision',
    ['project-materials', otherProjectId],
  );
  assert.equal(legacyHistory.rows.length, 2);
  assert.equal(legacyHistory.rows[0].snapshot.cableTypes[0].id, legacyTypeId);
  assert.deepEqual(legacyHistory.rows[1].snapshot.cableTypes, []);
  const history = await pool.query(
    'SELECT snapshot FROM mutation_history WHERE resource_type=$1 AND resource_id=$2 ORDER BY revision DESC LIMIT 1',
    ['project-materials', projectId],
  );
  assert(history.rows[0].snapshot.cableMaterials.some((row: { id: string; quantity: number }) => row.id === inherited.id && Number(row.quantity) === 42));
  console.log(
    JSON.stringify({
      database: databaseName,
      passed: [
        'pure repeated GET fingerprints',
        'virtual-to-persisted UUIDs',
        'current addition snapshot',
        'in-use deletion',
        'project isolation',
        'replacement preservation',
        'actual competing stale edits',
        'exact retry replay',
        'local override retention through replacement and sync',
        'catalog retirement reference and snapshot retention',
        'complete composition history',
        'baseline before first legacy deletion',
        'per-metre report applied once',
        'explicit sync',
      ],
    }),
  );
} finally {
  if (initialized) {
    await pool.query('DELETE FROM cables WHERE project_id = ANY($1::uuid[])', [
      [projectId, otherProjectId],
    ]);
    await pool.query('DELETE FROM projects WHERE id = ANY($1::uuid[])', [
      [projectId, otherProjectId],
    ]);
    for (const table of ['mutation_receipts', 'mutation_history', 'mutation_revisions'])
      await pool.query(`DELETE FROM ${table} WHERE resource_id = ANY($1::uuid[])`, [
        [projectId, otherProjectId],
      ]);
    await pool.query('UPDATE material_cable_types SET obsolete_at=NOW() WHERE id = ANY($1::uuid[])', [
      [sourceA, sourceB],
    ]);
    await pool.query(
      'UPDATE material_cable_installation_materials SET obsolete_at=NOW() WHERE id = ANY($1::uuid[])',
      [[pin, gland, clamp]],
    );
    await pool.query('DELETE FROM users WHERE id=$1', [actorId]);
  }
  await pool.end();
}
