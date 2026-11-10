// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Client, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { modelLocationMatchFixture } from './modelLocationMatchFixtures.js';
import { endpointFixtureId as id } from './endpointBindingFixtures.js';
import { createEndpointBindingRepository, endpointBindingHash } from './endpointBindingRepository.js';
import { readPreservedLocationDisplay } from './modelLocationMatchDisplay.js';
import { readCableEndpointDisplay } from './cableEndpointDisplay.js';
import { cableEndpointCommandSchema, cableEndpointReceiptSchema } from '../../shared/pathfinderCableEndpoints.js';
import type { ModelLocationMatchAssign, ModelLocationMatchReceipt } from '../../shared/pathfinderModelLocationMatch.js';

const testDatabaseUrl = process.env.WFC_TRAY_LENGTH_TEST_DATABASE_URL;

async function fixture() {
  const f = await modelLocationMatchFixture(), manual = createEndpointBindingRepository(f.pool);
  const saved = await manual.confirm(f.projectId, f.who, f.locationId, {
    schemaVersion: 'wfc.pf.endpoint-binding-write.v1', expectedRegistryRevision: f.state.registry,
    expectedLocationRevision: null, expectedHeadId: null, expectedSelectionRevision: f.context.current.selectionRevision,
    modelVersionId: f.context.current.modelVersionId, aggregateId: f.context.current.aggregateId,
    projectionSha256: f.context.current.projectionSha256, captureFrameId: f.context.current.captureFrameId,
    idempotencyKey: id(999), reason: 'Synthetic current manual endpoint.', location: { name: 'Equipment', aliases: [] },
    mode: 'fixed-world', pointProjectMetres: [2, 3, 3], derivation: 'manual-world-point', provenanceObject: null,
  });
  const input = f.command();
  input.scan.candidates.forEach(candidate => { candidate.objectIdentity = { guid: id(400 + candidate.objectId), sourceFile: 'models/instruments.dwg' }; });
  const assigned = await f.repo.assign(f.projectId, f.who, input);
  const stored = f.state.commands.get(f.who.userId + ':' + input.idempotencyKey)!;
  const value = { projectId: f.projectId, current: f.context.current,
    location: { ...f.state.locations.get(f.locationId)!, aliases: [] }, head: f.state.bindings.get(saved.binding.id)! };
  function findRow(key: string, patch?: (command: ModelLocationMatchAssign) => void) {
    const request = structuredClone(stored.request) as { command: ModelLocationMatchAssign }, receipt = structuredClone(stored.receipt) as ModelLocationMatchReceipt;
    request.command.idempotencyKey = key; patch?.(request.command);
    receipt.idempotencyKey = key; receipt.commandSha256 = endpointBindingHash(request.command);
    return { projectId: f.projectId, actorId: f.who.userId, key, kind: 'confirm', hash: endpointBindingHash(request), request, receipt };
  }
  function cableRow(key: string) {
    const command = cableEndpointCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-command.v1', idempotencyKey: key,
      expectedContextSha256: 'a'.repeat(64), expectedCableWriteRevision: '7', expectedLogicalName: value.location.name,
      expectedRegistryRevision: value.head.locationRegistryRevision, expectedLocationId: value.location.id,
      expectedLocationRevision: value.location.revision, expectedHeadId: value.head.id, expectedCurrent: value.current,
      reason: 'Synthetic explicit display clear.', selection: { mode: 'fixed-world', pointProjectMetres: value.head.pointProjectMetres,
        derivation: 'manual-world-point', displaySdkObjectId: null } });
    const request = { schemaVersion: 'wfc.pf.cable-endpoint-command-owner.v1', cableId: id(10), end: 'from', command };
    const receipt = cableEndpointReceiptSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-receipt.v1', projectId: f.projectId,
      actorId: id(888), cableId: request.cableId, end: request.end, logicalName: command.expectedLogicalName, idempotencyKey: key,
      commandSha256: endpointBindingHash(command), expectedCableWriteRevision: command.expectedCableWriteRevision,
      expectedContextSha256: command.expectedContextSha256, locationId: value.location.id, binding: saved,
      impact: { fromOccurrences: 1, toOccurrences: 0, distinctCables: 1, cableIds: [id(10)] }, duplicate: false });
    return { projectId: f.projectId, actorId: receipt.actorId, key, kind: 'confirm', hash: endpointBindingHash(request), request,
      receipt: { schemaVersion: 'wfc.pf.cable-endpoint-stored.v1', status: 'saved', receipt } };
  }
  return { value, findRow, cableRow, sdkObjectId: assigned.results.find(result => result.locationId === f.locationId)!.candidateObjectIds[0] };
}

