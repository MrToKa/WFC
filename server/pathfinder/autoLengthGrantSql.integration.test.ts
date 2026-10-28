// @vitest-environment node
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { hash } from './dependencies.js';
import { initializeCalculationGrantSchema } from './calculationGrantSchema.js';
import { initializeGrantOperationSchema } from './grantOperationSchema.js';
import { initializeRevisionResultSchema } from './revisionResultSchema.js';
import { initializeAutoLengthSchema } from './autoLengthSchema.js';
import { RECALCULATION_SQL } from './recalculationSchema.js';
import { sealRevisionResult } from './revisionResultRepository.js';
import { registerAutoLengthAdmission, publishAutoLength, readAutoLengths } from './autoLengthStore.js';
import { createCalculationGrantRepository, newCalculationGrantLeaseOwner, fenceCalculationGrantInstallationInTransaction } from './calculationGrantRepository.js';
import { calculationGrantAuthoritySchema, calculationGrantRecordHash, calculationGrantProvenance, calculationAuthorityOwnerHash,
  type CalculationGrantAuthority } from './calculationAuthority.js';
import { calculationGrantSchema, CALCULATION_GRANT_OPERATIONS } from '../../shared/pathfinderCalculationGrant.js';
import { revisionBaselineSchema } from '../../shared/pathfinderRevisionResults.js';
import { grantOperationPrincipal, operationTransaction } from './operationAuthority.js';
import { requireEnrollmentAuthority } from './recalculationRepository.js';

/** Opt-in actual SQL qualification of the existing finite calculate-grant
 * transaction/enrollment/seal/Auto boundary. Grant checks are not mocked.
 * Engine geometry/identity and direct admission inputs remain synthetic;
 * this is not the worker/producer loop, managed capture, HTTP or human Apply. */
const fixturePath = process.env.PF_B8_GRANT_SQL_FIXTURE, schemaName = 'pfb8_auto_grant';
let pool: Pool;
type Fixture = Awaited<ReturnType<typeof seed>>;
type Admission = Awaited<ReturnType<typeof admit>>;

const baseSchema = `
CREATE TABLE IF NOT EXISTS projects(id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,is_admin boolean NOT NULL);
CREATE TABLE IF NOT EXISTS model_versions(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 state text NOT NULL,health text NOT NULL,content_fingerprint text NOT NULL,UNIQUE(project_id,id));
CREATE TABLE IF NOT EXISTS project_model_selections(project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 active_model_version_id uuid NOT NULL,selection_revision bigint NOT NULL,
 FOREIGN KEY(project_id,active_model_version_id) REFERENCES model_versions(project_id,id));
CREATE TABLE IF NOT EXISTS cables(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 cable_write_revision bigint NOT NULL DEFAULT 0,tag text,from_location text,to_location text,routing text,
 design_length numeric,install_length numeric,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id));
CREATE TABLE IF NOT EXISTS pf_jobs(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 requested_by uuid NOT NULL,login_id uuid,login_expires_at timestamptz,kind text NOT NULL DEFAULT 'calculate',
 state text NOT NULL,cancel_requested boolean NOT NULL DEFAULT false,total int NOT NULL DEFAULT 2,completed int NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id));
CREATE TABLE IF NOT EXISTS pf_job_items(project_id uuid NOT NULL,job_id uuid NOT NULL,cable_id uuid NOT NULL,
 state text NOT NULL,status text NOT NULL,dependencies jsonb,PRIMARY KEY(project_id,job_id,cable_id),
 FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS pf_proposals(id uuid PRIMARY KEY,project_id uuid NOT NULL,job_id uuid NOT NULL,cable_id uuid NOT NULL,
 status text NOT NULL,dependencies jsonb NOT NULL,dependency_hash text NOT NULL,geometry_hash text NOT NULL,result jsonb NOT NULL,
 proposal_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id),UNIQUE(project_id,job_id,cable_id),
 FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid,expires_at timestamptz,revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS cable_versions(id bigserial PRIMARY KEY,snapshot jsonb);
CREATE TABLE IF NOT EXISTS pf_reviews(id uuid PRIMARY KEY,project_id uuid);
CREATE TABLE IF NOT EXISTS pf_apply_receipts(id uuid PRIMARY KEY,project_id uuid,cable_id uuid,applied_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS pf_initial_fill_mandates(id uuid PRIMARY KEY,project_id uuid);
CREATE TABLE IF NOT EXISTS pf_location_impact_enrollments(project_id uuid,job_id uuid,impact_id uuid);
CREATE TABLE IF NOT EXISTS pf_preparation_sessions(id uuid,project_id uuid,actor_id uuid,login_id uuid,plan jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS pf_preparation_events(id uuid,project_id uuid,actor_id uuid,login_id uuid);
`;

