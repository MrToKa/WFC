import { randomUUID } from 'node:crypto';
import { createDocker, command } from '../operations/docker.mjs';
import { ownership, request, fail } from './runtime-lib.mjs';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const unchangedFields = ['cables', 'cableSha256', 'proposals', 'reviews', 'applyReceipts', 'jobItems', 'locations', 'bindings', 'aliases'];
const literal = value => { if (!UUID.test(value ?? '')) fail('PF_PREVIEW_CRASH_UUID_INVALID'); return `'${value}'`; };

/** Check the execution boundary before any API, SQL or Docker operation. */
export function validatePreviewRecoveryTarget(target, sourceOrigin) {
  if (sourceOrigin !== 'http://127.0.0.1:5190' || target?.port === 5190 || target?.project === 'wfc-pathfinder-local'
    || !/^wfc-pathfinder-local-[a-f0-9]{12}$/.test(target?.project ?? '') || target?.restore?.inventoriesEqual !== true
    || target?.status !== 'running' || !UUID.test(target?.syntheticDemo?.projectId ?? '') || !UUID.test(target?.syntheticDemo?.actorId ?? ''))
    fail('PF_PREVIEW_CRASH_EXTRA_VERIFIED_TARGET_REQUIRED');
}

/** Standalone previews must never alter the shared registry or cable workflow. */
export function assertPreviewNoWorkflowWrites(before, after) {
  for (const value of [before, after]) for (const key of unchangedFields) {
    if (key === 'cableSha256' ? !/^[a-f0-9]{64}$/.test(value?.[key] ?? '') : !Number.isSafeInteger(value?.[key]) || value[key] < 0)
      fail('PF_PREVIEW_CRASH_BASELINE_INVALID');
  }
  if (unchangedFields.some(key => before[key] !== after[key])) fail('PF_PREVIEW_CRASH_WORKFLOW_CHANGED');
}

async function query(pgId, sql) {
  const raw = await command(['exec', pgId, 'psql', '--no-password', '--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1',
    '-U', 'pf_local', '-d', 'wfc_pathfinder_local', '-c', "SET statement_timeout='30s'; " + sql], { maxBytes: 1024 ** 2 });
  try { return JSON.parse(raw.toString().trim()); } catch { fail('PF_PREVIEW_CRASH_DATABASE_RESULT_INVALID'); }
}
async function top(docker, id) {
  const value = await docker.request('GET', '/containers/' + id + '/top?ps_args=' + encodeURIComponent('-eo pid,ppid,comm'));
  if (!Array.isArray(value?.Processes) || value.Processes.length > 256) fail('PF_PREVIEW_CRASH_PROCESS_INVENTORY_INVALID');
  return value.Processes.map(row => ({ pid: Number(row[0]), parentPid: Number(row[1]), command: row[2] }));
}
function workflowSql(projectId) {
  const project = literal(projectId);
  return `SELECT json_build_object('cables',(SELECT COUNT(*) FROM cables WHERE project_id=${project}),
    'cableSha256',(SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(c) ORDER BY id)::text,'[]'),'UTF8')),'hex') FROM cables c WHERE project_id=${project}),
    'proposals',(SELECT COUNT(*) FROM pf_proposals WHERE project_id=${project}),
    'reviews',(SELECT COUNT(*) FROM pf_reviews WHERE project_id=${project}),
    'applyReceipts',(SELECT COUNT(*) FROM pf_apply_receipts WHERE project_id=${project}),
    'jobItems',(SELECT COUNT(*) FROM pf_job_items WHERE project_id=${project}),
    'locations',(SELECT COUNT(*) FROM pf_locations WHERE project_id=${project}),
    'bindings',(SELECT COUNT(*) FROM pf_location_bindings WHERE project_id=${project}),
    'aliases',(SELECT COUNT(*) FROM pf_location_aliases WHERE project_id=${project}))`;
}

