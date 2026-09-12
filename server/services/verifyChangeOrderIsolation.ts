/** Explicit opt-in integration check. Refuses production databases and rolls back all fixtures. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import ExcelJS from 'exceljs';

const databaseName = process.argv[2];
if (!databaseName || !/^wfc_verify_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Pass an isolated wfc_verify_* database. Production databases are refused.');
}
const settings = parse(readFileSync('server/.env'));
const connection = new URL(process.env.WFC_TEST_DATABASE_URL ?? settings.DATABASE_URL);
connection.pathname = `/${databaseName}`;
process.env.DATABASE_URL = connection.toString();
const { createChangeOrder, addChangeOrderItem, updateChangeOrderItem, getChangeOrder } =
  await import('./changeOrderService.js');
const { beginVersionedMutation } = await import('./mutationService.js');
const { generateChangeOrderWorkbook } = await import('./changeOrderExcelExportService.js');
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
  const actor = randomUUID();
  const project = randomUUID();
  const material = randomUUID();
  await client.query('INSERT INTO users(id,email,password_hash) VALUES ($1,$2,$3)', [
    actor,
    `synthetic-${actor}@example.invalid`,
    'not-a-login-hash',
  ]);
  await client.query('INSERT INTO projects(id,project_number,name,customer) VALUES ($1,$2,$3,$4)', [
    project,
    `synthetic-${project}`,
    'Isolated snapshot verification',
    'Synthetic customer',
  ]);
  await client.query(
    `INSERT INTO material_supports
    (id,support_type,manufacturer,unit_price,minimum_order_quantity,order_measurement,packaging)
    VALUES ($1,$2,'Captured maker',10,5,'pcs','Box')`,
    [material, `Synthetic support ${material}`],
  );
  for (const documentType of ['change-order', 'internal-ncr'] as const) {
    const orders = [];
    for (let index = 0; index < 2; index += 1) {
      const order = await createChangeOrder(
        project,
        documentType,
        actor,
        {
          title: `Snapshot ${index}`,
          preparedBy: 'Synthetic author',
          reportDate: '2026-09-12',
          revision: '01',
        },
        client,
      );
      const parameters = {
        actorId: actor,
        resourceType: 'change-order',
        resourceId: order.id,
        idempotencyKey: 'add-once',
        expectedRevision: 0,
        request: { operation: 'add', material },
      };
      const mutation = await beginVersionedMutation(client, parameters);
      const item = await addChangeOrderItem(
        project,
        documentType,
        order.id,
        'support',
        material,
        client,
      );
      assert(item);
      await mutation.complete(item, await getChangeOrder(project, documentType, order.id, client));
      const replay = await beginVersionedMutation(client, parameters);
      assert.equal(replay.replay?.replayed, true);
      assert.equal(
        (
          await client.query(
            'SELECT COUNT(*)::int AS count FROM project_change_order_items WHERE change_order_id=$1',
            [order.id],
          )
        ).rows[0].count,
        1,
      );
      const edit = await beginVersionedMutation(client, {
        ...parameters,
        idempotencyKey: 'local-edit',
        expectedRevision: 1,
        request: { operation: 'edit', price: index ? 23 : 12 },
      });
      const updated = await updateChangeOrderItem(
        project,
        documentType,
        order.id,
        item.id,
        {
          unitPrice: index ? 23 : 12,
          manufacturer: `Local ${index}`,
          packagingQuantity: index ? 5 : 4,
          packagingUnit: 'local pcs',
          orderedUnit: 'local boxes',
          designQuantity: 8,
          orderQuantity: 8,
        },
        client,
      );
      assert(updated);
      await edit.complete(updated, await getChangeOrder(project, documentType, order.id, client));
      orders.push({ order, item });
    }
    await client.query(
      'UPDATE material_supports SET unit_price=999,manufacturer=$2,minimum_order_quantity=100,packaging=$3 WHERE id=$1',
      [material, 'Changed catalog', 'Drum'],
    );
    for (const [index, { order, item }] of orders.entries()) {
      if (index === 0) {
        await updateChangeOrderItem(
          project,
          documentType,
          order.id,
          item.id,
          { orderQuantity: 12 },
          client,
        );
      }
      const before = (
        await client.query(
          'SELECT to_jsonb(i) AS row FROM project_change_order_items i WHERE change_order_id=$1',
          [order.id],
        )
      ).rows;
      const details = await getChangeOrder(project, documentType, order.id, client);
      assert(details);
      assert.equal(details.mutationRevision, 2);
      assert.equal(details.items[0].unitPrice, index ? 23 : 12);
      assert.equal(details.items[0].manufacturer, `Local ${index}`);
      assert.equal(details.items[0].packagingQuantity, index ? 5 : 4);
      assert.equal(details.items[0].packagingUnit, 'local pcs');
      if (index === 0) assert.equal(details.items[0].orderedQuantity, 3);
      const workbook = new ExcelJS.Workbook();
      const bytes = await generateChangeOrderWorkbook(details, undefined, documentType);
      await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
      assert.equal(workbook.worksheets[0].getCell('P6').value, index ? 23 : 12);
      assert.equal(workbook.worksheets[0].getCell('G6').value, index ? 5 : 4);
      assert.equal(workbook.worksheets[0].getCell('W6').value, `Local ${index}`);
      assert.deepEqual(
        (
          await client.query(
            'SELECT to_jsonb(i) AS row FROM project_change_order_items i WHERE change_order_id=$1',
            [order.id],
          )
        ).rows,
        before,
      );
    }
    // Reset the synthetic source for the next document type, without changing its captured rows.
    await client.query(
      "UPDATE material_supports SET unit_price=10,manufacturer='Captured maker',minimum_order_quantity=5,packaging='Box' WHERE id=$1",
      [material],
    );
  }
  const snapshots = (
    await client.query(
      `SELECT co.id,co.document_type FROM project_change_orders co WHERE co.project_id=$1`,
      [project],
    )
  ).rows;
  await client.query('UPDATE material_supports SET obsolete_at=NOW() WHERE id=$1', [material]);
  for (const order of snapshots) {
    const details = await getChangeOrder(project, order.document_type, order.id, client);
    assert(details?.items.length === 1);
    assert([12, 23].includes(details.items[0].unitPrice));
    assert.equal(details.items[0].sourceMaterialId, material);
  }
  process.stdout.write(
    'PASS: two independent orders per document type; local price/packaging; catalog update/deletion; pure reads and XLSX exports; receipt replay; all fixtures rolled back.\n',
  );
} finally {
  if (began) await client.query('ROLLBACK');
  client.release();
  await pool.end();
  await applicationPool.end();
}
