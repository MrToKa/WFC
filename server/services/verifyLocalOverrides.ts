/** Explicit isolated verification; the complete fixture transaction is rolled back. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
const database = process.argv[2];
if (!database || !/^wfc_verify_[a-z0-9_]+$/.test(database)) throw new Error('An isolated wfc_verify_* database is required');
const url = new URL(parse(readFileSync('server/.env')).DATABASE_URL); url.pathname = `/${database}`;
process.env.DATABASE_URL = url.toString();
const { pool } = await import('../db.js');
const { snapshotStandardMaterialsToProjectCableType } = await import('./projectCableTypeSnapshotService.js');
const { replaceInheritedCableMaterials } = await import('./cableMaterialSnapshotService.js');
const client = await pool.connect();
const project = randomUUID(), otherProject = randomUUID(), type = randomUUID(), otherType = randomUUID();
const sourceA = randomUUID(), sourceB = randomUUID(), material = randomUUID(), edgeA = randomUUID(), edgeB = randomUUID();
const ownDefault = randomUUID(), otherDefault = randomUUID(), cable = randomUUID(), otherCable = randomUUID(), local = randomUUID();
try {
  assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, database);
  await client.query('BEGIN');
  for (const id of [project, otherProject]) await client.query('INSERT INTO projects(id,project_number,name,customer) VALUES($1,$2,$2,$2)', [id, `Verification ${id}`]);
  for (const id of [sourceA, sourceB]) await client.query('INSERT INTO material_cable_types(id,name) VALUES($1,$2)', [id, `Verification ${id}`]);
  await client.query('INSERT INTO material_cable_installation_materials(id,type) VALUES($1,$2)', [material, `Verification ${material}`]);
  for (const [edge, source] of [[edgeA, sourceA], [edgeB, sourceB]]) await client.query("INSERT INTO material_cable_type_standard_materials(id,cable_type_id,referenced_material_id,quantity,unit) VALUES($1,$2,$3,2,'pcs')", [edge, source, material]);
  for (const [id, parent] of [[type, project], [otherType, otherProject]]) await client.query('INSERT INTO cable_types(id,project_id,name,source_material_cable_type_id) VALUES($1,$2,$3,$4)', [id, parent, `Verification ${id}`, sourceA]);
  for (const [id, parent, quantity, edited] of [[ownDefault, type, 42, true], [otherDefault, otherType, 2, false]] as const) await client.query(
    `INSERT INTO cable_type_default_materials(id,cable_type_id,name,quantity,unit,source_kind,source_master_material_id,source_standard_material_assignment_ids,current_material_id,inherited_override)
     VALUES($1,$2,'Saved material',$3,'pcs','standard-material',$4,$5::uuid[],$4,$6)`, [id,parent,quantity,material,[edgeA],edited]);
  for (const [id, parent, selectedType] of [[cable, project, type], [otherCable, otherProject, otherType]]) await client.query(
    'INSERT INTO cables(id,project_id,cable_type_id,tag,cable_id,materials_initialized,materials_customized) VALUES($1,$2,$3,$4,1,TRUE,TRUE)', [id,parent,selectedType,`Verification ${id}`]);
  await client.query(`INSERT INTO cable_materials(id,cable_id,name,quantity,unit,source,cable_type_default_material_id,current_material_id,origin_kind,inherited_override)
    VALUES($1,$2,'Cable-local name',17,'pcs','default',$3,$4,'catalog-inherited',TRUE)`, [local,cable,ownDefault,material]);
  const otherBefore = JSON.stringify((await client.query('SELECT to_jsonb(t) AS row FROM cable_type_default_materials t WHERE id=$1', [otherDefault])).rows);
  const catalogBefore = JSON.stringify((await client.query('SELECT to_jsonb(t) AS row FROM material_cable_installation_materials t WHERE id=$1', [material])).rows);
  assert.equal(await snapshotStandardMaterialsToProjectCableType(client,type,sourceA,{replaceInherited:true}),0, 'Same occurrence must not duplicate the override');
  assert.equal(await snapshotStandardMaterialsToProjectCableType(client,type,sourceB,{replaceInherited:true}),1);
  const defaults = (await client.query('SELECT * FROM cable_type_default_materials WHERE cable_type_id=$1', [type])).rows;
  assert.equal(defaults.length,2); assert.equal(Number(defaults.find(row=>row.id===ownDefault).quantity),42);
  await replaceInheritedCableMaterials(client,cable,defaults);
  await replaceInheritedCableMaterials(client,cable,defaults);
  const rows=(await client.query('SELECT * FROM cable_materials WHERE cable_id=$1',[cable])).rows;
  assert.equal(rows.length,2); assert.equal(Number(rows.find(row=>row.id===local).quantity),17);
  assert.equal(rows.find(row=>row.id===local).name,'Cable-local name');
  assert.equal(rows.find(row=>row.id===local).current_material_id,material);
  assert.equal(JSON.stringify((await client.query('SELECT to_jsonb(t) AS row FROM cable_type_default_materials t WHERE id=$1',[otherDefault])).rows),otherBefore);
  assert.equal(JSON.stringify((await client.query('SELECT to_jsonb(t) AS row FROM material_cable_installation_materials t WHERE id=$1',[material])).rows),catalogBefore);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM cable_materials WHERE cable_id=$1',[otherCable])).rows[0].count,0);
  console.log('PASS: project and cable overrides retained, same occurrence not duplicated, repeated replacement stable, other project and shared catalog unchanged.');
} finally {
  await client.query('ROLLBACK'); client.release(); await pool.end();
}
