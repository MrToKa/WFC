import { randomUUID } from 'node:crypto';
import { createDocker, command } from '../operations/docker.mjs';
import { ownership, request, fail } from './runtime-lib.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const literal = value => { if (!UUID.test(value ?? '')) fail('PF_CRASH_UUID_INVALID'); return `'${value}'`; };
async function query(pgId, sql) {
  const raw = await command(['exec', pgId, 'psql', '--no-password', '--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '-U', 'pf_local', '-d', 'wfc_pathfinder_local', '-c', "SET statement_timeout='30s'; " + sql], { maxBytes: 1024 ** 2 });
  try { return JSON.parse(raw.toString().trim()); } catch { fail('PF_CRASH_DATABASE_RESULT_INVALID'); }
}
async function top(docker, id) {
  const value = await docker.request('GET', '/containers/' + id + '/top?ps_args=' + encodeURIComponent('-eo pid,ppid,comm'));
  if (!Array.isArray(value?.Processes) || value.Processes.length > 256) fail('PF_CRASH_PROCESS_INVENTORY_INVALID');
  return value.Processes.map(row => ({ pid: Number(row[0]), parentPid: Number(row[1]), command: row[2] }));
}
function jobPath(projectId, jobId = '') { return `/api/projects/${projectId}/pathfinder/jobs${jobId ? '/' + jobId : ''}`; }

/** A real process interruption, restricted to a verified EXTRA restore target. */
export async function crashRecovery(target, token, sourceOrigin) {
  if (target.project === 'wfc-pathfinder-local' || !target.restore?.inventoriesEqual || !target.syntheticDemo?.projectId || target.status !== 'running') fail('PF_CRASH_EXTRA_VERIFIED_TARGET_REQUIRED');
  const resources = await ownership(target), docker = await createDocker(), api = resources.containers.find(item => item.role === 'api'), pg = resources.containers.find(item => item.role === 'postgres');
  if (!api?.running || !pg?.running) fail('PF_CRASH_TARGET_NOT_READY');
  const projectId = target.syntheticDemo.projectId, actorId = target.syntheticDemo.actorId;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  literal(projectId); literal(actorId); literal(claims.jti);
  if (claims.sub !== actorId || !Number.isSafeInteger(claims.exp)) fail('PF_CRASH_FRESH_PRINCIPAL_REQUIRED');
  const marked = await query(pg.id, `SELECT json_build_object('marked',EXISTS(SELECT 1 FROM pf_synthetic_projects s JOIN projects p ON p.id=s.project_id WHERE s.project_id=${literal(projectId)} AND p.project_number LIKE 'PF-SYNTHETIC-%' AND p.name LIKE 'Synthetic PathFinder%'))`);
  if (!marked.marked) fail('PF_CRASH_SYNTHETIC_MARKER_REQUIRED');
  const beforeJobs = await query(pg.id, `SELECT COALESCE(json_agg(id::text),'[]'::json) FROM pf_jobs WHERE project_id=${literal(projectId)}`), baseline = new Set(beforeJobs);
  const ids = Array.from({ length: 64 }, () => randomUUID()), marker = randomUUID().slice(0, 8), values = ids.map((id, index) => `(${literal(id)}::uuid,${index})`).join(',');
  const fixture = await query(pg.id, `WITH source_type AS(SELECT cable_type_id FROM cables WHERE project_id=${literal(projectId)} AND cable_type_id IS NOT NULL ORDER BY cable_id LIMIT 1), base AS(SELECT COALESCE(MAX(cable_id),0) AS maximum FROM cables WHERE project_id=${literal(projectId)}), created AS(INSERT INTO cables(id,project_id,cable_id,cable_type_id,mto,tag,from_location,to_location,install_length) SELECT v.id,${literal(projectId)},base.maximum+v.ordinal+1,source_type.cable_type_id,'Control','PF-CRASH-${marker}-'||v.ordinal::text,'=PF-SYNTHETIC-FROM','=PF-SYNTHETIC-TO',77 FROM(VALUES${values})v(id,ordinal) CROSS JOIN base CROSS JOIN source_type RETURNING id) SELECT json_build_object('created',COUNT(*)) FROM created`);
  if (fixture.created !== ids.length) fail('PF_CRASH_FIXTURE_INCOMPLETE');
  const state = await request(target, `/api/projects/${projectId}/pathfinder/state`, { token }); if (state.status !== 200) fail('PF_CRASH_STATE_FAILED');
  const created = await request(target, jobPath(projectId), { token, method: 'POST', body: { cableIds: ids, expectedRegistryRevision: state.value.registryRevision, force: true } });
  if (created.status !== 202 || !UUID.test(created.value.jobId ?? '')) fail('PF_CRASH_JOB_CREATE_FAILED'); const jobId = created.value.jobId;
  let observed, beforeCrash;
  await ownership(target);
  const observeDeadline = Date.now() + 25000;
  while (Date.now() < observeDeadline) {
    const status = await request(target, jobPath(projectId, jobId), { token });
    if (status.status !== 200 || status.value.status !== 'running' || status.value.completed >= 64) { await pause(75); continue; }
    const inspected = await docker.inspect(api.id);
    if (inspected.Id !== api.id || inspected.Config.Labels?.['wfc.pathfinder.owner'] !== target.owner || inspected.Config.Labels?.['wfc.pathfinder.project'] !== target.project) fail('PF_CRASH_TARGET_OWNERSHIP_CHANGED');
    const processes = (await top(docker, api.id)).filter(row => row.command === 'dotnet');
    if (processes.length >= 2 && processes.some(row => processes.some(parent => parent.pid === row.parentPid))) {
      observed = processes; beforeCrash = status.value; break;
    }
    await pause(75);
  }
  if (!observed) {
    await request(target, jobPath(projectId, jobId), { token, method: 'DELETE' });
    return { status: 'NOT_RUN', reason: 'No simultaneous real dotnet supervisor/worker pair was observed within 25 seconds; no crash was performed.', jobId, disposableCableCount: ids.length };
  }
  // The source and every original container are excluded by the verified target
  // identity and by using this exact restored API's full immutable Docker ID.
  // The last observation before KILL is the live process pair itself. The full
  // immutable container ID and its ownership labels were checked immediately
  // before that process inventory, without another intervening fixture query.
  await command(['kill', '--signal=KILL', api.id]);
  const killed = await docker.inspect(api.id); if (killed.State.Running || killed.State.Pid !== 0 || killed.State.ExitCode !== 137 || killed.State.OOMKilled) fail('PF_CRASH_NAMESPACE_NOT_STOPPED');
  let topRefused = false; try { await top(docker, api.id); } catch { topRefused = true; } if (!topRefused) fail('PF_CRASH_STOPPED_PROCESS_LIST_REMAINED');
  const sourceHealth = await fetch(sourceOrigin + '/health', { signal: AbortSignal.timeout(3000) }); if (sourceHealth.status !== 200) fail('PF_CRASH_SOURCE_HEALTH_FAILED');
  const persisted = await query(pg.id, `SELECT json_build_object('state',state,'attempts',attempts,'completed',completed,'total',total,'leaseUntil',lease_until,'runningItems',(SELECT COUNT(*) FROM pf_job_items WHERE job_id=j.id AND state='running')) FROM pf_jobs j WHERE id=${literal(jobId)} AND project_id=${literal(projectId)}`);
  if (persisted.state !== 'running' || persisted.completed >= 64 || persisted.runningItems < 1) fail('PF_CRASH_RUNNING_JOB_NOT_PERSISTED');
  await docker.start(api.id); const restartedAt = Date.now(), deadline = restartedAt + 180000; let finalJob;
  while (Date.now() < deadline) {
    try {
      const response = await request(target, jobPath(projectId, jobId), { token });
      if (response.status === 200) {
        if (response.value.status === 'complete') { finalJob = response.value; break; }
        if (['cancelled', 'failed'].includes(response.value.status)) fail('PF_CRASH_RECOVERY_TERMINAL_FAILURE');
      }
    } catch (error) { if (error.code === 'PF_CRASH_RECOVERY_TERMINAL_FAILURE') throw error; }
    await pause(300);
  }
  if (!finalJob || finalJob.attempts < persisted.attempts + 1 || finalJob.completed !== 64 || finalJob.total !== 64 || finalJob.items.some(item => item.state !== 'complete' || item.status !== 'calculated')) fail('PF_CRASH_RECOVERY_INCOMPLETE');
  const restarted = await top(docker, api.id);
  if (restarted.some(row => observed.some(old => old.pid === row.pid))) fail('PF_CRASH_OLD_PROCESS_PID_REMAINED');
  const closure = await query(pg.id, `SELECT json_build_object('proposalCount',(SELECT COUNT(*) FROM pf_proposals WHERE project_id=${literal(projectId)} AND job_id=${literal(jobId)}),'distinctCableCount',(SELECT COUNT(DISTINCT cable_id) FROM pf_proposals WHERE project_id=${literal(projectId)} AND job_id=${literal(jobId)}),'duplicateGroups',(SELECT COUNT(*) FROM(SELECT cable_id FROM pf_proposals WHERE project_id=${literal(projectId)} AND job_id=${literal(jobId)} GROUP BY cable_id HAVING COUNT(*)<>1)d),'unchangedCables',(SELECT COUNT(*) FROM cables WHERE project_id=${literal(projectId)} AND id=ANY(ARRAY[${ids.map(literal).join(',')}]::uuid[]) AND install_length=77 AND routing IS NULL AND design_length IS NULL AND cable_write_revision=0),'adminCurrent',(SELECT is_admin FROM users WHERE id=${literal(actorId)}),'loginCurrent',EXISTS(SELECT 1 FROM viewer_login_bindings WHERE login_id=${literal(claims.jti)} AND user_id=${literal(actorId)} AND revoked_at IS NULL AND expires_at=to_timestamp(${claims.exp}) AND expires_at>NOW()))`);
  if (closure.proposalCount !== 64 || closure.distinctCableCount !== 64 || closure.duplicateGroups !== 0 || closure.unchangedCables !== 64 || !closure.adminCurrent || !closure.loginCurrent) fail('PF_CRASH_PUBLICATION_OR_AUTHORITY_CLOSURE_FAILED');
  // Prevent the automatic latest-job scan from creating a new all-cables batch.
  const currentJobs = await query(pg.id, `SELECT COALESCE(json_agg(id::text),'[]'::json) FROM pf_jobs WHERE project_id=${literal(projectId)}`);
  for (const id of currentJobs) if (!baseline.has(id)) { const result = await request(target, jobPath(projectId, id), { token, method: 'DELETE' }); if (result.status !== 200) fail('PF_CRASH_TEST_JOB_CANCEL_FAILED'); }
  return { status: 'PASS', scope: 'Actual extra-target API namespace/SIGKILL interruption and natural lease recovery; no SQL lease manipulation.', targetProject: target.project, targetApiId: api.id, jobId, disposableCableCount: 64, observedDotnetProcesses: observed, beforeCrash: { status: beforeCrash.status, completed: beforeCrash.completed, attempts: beforeCrash.attempts }, stopped: { exitCode: killed.State.ExitCode, pid: killed.State.Pid, oomKilled: killed.State.OOMKilled, stoppedTopRefused: topRefused }, persistedAtCrash: persisted, afterRecovery: { status: finalJob.status, completed: finalJob.completed, total: finalJob.total, attempts: finalJob.attempts, elapsedAfterRestartMs: Date.now() - restartedAt }, publication: closure, sourceHealthDuringTargetCrash: sourceHealth.status, cleanup: 'Exact new target jobs received durable cancellation; disposable rows remain only in the extra target, retired by the enclosing successful drill.', limits: ['Container PID namespace stopped and old observed host PIDs absent after restart; no host-wide process inspection.', 'Recovery test performs no cable Apply.', 'Only this restored synthetic fixture was interrupted.'] };
}