/** A second, bounded drill for the standalone kind; the primary stack is excluded. */
export async function previewCrashRecovery(target, token, sourceOrigin) {
  validatePreviewRecoveryTarget(target, sourceOrigin);
  const resources = await ownership(target), docker = await createDocker();
  const api = resources.containers.find(item => item.role === 'api'), pg = resources.containers.find(item => item.role === 'postgres');
  if (!api?.running || !pg?.running) fail('PF_PREVIEW_CRASH_TARGET_NOT_READY');
  const projectId = target.syntheticDemo.projectId, actorId = target.syntheticDemo.actorId;
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { fail('PF_PREVIEW_CRASH_FRESH_PRINCIPAL_REQUIRED'); }
  literal(claims.jti);
  if (claims.sub !== actorId || !Number.isSafeInteger(claims.exp)) fail('PF_PREVIEW_CRASH_FRESH_PRINCIPAL_REQUIRED');
  const markerCheck = await query(pg.id, `SELECT json_build_object('marked',EXISTS(SELECT 1 FROM pf_synthetic_projects s JOIN projects p ON p.id=s.project_id
    WHERE s.project_id=${literal(projectId)} AND p.project_number LIKE 'PF-SYNTHETIC-%' AND p.name LIKE 'Synthetic PathFinder%'))`);
  if (!markerCheck.marked) fail('PF_PREVIEW_CRASH_SYNTHETIC_MARKER_REQUIRED');
  const base = `/api/projects/${projectId}/pathfinder`, jobPath = id => `${base}/jobs/${id}`, previewPath = id => `${base}/previews/${id}`;
  const before = await query(pg.id, workflowSql(projectId)); assertPreviewNoWorkflowWrites(before, before);
  const current = await request(target, base + '/state', { token });
  if (current.status !== 200 || !UUID.test(current.value.artifacts?.[0]?.id ?? '')) fail('PF_PREVIEW_CRASH_STATE_FAILED');
  const fixtureSettings = current.value.settings;
  if (!fixtureSettings || Number(fixtureSettings.connectionGap) !== 1 || Number(fixtureSettings.secondaryTrayLength) !== 5
    || Number(fixtureSettings.endConnectionLength) !== 6 || Number(fixtureSettings.additionalBendingPercent) !== 10)
    fail('PF_PREVIEW_CRASH_KNOWN_FIXTURE_SETTINGS_REQUIRED');
  const marker = randomUUID().slice(0, 8), ids = [];
  for (let index = 0; index < 12; index++) {
    const created = await request(target, base + '/previews', { token, method: 'POST', body: {
      from: { name: `PF-PREVIEW-RECOVERY-${marker}-${index}-from`, point: [0, 0, 0.5] },
      to: { name: `PF-PREVIEW-RECOVERY-${marker}-${index}-to`, point: [10, 0, 0.5] }, category: 'Control', reverse: false,
      artifactId: current.value.artifacts[0].id, expectedSelectionRevision: current.value.activeModel.selectionRevision,
      expectedSettingsRevision: current.value.settings.revision, expectedRegistryRevision: current.value.registryRevision,
    } });
    if (created.status !== 202 || !UUID.test(created.value.jobId ?? '') || created.value.duplicate || ids.includes(created.value.jobId)) fail('PF_PREVIEW_CRASH_JOB_CREATE_FAILED');
    ids.push(created.value.jobId);
  }
  let queuedCancellation = { status: 'NOT_RUN', reason: 'No submitted preview remained queued at the bounded cancellation observation.' };
  let cancelledId;
  for (const id of [...ids].reverse()) {
    const value = await request(target, jobPath(id), { token });
    if (value.status !== 200 || value.value.kind !== 'preview') fail('PF_PREVIEW_CRASH_JOB_KIND_INVALID');
    if (value.value.status !== 'queued') continue;
    const cancelled = await request(target, jobPath(id), { token, method: 'DELETE' });
    if (cancelled.status !== 200 || !cancelled.value.cancelRequested) fail('PF_PREVIEW_CRASH_CANCEL_FAILED');
    if (cancelled.value.status === 'cancelled') { cancelledId = id; queuedCancellation = { status: 'PENDING', jobId: id, observedBefore: 'queued', afterCancel: 'cancelled' }; }
    else queuedCancellation = { status: 'NOT_RUN', jobId: id, reason: 'The preview left queued state between observation and cancellation; no queued-cancellation PASS inferred.' };
    break;
  }
  const known = `ARRAY[${ids.map(literal).join(',')}]::uuid[]`;
  let observed, observedRunning;
  const observeDeadline = Date.now() + 25000;
  while (Date.now() < observeDeadline) {
    const running = await query(pg.id, `SELECT COALESCE(json_agg(json_build_object('id',id,'attempts',attempts,'completed',completed)),'[]'::json)
      FROM pf_jobs WHERE project_id=${literal(projectId)} AND id=ANY(${known}) AND kind='preview' AND state='running' AND cancel_requested=false AND completed=0`);
    if (!running.length) {
      const remaining = await query(pg.id, `SELECT COUNT(*)::int FROM pf_jobs WHERE project_id=${literal(projectId)} AND id=ANY(${known}) AND state IN ('queued','running')`);
      if (!remaining) break;
      await pause(75); continue;
    }
    const inspected = await docker.inspect(api.id);
    if (inspected.Id !== api.id || inspected.Config.Labels?.['wfc.pathfinder.owner'] !== target.owner || inspected.Config.Labels?.['wfc.pathfinder.project'] !== target.project)
      fail('PF_PREVIEW_CRASH_TARGET_OWNERSHIP_CHANGED');
    const processes = (await top(docker, api.id)).filter(row => row.command === 'dotnet');
    if (processes.length >= 2 && processes.some(row => processes.some(parent => parent.pid === row.parentPid))) { observed = processes; observedRunning = running; break; }
    await pause(75);
  }
  let crash = { status: 'NOT_RUN', reason: 'No live .NET supervisor/worker pair was observed for the bounded preview queue; no crash was performed.' };
  if (observed) {
    // The immediately preceding operation observed the real pair in the exact
    // owned API. Never substitute a SQL lease edit or an artificial engine delay.
    await command(['kill', '--signal=KILL', api.id]);
    const killed = await docker.inspect(api.id);
    if (killed.State.Running || killed.State.Pid !== 0 || killed.State.ExitCode !== 137 || killed.State.OOMKilled) fail('PF_PREVIEW_CRASH_NAMESPACE_NOT_STOPPED');
    let topRefused = false; try { await top(docker, api.id); } catch { topRefused = true; }
    if (!topRefused) fail('PF_PREVIEW_CRASH_STOPPED_PROCESS_LIST_REMAINED');
    const sourceHealth = await fetch(sourceOrigin + '/health', { signal: AbortSignal.timeout(3000) });
    if (sourceHealth.status !== 200) fail('PF_PREVIEW_CRASH_SOURCE_HEALTH_FAILED');
    const persisted = await query(pg.id, `SELECT COALESCE(json_agg(json_build_object('id',id,'state',state,'attempts',attempts,'completed',completed,'total',total,'leaseUntil',lease_until)),'[]'::json)
      FROM pf_jobs WHERE project_id=${literal(projectId)} AND id=ANY(${known}) AND kind='preview' AND state='running' AND completed=0 AND cancel_requested=false`);
    await docker.start(api.id); const restartedAt = Date.now();
    if (persisted.length === 1 && observedRunning.some(job => job.id === persisted[0].id)) {
      const interrupted = persisted[0], deadline = restartedAt + 180000; let finalJob;
      while (Date.now() < deadline) {
        try {
          const value = await request(target, previewPath(interrupted.id), { token });
          if (value.status === 200) {
            if (value.value.status === 'complete') { finalJob = value.value; break; }
            if (['failed', 'cancelled'].includes(value.value.status)) fail('PF_PREVIEW_CRASH_RECOVERY_TERMINAL_FAILURE');
          }
        } catch (error) { if (error.code === 'PF_PREVIEW_CRASH_RECOVERY_TERMINAL_FAILURE') throw error; }
        await pause(300);
      }
      if (!finalJob || finalJob.kind !== 'preview' || finalJob.attempts < interrupted.attempts + 1 || finalJob.completed !== 1 || finalJob.total !== 1
        || finalJob.result?.status !== 'calculated' || finalJob.result.route?.success !== true || finalJob.result.stale || finalJob.result.canApply !== false
        || finalJob.result.engineeringAccepted !== false || finalJob.result.acceptanceScope !== 'standalone-preview' || !finalJob.result.design)
        fail('PF_PREVIEW_CRASH_RECOVERY_INCOMPLETE');
      // Exact, existing synthetic oracle: centreline10m, no SECONDARY
      // replacement, one6m reserve, then10%, Ceiling(17.6)=18m.
      const route = finalJob.result.route, design = finalJob.result.design;
      if (route.lengthMeters !== 10 || route.fromDistanceMeters !== 0 || route.toDistanceMeters !== 0
        || route.fromRequiresSecondary !== false || route.toRequiresSecondary !== false
        || Number(design.lengthBeforePercentageMeters) !== 16 || Number(design.unroundedLengthMeters) !== 17.6 || design.designLengthMeters !== '18')
        fail('PF_PREVIEW_CRASH_SYNTHETIC_FORMULA_MISMATCH');
      const restarted = await top(docker, api.id);
      if (restarted.some(row => observed.some(old => old.pid === row.pid))) fail('PF_PREVIEW_CRASH_OLD_PROCESS_PID_REMAINED');
      const publication = await query(pg.id, `SELECT json_build_object('results',(SELECT COUNT(*) FROM pf_lookup_results WHERE project_id=${literal(projectId)} AND job_id=${literal(interrupted.id)}),
        'items',(SELECT COUNT(*) FROM pf_job_items WHERE project_id=${literal(projectId)} AND job_id=${literal(interrupted.id)}),
        'proposals',(SELECT COUNT(*) FROM pf_proposals WHERE project_id=${literal(projectId)} AND job_id=${literal(interrupted.id)}),
        'immutableResultGuard',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='pf_lookup_results'::regclass AND tgname='pf_lookup_immutable' AND NOT tgisinternal AND tgenabled IN ('O','A')),
        'adminCurrent',(SELECT is_admin FROM users WHERE id=${literal(actorId)}),
        'loginCurrent',EXISTS(SELECT 1 FROM viewer_login_bindings WHERE login_id=${literal(claims.jti)} AND user_id=${literal(actorId)} AND revoked_at IS NULL AND expires_at=to_timestamp(${claims.exp}) AND expires_at>NOW()))`);
      if (publication.results !== 1 || publication.items !== 0 || publication.proposals !== 0 || !publication.immutableResultGuard || !publication.adminCurrent || !publication.loginCurrent)
        fail('PF_PREVIEW_CRASH_PUBLICATION_OR_AUTHORITY_CLOSURE_FAILED');
      crash = { status: 'PASS', jobId: interrupted.id, observedDotnetProcesses: observed, observedRunningPreviewJobs: observedRunning,
        stopped: { exitCode: killed.State.ExitCode, pid: killed.State.Pid, oomKilled: killed.State.OOMKilled, stoppedTopRefused: topRefused },
        persistedAtCrash: interrupted, afterRecovery: { status: finalJob.status, completed: finalJob.completed, total: finalJob.total, attempts: finalJob.attempts,
          elapsedAfterRestartMs: Date.now() - restartedAt, geometricLengthMeters: finalJob.result.route.lengthMeters, designLengthMeters: finalJob.result.design.designLengthMeters },
        publication, sourceHealthDuringTargetCrash: sourceHealth.status };
    } else {
      crash = { status: 'NOT_RUN', reason: 'KILL did not leave exactly one of the observed running previews persisted as interrupted. Target restarted; no natural-recovery PASS inferred.',
        observedDotnetProcesses: observed, observedRunningPreviewJobs: observedRunning, persistedRunningCount: persisted.length,
        stopped: { exitCode: killed.State.ExitCode, pid: killed.State.Pid, oomKilled: killed.State.OOMKilled, stoppedTopRefused: topRefused }, sourceHealthDuringTargetCrash: sourceHealth.status };
      const deadline = Date.now() + 30000; let ready = false;
      while (Date.now() < deadline) {
        try { const health = await fetch(`http://127.0.0.1:${target.port}/health`, { signal: AbortSignal.timeout(3000) }); if (health.status === 200) { ready = true; break; } } catch { /* bounded startup */ }
        await pause(300);
      }
      if (!ready) fail('PF_PREVIEW_CRASH_TARGET_RESTART_FAILED');
    }
  }
  // Explicitly cancel exactly these disposable preview jobs; never touch a
  // copied user's job or the primary runtime's durable cancellation state.
  for (const id of ids) {
    const cancelled = await request(target, jobPath(id), { token, method: 'DELETE' });
    if (cancelled.status !== 200) fail('PF_PREVIEW_CRASH_TEST_JOB_CANCEL_FAILED');
  }
  if (cancelledId) {
    const cancellation = await query(pg.id, `SELECT json_build_object('state',state,'cancelRequested',cancel_requested,
      'results',(SELECT COUNT(*) FROM pf_lookup_results WHERE project_id=j.project_id AND job_id=j.id),
      'items',(SELECT COUNT(*) FROM pf_job_items WHERE project_id=j.project_id AND job_id=j.id),
      'proposals',(SELECT COUNT(*) FROM pf_proposals WHERE project_id=j.project_id AND job_id=j.id))
      FROM pf_jobs j WHERE project_id=${literal(projectId)} AND id=${literal(cancelledId)} AND kind='preview'`);
    if (cancellation.state !== 'cancelled' || !cancellation.cancelRequested || cancellation.results !== 0 || cancellation.items !== 0 || cancellation.proposals !== 0)
      fail('PF_PREVIEW_CRASH_QUEUED_CANCEL_PUBLISHED');
    queuedCancellation = { ...queuedCancellation, status: 'PASS', readback: cancellation };
  }
  const after = await query(pg.id, workflowSql(projectId)); assertPreviewNoWorkflowWrites(before, after);
  return { status: crash.status === 'PASS' && queuedCancellation.status === 'PASS' ? 'PASS' : 'PARTIAL',
    scope: 'Actual extra-target standalone preview interruption, natural recovery and queued cancellation; no SQL delay/lease manipulation.',
    targetProject: target.project, targetApiId: api.id, submittedPreviewCount: ids.length,
    knownFixture: { from: [0, 0, 0.5], to: [10, 0, 0.5], settings: fixtureSettings, geometricLengthMeters: 10,
      lengthBeforePercentageMeters: '16', unroundedLengthMeters: '17.6', designLengthMeters: '18', formula: 'Ceiling((10 + 6) * 1.10) = 18; zero approaches, no SECONDARY replacement.' },
    crash, queuedCancellation,
    workflowBefore: before, workflowAfter: after, noWorkflowWrites: true,
    cleanup: 'Only these new transient preview jobs were cancelled. Extra-target retirement removes their rows.',
    limits: ['Fast unobserved races are NOT_RUN, never synthetic recovery/cancellation PASS.', 'No cable, registry, proposal, review or Apply writes are allowed by this drill.',
      'Same-host/container-PID proof only; no native engineering parity or cross-computer restore claim.'] };
}