describe.skipIf(!testDatabaseUrl)('preserved manual display against dedicated PostgreSQL', () => {
  it('executes the real ledger query, microsecond ordering, null boundary and current-scope fences', async () => {
    // Use only the explicitly supplied disposable database, never DATABASE_URL.
    const url = new URL(testDatabaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/wfc_tray_auto_length_test')
      throw new Error('Preserved display tests require the dedicated wfc_tray_auto_length_test database.');
    const schema = 'pf_preserved_display_' + randomUUID().replaceAll('-', '');
    if (!/^pf_preserved_display_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid owned test schema.');
    const client = new Client({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    let connected = false, created = false;
    try {
      await client.connect(); connected = true;
      expect((await client.query('SELECT current_database() AS name')).rows[0].name).toBe('wfc_tray_auto_length_test');
      await client.query(`CREATE SCHEMA "${schema}"`); created = true;
      await client.query("SELECT set_config('search_path',$1,false)", [schema + ',pg_catalog']);
      // This tests the production reader's SQL, not unrelated endpoint writes.
      await client.query(`CREATE TABLE pf_endpoint_binding_commands(project_id uuid NOT NULL,actor_id uuid NOT NULL,
        idempotency_key uuid NOT NULL,kind text NOT NULL,request_sha256 text NOT NULL,request jsonb NOT NULL,
        receipt jsonb NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(project_id,actor_id,idempotency_key))`);
      const f = await fixture(), before = structuredClone(f.value), c = client as unknown as PoolClient;
      const insert = async (row: ReturnType<typeof f.findRow> | ReturnType<typeof f.cableRow>, time: string) => {
        await client.query('INSERT INTO pf_endpoint_binding_commands VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [row.projectId, row.actorId, row.key, row.kind, row.hash, row.request, row.receipt, time]);
      };
      await insert(f.findRow(id(701)), '2026-11-10T12:00:00.000002Z');
      expect((await readPreservedLocationDisplay(c, f.value, () => undefined))?.sdkObjectId).toBe(f.sdkObjectId);
      await insert(f.cableRow(id(801)), '2026-11-10T12:00:00.000001Z');
      expect((await readCableEndpointDisplay(c, f.value, () => undefined))?.sdkObjectId).toBe(f.sdkObjectId);
      await insert(f.cableRow(id(802)), '2026-11-10T12:00:00.000003Z');
      expect(await readCableEndpointDisplay(c, f.value, () => undefined)).toBeNull();
      await insert(f.findRow(id(702)), '2026-11-10T12:00:00.000004Z');
      expect((await readCableEndpointDisplay(c, f.value, () => undefined))?.sdkObjectId).toBe(f.sdkObjectId);
      await insert(f.findRow(id(703), command => { command.current.traceId = id(55); }), '2026-11-10T12:00:00.000005Z');
      expect((await readCableEndpointDisplay(c, f.value, () => undefined))?.commandSha256)
        .toBe(f.findRow(id(702)).receipt.commandSha256);
      await insert(f.findRow(id(704), command => {
        const candidate = command.scan.candidates.find(value => value.matchedNames.includes('EQUIPMENT'))!;
        candidate.bounds!.minimum[0] += .01; candidate.bounds!.maximum[0] += .01;
        candidate.bottomCentre![0] = (candidate.bounds!.minimum[0] + candidate.bounds!.maximum[0]) / 2;
      }), '2026-11-10T12:00:00.000006Z');
      expect(await readCableEndpointDisplay(c, f.value, () => undefined)).toBeNull();
      const wrongHead = { ...f.value.head, id: id(9999) }, { contentSha256: _sha, ...body } = wrongHead;
      wrongHead.contentSha256 = endpointBindingHash(body);
      expect(await readPreservedLocationDisplay(c, { ...f.value, head: wrongHead }, () => undefined)).toBeNull();
      expect(f.value).toEqual(before);
      expect((await client.query('SELECT count(*)::int AS n FROM pf_endpoint_binding_commands')).rows[0].n).toBe(6);
    } finally {
      if (connected) {
        try { if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`); }
        finally { await client.end(); }
      }
    }
  }, 15000);
});
