// Uses a unique, disposable schema; never modifies application tables.
// Run: npx tsx scripts/check-standard-material-categories.ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';
import { MATERIAL_CAPABILITIES } from '../server/services/materialCapabilities.js';
import { initializeStandardMaterialCategories } from '../server/services/standardMaterialCategorySchema.js';
import {
  createStandardMaterialAssignment,
  updateStandardMaterialAssignment,
  listStandardMaterialAssignments,
  expandStandardMaterials,
} from '../server/services/standardMaterialService.js';

loadEnv({ path: 'server/.env', quiet: true });
const schema = 'standard_material_test_' + randomUUID().replaceAll('-', '');
const admin = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
await admin.query(`CREATE SCHEMA ${schema}`);
process.env.PGOPTIONS = `-c search_path=${schema}`;
const { pool, initializeDatabase } = await import('../server/db.js');
try {
  await initializeDatabase();
  const owners = new Map<string, string>();
  const children = new Map<string, string>();
  for (const c of Object.values(MATERIAL_CAPABILITIES)) {
    for (const [map, label] of [
      [owners, 'Owner'],
      [children, 'Child'],
    ] as const) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO ${c.ownerTable} (id, ${c.ownerNameColumn}, unit_price) VALUES ($1, $2, 2)`,
        [id, label + ' ' + c.category],
      );
      map.set(c.category, id);
    }
  }
  const client = await pool.connect();
  try {
    for (const owner of Object.values(MATERIAL_CAPABILITIES)) {
      for (const child of Object.values(MATERIAL_CAPABILITIES)) {
        const assignment = await createStandardMaterialAssignment(
          client,
          owner.category,
          owners.get(owner.category)!,
          {
            referencedMaterialId: children.get(child.category)!,
            referencedMaterialCategory: child.category,
            quantity: 2,
            unit: 'pcs',
          },
        );
        assert.equal(assignment.referencedMaterialCategory, child.category);
        assert.equal(assignment.referencedMaterial.type, 'Child ' + child.category);
      }
      assert.equal(
        (await listStandardMaterialAssignments(client, owner.category, owners.get(owner.category)!))
          .length,
        7,
      );
    }
    await assert.rejects(
      createStandardMaterialAssignment(client, 'cable-type', owners.get('cable-type')!, {
        referencedMaterialCategory: 'cable-type',
        referencedMaterialId: owners.get('cable-type')!,
        quantity: 1,
        unit: 'pcs',
      }),
      { code: 'SELF_REFERENCE' },
    );
    await assert.rejects(
      createStandardMaterialAssignment(client, 'tray', children.get('tray')!, {
        referencedMaterialCategory: 'cable-type',
        referencedMaterialId: owners.get('cable-type')!,
        quantity: 1,
        unit: 'pcs',
      }),
      { code: 'CYCLE' },
    );
    await assert.rejects(
      createStandardMaterialAssignment(client, 'cable-type', owners.get('cable-type')!, {
        referencedMaterialCategory: 'tray',
        referencedMaterialId: children.get('tray')!,
        quantity: 1,
        unit: 'pcs',
      }),
      { code: 'DUPLICATE_ASSIGNMENT' },
    );
    await assert.rejects(
      client.query('DELETE FROM material_trays WHERE id = $1', [children.get('tray')]),
      { code: '23503' },
    );
    const assignments = await listStandardMaterialAssignments(
      client,
      'cable-type',
      owners.get('cable-type')!,
    );
    const updated = await updateStandardMaterialAssignment(
      client,
      'cable-type',
      owners.get('cable-type')!,
      assignments[0].id,
      {
        referencedMaterialCategory: 'instrument',
        referencedMaterialId: owners.get('instrument')!,
        quantity: 3,
      },
    );
    assert.equal(updated.referencedMaterialCategory, 'instrument');
    assert.equal(updated.quantity, 3);
    assert(
      (await expandStandardMaterials(client, 'cable-type', owners.get('cable-type')!)).length >= 7,
    );
  } finally {
    client.release();
  }
  // Simulate the legacy Tray assignment table and verify old cable references survive.
  await pool.query('DELETE FROM material_tray_standard_materials');
  await pool.query(
    'ALTER TABLE material_tray_standard_materials DROP COLUMN referenced_material_category CASCADE',
  );
  await pool.query(`ALTER TABLE material_tray_standard_materials ADD CONSTRAINT legacy_reference_fk
    FOREIGN KEY (referenced_material_id) REFERENCES material_cable_installation_materials(id) ON DELETE RESTRICT`);
  await pool.query(
    `INSERT INTO material_tray_standard_materials (id, tray_id, referenced_material_id, quantity, unit)
    VALUES ($1,$2,$3,1,'pcs')`,
    [randomUUID(), owners.get('tray'), children.get('cable-installation-material')],
  );
  await initializeStandardMaterialCategories(pool);
  const legacy = await listStandardMaterialAssignments(pool, 'tray', owners.get('tray')!);
  assert.equal(legacy[0].referencedMaterialCategory, 'cable-installation-material');
  await initializeDatabase();
  await initializeDatabase();
  assert.equal(
    (await listStandardMaterialAssignments(pool, 'tray', owners.get('tray')!))[0]
      .referencedMaterialCategory,
    'cable-installation-material',
  );
  const audit = await pool.query(
    "SELECT events FROM material_change_logs WHERE category = 'cable-type'",
  );
  assert(
    audit.rows.some((row) =>
      row.events.some((event: { label: string }) => event.label === 'Child tray'),
    ),
  );
  console.log(
    'PASS: 49 category combinations, editing, expansion, self/cycle/duplicate/FK checks, legacy migration, repeated startup, audit labels.',
  );
} finally {
  await pool.end();
  // Only this script's UUID-named schema is removed.
  assert(/^standard_material_test_[a-f0-9]{32}$/.test(schema));
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
