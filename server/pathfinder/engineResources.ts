import fs from 'node:fs/promises';
import { PathFinderError } from './errors.js';

export type RssFailureDetail = Readonly<{
  stage: 'platform' | 'proc-list' | 'proc-stat' | 'proc-status' | 'root-rss' | 'unsafe-total';
  errno: 'EACCES' | 'EPERM' | 'ENOENT' | 'ESRCH' | 'EIO' | 'EINVAL' | 'EMFILE' | 'ENFILE' | 'ENOMEM' | 'EAGAIN' | 'ENOTDIR' | 'EBADF' | 'EINTR' | 'OTHER' | null;
  role: 'root' | 'descendant' | 'unrelated' | null;
  rootStatusPresent: boolean;
  rootState: 'R' | 'S' | 'D' | 'T' | 't' | 'Z' | 'X' | 'x' | 'K' | 'W' | 'P' | 'I' | 'N' | null;
  enumeratedCount: number; // Numeric PID entries visited before this refusal.
  retainedCount: number; // Proven subtree size; zero before ancestry collection ends.
  statusReadCount: number; // Successfully read status files, including absent VmRSS.
}>;
const errnoAllowlist = new Set(['EACCES', 'EPERM', 'ENOENT', 'ESRCH', 'EIO', 'EINVAL', 'EMFILE', 'ENFILE', 'ENOMEM', 'EAGAIN', 'ENOTDIR', 'EBADF', 'EINTR']);
const rootStates = new Set(['R', 'S', 'D', 'T', 't', 'Z', 'X', 'x', 'K', 'W', 'P', 'I', 'N']);
const rssFailures = new WeakMap<object, RssFailureDetail>();
const errorObject = (value: unknown): value is object => value !== null && (typeof value === 'object' || typeof value === 'function');
const safeErrno = (value: unknown): RssFailureDetail['errno'] => {
  try {
    const code = errorObject(value) ? (value as { code?: unknown }).code : undefined;
    return typeof code === 'string' && errnoAllowlist.has(code) ? code as RssFailureDetail['errno'] : 'OTHER';
  } catch { return 'OTHER'; }
};
/** Internal-only metadata: arbitrary error properties never become diagnostics. */
export function getEngineRssFailureDetail(error: unknown): RssFailureDetail | null {
  return errorObject(error) ? rssFailures.get(error) ?? null : null;
}

/** Sequential Linux /proc samples are a soft estimate, not an exact coincident peak. */
export async function residentBytes(pid: number): Promise<number> {
  let enumeratedCount = 0, retainedCount = 0, statusReadCount = 0, rootStatusPresent = false;
  let rootState: RssFailureDetail['rootState'] = null, rootErrno: RssFailureDetail['errno'] = null;
  const detail = (stage: RssFailureDetail['stage'], errno: RssFailureDetail['errno'] = null, role: RssFailureDetail['role'] = null): RssFailureDetail => Object.freeze({
    stage, errno, role, rootStatusPresent, rootState,
    // Diagnostic counters only: no traversal, memory guard or arithmetic is capped.
    enumeratedCount: Math.min(1_000_000, enumeratedCount), retainedCount: Math.min(1_000_000, retainedCount), statusReadCount: Math.min(1_000_000, statusReadCount),
  });
  const fail = (stage: RssFailureDetail['stage'], errno: RssFailureDetail['errno'] = null, role: RssFailureDetail['role'] = null): never => {
    const error = new PathFinderError('ENGINE_RSS_UNAVAILABLE', 502);
    rssFailures.set(error, detail(stage, errno, role)); throw error;
  };
  if (process.platform !== 'linux') return fail('platform');
  const rows: Array<{ pid: number; parent: number }> = [];
  let names: string[];
  try { names = await fs.readdir('/proc'); }
  catch (cause) {
    // Preserve the pre-existing proc-list rejection object/code verbatim.
    if (errorObject(cause)) rssFailures.set(cause, detail('proc-list', safeErrno(cause)));
    throw cause;
  }
  for (const name of names) if (/^[1-9][0-9]*$/.test(name)) {
    enumeratedCount++;
    try {
      const stat = await fs.readFile('/proc/' + name + '/stat', 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
      rows.push({ pid: Number(name), parent: Number(fields[1]) });
    } catch (cause) { if (!['ENOENT', 'ESRCH'].includes((cause as NodeJS.ErrnoException).code ?? '')) return fail('proc-stat', safeErrno(cause), Number(name) === pid ? 'root' : null); }
  }
  const retained = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (!retained.has(row.pid) && retained.has(row.parent)) { retained.add(row.pid); changed = true; }
  }
  retainedCount = retained.size;
  let total = 0, root = false;
  for (const current of retained) {
    try {
      const status = await fs.readFile('/proc/' + current + '/status', 'utf8');
      statusReadCount++;
      if (current === pid) {
        rootStatusPresent = true;
        const state = /^State:\s*([A-Za-z])(?:\s|$)/m.exec(status)?.[1];
        rootState = state && rootStates.has(state) ? state as RssFailureDetail['rootState'] : null;
      }
      const found = /^VmRSS:\s*(\d+)\s+kB\s*$/m.exec(status);
      if (found) { total += Number(found[1]) * 1024; if (current === pid) root = true; }
    } catch (cause) {
      if (current === pid) rootErrno = safeErrno(cause);
      if (!['ENOENT', 'ESRCH'].includes((cause as NodeJS.ErrnoException).code ?? '')) return fail('proc-status', safeErrno(cause), current === pid ? 'root' : 'descendant');
    }
  }
  if (!root) return fail('root-rss', rootErrno, 'root');
  if (!Number.isSafeInteger(total)) return fail('unsafe-total', null, 'root');
  return total;
}
export type PreparationEngineObservation = { mode: 'oneshot'; thresholdBytes: number; intervalMilliseconds: number;
  observedMaximumBytes: number; samples: number; wallMilliseconds: number; exactPeak: false; outcome: 'completed' | 'refused';
  rssFailure?: RssFailureDetail;
  lifecycle?: {
    refusal: { elapsedMilliseconds: number; exitCode: number | null; signalCode: string | null } | null;
    exit: { elapsedMilliseconds: number; exitCode: number | null; signalCode: string | null } | null;
    close: { elapsedMilliseconds: number; exitCode: number | null; signalCode: string | null };
  };
};
const observations = new Map<string, PreparationEngineObservation>();
export function retainPreparationEngineObservation(requestId: string, value: PreparationEngineObservation): void {
  observations.set(requestId, Object.freeze({ ...value,
    ...(value.rssFailure ? { rssFailure: Object.freeze({ ...value.rssFailure }) } : {}),
    ...(value.lifecycle ? { lifecycle: Object.freeze({
      refusal: value.lifecycle.refusal ? Object.freeze({ ...value.lifecycle.refusal }) : null,
      exit: value.lifecycle.exit ? Object.freeze({ ...value.lifecycle.exit }) : null,
      close: Object.freeze({ ...value.lifecycle.close }),
    }) } : {}),
  }));
  while (observations.size > 16) observations.delete(observations.keys().next().value!);
}
export function preparationEngineObservation(requestId: string): PreparationEngineObservation | null {
  return observations.get(requestId) ?? null;
}
