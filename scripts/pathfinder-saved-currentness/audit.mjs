// Administrative observation only: run inside the existing application container.
import pg from 'pg';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const projectId = process.argv[2] ?? 'da667921-1f13-4c1d-9f87-063d127b98ce';
const panel = process.argv[3] ?? 'JB_Prod20_03';
if (!/^[a-f0-9-]{36}$/i.test(projectId) || !panel.trim() || panel.length > 256 || /[\u0000-\u001f\u007f]/.test(panel)) {
  console.error('INVALID_DIAGNOSTIC_SCOPE'); process.exit(1);
}
const report = { schemaVersion: 'wfc.pf.saved-currentness-audit.v1', observedAt: new Date().toISOString(),
  projectId, panel, readOnly: false, running: {}, cables: [],
  interpretation: 'A recorded/current profile or engine mismatch is sufficient to reject strict saved-result currentness. Matching values alone do not prove currentness; this audit does not replace the full receipt, endpoint, model and settings proof.' };
const load = relative => import(pathToFileURL(path.resolve(process.cwd(), 'server/dist', relative)).href);
const safeCode = error => /^[A-Z0-9_]{1,80}$/.test(error?.code ?? '') ? error.code : 'DIAGNOSTIC_READ_FAILED';
const deadline = setTimeout(() => { console.error('DIAGNOSTIC_DEADLINE_EXCEEDED'); process.exit(2); }, 30_000);
let pool, client;
try {
  if (!process.env.DATABASE_URL?.trim()) throw Object.assign(new Error(), { code: 'DATABASE_URL_REQUIRED' });
  let runtimeProfiles, canonicalProfile;
  try {
    const [profiles, { barrierCanonicalJson }] = await Promise.all([
      load('shared/pathfinderBarrierMixed.js'), load('shared/pathfinderBarriers.js'),
    ]);
    runtimeProfiles = profiles; canonicalProfile = barrierCanonicalJson;
  } catch (error) { report.running.profileReadError = safeCode(error); }
  try {
    const { mixedBarrierCalculationEngineIdentity } = await load('server/pathfinder/calculationEngineIdentity.js');
    const identity = await mixedBarrierCalculationEngineIdentity({ force: true });
    report.running.mixedEngine = { schemaVersion: identity.schemaVersion, version: identity.version,
      contentSha256: identity.contentSha256, runtimeProfile: identity.policyVersions.runtimeProfile };
    const profile = Object.entries(runtimeProfiles ?? {}).find(([name, value]) => name.endsWith('RUNTIME_PROFILE')
      && value?.schemaVersion === identity.policyVersions.runtimeProfile)?.[1];
    if (profile && canonicalProfile) report.running.mixedProfile = { version: profile.schemaVersion, maxPairs: profile.routing.maxPairs,
      sha256: createHash('sha256').update(canonicalProfile(profile)).digest('hex') };
    else report.running.profileReadError ??= 'RUNNING_PROFILE_EXPORT_UNAVAILABLE';
  } catch (error) { report.running.engineReadError = safeCode(error); }
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10_000 });
  client = await pool.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout='10000ms'; SET LOCAL idle_in_transaction_session_timeout='15000ms'");
  const mode = (await client.query('SHOW transaction_read_only')).rows[0];
  if (mode.transaction_read_only !== 'on') throw Object.assign(new Error(), { code: 'READ_ONLY_REQUIRED' });
  report.readOnly = true;
  const decisionAvailable = (await client.query("SELECT to_regclass('pf_automatic_pair_admission_decisions') IS NOT NULL AS available")).rows[0].available;
  report.admissionDecisionEvidenceAvailable = decisionAvailable;
  const decisionJoin = decisionAvailable ? 'LEFT JOIN pf_automatic_pair_admission_decisions decision ON decision.project_id=a.project_id AND decision.job_id=a.job_id AND decision.cable_id=b.cable_id' : '';
  const updateStatus = decisionAvailable ? "COALESCE(d.status,CASE WHEN decision.reason_code IS NOT NULL THEN 'review-required' END)" : 'd.status';
  const updateReason = decisionAvailable ? 'CASE WHEN d.status IS NOT NULL THEN d.reason_code ELSE decision.reason_code END' : 'd.reason_code';
  const { rows } = await client.query(`
    WITH selected AS (
      SELECT id,project_id,tag,from_location,to_location,routing,design_length,cable_write_revision,updated_at
      FROM cables WHERE project_id=$1 AND mto IS DISTINCT FROM 'MV'
        AND (upper(trim(from_location))=upper(trim($2)) OR upper(trim(to_location))=upper(trim($2)))
      ORDER BY id LIMIT 101
    )
    SELECT c.id,left(c.tag,256) AS tag,left(c.from_location,256) AS from_location,left(c.to_location,256) AS to_location,
      c.updated_at AS cable_updated_at,
      jsonb_build_object('revision',c.cable_write_revision::text,'routing',left(c.routing,4096),'designLength',c.design_length::text) AS current,
      latest.job_id,latest.admitted_at,latest.job_created_at,latest.job_status,latest.item_state,latest.item_status,
      latest.proposal_id,latest.proposal_status,latest.proposal_created_at,latest.automatic_update_status,latest.automatic_update_reason,
      latest.proposal AS latest_proposal,
      saved.receipt_id,saved.applied_at,saved.receipt_kind,saved.saved_proposal_id,saved.saved_proposal_status,
      saved.receipt_after,saved.proposal AS saved_proposal
    FROM selected c
    LEFT JOIN LATERAL (
      SELECT a.job_id,a.created_at AS admitted_at,j.created_at AS job_created_at,j.state AS job_status,
        i.state AS item_state,i.status AS item_status,p.id AS proposal_id,p.status AS proposal_status,p.created_at AS proposal_created_at,
        ${updateStatus} AS automatic_update_status,
        ${updateReason} AS automatic_update_reason,
        jsonb_build_object('dependencySchema',p.dependencies->>'schemaVersion','barrierLane',p.dependencies->'barriers'->>'schemaVersion',
          'cableRevision',p.dependencies->>'cableWriteRevision','routing',left(p.result->'route'->>'routeText',4096),
          'designLength',p.result->'design'->>'designLengthMeters','runtimeProfile',p.dependencies->'barriers'->'profile'->>'schemaVersion',
          'maxPairs',p.dependencies->'barriers'->'profile'->'routing'->'maxPairs','profileSha256',p.dependencies->'barriers'->>'profileSha256',
          'engineSchema',p.dependencies->'engineIdentity'->>'schemaVersion','engineContentSha256',p.dependencies->'engineIdentity'->>'contentSha256') AS proposal
      FROM pf_revision_baselines b JOIN pf_revision_admissions a ON a.project_id=b.project_id AND a.id=b.admission_id
      LEFT JOIN pf_jobs j ON j.project_id=a.project_id AND j.id=a.job_id
      LEFT JOIN pf_job_items i ON i.project_id=a.project_id AND i.job_id=a.job_id AND i.cable_id=b.cable_id
      LEFT JOIN pf_proposals p ON p.project_id=a.project_id AND p.job_id=a.job_id AND p.cable_id=b.cable_id
      LEFT JOIN pf_automatic_pair_dispatch d ON d.project_id=a.project_id AND d.job_id=a.job_id AND d.cable_id=b.cable_id
      ${decisionJoin}
      WHERE b.project_id=c.project_id AND b.cable_id=c.id ORDER BY a.created_at DESC,a.id DESC LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT r.id AS receipt_id,r.applied_at,r.provenance->>'schemaVersion' AS receipt_kind,
        r.proposal_id AS saved_proposal_id,p.status AS saved_proposal_status,
        jsonb_build_object('revision',r.after_snapshot->>'cable_write_revision','routing',left(r.after_snapshot->>'routing',4096),
          'designLength',r.after_snapshot->>'design_length') AS receipt_after,
        jsonb_build_object('dependencySchema',p.dependencies->>'schemaVersion','barrierLane',p.dependencies->'barriers'->>'schemaVersion',
          'cableRevision',p.dependencies->>'cableWriteRevision','routing',left(p.result->'route'->>'routeText',4096),
          'designLength',p.result->'design'->>'designLengthMeters','runtimeProfile',p.dependencies->'barriers'->'profile'->>'schemaVersion',
          'maxPairs',p.dependencies->'barriers'->'profile'->'routing'->'maxPairs','profileSha256',p.dependencies->'barriers'->>'profileSha256',
          'engineSchema',p.dependencies->'engineIdentity'->>'schemaVersion','engineContentSha256',p.dependencies->'engineIdentity'->>'contentSha256') AS proposal
      FROM pf_apply_receipts r LEFT JOIN pf_proposals p ON p.project_id=r.project_id AND p.cable_id=r.cable_id AND p.id=r.proposal_id
      WHERE r.project_id=c.project_id AND r.cable_id=c.id ORDER BY r.applied_at DESC,r.id DESC LIMIT 1
    ) saved ON true ORDER BY c.id`, [projectId, panel]);
  if (rows.length > 100) throw Object.assign(new Error(), { code: 'DIAGNOSTIC_CABLE_LIMIT' });
  for (const row of rows) {
    const mismatches = [], evidenceGaps = [];
    if (!row.receipt_id) evidenceGaps.push('NO_SAVED_APPLY_RECEIPT');
    else if (row.saved_proposal?.barrierLane === 'wfc.pf.barrier-runtime.v2') {
      const recorded = row.saved_proposal, running = report.running;
      if (recorded.profileSha256 && running.mixedProfile && recorded.profileSha256 !== running.mixedProfile.sha256)
        mismatches.push('SAVED_RUNTIME_PROFILE_CHANGED');
      if (recorded.engineContentSha256 && running.mixedEngine && recorded.engineSchema === running.mixedEngine.schemaVersion
        && recorded.engineContentSha256 !== running.mixedEngine.contentSha256) mismatches.push('SAVED_ENGINE_IMPLEMENTATION_CHANGED');
    }
    report.cables.push({ ...row, provenStrictCurrentnessMismatches: mismatches, evidenceGaps });
  }
  await client.query('ROLLBACK');
  report.status = 'complete';
  if (Buffer.byteLength(JSON.stringify(report)) > 1024 * 1024) throw Object.assign(new Error(), { code: 'DIAGNOSTIC_OUTPUT_LIMIT' });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = safeCode(error); report.status = 'failed';
  console.log(JSON.stringify(report, null, 2));
  console.error('Saved currentness audit failed: ' + report.error); process.exitCode = 1;
} finally {
  if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  await pool?.end(); clearTimeout(deadline);
}
