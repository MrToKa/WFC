/** Explicit isolated PostgreSQL verification; fixtures are always rolled back. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import {
  captureTrayMaterialSnapshot,
  syncProjectSupportSnapshots,
} from './projectCatalogSnapshotService.js';
import { mapTrayRow, type TrayRow } from '../models/tray.js';
import { mapProjectRow } from '../models/project.js';

const databaseName = process.argv[2];
if (!databaseName || !/^wfc_verify_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Pass an isolated wfc_verify_* database. Production databases are refused.');
}
const settings = parse(readFileSync('server/.env'));
const connection = new URL(process.env.WFC_TEST_DATABASE_URL ?? settings.DATABASE_URL);
connection.pathname = `/${databaseName}`;
process.env.DATABASE_URL = connection.toString();
const { ensureProjectExists } = await import('./projectService.js');
const { pool: applicationPool } = await import('../db.js');
const pool = new Pool({ connectionString: connection.toString(), max: 1 });
const client = await pool.connect();
let began = false;
try {
  assert.equal(
    (await client.query('SELECT current_database() AS name')).rows[0].name,
    databaseName,
  );
  await client.query('BEGIN');
  began = true;
  const first = randomUUID();
  const second = randomUUID();
  const source = randomUUID();
  const support = randomUUID();
  const curve = randomUUID();
  const trayType = `Synthetic ${source}`;
  for (const projectId of [first, second]) {
    await client.query(
      'INSERT INTO projects(id,project_number,name,customer) VALUES ($1,$2,$3,$4)',
      [projectId, `synthetic-${projectId}`, 'Snapshot test', 'Synthetic customer'],
    );
  }
  await client.query(`INSERT INTO material_load_curves(id,name) VALUES ($1,$2)`, [
    curve,
    `Synthetic ${curve}`,
  ]);
  await client.query(
    `INSERT INTO material_load_curve_points(id,load_curve_id,point_order,span_m,load_kn_per_m)
    VALUES ($1,$2,0,2,4)`,
    [randomUUID(), curve],
  );
  await client.query(
    `INSERT INTO material_trays(id,tray_type,manufacturer,width_mm,height_mm,rung_height_mm,weight_kg_per_m,load_curve_id)
    VALUES ($1,$2,'Captured manufacturer',400,100,20,3,$3)`,
    [source, trayType, curve],
  );
  await client.query(
    `INSERT INTO material_supports(id,support_type,weight_kg,length_mm) VALUES ($1,$2,2,500)`,
    [support, `Support ${support}`],
  );

  const oldSnapshot = await captureTrayMaterialSnapshot(client, trayType);
  assert(oldSnapshot);
  assert.equal(oldSnapshot.material.weightKgPerM, 3);
  assert.equal(oldSnapshot.loadCurve?.points[0].loadKnPerM, 4);
  const oldTray = randomUUID();
  await client.query(
    `INSERT INTO trays(id,project_id,name,tray_type,width_mm,height_mm,material_snapshot)
    VALUES ($1,$2,'Old captured',$3,450,110,$4)`,
    [oldTray, first, trayType, oldSnapshot],
  );
  const legacyTray = randomUUID();
  await client.query(
    `INSERT INTO trays(id,project_id,name,tray_type,width_mm,height_mm)
    VALUES ($1,$2,'Legacy unknown',$3,333,88)`,
    [legacyTray, first, trayType],
  );
  await syncProjectSupportSnapshots(client, first, {
    [trayType]: { distance: 2, supportId: support },
  });

  await client.query(
    `UPDATE material_trays SET manufacturer='New manufacturer',width_mm=999,weight_kg_per_m=90 WHERE id=$1`,
    [source],
  );
  await client.query(
    'UPDATE material_load_curve_points SET load_kn_per_m=99 WHERE load_curve_id=$1',
    [curve],
  );
  await client.query('UPDATE material_supports SET weight_kg=99,length_mm=999 WHERE id=$1', [
    support,
  ]);
  const currentSnapshot = await captureTrayMaterialSnapshot(client, trayType);
  assert.equal(currentSnapshot?.material.weightKgPerM, 90);
  assert.equal(currentSnapshot?.loadCurve?.points[0].loadKnPerM, 99);
  await syncProjectSupportSnapshots(client, second, {
    [trayType]: { distance: 2, supportId: support },
  });
  // A local distance edit preserves captured support characteristics in the first project.
  await syncProjectSupportSnapshots(client, first, {
    [trayType]: { distance: 3, supportId: support },
  });
  const project = mapProjectRow((await ensureProjectExists(first, client))!);
  const otherProject = mapProjectRow((await ensureProjectExists(second, client))!);
  assert.equal(project.supportDistanceOverrides[trayType].supportSnapshot?.weightKg, 2);
  assert.equal(otherProject.supportDistanceOverrides[trayType].supportSnapshot?.weightKg, 99);

  await client.query('UPDATE material_trays SET obsolete_at=NOW() WHERE id=$1', [source]);
  await client.query('DELETE FROM material_load_curves WHERE id=$1', [curve]);
  await client.query('UPDATE material_supports SET obsolete_at=NOW() WHERE id=$1', [support]);
  // Selection identity and captured values survive deletion of the FK target.
  await syncProjectSupportSnapshots(client, first, {
    [trayType]: { distance: 4, supportId: support },
  });
  const surviving = mapProjectRow((await ensureProjectExists(first, client))!);
  assert.equal(surviving.supportDistanceOverrides[trayType].supportId, support);
  assert.equal(surviving.supportDistanceOverrides[trayType].supportSnapshot?.weightKg, 2);

  const rows = (
    await client.query<TrayRow>('SELECT * FROM trays WHERE id=ANY($1::uuid[]) ORDER BY id', [
      [oldTray, legacyTray],
    ])
  ).rows;
  const captured = mapTrayRow(rows.find((row) => row.id === oldTray)!);
  const legacy = mapTrayRow(rows.find((row) => row.id === legacyTray)!);
  assert.equal(captured.widthMm, 450);
  assert.equal(captured.materialSnapshot?.material.widthMm, 400);
  assert.equal(captured.materialSnapshot?.loadCurve?.points[0].loadKnPerM, 4);
  assert.equal(legacy.widthMm, 333);
  assert.equal(legacy.materialSnapshotStatus, 'unknown');
  assert.equal(legacy.materialSnapshot, null);
  assert.equal('imageObjectKey' in captured.materialSnapshot!, false);

  const readQueries: string[] = [];
  const readOnly = {
    query: async (...args: Parameters<typeof client.query>) => {
      readQueries.push(String(args[0]));
      return client.query(...args);
    },
  } as typeof client;
  await ensureProjectExists(first, readOnly);
  await ensureProjectExists(first, readOnly);
  assert(readQueries.every((sql) => sql.trim().startsWith('SELECT')));
  assert(readQueries.every((sql) => !sql.includes('JOIN material_supports')));
  // Explicitly clearing the selection is still possible after source retirement.
  await syncProjectSupportSnapshots(client, first, {
    [trayType]: { distance: 4, supportId: null },
  });
  assert.equal(
    mapProjectRow((await ensureProjectExists(first, client))!).supportDistanceOverrides[trayType]
      .supportSnapshot,
    null,
  );
  console.log(
    'PASS: tray/support isolation, embedded curve, distinct new capture, catalog deletion, legacy unknown, pure reads. Fixtures rolled back.',
  );
} finally {
  if (began) await client.query('ROLLBACK');
  client.release();
  await pool.end();
  await applicationPool.end();
}
