import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { command } from '../operations/docker.mjs';
import { ownership, ROOT, contained } from '../pathfinder-local/runtime-lib.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REAL = '105913f0-7ee4-45f2-bfd8-2c01f9be9f2a';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) =>
  value === null || typeof value !== 'object'
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? '[' + value.map(canonical).join(',') + ']'
      : '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
          .join(',') +
        '}';
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const assert = (value, code) => {
  if (!value) fail(code);
};
const id = (value) => {
  assert(UUID.test(value ?? ''), 'SESSION_JOB_UUID_REQUIRED');
  return "'" + value + "'";
};
const text = (value) => "'" + String(value).replaceAll("'", "''") + "'";

/** Guard before any fixture mutation. The caller exclusively owns target lifecycle. */
export function validateJobControlTarget(target) {
  assert(
    target?.port === 5191 &&
      /^wfc-pathfinder-local-[a-f0-9]{12}$/.test(target.project ?? '') &&
      UUID.test(target.owner ?? '') &&
      target.restore?.inventoriesEqual === true &&
      target.status === 'running' &&
      UUID.test(target.syntheticDemo?.projectId ?? '') &&
      UUID.test(target.syntheticDemo?.actorId ?? ''),
    'SESSION_JOB_EXTRA_RESTORED_5191_REQUIRED',
  );
  assert(target.syntheticDemo.projectId !== REAL, 'SESSION_JOB_SYNTHETIC_PROJECT_REQUIRED');
}

