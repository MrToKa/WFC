/** Root-invoked local PG lock evidence. Importing this module never runs a probe. */
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { pool } from '../db.js';
import type { PoolClient } from 'pg';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import type { JobPrincipal } from './jobContracts.js';
import { preparationTransaction } from './preparationSessions.js';
import { readPreparationContext } from './preparationPlans.js';

type ProbeKind = 'current-admin' | 'model-selection' | 'location-registry';
const mutations: Record<ProbeKind, string> = {
  'current-admin': "UPDATE users SET is_admin=false,role='engineer' WHERE id=$1 RETURNING id",
  'model-selection':
    'UPDATE project_model_selections SET selection_revision=selection_revision+1 WHERE project_id=$1 RETURNING project_id',
  'location-registry':
    'UPDATE pf_project_state SET registry_revision=registry_revision+1 WHERE project_id=$1 RETURNING project_id',
};
/** SQL comparisons contain no password, bearer token, source names or geometry. */
async function invariant(projectId: string, actorId: string) {
  return (
    await pool.query(
      `SELECT (SELECT jsonb_build_object('isAdmin',is_admin,'role',role) FROM users WHERE id=$2) AS actor,
 (SELECT to_jsonb(s) FROM project_model_selections s WHERE project_id=$1) AS selection,
 (SELECT to_jsonb(s) FROM pf_project_state s WHERE project_id=$1) AS registry,
 (SELECT to_jsonb(s) FROM pf_project_preparations s WHERE project_id=$1) AS preparation`,
      [projectId, actorId],
    )
  ).rows[0];
}

