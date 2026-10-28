import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { parseStat, rssBytes, sha256, fail } from './lib.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function processes() {
  const values = [];
  for (const name of await fs.readdir('/proc')) {
    if (!/^[1-9][0-9]*$/.test(name)) continue;
    try {
      const stat = parseStat(await fs.readFile('/proc/' + name + '/stat', 'utf8'));
      values.push({ ...stat, rss: rssBytes(await fs.readFile('/proc/' + name + '/status', 'utf8')) });
    } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error; }
  }
  return values;
}
async function sample(rootPid) {
  const all = await processes(), retained = new Set([rootPid]); let changed;
  do { changed = false; for (const p of all) if (!retained.has(p.pid) && retained.has(p.ppid)) { retained.add(p.pid); changed = true; } } while (changed);
  const live = all.filter(p => retained.has(p.pid));
  return { treeRssBytes: live.reduce((sum, p) => sum + p.rss, 0), supervisorRssBytes: live.find(p => p.pid === rootPid)?.rss ?? 0,
    descendantsRssBytes: live.filter(p => p.pid !== rootPid).reduce((sum, p) => sum + p.rss, 0), processes: live.length, descendants: live.filter(p => p.pid !== rootPid).length };
}
function groupAlive(pid) { try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
async function retireGroup(pid) {
  if (groupAlive(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  const deadline = Date.now() + 3000;
  while (groupAlive(pid) && Date.now() < deadline) await sleep(10);
  return !groupAlive(pid);
}
/** Linux-only sampled process-tree RSS estimate. /proc rows are non-atomic; no exact peak claim. */
export async function measureProcess(command, args, { input = '', env = {}, timeoutMilliseconds = 35000, maximumOutputBytes = 32 * 1024 ** 2, intervalMilliseconds = 20, signal, onSample } = {}) {
  if (process.platform !== 'linux') fail('LINUX_PROC_REQUIRED');
  if (signal?.aborted) return { status: 'CANCELLED', spawned: false, output: Buffer.alloc(0), stderrBytes: 0, wallMilliseconds: 0, cleanup: { groupGone: true } };
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 600000 || !Number.isInteger(maximumOutputBytes) || maximumOutputBytes < 1 || maximumOutputBytes > 32 * 1024 ** 2 || intervalMilliseconds < 5 || intervalMilliseconds > 1000) fail('MEASUREMENT_BUDGET_INVALID');
  const started = performance.now(), child = spawn(command, args, { cwd: '/work', env: { PATH: process.env.PATH, DOTNET_ROOT: '/usr/share/dotnet', HOME: '/tmp', TMPDIR: '/tmp', DOTNET_CLI_HOME: '/tmp/dotnet', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', ...env }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks = []; let count = 0, stderrBytes = 0, reason = null, samples = 0, sampleError = null, closed = false;
  const observed = { maxTreeRssBytes: 0, maxSupervisorRssBytes: 0, maxDescendantsRssBytes: 0, maxProcessCount: 0, sawDescendant: false };
  const kill = why => { if (!reason) reason = why; if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') sampleError = error.code ?? 'KILL_FAILED'; } };
  const abort = () => kill('CANCELLED'); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(() => kill('TIMEOUT'), timeoutMilliseconds);
  child.stdin.on('error', error => { if (error.code !== 'EPIPE' && !reason) reason = 'STDIN_FAILED'; });
  child.stdout.on('data', bytes => { count += bytes.length; if (count > maximumOutputBytes) kill('OUTPUT_LIMIT'); else chunks.push(bytes); });
  child.stderr.on('data', bytes => { stderrBytes += bytes.length; if (stderrBytes > 1024 ** 2) kill('STDERR_LIMIT'); });
  const completion = new Promise(resolve => {
    child.once('error', error => { reason = 'SPAWN_FAILED'; closed = true; resolve({ code: null, signal: null, errorCode: error.code }); });
    child.once('close', (code, term) => { closed = true; resolve({ code, signal: term }); });
  });
  child.stdin.end(input);
  const sampling = (async () => {
    while (!closed && child.pid) {
      try {
        const value = await sample(child.pid); samples++;
        observed.maxTreeRssBytes = Math.max(observed.maxTreeRssBytes, value.treeRssBytes);
        observed.maxSupervisorRssBytes = Math.max(observed.maxSupervisorRssBytes, value.supervisorRssBytes);
        observed.maxDescendantsRssBytes = Math.max(observed.maxDescendantsRssBytes, value.descendantsRssBytes);
        observed.maxProcessCount = Math.max(observed.maxProcessCount, value.processes); observed.sawDescendant ||= value.descendants > 0;
        onSample?.(value);
      } catch (error) { sampleError = error.code ?? error.message; kill('SAMPLING_FAILED'); }
      if (!closed) await sleep(intervalMilliseconds);
    }
  })();
  const exited = await completion, exitedAt = performance.now(); clearTimeout(timeout); signal?.removeEventListener('abort', abort); await sampling;
  const groupGone = child.pid ? await retireGroup(child.pid) : true, output = Buffer.concat(chunks);
  return { status: !groupGone ? 'CLEANUP_FAILED' : reason ?? (exited.code === 0 ? 'PASS' : 'EXIT_FAILED'), spawned: Boolean(child.pid), ...exited,
    wallMilliseconds: exitedAt - started, measurementAndCleanupWallMilliseconds: performance.now() - started, outputBytes: count, retainedOutputBytes: output.length, outputSha256: count <= maximumOutputBytes ? sha256(output) : null, output, stderrBytes, sampleError,
    sampling: { intervalMilliseconds, samples, ...observed, interpretation: 'Sampled process-tree RSS estimate from sequential non-atomic /proc reads; may miss short peaks and is not an exact coincident peak. Supervisor and descendant maxima occur independently and must not be added.' },
    cleanup: { groupGone } };
}
export function publicMeasurement(result) { const { output, ...value } = result; return value; }