/** Actual synthetic durable controls; no Docker lifecycle, Apply, Review or source-runtime access. */
export async function runJobControls({ target, loginToken, docker, request, receiptRoot }) {
  validateJobControlTarget(target);
  assert(
    typeof request === 'function' && typeof loginToken === 'string' && loginToken.length < 16384,
    'SESSION_JOB_CALLER_REQUIRED',
  );
  const root = path.resolve(receiptRoot);
  assert(
    contained(path.join(ROOT, 'pathfinder-engine/.scratch'), root),
    'SESSION_JOB_OWN_RECEIPT_ROOT_REQUIRED',
  );
  const parent = await fs.realpath(path.dirname(root));
  assert(
    parent.toLowerCase() === path.dirname(root).toLowerCase(),
    'SESSION_JOB_RECEIPT_LINK_REFUSED',
  );
  await fs.mkdir(root, { recursive: false, mode: 0o700 });
  const runId = randomUUID(),
    projectId = target.syntheticDemo.projectId,
    adminId = target.syntheticDemo.actorId,
    base = `/api/projects/${projectId}/pathfinder`;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(loginToken.split('.')[1], 'base64url').toString());
  } catch {
    fail('SESSION_JOB_PRINCIPAL_INVALID');
  }
  assert(
    claims.sub === adminId &&
      UUID.test(claims.jti ?? '') &&
      Number.isSafeInteger(claims.exp) &&
      claims.exp * 1000 > Date.now(),
    'SESSION_JOB_FRESH_TARGET_LOGIN_REQUIRED',
  );
  const resources = await ownership(target),
    api = resources.containers.find((v) => v.role === 'api'),
    pg = resources.containers.find((v) => v.role === 'postgres');
  assert(api?.running && pg?.running, 'SESSION_JOB_TARGET_RUNNING_REQUIRED');
  const actual = await docker.inspect(api.id);
  assert(actual.Config.Env.includes('PF_ENGINE_MODE=session'), 'SESSION_JOB_SESSION_MODE_REQUIRED');
  const until = Date.now() + 300000,
    checks = [],
    createdJobs = [],
    cableIds = Array.from({ length: 256 }, () => randomUUID());
  const sourceFile = fileURLToPath(import.meta.url),
    sourceHash = hash(await fs.readFile(sourceFile));
  const receipt = {
    schemaVersion: 'pathfinder.session.job-controls.v1',
    runId,
    startedAtUtc: new Date().toISOString(),
    status: 'FAIL',
    source: { path: sourceFile, sha256: sourceHash },
    target: {
      project: target.project,
      owner: target.owner,
      port: target.port,
      projectId,
      adminId,
      apiId: api.id,
      apiImage: api.image,
      postgresId: pg.id,
      modelId: target.syntheticDemo.modelVersionId ?? null,
    },
    checks,
    createdJobs,
    ownedCableIds: cableIds,
    cleanup: [],
    scope: {
      authority:
        'Actual HTTP/current-role/login SQL and durable job observations in a restored synthetic project.',
      busyBoundary:
        'Running durable batch with a previously completed engine item and a currently running item. Exact private frame/deep-Core instant is not observable here.',
      crashRecovery:
        'Owned by the runtime orchestrator separately; lease control here is deliberate SQL fault injection.',
      noApply: true,
      noReview: true,
      engineeringAcceptance: false,
    },
  };
  async function query(sql) {
    assert(Date.now() < until, 'SESSION_JOB_TOTAL_DEADLINE');
    const bytes = await command(
      [
        'exec',
        pg.id,
        'psql',
        '--no-password',
        '--no-psqlrc',
        '--quiet',
        '--tuples-only',
        '--no-align',
        '--set=ON_ERROR_STOP=1',
        '-U',
        'pf_local',
        '-d',
        'wfc_pathfinder_local',
        '-c',
        "SET statement_timeout='30s'; " + sql,
      ],
      { maxBytes: 4 * 1024 ** 2 },
    );
    try {
      return JSON.parse(bytes.toString().trim());
    } catch {
      fail('SESSION_JOB_SQL_RESULT_INVALID');
    }
  }
  async function call(method, url, body) {
    const result = await request(target, url, {
      token: loginToken,
      method,
      ...(body === undefined ? {} : { body }),
    });
    return result;
  }
  async function ok(method, url, body) {
    const result = await call(method, url, body);
    assert(
      result.status >= 200 && result.status < 300,
      'SESSION_JOB_HTTP_' + result.status + '_' + (result.value?.code ?? 'FAILED'),
    );
    return result.value;
  }
  async function state() {
    return ok('GET', base + '/state');
  }
  async function poll(operation, ms = 60000) {
    const end = Math.min(until, Date.now() + ms);
    while (Date.now() < end) {
      const value = await operation();
      if (value !== undefined) return value;
      await pause(20);
    }
    return undefined;
  }
  async function run(name, action) {
    const start = Date.now();
    try {
      const details = await action();
      checks.push({
        name,
        status: details?.status ?? 'PASS',
        milliseconds: Date.now() - start,
        details,
      });
    } catch (error) {
      checks.push({
        name,
        status: 'FAIL',
        milliseconds: Date.now() - start,
        code: error.code ?? 'SESSION_JOB_CONTROL_FAILED',
      });
    }
  }
  async function jobInfo(jobId) {
    return query(`SELECT json_build_object('id',j.id,'state',j.state,'owner',j.owner_token,'attempts',j.attempts,'completed',j.completed,'total',j.total,'cancelRequested',j.cancel_requested,'failure',j.failure,
    'running',(SELECT COALESCE(json_agg(cable_id ORDER BY cable_id),'[]') FROM pf_job_items WHERE project_id=j.project_id AND job_id=j.id AND state='running'),
    'waiting',(SELECT COUNT(*) FROM pf_job_items WHERE project_id=j.project_id AND job_id=j.id AND state='waiting'),
    'proposalCount',(SELECT COUNT(*) FROM pf_proposals WHERE project_id=j.project_id AND job_id=j.id),
    'staleCount',(SELECT COUNT(*) FROM pf_proposals WHERE project_id=j.project_id AND job_id=j.id AND status='stale')) FROM pf_jobs j WHERE j.project_id=${id(projectId)} AND j.id=${id(jobId)}`);
  }
  async function busy(jobId) {
    return poll(async () => {
      const value = await jobInfo(jobId);
      return value.state === 'running' &&
        value.completed > 0 &&
        value.completed < value.total &&
        value.running.length
        ? value
        : ['complete', 'failed', 'cancelled'].includes(value.state)
          ? null
          : undefined;
    }, 15000);
  }
  async function terminal(jobId) {
    const value = await poll(async () => {
      const x = await jobInfo(jobId);
      return ['complete', 'failed', 'cancelled'].includes(x.state) ? x : undefined;
    });
    assert(value, 'SESSION_JOB_TERMINAL_TIMEOUT');
    return value;
  }
  async function enqueue(ids = cableIds) {
    const current = await state(),
      accepted = await ok('POST', base + '/jobs', {
        cableIds: ids,
        expectedRegistryRevision: current.registryRevision,
        force: true,
        timeoutMilliseconds: 30000,
      });
    assert(UUID.test(accepted.jobId), 'SESSION_JOB_ACCEPTED_ID');
    createdJobs.push(accepted.jobId);
    return accepted.jobId;
  }
  async function stopAutomatic(jobId) {
    await ok('DELETE', base + '/jobs/' + jobId);
  }
  async function realAudit() {
    return JSON.parse(
      (
        await command(
          ['exec', api.id, 'node', 'server/dist/server/pathfinder/lookupAudit.js', REAL],
          { maxBytes: 1024 ** 2 },
        )
      ).toString(),
    );
  }
  async function protectedCounts() {
    return query(`SELECT json_build_object('applies',(SELECT COUNT(*) FROM pf_apply_receipts WHERE project_id=${id(projectId)}),'reviews',(SELECT COUNT(*) FROM pf_reviews WHERE project_id=${id(projectId)}),
    'seedCableHash',(SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_object('id',id,'routing',routing,'designLength',design_length,'installLength',install_length,'revision',cable_write_revision) ORDER BY id)::text,'[]'),'UTF8')),'hex') FROM cables WHERE project_id=${id(projectId)} AND id<>ALL(ARRAY[${cableIds.map(id).join(',')}]::uuid[])))`);
  }
  let before,
    realBefore,
    initial,
    fixtureValidated = false;
  try {
    // Bind only this fresh restored-target login through the real protected API.
    await state();
    initial =
      await query(`SELECT json_build_object('database',current_database(),'marked',EXISTS(SELECT 1 FROM pf_synthetic_projects s JOIN projects p ON p.id=s.project_id WHERE s.project_id=${id(projectId)} AND s.fixture_id='pf-local-straight-v1' AND p.project_number LIKE 'PF-SYNTHETIC-%' AND p.name LIKE 'Synthetic PathFinder%'),
      'model',(SELECT active_model_version_id FROM project_model_selections WHERE project_id=${id(projectId)}),
      'admin',(SELECT json_build_object('isAdmin',is_admin,'role',role) FROM users WHERE id=${id(adminId)}),
      'login',(SELECT json_build_object('revokedAt',revoked_at,'userId',user_id) FROM viewer_login_bindings WHERE login_id=${id(claims.jti)}),
      'settings',(SELECT json_build_object('secondary',secondary_tray_length::text,'end',end_connection_length::text,'percent',additional_bending_percent::text,'gap',connection_gap::text) FROM projects WHERE id=${id(projectId)}),
      'seed',(SELECT json_build_object('typeId',cable_type_id,'from',from_location,'to',to_location) FROM cables WHERE project_id=${id(projectId)} AND from_location IS NOT NULL AND to_location IS NOT NULL ORDER BY cable_id,id LIMIT 1))`);
    assert(
      initial.database === 'wfc_pathfinder_local' &&
        initial.marked &&
        initial.admin?.isAdmin === true,
      'SESSION_JOB_SYNTHETIC_MARKER_OR_ACTOR_INVALID',
    );
    assert(
      initial.login?.userId === adminId &&
        !initial.login.revokedAt &&
        initial.seed?.from &&
        initial.seed?.to,
      'SESSION_JOB_CONFIRMED_LOGIN_AND_SEED_REQUIRED',
    );
    assert(
      Number(initial.settings.secondary) === 5 &&
        Number(initial.settings.end) === 6 &&
        Number(initial.settings.percent) === 10 &&
        Number(initial.settings.gap) === 1,
      'SESSION_JOB_KNOWN_STRAIGHT_SETTINGS_REQUIRED',
    );
    receipt.target.modelId = initial.model;
    realBefore = await realAudit();
    before = await protectedCounts();
    receipt.before = { protected: before, realWorkflow: realBefore.planningArtifactsAndWorkflow };
    fixtureValidated = true;
    await query(`INSERT INTO cables(id,project_id,cable_id,cable_type_id,mto,tag,from_location,to_location,install_length)
      SELECT v.id,${id(projectId)},n.maximum+v.ordinal,${id(initial.seed.typeId)},'Instrumentation',${text('PF-SESSION-CONTROLS-' + runId)},${text(initial.seed.from)},${text(initial.seed.to)},99
      FROM (VALUES ${cableIds.map((value, index) => `(${id(value)}::uuid,${index + 1})`).join(',')}) AS v(id,ordinal) CROSS JOIN (SELECT COALESCE(MAX(cable_id),0) AS maximum FROM cables WHERE project_id=${id(projectId)}) n;
      SELECT json_build_object('inserted',(SELECT COUNT(*) FROM cables WHERE project_id=${id(projectId)} AND id=ANY(ARRAY[${cableIds.map(id).join(',')}]::uuid[])))`);
    await run(
      'actual session durable proposal retains exact known Core/design/category and does not Apply',
      async () => {
        const job = await enqueue([cableIds[0]]),
          end = await terminal(job);
        assert(
          end.state === 'complete' && end.proposalCount === 1,
          'SESSION_JOB_BASELINE_NOT_COMPLETE',
        );
        const result = await query(
          `SELECT json_build_object('status',status,'length',result->'route'->'lengthMeters','design',result->'design'->>'designLengthMeters','category',result->>'effectiveCategory','calculationMode',result->>'calculationMode','engineeringAccepted',result->'engineeringAccepted') FROM pf_proposals WHERE project_id=${id(projectId)} AND job_id=${id(job)}`,
        );
        assert(
          result.status === 'calculated' &&
            result.length === 10 &&
            result.design === '18' &&
            result.category === 'Control' &&
            result.engineeringAccepted === false,
          'SESSION_JOB_EXACT_BASELINE_MISMATCH',
        );
        await stopAutomatic(job);
        return { job, end, result };
      },
    );
    await run('before-dispatch current admin denial creates no fresh job', async () => {
      const current = await state(),
        old = await query(
          `SELECT json_build_object('count',COUNT(*)::int) FROM pf_jobs WHERE project_id=${id(projectId)}`,
        );
      try {
        await query(
          `UPDATE users SET is_admin=false,role='engineer' WHERE id=${id(adminId)};SELECT json_build_object('changed',true)`,
        );
        const denied = await call('POST', base + '/jobs', {
          cableIds: [cableIds[0]],
          expectedRegistryRevision: current.registryRevision,
          force: true,
        });
        assert(denied.status === 403, 'SESSION_JOB_PRE_DISPATCH_ADMIN_NOT_DENIED');
        const after = await query(
          `SELECT json_build_object('count',COUNT(*)::int) FROM pf_jobs WHERE project_id=${id(projectId)}`,
        );
        assert(old.count === after.count, 'SESSION_JOB_UNAUTHORIZED_JOB_CREATED');
        return {
          httpStatus: denied.status,
          jobsBefore: old.count,
          jobsAfter: after.count,
          boundary: 'HTTP rejected before dispatch',
        };
      } finally {
        await query(
          `UPDATE users SET is_admin=true,role=${text(initial.admin.role)} WHERE id=${id(adminId)};SELECT json_build_object('restored',true)`,
        );
      }
    });
    for (const kind of ['admin', 'login'])
      await run('revocation during observed running durable batch: ' + kind, async () => {
        const job = await enqueue(),
          observed = await busy(job);
        if (!observed) {
          await terminal(job);
          await stopAutomatic(job);
          return {
            status: 'NOT_RUN',
            job,
            reason:
              'No running batch with prior complete item and active item was observed; no busy PASS inferred.',
          };
        }
        let committed;
        try {
          const mutation =
            kind === 'admin'
              ? `UPDATE users SET is_admin=false,role='engineer' WHERE id=${id(adminId)}`
              : `UPDATE viewer_login_bindings SET revoked_at=NOW() WHERE login_id=${id(claims.jti)} AND user_id=${id(adminId)}`;
          committed = await query(
            `BEGIN;${mutation};SELECT json_build_object('at',clock_timestamp(),'proposals',(SELECT COUNT(*) FROM pf_proposals WHERE project_id=${id(projectId)} AND job_id=${id(job)}));COMMIT;`,
          );
          const end = await terminal(job);
          assert(
            end.state === 'failed' && end.proposalCount === committed.proposals,
            'SESSION_JOB_PUBLICATION_AFTER_REVOCATION',
          );
          const denied = await call('GET', base + '/state');
          assert(
            denied.status === (kind === 'admin' ? 403 : 401),
            'SESSION_JOB_REVOKED_HTTP_NOT_DENIED',
          );
          return {
            job,
            observed,
            committed,
            end,
            httpStatus: denied.status,
            boundary: receipt.scope.busyBoundary,
          };
        } finally {
          await query(
            `UPDATE users SET is_admin=true,role=${text(initial.admin.role)} WHERE id=${id(adminId)};UPDATE viewer_login_bindings SET revoked_at=NULL WHERE login_id=${id(claims.jti)} AND user_id=${id(adminId)};SELECT json_build_object('restored',true)`,
          );
          await stopAutomatic(job);
        }
      });
    await run(
      'Project Details mutation during running batch marks later frozen proposals stale',
      async () => {
        const job = await enqueue(),
          observed = await busy(job);
        if (!observed) {
          await terminal(job);
          await stopAutomatic(job);
          return { status: 'NOT_RUN', job, reason: 'Busy window not observed.' };
        }
        try {
          const committed = await query(
            `BEGIN;UPDATE projects SET end_connection_length=7 WHERE id=${id(projectId)};SELECT json_build_object('at',clock_timestamp(),'proposalIds',(SELECT COALESCE(json_agg(id ORDER BY id),'[]') FROM pf_proposals WHERE project_id=${id(projectId)} AND job_id=${id(job)}));COMMIT;`,
          );
          const end = await terminal(job);
          assert(end.state === 'complete', 'SESSION_JOB_SETTINGS_BATCH_STOPPED');
          const rows = await query(
              `SELECT COALESCE(json_agg(json_build_object('id',id,'status',status) ORDER BY id),'[]') FROM pf_proposals WHERE project_id=${id(projectId)} AND job_id=${id(job)}`,
            ),
            beforeIds = new Set(committed.proposalIds),
            later = rows.filter((row) => !beforeIds.has(row.id)),
            details = {
              beforeProposalIds: committed.proposalIds,
              laterProposalIds: later.map((row) => row.id),
              later: later.length,
              laterNonStale: later.filter((row) => row.status !== 'stale').length,
              stale: rows.filter((row) => row.status === 'stale').length,
            };
          assert(
            details.later > 0 && details.laterNonStale === 0 && details.stale > 0,
            'SESSION_JOB_SETTINGS_FENCE_NOT_OBSERVED',
          );
          return {
            job,
            observed,
            committed,
            end,
            details,
            boundary: receipt.scope.busyBoundary,
            publicationBoundary:
              'Existing proposal IDs were captured while the project mutation held its row lock; subsequent IDs are checked regardless of transaction start timestamps.',
          };
        } finally {
          await query(
            `UPDATE projects SET end_connection_length=${text(initial.settings.end)}::numeric WHERE id=${id(projectId)};SELECT json_build_object('restored',true)`,
          );
          await stopAutomatic(job);
        }
      },
    );
    await run(
      'intervening cable input edit in a running batch preserves manual values and invalidates frozen result',
      async () => {
        const job = await enqueue(),
          observed = await busy(job);
        if (!observed) {
          await terminal(job);
          await stopAutomatic(job);
          return { status: 'NOT_RUN', job, reason: 'Busy window not observed.' };
        }
        const waiting = await query(
          `SELECT json_build_object('cableId',cable_id) FROM pf_job_items WHERE project_id=${id(projectId)} AND job_id=${id(job)} AND state='waiting' ORDER BY cable_id DESC LIMIT 1`,
        );
        if (!waiting) {
          await terminal(job);
          await stopAutomatic(job);
          return {
            status: 'NOT_RUN',
            job,
            observed,
            reason:
              'No pending item left for a precisely classified pre-dispatch dependency mutation.',
          };
        }
        await query(
          `UPDATE cables SET mto='MV' WHERE project_id=${id(projectId)} AND id=${id(waiting.cableId)};SELECT json_build_object('changed',true)`,
        );
        const end = await terminal(job),
          result = await query(
            `SELECT json_build_object('proposalId',p.id,'status',p.status,'mto',c.mto,'routing',c.routing,'designLength',c.design_length,'installLength',c.install_length) FROM pf_proposals p JOIN cables c ON c.id=p.cable_id AND c.project_id=p.project_id WHERE p.project_id=${id(projectId)} AND p.job_id=${id(job)} AND p.cable_id=${id(waiting.cableId)}`,
          );
        assert(
          end.state === 'complete' &&
            result.status === 'stale' &&
            result.mto === 'MV' &&
            result.installLength === 99 &&
            result.routing === null &&
            result.designLength === null,
          'SESSION_JOB_MANUAL_EDIT_FENCE_FAILED',
        );
        await stopAutomatic(job);
        return {
          job,
          observed,
          end,
          result,
          boundary:
            'The batch was active, but this selected waiting item was edited before its own dispatch; not an exact active-frame mutation claim.',
        };
      },
    );
    await run(
      'seeded queued expired lease is recovered with owner change and unique item publication',
      async () => {
        const predecessor = await enqueue(),
          observed = await busy(predecessor);
        if (!observed) {
          await terminal(predecessor);
          await stopAutomatic(predecessor);
          return {
            status: 'NOT_RUN',
            predecessor,
            reason: 'Could not establish busy predecessor for deterministic queued lease seeding.',
          };
        }
        const job = await enqueue(cableIds.slice(0, 128)),
          oldOwner = randomUUID();
        const seeded = await query(
          `WITH changed AS (UPDATE pf_jobs SET state='running',owner_token=${id(oldOwner)},lease_until=NOW()-INTERVAL '1 second',attempts=1 WHERE project_id=${id(projectId)} AND id=${id(job)} AND state='queued' RETURNING id) SELECT json_build_object('seeded',EXISTS(SELECT 1 FROM changed))`,
        );
        if (!seeded.seeded) {
          await terminal(predecessor);
          await terminal(job);
          await stopAutomatic(job);
          return {
            status: 'NOT_RUN',
            job,
            predecessor,
            reason: 'The new job was already claimed; an active owner was not overwritten.',
          };
        }
        await terminal(predecessor);
        await stopAutomatic(predecessor);
        const recovered = await poll(async () => {
            const x = await jobInfo(job);
            return x.state === 'running' && x.attempts >= 2 && x.owner && x.owner !== oldOwner
              ? x
              : ['complete', 'failed', 'cancelled'].includes(x.state)
                ? null
                : undefined;
          }, 15000),
          end = await terminal(job);
        const fence = await query(
          `WITH changed AS (UPDATE pf_jobs SET completed=999 WHERE project_id=${id(projectId)} AND id=${id(job)} AND owner_token=${id(oldOwner)} RETURNING id) SELECT json_build_object('obsoleteOwnerWrites',(SELECT COUNT(*) FROM changed),'distinctCables',(SELECT COUNT(DISTINCT cable_id) FROM pf_proposals WHERE project_id=${id(projectId)} AND job_id=${id(job)}),'proposals',(SELECT COUNT(*) FROM pf_proposals WHERE project_id=${id(projectId)} AND job_id=${id(job)}))`,
        );
        assert(
          end.state === 'complete' &&
            end.attempts === 2 &&
            fence.obsoleteOwnerWrites === 0 &&
            fence.proposals === 128 &&
            fence.distinctCables === 128,
          'SESSION_JOB_LEASE_OR_UNIQUE_PUBLICATION_FAILED',
        );
        await stopAutomatic(job);
        return {
          status: recovered ? 'PASS' : 'NOT_RUN',
          job,
          predecessor,
          seededOldOwner: oldOwner,
          recovered,
          end,
          fence,
          reason: recovered
            ? undefined
            : 'Recovery/unique publication passed, but exact new owner token was not observed while running; full owner-transition gate remains NOT_RUN.',
          faultInjection:
            'Deliberate expired SQL lease on a still-queued synthetic job; not a natural process crash.',
          attributionLimit:
            'The old token was seeded without a live prior executor. The conditional SQL probe is not evidence of an actual obsolete worker attempting publication.',
        };
      },
    );
    await run(
      'observed active lease owner rollover recovers one job without duplicate item publication',
      async () => {
        const job = await enqueue(),
          observed = await busy(job);
        if (!observed || !UUID.test(observed.owner ?? '')) {
          await terminal(job);
          await stopAutomatic(job);
          return {
            status: 'NOT_RUN',
            job,
            reason: 'No actual active owner was observed for a guarded lease rollover.',
          };
        }
        const intermediateOwner = randomUUID(),
          changed = await query(
            `BEGIN;WITH changed AS (UPDATE pf_jobs SET owner_token=${id(intermediateOwner)},lease_until=NOW()-INTERVAL '1 second' WHERE project_id=${id(projectId)} AND id=${id(job)} AND state='running' AND owner_token=${id(observed.owner)} AND cancel_requested=false RETURNING id) SELECT json_build_object('changed',EXISTS(SELECT 1 FROM changed),'proposalIds',(SELECT COALESCE(json_agg(id ORDER BY id),'[]') FROM pf_proposals WHERE project_id=${id(projectId)} AND job_id=${id(job)}));COMMIT;`,
          );
        if (!changed.changed) {
          await terminal(job);
          await stopAutomatic(job);
          return {
            status: 'NOT_RUN',
            job,
            observed,
            reason:
              'The observed live owner no longer owned a running job when the guarded mutation executed; no other owner was overwritten.',
          };
        }
        const recovered = await poll(async () => {
            const x = await jobInfo(job);
            return x.state === 'running' &&
              x.attempts === observed.attempts + 1 &&
              x.owner &&
              x.owner !== observed.owner &&
              x.owner !== intermediateOwner
              ? x
              : ['complete', 'failed', 'cancelled'].includes(x.state)
                ? null
                : undefined;
          }, 15000),
          end = await terminal(job),
          published = await query(
            `SELECT json_build_object('ids',COALESCE(json_agg(id ORDER BY id),'[]'),'proposals',COUNT(*),'distinctCables',COUNT(DISTINCT cable_id)) FROM pf_proposals WHERE project_id=${id(projectId)} AND job_id=${id(job)}`,
          );
        const publishedIds = new Set(published.ids);
        assert(
          end.state === 'complete' &&
            end.attempts === observed.attempts + 1 &&
            end.completed === cableIds.length &&
            end.total === cableIds.length &&
            published.proposals === cableIds.length &&
            published.distinctCables === cableIds.length &&
            changed.proposalIds.every((value) => publishedIds.has(value)),
          'SESSION_JOB_ACTIVE_LEASE_RECOVERY_OR_UNIQUENESS_FAILED',
        );
        await stopAutomatic(job);
        return {
          status: recovered ? 'PASS' : 'NOT_RUN',
          job,
          observed,
          intermediateOwner,
          changed,
          recovered,
          end,
          published,
          reason: recovered
            ? undefined
            : 'Recovery and exact unique publication passed, but the replacement owner was not sampled while running.',
          faultInjection:
            'The actual running owner token was replaced conditionally and its lease expired in one transaction. The normal durable worker reclaimed the job; this is not a natural process crash.',
          attributionLimit:
            'Proposal rows do not record owner/attempt. This proves active owner rollover, recovery and final uniqueness, not an observed obsolete executor publication attempt.',
        };
      },
    );
    await run(
      'running durable cancellation is terminal and prevents further publication',
      async () => {
        const job = await enqueue(),
          observed = await busy(job);
        if (!observed) {
          await terminal(job);
          await stopAutomatic(job);
          return { status: 'NOT_RUN', job, reason: 'Running window not observed.' };
        }
        await ok('DELETE', base + '/jobs/' + job);
        const end = await terminal(job);
        assert(
          end.state === 'cancelled' && end.owner === null,
          'SESSION_JOB_CANCEL_TERMINAL_FAILED',
        );
        const after = await jobInfo(job);
        assert(after.proposalCount === end.proposalCount, 'SESSION_JOB_PUBLICATION_AFTER_CANCEL');
        return { job, observed, end, after, boundary: receipt.scope.busyBoundary };
      },
    );
  } catch (error) {
    receipt.error = error.code ?? 'SESSION_JOB_SETUP_FAILED';
  } finally {
    if (fixtureValidated) {
      try {
        await query(
          `UPDATE users SET is_admin=true,role=${text(initial.admin.role)} WHERE id=${id(adminId)};UPDATE viewer_login_bindings SET revoked_at=NULL WHERE login_id=${id(claims.jti)} AND user_id=${id(adminId)};UPDATE projects SET secondary_tray_length=${text(initial.settings.secondary)}::numeric,end_connection_length=${text(initial.settings.end)}::numeric,additional_bending_percent=${text(initial.settings.percent)}::numeric,connection_gap=${text(initial.settings.gap)}::numeric WHERE id=${id(projectId)};SELECT json_build_object('restored',true)`,
        );
        receipt.cleanup.push({
          name: 'restore only cloned actor/login and synthetic project allowance values',
          status: 'PASS',
          revisionRestored: false,
        });
      } catch (error) {
        receipt.cleanup.push({
          name: 'restore fixture values',
          status: 'FAIL',
          code: error.code ?? 'FAILED',
        });
      }
      for (const job of createdJobs)
        try {
          await ok('DELETE', base + '/jobs/' + job);
        } catch (error) {
          receipt.cleanup.push({
            name: 'cancel owned retained job ' + job,
            status: 'FAIL',
            code: error.code ?? 'FAILED',
          });
        }
      try {
        const after = await protectedCounts(),
          realAfter = await realAudit();
        receipt.after = { protected: after, realWorkflow: realAfter.planningArtifactsAndWorkflow };
        assert(canonical(before) === canonical(after), 'SESSION_JOB_IMPLICIT_APPLY_OR_SEED_WRITE');
        assert(
          canonical(realBefore.planningArtifactsAndWorkflow) ===
            canonical(realAfter.planningArtifactsAndWorkflow),
          'SESSION_JOB_COPIED_REAL_WORKFLOW_CHANGED',
        );
        checks.push({
          name: 'no Review/Apply/seed cable mutation and copied real workflow preserved',
          status: 'PASS',
        });
      } catch (error) {
        checks.push({ name: 'final preservation', status: 'FAIL', code: error.code ?? 'FAILED' });
      }
    }
    receipt.sourceUnchanged = hash(await fs.readFile(sourceFile)) === sourceHash;
    receipt.finishedAtUtc = new Date().toISOString();
    receipt.status =
      receipt.error ||
      !receipt.sourceUnchanged ||
      checks.some((x) => x.status === 'FAIL') ||
      receipt.cleanup.some((x) => x.status === 'FAIL')
        ? 'FAIL'
        : checks.some((x) => x.status === 'NOT_RUN')
          ? 'PARTIAL'
          : 'PASS';
    const filename = path.join(root, 'job-controls.json');
    await fs.writeFile(filename, JSON.stringify(receipt, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  }
  return {
    status: receipt.status,
    receipt: path.join(root, 'job-controls.json'),
    checks: checks.map(({ name, status }) => ({ name, status })),
    createdJobs,
    ownedCableCount: cableIds.length,
  };
}