export async function runPreparationFencingIntegration({
  projectId,
  principal,
  expectedOwner,
}: {
  projectId: string;
  principal: JobPrincipal;
  expectedOwner?: string;
}) {
  assert.equal(process.env.PF_LOCAL_DEMO, 'true', 'Explicit isolated local demo required');
  assert.equal(process.env.PF_TEST_API_ORIGIN ?? 'http://127.0.0.1:4000', 'http://127.0.0.1:4000');
  policyUuidSchema.parse(projectId);
  policyUuidSchema.parse(principal.userId);
  policyUuidSchema.parse(principal.loginId);
  assert.ok(
    Number.isSafeInteger(principal.loginExpiresAt) && principal.loginExpiresAt > Date.now() + 30000,
    'Use a current login with the complete probe budget remaining.',
  );
  const identity = (await pool.query('SELECT current_database() AS name,current_user AS owner'))
    .rows[0];
  assert.equal(identity.name, 'wfc_pathfinder_local');
  if (expectedOwner !== undefined) assert.equal(identity.owner, expectedOwner);
  const owned = (
    await pool.query(
      `SELECT p.project_number,u.email,u.is_admin,v.imported_by,b.expires_at,b.revoked_at FROM projects p
 JOIN project_model_selections s ON s.project_id=p.id JOIN model_versions v ON v.project_id=p.id AND v.id=s.active_model_version_id
 JOIN users u ON u.id=$2 JOIN viewer_login_bindings b ON b.user_id=u.id AND b.login_id=$3
 WHERE p.id=$1`,
      [projectId, principal.userId, principal.loginId],
    )
  ).rows[0];
  assert.ok(owned, 'The exact generated fixture and existing current login are required.');
  assert.equal(owned.project_number, `PF-R3-${projectId}`);
  assert.equal(owned.email, `${principal.userId}@pf-r3-integration.invalid`);
  assert.equal(owned.imported_by, principal.userId);
  assert.equal(owned.is_admin, true);
  assert.equal(owned.revoked_at, null);
  assert.equal(new Date(owned.expires_at).getTime(), principal.loginExpiresAt);
  const before = await invariant(projectId, principal.userId);
  assert.ok(
    before.registry && before.preparation,
    'Use the already initialized engine-control fixture.',
  );
  const checks: {
    name: ProbeKind;
    status: 'PASS' | 'FAIL';
    ownerPid?: number;
    probePid?: number;
    blockingPids?: number[];
    rolledBack?: boolean;
    message?: string;
  }[] = [];
  const deadline = Date.now() + 30000,
    controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 30000);
  const current = () => {
    controller.signal.throwIfAborted();
    assert.ok(Date.now() < deadline, 'Preparation lock probe deadline exceeded.');
  };
  let secondary: PoolClient | undefined;
  try {
    // The production transaction obtains a different real connection while this
    // exact secondary connection owns the temporary, always-rolled-back edit.
    let expired = false,
      acquisitionTimer: ReturnType<typeof setTimeout> | undefined;
    const acquisition = pool.connect().then((client) => {
      if (expired) {
        client.release();
        throw Error('Secondary connection acquisition deadline exceeded.');
      }
      return client;
    });
    try {
      secondary = await Promise.race([
        acquisition,
        new Promise<never>((_resolve, reject) => {
          acquisitionTimer = setTimeout(() => {
            expired = true;
            reject(Error('Secondary connection acquisition deadline exceeded.'));
          }, 5000);
        }),
      ]);
    } finally {
      if (acquisitionTimer) clearTimeout(acquisitionTimer);
    }
    for (const name of Object.keys(mutations) as ProbeKind[]) {
      current();
      const probe: {
        name: ProbeKind;
        status: 'PASS' | 'FAIL';
        ownerPid: number;
        probePid: number;
        blockingPids: number[];
        rolledBack: boolean;
        message?: string;
      } = {
        name,
        status: 'FAIL' as 'PASS' | 'FAIL',
        ownerPid: 0,
        probePid: 0,
        blockingPids: [] as number[],
        rolledBack: false,
      };
      checks.push(probe);
      let edit: Promise<{ rowCount: number | null }> | undefined,
        settled = false;
      try {
        await secondary.query('BEGIN');
        const remaining = Math.max(1, Math.min(5000, deadline - Date.now()));
        await secondary.query(
          "SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('idle_in_transaction_session_timeout','10000ms',true)",
          [`${remaining}ms`, `${remaining + 1000}ms`],
        );
        probe.probePid = Number(
          (await secondary.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );
        await preparationTransaction(
          pool,
          projectId,
          principal,
          async (primary) => {
            current();
            await readPreparationContext(primary, projectId);
            current();
            probe.ownerPid = Number(
              (await primary.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
            );
            assert.notEqual(probe.ownerPid, probe.probePid);
            edit = secondary!
              .query(mutations[name], [name === 'current-admin' ? principal.userId : projectId])
              .then(
                (value) => {
                  settled = true;
                  return { rowCount: value.rowCount };
                },
                (error) => {
                  settled = true;
                  throw error;
                },
              );
            // Attach immediately: a lock timeout must never become an unhandled promise.
            void edit.catch(() => undefined);
            const until = Math.min(deadline, Date.now() + 2000);
            while (Date.now() < until) {
              current();
              probe.blockingPids = (
                await primary.query('SELECT pg_blocking_pids($1) AS pids', [probe.probePid])
              ).rows[0].pids.map(Number);
              if (probe.blockingPids.includes(probe.ownerPid)) break;
              assert.equal(
                settled,
                false,
                'The temporary edit escaped the production authority/dependency locks.',
              );
              await delay(25);
            }
            assert.ok(
              probe.blockingPids.includes(probe.ownerPid),
              'The production connection did not block the exact temporary edit.',
            );
            assert.equal(settled, false);
            // Returning releases the gate through production final-expiry checks and
            // COMMIT. No production business mutation was submitted by this callback.
          },
          controller.signal,
        );
        current();
        assert.ok(edit);
        assert.equal(
          (await edit).rowCount,
          1,
          'The edit did not acquire its lock after the primary COMMIT.',
        );
        await secondary.query('ROLLBACK');
        probe.rolledBack = true;
        assert.deepEqual(
          await invariant(projectId, principal.userId),
          before,
          'A probe edit escaped rollback.',
        );
        probe.status = 'PASS';
      } catch (error) {
        if (edit) await edit.catch(() => undefined);
        await secondary
          .query('ROLLBACK')
          .then(() => {
            probe.rolledBack = true;
          })
          .catch(() => undefined);
        probe.message = error instanceof Error ? error.message : 'Preparation lock probe failed.';
        throw error;
      }
    }
  } catch (error) {
    if (!checks.length)
      checks.push({
        name: 'current-admin',
        status: 'FAIL',
        message:
          error instanceof Error ? error.message : 'Preparation lock probe admission failed.',
      });
  } finally {
    clearTimeout(timer);
    secondary?.release();
  }
  const unchanged =
    JSON.stringify(await invariant(projectId, principal.userId)) === JSON.stringify(before);
  return {
    schemaVersion: 'wfc.pf.preparation-fencing.integration.v1',
    recordedAtUtc: new Date().toISOString(),
    projectId,
    status:
      checks.length === 3 &&
      checks.every((check) => check.status === 'PASS' && check.rolledBack) &&
      unchanged
        ? 'PASS'
        : 'FAIL',
    checks,
    unchanged,
    deadlineMilliseconds: 30000,
    scope:
      'Production current-admin/selection/registry SQL fencing only; no engine, HTTP, Apply, model conversion or global test hook.',
  };
}