async function seed(shortLease = false) {
  const fixture = syntheticBarrierWriteInputs(), { dependencies } = fixture;
  dependencies.cableWriteRevision = '0';
  const projectId = dependencies.projectId, cableId = dependencies.cableId, issuerId = randomUUID(), grantId = randomUUID();
  await pool.query('INSERT INTO projects VALUES($1)', [projectId]);
  await pool.query('INSERT INTO users(id,is_admin) VALUES($1,true)', [issuerId]);
  await pool.query("INSERT INTO model_versions VALUES($1,$2,'ready','healthy',$3)", [dependencies.model.id, projectId, dependencies.model.contentFingerprint]);
  await pool.query('INSERT INTO project_model_selections VALUES($1,$2,$3)', [projectId, dependencies.model.id, dependencies.model.selectionRevision]);
  await pool.query("INSERT INTO cables(id,project_id,tag,from_location,to_location,routing,design_length,install_length) VALUES($1,$2,'SYNTHETIC','FROM','TO','/EXISTING',99,123.45)", [cableId, projectId]);
  const epoch = (await pool.query('SELECT installation_epoch FROM pf_installation_state WHERE singleton=true')).rows[0].installation_epoch as string;
  const grant = calculationGrantSchema.parse({ schemaVersion: 'wfc.pf.calculation-grant.v1', projectId, id: grantId, grantRevision: '1', grantEpoch: '1',
    installationEpoch: epoch, enabled: true, enabledBy: issuerId, enabledAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    issuerAdminRevision: '0', scope: 'active-model', operations: [...CALCULATION_GRANT_OPERATIONS], limitsProfile: 'local-bounded-v1',
    preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true, barrierRouting: dependencies.options.barrierRouting }, timeoutMilliseconds: 60000 });
  await pool.query(`INSERT INTO pf_calculation_grant_revisions(project_id,id,grant_revision,grant_epoch,installation_epoch,issuer_id,issuer_admin_revision,record_sha256,record)
    VALUES($1,$2,1,1,$3,$4,0,$5,$6)`, [projectId, grantId, epoch, issuerId, calculationGrantRecordHash(grant), grant]);
  await pool.query('UPDATE pf_calculation_grant_heads SET grant_id=$2,control_revision=1,grant_epoch=1 WHERE project_id=$1', [projectId, grantId]);
  await pool.query('INSERT INTO pf_recalculation_state(project_id,desired_generation,control_revision,authority_epoch) VALUES($1,1,1,1)', [projectId]);
  const claim = { projectId, grantId, grantRevision: '1', grantEpoch: '1', installationEpoch: epoch, operation: 'calculate' as const,
    modelVersionId: dependencies.model.id, selectionRevision: dependencies.model.selectionRevision, contentFingerprint: dependencies.model.contentFingerprint,
    ...newCalculationGrantLeaseOwner() };
  let authority: CalculationGrantAuthority;
  if (!shortLease) authority = await createCalculationGrantRepository(pool).claim(claim);
  else {
    // A real five-second lease row exercises actual clock expiry without a
    // fifteen-minute test or a mocked authority function. It is not a claim
    // factory timing benchmark; all production identity constraints remain.
    const created = new Date(), expires = new Date(created.getTime() + 5000);
    await pool.query(`INSERT INTO pf_calculation_grant_leases(id,project_id,grant_id,grant_revision,grant_epoch,installation_epoch,issuer_id,issuer_admin_revision,
      operation,model_version_id,selection_revision,content_fingerprint,owner_sha256,state,created_at,expires_at)
      VALUES($1,$2,$3,1,1,$4,$5,0,'calculate',$6,$7,$8,$9,'active',$10,$11)`,
    [claim.leaseId, projectId, grantId, epoch, issuerId, claim.modelVersionId, claim.selectionRevision, claim.contentFingerprint,
      calculationAuthorityOwnerHash(claim.ownerToken), created, expires]);
    authority = calculationGrantAuthoritySchema.parse({ ...claim, kind: 'calculation-grant', issuerId, issuerAdminRevision: '0', leaseExpiresAt: expires.toISOString() });
  }
  const cable = async () => (await pool.query('SELECT to_jsonb(c) AS value FROM cables c WHERE project_id=$1 AND id=$2', [projectId, cableId])).rows[0].value;
  const counts = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM pf_auto_lengths) AS auto,(SELECT count(*)::int FROM pf_proposals) AS proposals,
    (SELECT count(*)::int FROM pf_revision_results) AS seals,(SELECT count(*)::int FROM cable_versions) AS history,
    (SELECT count(*)::int FROM pf_reviews) AS reviews,(SELECT count(*)::int FROM pf_apply_receipts) AS receipts,
    (SELECT count(*)::int FROM pf_initial_fill_mandates) AS mandates,(SELECT count(*)::int FROM viewer_login_bindings) AS logins`)).rows[0];
  return { ...fixture, projectId, cableId, authority, cable, counts };
}

async function admit(f: Fixture) {
  const admissionId = randomUUID(), jobId = randomUUID(), proposalId = randomUUID();
  return operationTransaction(pool, f.projectId, grantOperationPrincipal(f.authority), 'calculate', async client => {
    const provenance = calculationGrantProvenance(f.authority);
    await client.query("INSERT INTO pf_jobs(id,project_id,requested_by,state,authority_kind,grant_provenance) VALUES($1,$2,$3,'running','calculation-grant',$4)", [jobId, f.projectId, f.authority.issuerId, provenance]);
    await client.query(`INSERT INTO pf_recalculation_enrollments(project_id,generation,control_revision,authority_epoch,actor_id,login_id,authority_expires_at,grant_provenance,
      job_id,input_sha256,total,ready_cables,blocked_cables,reason_codes) VALUES($1,1,1,1,$2,NULL,NULL,$3,$4,$5,1,1,0,'[]')`,
    [f.projectId, f.authority.issuerId, provenance, jobId, 'a'.repeat(64)]);
    const baseline = revisionBaselineSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-baseline.v1', currentCable: { id: f.cableId, tag: 'SYNTHETIC',
      fromLocation: 'FROM', toLocation: 'TO', routing: '/EXISTING', designLength: '99', installLength: '123.45', cableWriteRevision: '0' }, lastAcceptedApply: null, acceptedMatchesCurrent: false });
    const baselineHash = hash(baseline);
    await client.query(`INSERT INTO pf_revision_admissions(id,project_id,job_id,generation,kind,input_sha256,options,model_ref,total,observed_events)
      VALUES($1,$2,$3,1,'automatic',$4,$5,$6,1,'[]')`, [admissionId, f.projectId, jobId, hash({ admissionId }), f.dependencies.options, f.dependencies.model]);
    await client.query("INSERT INTO pf_revision_baselines VALUES($1,$2,$3,$4,$5,'ready','Synthetic grant qualification')", [f.projectId, admissionId, f.cableId, baselineHash, baseline]);
    await client.query("INSERT INTO pf_job_items VALUES($1,$2,$3,'running','calculating',$4)", [f.projectId, jobId, f.cableId, f.dependencies]);
    await registerAutoLengthAdmission(client, { projectId: f.projectId, admissionId, jobId, cableIds: [f.cableId] });
    await requireEnrollmentAuthority(client, { projectId: f.projectId, jobId, cableId: f.cableId });
    return { admissionId, jobId, proposalId, baselineHash };
  });
}

async function complete(f: Fixture, a: Admission, afterPublish?: (client: PoolClient) => Promise<void>) {
  return operationTransaction(pool, f.projectId, grantOperationPrincipal(f.authority), 'calculate', async client => {
    await requireEnrollmentAuthority(client, { projectId: f.projectId, jobId: a.jobId, cableId: f.cableId });
    const proposalHash = hash({ dependencies: f.dependencies, result: f.result, baselineHash: a.baselineHash });
    await client.query(`INSERT INTO pf_proposals(id,project_id,job_id,cable_id,status,dependencies,dependency_hash,geometry_hash,result,proposal_hash)
      VALUES($1,$2,$3,$4,'calculated',$5,$6,$7,$8,$9)`, [a.proposalId, f.projectId, a.jobId, f.cableId, f.dependencies, hash(f.dependencies), 'a'.repeat(64), f.result, proposalHash]);
    const seal = await sealRevisionResult(client, { projectId: f.projectId, jobId: a.jobId, cableId: f.cableId, proposalId: a.proposalId,
      dependencyHash: hash(f.dependencies), dependencies: f.dependencies, result: f.result });
    await client.query("UPDATE pf_job_items SET state='complete',status='calculated' WHERE project_id=$1 AND job_id=$2 AND cable_id=$3", [f.projectId, a.jobId, f.cableId]);
    const published = await publishAutoLength(client, { projectId: f.projectId, jobId: a.jobId, cableId: f.cableId, proposalId: a.proposalId,
      dependencies: f.dependencies, result: f.result, seal });
    await requireEnrollmentAuthority(client, { projectId: f.projectId, jobId: a.jobId, cableId: f.cableId });
    await afterPublish?.(client);
    return published;
  });
}

describe.runIf(Boolean(fixturePath))('B8 actual calculate-grant transaction to checked synthetic Auto publication', () => {
  beforeAll(async () => {
    const scratch = await realpath(fileURLToPath(new URL('../../pathfinder-engine/.scratch/', import.meta.url))), resolved = await realpath(fixturePath!);
    const relative = path.relative(scratch, resolved), parts = relative.split(path.sep);
    if (path.isAbsolute(relative) || relative.startsWith('..') || parts.length !== 2
      || !/^barrier-qualification-20261021-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(parts[0]) || !/^[A-Za-z0-9_-]+[.]private[.]json$/.test(parts[1])) throw new Error('Refuse an unowned B8 grant fixture path.');
    const config = JSON.parse(await readFile(resolved, 'utf8')) as { database: string; url: string; owner: string };
    if (!/^wfc_pfb8grant_[a-f0-9_]+$/.test(config.database) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.owner)) throw new Error('Invalid B8 grant fixture identity.');
    const url = new URL(config.url);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port !== '55443'
      || decodeURIComponent(url.pathname.slice(1)) !== config.database) throw new Error('Refuse wrong-port or nonlocal B8 grant database.');
    pool = new Pool({ connectionString: config.url, options: `-c search_path=${schemaName},pg_catalog`, max: 4, connectionTimeoutMillis: 3000, query_timeout: 12000 });
    const owner = (await pool.query('SELECT current_database() AS db,owner FROM public.pfb8_fixture_owner')).rows;
    if (owner.length !== 1 || owner[0].db !== config.database || owner[0].owner !== config.owner) throw new Error('B8 grant fixture owner mismatch before DDL.');
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`); await pool.query(baseSchema);
    // Use actual production scheduler table DDL, without installing unrelated
    // business/model dirty triggers in this deliberately bounded SQL fixture.
    const prefixEnd = RECALCULATION_SQL.indexOf('CREATE OR REPLACE FUNCTION pf_recalculation_immutable()');
    if (prefixEnd < 0) throw new Error('Production recalculation table boundary changed.');
    await pool.query(RECALCULATION_SQL.slice(0, prefixEnd));
    await initializeCalculationGrantSchema(pool); await initializeGrantOperationSchema(pool);
    await initializeRevisionResultSchema(pool); await initializeAutoLengthSchema(pool);
  });
  beforeEach(async () => { await pool.query(`TRUNCATE ${schemaName}.projects,${schemaName}.users,${schemaName}.viewer_login_bindings,
    ${schemaName}.cable_versions,${schemaName}.pf_reviews,${schemaName}.pf_apply_receipts,${schemaName}.pf_initial_fill_mandates,${schemaName}.pf_location_impact_enrollments CASCADE`); });
  afterAll(async () => { await pool?.end(); });

  it('publishes checked per-item Auto through an actual calculate lease and enrollment while leaving all business and human-approval state untouched', async () => {
    const f = await seed(), before = await f.cable(), a = await admit(f);
    expect((await complete(f, a)).status).toBe('published');
    expect((await readAutoLengths(pool, f.projectId, [f.cableId])).get(f.cableId)).toMatchObject({ autoCalculatedLength: 7, autoLengthStatus: 'last-successful', autoLengthMatchesLatestRequest: true });
    expect((await pool.query('SELECT state,completed FROM pf_jobs WHERE id=$1', [a.jobId])).rows[0]).toEqual({ state: 'running', completed: 0 });
    expect(await f.cable()).toEqual(before);
    expect(await f.counts()).toEqual({ auto: 1, proposals: 1, seals: 1, history: 0, reviews: 0, receipts: 0, mandates: 0, logins: 0 });
  });

  it.each(['revoked', 'installation'] as const)('rolls back provisional Auto, proposal, seal and item after a final %s fence changes', async kind => {
    const f = await seed(), before = await f.cable(), a = await admit(f); let provisional = false;
    await expect(complete(f, a, async client => {
      provisional = (await client.query('SELECT count(*)::int n FROM pf_auto_lengths')).rows[0].n === 1;
      if (kind === 'revoked') await client.query('UPDATE pf_calculation_grant_heads SET grant_epoch=grant_epoch+1 WHERE project_id=$1', [f.projectId]);
      else await fenceCalculationGrantInstallationInTransaction(client, f.authority.installationEpoch, randomUUID());
    })).rejects.toMatchObject({ code: kind === 'revoked' ? 'CALCULATION_GRANT_REVOKED' : 'CALCULATION_GRANT_RESTORE_FENCED' });
    expect(provisional).toBe(true); expect(await f.cable()).toEqual(before);
    expect(await f.counts()).toEqual({ auto: 0, proposals: 0, seals: 0, history: 0, reviews: 0, receipts: 0, mandates: 0, logins: 0 });
    expect((await pool.query('SELECT state,status FROM pf_job_items WHERE job_id=$1', [a.jobId])).rows[0]).toEqual({ state: 'running', status: 'calculating' });
    expect((await pool.query('SELECT installation_epoch FROM pf_installation_state WHERE singleton=true')).rows[0].installation_epoch).toBe(f.authority.installationEpoch);
  });

  it('rolls back publication when the real finite lease expires after its checked value was provisionally written', async () => {
    const f = await seed(true), before = await f.cable(), a = await admit(f); let provisional = false;
    await expect(complete(f, a, async client => {
      provisional = (await client.query('SELECT count(*)::int n FROM pf_auto_lengths')).rows[0].n === 1;
      await client.query('SELECT pg_sleep(GREATEST(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.05)', [f.authority.leaseExpiresAt]);
    })).rejects.toMatchObject({ code: 'CALCULATION_GRANT_LEASE_EXPIRED' });
    expect(provisional).toBe(true); expect(await f.cable()).toEqual(before);
    expect(await f.counts()).toEqual({ auto: 0, proposals: 0, seals: 0, history: 0, reviews: 0, receipts: 0, mandates: 0, logins: 0 });
  }, 15000);
});
