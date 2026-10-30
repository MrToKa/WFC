// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { readCurrentTrayAutoLength } from './trayAutoLengthService.js';
import { geometryTraceFixture } from '../pathfinder/geometryTraceFixtures.js';
import { buildGeometryTrace } from '../pathfinder/geometryTraceBuilder.js';
import { GEOMETRY_TRACE_DERIVATION } from '../../shared/pathfinderGeometryTrace.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { TRAY_AUTO_LENGTH_CAPTURE_SQL, readCapturedTrayAutoLength, readTrayAutoLengthCaptureContext } from './trayAutoLengthCaptureService.js';

const testDatabaseUrl = process.env.WFC_TRAY_LENGTH_TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)('tray Auto-length against dedicated PostgreSQL', () => {
  it('applies the production migrations and fences published and independently captured lengths through Save', async () => {
    // This test never uses DATABASE_URL or application credentials. CI supplies
    // an otherwise empty, disposable database; only this random schema is owned.
    const url = new URL(testDatabaseUrl!);
    if (url.pathname !== '/wfc_tray_auto_length_test') throw new Error('WFC_TRAY_LENGTH_TEST_DATABASE_URL must name the dedicated wfc_tray_auto_length_test database.');
    const schema = 'wfc_tray_auto_length_' + randomUUID().replaceAll('-', '');
    if (!/^wfc_tray_auto_length_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid owned test schema.');
    const client = new Client({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    const writer = new Client({ connectionString: testDatabaseUrl, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    let connected = false, writerConnected = false, created = false, transaction = false;
    try {
      await client.connect(); connected = true;
      await client.query(`CREATE SCHEMA "${schema}"`); created = true;
      await client.query("SELECT set_config('search_path',$1,false)", [schema]);
      await client.query(`
        CREATE TABLE projects(id uuid PRIMARY KEY);
        CREATE TABLE trays(id uuid PRIMARY KEY,project_id uuid NOT NULL,name text NOT NULL,length_mm numeric);
        CREATE TABLE project_model_selections(project_id uuid PRIMARY KEY,active_model_version_id uuid,selection_revision bigint NOT NULL);
        CREATE TABLE model_versions(id uuid PRIMARY KEY,project_id uuid NOT NULL,content_fingerprint text,state text,health text);
        CREATE TABLE pf_project_preparations(project_id uuid PRIMARY KEY,current_aggregate_id uuid,current_artifact_id uuid,geometry_revision bigint,resolution_revision bigint);
        CREATE TABLE pf_preparation_aggregates(id uuid PRIMARY KEY,project_id uuid,session_id uuid,model_version_id uuid,artifact_id uuid,geometry_revision bigint,manifest jsonb);
        CREATE TABLE pf_preparation_sessions(id uuid PRIMARY KEY,project_id uuid,plan jsonb,state text,published_aggregate_id uuid);
        CREATE TABLE pf_artifacts(id uuid PRIMARY KEY,project_id uuid,model_version_id uuid,snapshot_sha256 text,snapshot_bytes bigint);
        CREATE TABLE pf_geometry_trace_sets(id uuid PRIMARY KEY,project_id uuid,aggregate_id uuid,model_version_id uuid,derivation_version text,manifest jsonb);
        CREATE TABLE pf_preparation_resolutions(project_id uuid,project_tray_id uuid,resolution jsonb);
        CREATE TABLE pf_preparation_commands(project_id uuid,kind text,receipt jsonb);
        CREATE TABLE pf_geometry_object_revisions(id uuid PRIMARY KEY,project_id uuid,trace_id uuid,object_id text,order_index int,project_tray_id uuid,summary jsonb,record jsonb);
      `);
      const f = geometryTraceFixture();
      f.aggregate.projection.payloadRef = f.aggregate.artifactId;
      const built = buildGeometryTrace(f), a = f.aggregate, tray = f.plan.requestedScope.trays[0];
      await client.query('INSERT INTO projects(id) VALUES($1)', [a.projectId]);
      const legacyTrayId = randomUUID();
      await client.query('INSERT INTO trays(id,project_id,name,length_mm) VALUES($1,$2,$3,$4)', [legacyTrayId, a.projectId, 'Legacy tray', 1234.567]);
      // Execute the exact production block, twice, instead of maintaining a
      // test-only copy that could silently diverge from the deployed migration.
      const databaseSource = readFileSync(new URL('../db.ts', import.meta.url), 'utf8');
      const migrations = [...databaseSource.matchAll(/await pool\.query\(`([\s\S]*?)`\);/g)]
        .map(match => match[1]).filter(sql => sql.includes('ADD COLUMN IF NOT EXISTS length_source TEXT'));
      expect(migrations).toHaveLength(1);
      expect(databaseSource).toContain('await pool.query(TRAY_AUTO_LENGTH_CAPTURE_SQL)');
      await client.query(migrations[0]);
      await client.query(migrations[0]);
      // Use the actual standalone initializer, including FK and byte/hash
      // constraints; executing it twice must retain existing application data.
      await client.query(TRAY_AUTO_LENGTH_CAPTURE_SQL);
      await client.query(TRAY_AUTO_LENGTH_CAPTURE_SQL);
      expect((await client.query('SELECT length_mm::text,length_source,length_calculation FROM trays WHERE id=$1', [legacyTrayId])).rows)
        .toEqual([{ length_mm: '1234.567', length_source: 'manual', length_calculation: null }]);
      await expect(client.query("UPDATE trays SET length_source='auto' WHERE id=$1", [legacyTrayId]))
        .rejects.toMatchObject({ code: '23514' });
      await expect(client.query("UPDATE trays SET length_source='auto',length_mm=NULL,length_calculation='{}'::jsonb WHERE id=$1", [legacyTrayId]))
        .rejects.toMatchObject({ code: '23514' });
      await expect(client.query("UPDATE trays SET length_calculation='{}'::jsonb WHERE id=$1", [legacyTrayId]))
        .rejects.toMatchObject({ code: '23514' });
      await client.query('INSERT INTO trays(id,project_id,name) VALUES($1,$2,$3)', [tray.projectTrayId, a.projectId, tray.rawName]);
      await client.query('INSERT INTO project_model_selections VALUES($1,$2,$3)', [a.projectId, a.modelVersionId, a.selectionRevision]);
      await client.query('INSERT INTO model_versions VALUES($1,$2,$3,$4,$5)', [a.modelVersionId, a.projectId, a.contentFingerprint, 'ready', 'healthy']);
      await client.query('INSERT INTO pf_project_preparations VALUES($1,$2,$3,$4,$5)', [a.projectId, a.id, a.artifactId, a.geometryRevision, a.resolutionRevision]);
      await client.query('INSERT INTO pf_preparation_aggregates VALUES($1,$2,$3,$4,$5,$6,$7)', [a.id, a.projectId, a.sessionId, a.modelVersionId, a.artifactId, a.geometryRevision, a]);
      await client.query('INSERT INTO pf_preparation_sessions VALUES($1,$2,$3,$4,$5)', [a.sessionId, a.projectId, f.plan, 'published', a.id]);
      await client.query('INSERT INTO pf_artifacts VALUES($1,$2,$3,$4,$5)', [a.artifactId, a.projectId, a.modelVersionId, a.projection.sha256, a.projection.bytes]);
      await client.query('INSERT INTO pf_geometry_trace_sets VALUES($1,$2,$3,$4,$5,$6)', [f.traceId, a.projectId, a.id, a.modelVersionId, GEOMETRY_TRACE_DERIVATION, built.manifest]);
      await client.query('INSERT INTO pf_preparation_commands VALUES($1,$2,$3)', [a.projectId, 'publish', { sessionId: a.sessionId, aggregate: a }]);
      for (const record of built.records) {
        const summary = built.summaries.find(value => value.id === record.id)!;
        await client.query('INSERT INTO pf_geometry_object_revisions VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [record.id, a.projectId, f.traceId, record.identity.objectId, summary.orderIndex, record.catalog.projectTrayId, summary, record]);
      }
      await client.query('BEGIN'); transaction = true;
      const measured = await readCurrentTrayAutoLength(client as unknown as Pick<PoolClient, 'query'>, a.projectId, tray.projectTrayId);
      expect(measured).toMatchObject({ lengthMm: 7000, elementCount: 1, aggregateId: a.id, modelVersionId: a.modelVersionId, traceId: f.traceId });
      await writer.connect(); writerConnected = true;
      await writer.query("SELECT set_config('search_path',$1,false)", [schema]);
      await writer.query("SET lock_timeout='100ms'");
      await expect(writer.query('UPDATE project_model_selections SET selection_revision=selection_revision+1 WHERE project_id=$1', [a.projectId]))
        .rejects.toMatchObject({ code: '55P03' });
      await expect(writer.query('UPDATE pf_project_preparations SET geometry_revision=geometry_revision+1 WHERE project_id=$1', [a.projectId]))
        .rejects.toMatchObject({ code: '55P03' });
      await client.query('COMMIT'); transaction = false;
      const calculation = { ...measured, calculatedAt: new Date().toISOString() };
      await client.query("UPDATE trays SET length_source='auto',length_mm=$2,length_calculation=$3 WHERE id=$1", [legacyTrayId, measured.lengthMm, calculation]);
      expect((await client.query('SELECT length_mm::text,length_source,length_calculation FROM trays WHERE id=$1', [legacyTrayId])).rows[0])
        .toEqual({ length_mm: '7000', length_source: 'auto', length_calculation: calculation });
      await client.query("UPDATE trays SET length_source='manual',length_mm=$2,length_calculation=NULL WHERE id=$1", [legacyTrayId, 1234.567]);
      expect((await client.query('SELECT length_mm::text,length_source,length_calculation FROM trays WHERE id=$1', [legacyTrayId])).rows[0])
        .toEqual({ length_mm: '1234.567', length_source: 'manual', length_calculation: null });
      await expect(writer.query('UPDATE pf_project_preparations SET geometry_revision=geometry_revision+1 WHERE project_id=$1', [a.projectId]))
        .resolves.toMatchObject({ rowCount: 1 });

      // There is now no published current network. A manual assignment alone
      // plus its independently fitted polylines must support preview and Save.
      await client.query('UPDATE pf_project_preparations SET current_aggregate_id=NULL,current_artifact_id=NULL WHERE project_id=$1', [a.projectId]);
      const scopeKeys = ['modelVersionId', 'contentFingerprint', 'selectionRevision', 'catalogRevision', 'routingContentSha256',
        'routingPolicyRevision', 'routingPolicySha256', 'locationRegistryRevision', 'resolutionRevision'] as const;
      const resolution = { id: randomUUID(), projectTrayId: tray.projectTrayId, mode: 'roots', rootObjectIds: ['dbid:9', 'dbid:2'],
        reason: 'Synthetic independent measurement assignment', actorId: f.createdBy, createdAt: f.createdAt,
        scope: Object.fromEntries(scopeKeys.map(key => [key, f.plan[key]])) };
      await client.query('INSERT INTO pf_preparation_resolutions(project_id,project_tray_id,resolution) VALUES($1,$2,$3)',
        [a.projectId, tray.projectTrayId, resolution]);
      const context = await readTrayAutoLengthCaptureContext(client as unknown as Pick<PoolClient, 'query'>, a.projectId, tray.projectTrayId);
      expect(context.rootObjectIds).toEqual([2, 9]);
      const standalone = { source: 'tray-capture', modelVersionId: context.modelVersionId, selectionRevision: context.selectionRevision,
        assignmentSha256: context.assignmentSha256, measurementId: randomUUID(), lengthMm: 9000, elementCount: 2 };
      const proof = { snapshotSha256: 'a'.repeat(64), fittedSha256: 'b'.repeat(64), engine: f.fitted.engine,
        rulesSha256: f.fitted.rulesSha256, measurementVersion: f.fitted.measurementVersion,
        elements: [{ objectId: 'dbid:9', pointsMetres: [[0, 0, 0], [3, 0, 0], [3, 4, 0]], geometricLengthMetres: 7 },
          { objectId: 'dbid:2', pointsMetres: [[100, 0, 0], [102, 0, 0]], geometricLengthMetres: 2 }] };
      const contentSha256 = createHash('sha256').update(canonicalPurposeJson({ context, measurement: standalone, proof })).digest('hex');
      await expect(client.query('INSERT INTO tray_auto_length_measurements(tray_id,project_id,context,measurement,proof,content_sha256) VALUES($1,$2,$3,$4,$5,$6)',
        [tray.projectTrayId, a.projectId, context, standalone, proof, 'invalid']))
        .rejects.toMatchObject({ code: '23514' });
      await expect(client.query('INSERT INTO tray_auto_length_measurements(tray_id,project_id,context,measurement,proof,content_sha256) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), a.projectId, context, standalone, proof, contentSha256]))
        .rejects.toMatchObject({ code: '23503' });
      await expect(client.query('INSERT INTO tray_auto_length_measurements(tray_id,project_id,context,measurement,proof,content_sha256) VALUES($1,$2,$3,$4,$5,$6)',
        [tray.projectTrayId, a.projectId, context, standalone, { padding: 'x'.repeat(1048576) }, contentSha256]))
        .rejects.toMatchObject({ code: '23514' });
      await client.query('INSERT INTO tray_auto_length_measurements(tray_id,project_id,context,measurement,proof,content_sha256) VALUES($1,$2,$3,$4,$5,$6)',
        [tray.projectTrayId, a.projectId, context, standalone, proof, contentSha256]);
      await client.query(TRAY_AUTO_LENGTH_CAPTURE_SQL);
      expect((await client.query('SELECT length_mm,length_source FROM trays WHERE id=$1', [tray.projectTrayId])).rows[0])
        .toEqual({ length_mm: null, length_source: 'manual' });
      await expect(readCurrentTrayAutoLength(client as unknown as Pick<PoolClient, 'query'>, a.projectId, tray.projectTrayId))
        .resolves.toEqual(standalone);

      await client.query('BEGIN'); transaction = true;
      // Mirror the update route: lock the current manual/empty length first,
      // then re-read exact measurement proof and hold all model/assignment
      // fences until its single tray write commits.
      const oldLength = (await client.query('SELECT length_mm,length_source FROM trays WHERE project_id=$1 AND id=$2 FOR UPDATE',
        [a.projectId, tray.projectTrayId])).rows[0];
      expect(oldLength).toEqual({ length_mm: null, length_source: 'manual' });
      const captured = await readCurrentTrayAutoLength(client as unknown as Pick<PoolClient, 'query'>, a.projectId, tray.projectTrayId);
      expect(captured).toEqual(standalone);
      await expect(writer.query('UPDATE project_model_selections SET selection_revision=selection_revision+1 WHERE project_id=$1', [a.projectId]))
        .rejects.toMatchObject({ code: '55P03' });
      await expect(writer.query('UPDATE pf_project_preparations SET resolution_revision=resolution_revision+1 WHERE project_id=$1', [a.projectId]))
        .rejects.toMatchObject({ code: '55P03' });
      await expect(writer.query('UPDATE trays SET length_mm=999 WHERE id=$1', [tray.projectTrayId]))
        .rejects.toMatchObject({ code: '55P03' });
      const capturedCalculation = { ...captured, calculatedAt: new Date().toISOString() };
      await client.query("UPDATE trays SET length_source='auto',length_mm=$2,length_calculation=$3 WHERE id=$1",
        [tray.projectTrayId, captured.lengthMm, capturedCalculation]);
      await client.query('COMMIT'); transaction = false;
      expect((await client.query('SELECT length_mm::text,length_source,length_calculation FROM trays WHERE id=$1', [tray.projectTrayId])).rows[0])
        .toEqual({ length_mm: '9000', length_source: 'auto', length_calculation: capturedCalculation });

      // A global preparation/catalog counter does not change this measurement;
      // replacing this tray's own roots or model selection does invalidate it.
      await writer.query('UPDATE pf_project_preparations SET resolution_revision=resolution_revision+1 WHERE project_id=$1', [a.projectId]);
      await expect(readCapturedTrayAutoLength(client as unknown as Pick<PoolClient, 'query'>, a.projectId, tray.projectTrayId))
        .resolves.toEqual(standalone);
      await writer.query("UPDATE pf_preparation_resolutions SET resolution=jsonb_set(resolution,'{rootObjectIds}',$3::jsonb) WHERE project_id=$1 AND project_tray_id=$2",
        [a.projectId, tray.projectTrayId, JSON.stringify(['dbid:9'])]);
      await expect(readCapturedTrayAutoLength(client as unknown as Pick<PoolClient, 'query'>, a.projectId, tray.projectTrayId)).resolves.toBeNull();
      await expect(readCurrentTrayAutoLength(client as unknown as Pick<PoolClient, 'query'>, a.projectId, tray.projectTrayId))
        .rejects.toMatchObject({ code: 'TRAY_AUTO_LENGTH_UNAVAILABLE' });
      expect((await client.query('SELECT length_mm::text FROM trays WHERE id=$1', [tray.projectTrayId])).rows[0]).toEqual({ length_mm: '9000' });
      await writer.query('UPDATE pf_preparation_resolutions SET resolution=$3 WHERE project_id=$1 AND project_tray_id=$2',
        [a.projectId, tray.projectTrayId, resolution]);
      await writer.query('UPDATE project_model_selections SET selection_revision=selection_revision+1 WHERE project_id=$1', [a.projectId]);
      await expect(readCapturedTrayAutoLength(client as unknown as Pick<PoolClient, 'query'>, a.projectId, tray.projectTrayId)).resolves.toBeNull();
      await client.query('DELETE FROM trays WHERE id=$1', [tray.projectTrayId]);
      expect((await client.query('SELECT count(*)::int AS n FROM tray_auto_length_measurements')).rows[0]).toEqual({ n: 0 });
    } finally {
      if (writerConnected) await writer.end();
      if (connected) {
        if (transaction) await client.query('ROLLBACK');
        if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        await client.end();
      }
    }
  }, 15000);
});
