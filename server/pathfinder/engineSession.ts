import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { runEngine } from './engine.js';
import { engineResponseSchema, type EngineResponse } from './jobContracts.js';
import { PathFinderError } from './errors.js';

export type EngineInvocation = Record<string, unknown> & {
  requestId: string;
  timeoutMilliseconds: number;
};
export interface EngineExecutor {
  execute(request: EngineInvocation, signal: AbortSignal): Promise<EngineResponse>;
  close(): Promise<void>;
}
type Reuse = 'none' | 'build' | 'disk' | 'memory';
export type EngineSessionEvent =
  | { type: 'spawn' | 'closed'; pid: number }
  | { type: 'ready'; pid: number; runnerSha256: string }
  | { type: 'dispatch'; pid: number; requestId: string; requestOrdinal: number }
  | {
      type: 'result';
      pid: number;
      requestId: string;
      requestOrdinal: number;
      preparedReuse: Reuse;
      retireAfterResponse: boolean;
    }
  | { type: 'retire'; pid: number; reason: string }
  | { type: 'rss'; pid: number; bytes: number; thresholdBytes: number };
type Observer = (event: EngineSessionEvent) => void;
const VERSION = 'pathfinder.engine.session.v1',
  ENGINE = '45c24bf5f433f13e102600b36f20327c77961d0a';
const INPUT = 1024 * 1024,
  OUTPUT = 32 * 1024 * 1024,
  STDERR = 65536;
/** Interactive local work may keep its prepared model for five idle minutes;
 * request count, total lifetime, cancellation and memory ceilings remain fixed. */
export function engineSessionIdleMilliseconds(profile: unknown = process.env.PF_ENGINE_SESSION_PROFILE): 30000 | 300000 {
  if (profile === undefined || profile === 'bounded') return 30000;
  if (profile === 'interactive') return 300000;
  throw new PathFinderError('PATHFINDER_ENGINE_SESSION_PROFILE_INVALID', 503);
}
export const engineSessionPolicy = Object.freeze({
  requests: 64,
  idleMilliseconds: engineSessionIdleMilliseconds(),
  lifetimeMilliseconds: 600000,
  startupMilliseconds: 5000,
  rssBytes: 512 * 1024 * 1024,
  rssIntervalMilliseconds: 100,
  joinMilliseconds: 10000,
});
export function assertEngineSessionIdleMilliseconds(actual: unknown, expected: number = engineSessionPolicy.idleMilliseconds): void {
  if (![30000, 300000].includes(actual === undefined ? 30000 : actual as number) || (actual ?? 30000) !== expected)
    throw new PathFinderError('ENGINE_SESSION_PROFILE_MISMATCH', 502);
}
const readySchema = z
  .object({
    schemaVersion: z.literal(VERSION),
    type: z.literal('ready'),
    runnerSha256: z.string().regex(/^[a-f0-9]{64}$/),
    engineVersion: z.literal(ENGINE),
    maxInputBytes: z.literal(INPUT),
    maxOutputBytes: z.literal(OUTPUT),
    idleMilliseconds: z.union([z.literal(30000), z.literal(300000)]).optional(),
  })
  .strict();
const resultSchema = z
  .object({
    schemaVersion: z.literal(VERSION),
    type: z.literal('result'),
    response: engineResponseSchema,
    session: z
      .object({
        requestOrdinal: z.number().int().min(1).max(64),
        preparedReuse: z.enum(['none', 'build', 'disk', 'memory']),
        retireAfterResponse: z.boolean(),
      })
      .strict(),
  })
  .strict();
type Reply = z.infer<typeof resultSchema>;
const error = (code: string, message?: string) => new PathFinderError(code, 502, message);
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** This parser rejects duplicate members before JSON.parse can discard evidence. */
function parse(bytes: Buffer): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let at = 0;
  const space = () => {
    while (at < text.length && /\s/.test(text[at])) at++;
  };
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      const ch = text[at++];
      if (ch === '\\') at++;
      else if (ch === '"') return JSON.parse(text.slice(start, at)) as string;
    }
    throw error('ENGINE_SESSION_PROTOCOL');
  };
  const value = (depth: number): void => {
    if (depth > 48) throw error('ENGINE_SESSION_PROTOCOL');
    space();
    if (text[at] === '{') {
      at++;
      space();
      const keys = new Set<string>();
      if (text[at] === '}') {
        at++;
        return;
      }
      for (;;) {
        if (text[at] !== '"') throw error('ENGINE_SESSION_PROTOCOL');
        const key = string();
        if (keys.has(key)) throw error('ENGINE_SESSION_PROTOCOL');
        keys.add(key);
        space();
        if (text[at++] !== ':') throw error('ENGINE_SESSION_PROTOCOL');
        value(depth + 1);
        space();
        const end = text[at++];
        if (end === '}') return;
        if (end !== ',') throw error('ENGINE_SESSION_PROTOCOL');
        space();
      }
    }
    if (text[at] === '[') {
      at++;
      space();
      if (text[at] === ']') {
        at++;
        return;
      }
      for (;;) {
        value(depth + 1);
        space();
        const end = text[at++];
        if (end === ']') return;
        if (end !== ',') throw error('ENGINE_SESSION_PROTOCOL');
      }
    }
    if (text[at] === '"') {
      string();
      return;
    }
    const token = /^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/.exec(
      text.slice(at),
    );
    if (!token) throw error('ENGINE_SESSION_PROTOCOL');
    at += token[0].length;
  };
  value(0);
  space();
  if (at !== text.length) throw error('ENGINE_SESSION_PROTOCOL');
  const result: unknown = JSON.parse(text);
  const finite = (item: unknown): void => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw error('ENGINE_SESSION_PROTOCOL');
    if (item && typeof item === 'object') for (const child of Object.values(item)) finite(child);
  };
  finite(result);
  return result;
}
async function runner(dll: string): Promise<string> {
  if (!path.isAbsolute(dll)) throw error('PATHFINDER_ENGINE_NOT_CONFIGURED');
  const stat = await fs.lstat(dll);
  if (!stat.isFile() || stat.isSymbolicLink()) throw error('PATHFINDER_ENGINE_NOT_CONFIGURED');
  return createHash('sha256')
    .update(await fs.readFile(dll))
    .digest('hex');
}
/** Soft estimate from sequential /proc reads; not a hard or exact coincident peak. */
async function residentBytes(pid: number): Promise<number> {
  if (process.platform !== 'linux') throw error('ENGINE_SESSION_RSS_UNAVAILABLE');
  const rows: Array<{ pid: number; parent: number }> = [];
  for (const name of await fs.readdir('/proc'))
    if (/^[1-9][0-9]*$/.test(name)) {
      try {
        const stat = await fs.readFile('/proc/' + name + '/stat', 'utf8'),
          fields = stat
            .slice(stat.lastIndexOf(')') + 1)
            .trim()
            .split(/\s+/);
        rows.push({ pid: Number(name), parent: Number(fields[1]) });
      } catch (cause) {
        if (!['ENOENT', 'ESRCH'].includes((cause as NodeJS.ErrnoException).code ?? ''))
          throw error('ENGINE_SESSION_RSS_UNAVAILABLE');
      }
    }
  const retained = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (!retained.has(row.pid) && retained.has(row.parent)) {
        retained.add(row.pid);
        changed = true;
      }
  }
  let total = 0,
    root = false;
  for (const current of retained) {
    try {
      const status = await fs.readFile('/proc/' + current + '/status', 'utf8'),
        found = /^VmRSS:\s*(\d+)\s+kB\s*$/m.exec(status);
      if (found) {
        total += Number(found[1]) * 1024;
        if (current === pid) root = true;
      }
    } catch (cause) {
      if (!['ENOENT', 'ESRCH'].includes((cause as NodeJS.ErrnoException).code ?? ''))
        throw error('ENGINE_SESSION_RSS_UNAVAILABLE');
    }
  }
  if (!root || !Number.isSafeInteger(total)) throw error('ENGINE_SESSION_RSS_UNAVAILABLE');
  return total;
}
async function kill(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32')
    await new Promise<void>((resolve) =>
      execFile(
        'taskkill',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: 10000 },
        () => resolve(),
      ),
    );
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}
/** Server-owned test seams; never populated from an HTTP request or an environment policy override. */
export type EngineSessionDependencies = {
  spawn: (dll: string) => ChildProcessWithoutNullStreams;
  runnerHash: (dll: string) => Promise<string>;
  residentBytes: (pid: number) => Promise<number>;
  kill: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  groupGone: (pid: number) => Promise<boolean>;
};
const defaults: EngineSessionDependencies = {
  spawn: (dll) =>
    spawn('dotnet', [dll, '--session-supervisor'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: process.env,
    }),
  runnerHash: runner,
  residentBytes,
  kill,
  groupGone: async (pid) => {
    if (process.platform !== 'linux') throw error('ENGINE_SESSION_PLATFORM_UNSUPPORTED');
    try {
      process.kill(-pid, 0);
      return false;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return true;
      throw error('ENGINE_SESSION_REAP_FAILED');
    }
  },
};
type Lane = {
  child: ChildProcessWithoutNullStreams;
  pid: number;
  born: number;
  ordinal: number;
  exited: boolean;
  expectedExit: boolean;
  fault: unknown;
  retiring?: Promise<void>;
  closed: Deferred<void>;
  ready: Deferred<void>;
  waiting: Deferred<Reply> | null;
  hash: string;
  header: Buffer;
  headerBytes: number;
  length: number;
  body: Buffer | null;
  bytes: number;
  stderr: number;
  idle?: NodeJS.Timeout;
  rss?: NodeJS.Timeout;
  startup?: NodeJS.Timeout;
  sampling: boolean;
};

export function createSessionEngineExecutor(
  options: { observe?: Observer } = {},
  dependencies: EngineSessionDependencies = defaults,
): EngineExecutor {
  if (dependencies === defaults && process.platform !== 'linux')
    throw error('ENGINE_SESSION_PLATFORM_UNSUPPORTED');
  let lane: Lane | undefined,
    busy = false,
    closed = false,
    fatal: unknown,
    stopActive: ((cause: unknown) => void) | undefined,
    activeDone: Deferred<void> | undefined;
  const observe = (event: EngineSessionEvent): void => {
    try {
      options.observe?.(event);
    } catch {
      /* Telemetry cannot authorize, fail or alter a calculation. */
    }
  };
  const timer = (callback: () => void, ms: number): NodeJS.Timeout => {
    const value = setTimeout(callback, ms);
    value.unref();
    return value;
  };
  async function retire(current: Lane, reason: string): Promise<void> {
    if (current.retiring) return current.retiring;
    clearTimeout(current.idle);
    clearTimeout(current.startup);
    clearInterval(current.rss);
    observe({ type: 'retire', pid: current.pid, reason });
    current.retiring = Promise.resolve().then(async () => {
      let join: NodeJS.Timeout | undefined,
        ended = false;
      try {
        const reaped = (async () => {
          if (!current.exited) await dependencies.kill(current.child);
          await current.closed.promise;
          while (!ended && !(await dependencies.groupGone(current.pid)))
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
        })();
        await Promise.race([
          reaped,
          new Promise<never>((_, reject) => {
            join = timer(
              () => reject(error('ENGINE_SESSION_REAP_FAILED')),
              engineSessionPolicy.joinMilliseconds,
            );
          }),
        ]);
        if (lane === current) lane = undefined;
      } catch (cause) {
        fatal = cause instanceof PathFinderError && cause.code==='ENGINE_SESSION_REAP_FAILED'
          ? cause : error('ENGINE_SESSION_REAP_FAILED','The owned engine process group could not be confirmed stopped.');
        throw fatal;
      } finally {
        ended = true;
        clearTimeout(join);
      }
    });
    return current.retiring;
  }
  function fault(current: Lane, cause: unknown): void {
    if (current.retiring) return;
    current.fault = cause;
    current.ready.reject(cause);
    current.waiting?.reject(cause);
    void retire(
      current,
      cause instanceof PathFinderError ? cause.code : 'ENGINE_SESSION_PROCESS_FAILED',
    ).catch((problem) => {
      fatal = problem;
    });
  }
  function data(current: Lane, chunk: Buffer): void {
    if (current.retiring) return;
    try {
      let at = 0;
      while (at < chunk.length) {
        if (current.fault) throw current.fault;
        if (current.ordinal !== 0 && !current.waiting) throw error('ENGINE_SESSION_UNSOLICITED');
        if (current.headerBytes < 4) {
          const count = Math.min(4 - current.headerBytes, chunk.length - at);
          chunk.copy(current.header, current.headerBytes, at, at + count);
          current.headerBytes += count;
          at += count;
          if (current.headerBytes < 4) return;
          current.length = current.header.readUInt32BE();
          if (current.length < 1 || current.length > OUTPUT) throw error('ENGINE_OUTPUT_BUDGET');
          current.body = Buffer.allocUnsafe(current.length);
        }
        const count = Math.min(current.length - current.bytes, chunk.length - at);
        chunk.copy(current.body!, current.bytes, at, at + count);
        current.bytes += count;
        at += count;
        if (current.bytes < current.length) return;
        // No second response is legal without another server dispatch, including a partial header.
        if (at !== chunk.length) throw error('ENGINE_SESSION_UNSOLICITED');
        const decoded = parse(current.body!);
        current.headerBytes = 0;
        current.length = 0;
        current.bytes = 0;
        current.body = null;
        if (current.ordinal === 0) {
          const ready = readySchema.parse(decoded);
          if (ready.runnerSha256 !== current.hash) throw error('ENGINE_SESSION_IDENTITY');
          assertEngineSessionIdleMilliseconds(ready.idleMilliseconds);
          clearTimeout(current.startup);
          current.ready.resolve();
          current.ordinal = -1;
          observe({ type: 'ready', pid: current.pid, runnerSha256: ready.runnerSha256 });
        } else {
          const answer = resultSchema.parse(decoded);
          if (answer.session.requestOrdinal !== current.ordinal)
            throw error('ENGINE_SESSION_IDENTITY');
          const waiting = current.waiting;
          if (!waiting) throw error('ENGINE_SESSION_UNSOLICITED');
          current.waiting = null;
          current.expectedExit = answer.session.retireAfterResponse;
          waiting.resolve(answer);
        }
      }
    } catch (cause) {
      fault(current, cause instanceof PathFinderError ? cause : error('ENGINE_SESSION_PROTOCOL'));
    }
  }
  async function start(deadline: number, check: () => void): Promise<Lane> {
    const dll = process.env.PF_ENGINE_DLL;
    if (!dll) throw error('PATHFINDER_ENGINE_NOT_CONFIGURED');
    const hash = await dependencies.runnerHash(dll);
    check();
    if (Date.now() >= deadline) throw error('ENGINE_DEADLINE');
    const child = dependencies.spawn(dll);
    if (!child.pid) {
      // spawn() reports ENOENT asynchronously even when no process was created.
      child.on('error', () => undefined);
      child.stdin.on('error', () => undefined);
      child.stdout.resume();
      child.stderr.resume();
      throw error('ENGINE_PROCESS_FAILED');
    }
    const current: Lane = {
      child,
      pid: child.pid,
      born: Date.now(),
      ordinal: 0,
      exited: false,
      expectedExit: false,
      fault: null,
      closed: deferred<void>(),
      ready: deferred<void>(),
      waiting: null,
      hash,
      header: Buffer.alloc(4),
      headerBytes: 0,
      length: 0,
      body: null,
      bytes: 0,
      stderr: 0,
      sampling: false,
    };
    lane = current;
    // A failure may occur before start() reaches its await. Attach a handler immediately.
    void current.ready.promise.catch(() => undefined);
    observe({ type: 'spawn', pid: current.pid });
    child.stdout.on('data', (chunk: Buffer) => data(current, chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      current.stderr += chunk.length;
      if (current.stderr > STDERR) fault(current, error('ENGINE_ERROR_BUDGET'));
    });
    child.stdin.on('error', () => fault(current, error('ENGINE_SESSION_PROCESS_FAILED')));
    child.once('error', () => fault(current, error('ENGINE_SESSION_PROCESS_FAILED')));
    child.once('close', () => {
      current.exited = true;
      current.closed.resolve();
      observe({ type: 'closed', pid: current.pid });
      if (!current.retiring && !current.expectedExit)
        fault(current, error('ENGINE_SESSION_PROCESS_FAILED'));
    });
    current.startup = timer(
      () =>
        fault(
          current,
          error(Date.now() >= deadline ? 'ENGINE_DEADLINE' : 'ENGINE_SESSION_STARTUP_DEADLINE'),
        ),
      Math.max(1, Math.min(engineSessionPolicy.startupMilliseconds, deadline - Date.now())),
    );
    const sample = async (): Promise<void> => {
      if (current.sampling || current.exited || current.retiring) return;
      current.sampling = true;
      try {
        const bytes = await dependencies.residentBytes(current.pid);
        if (current.exited || current.retiring) return;
        observe({
          type: 'rss',
          pid: current.pid,
          bytes,
          thresholdBytes: engineSessionPolicy.rssBytes,
        });
        if (bytes > engineSessionPolicy.rssBytes) fault(current, error('ENGINE_SESSION_RSS_LIMIT'));
      } catch {
        if (!current.exited && !current.retiring)
          fault(current, error('ENGINE_SESSION_RSS_UNAVAILABLE'));
      } finally {
        current.sampling = false;
      }
    };
    current.rss = setInterval(() => void sample(), engineSessionPolicy.rssIntervalMilliseconds);
    current.rss.unref();
    await sample();
    await current.ready.promise;
    if (current.fault) throw current.fault;
    return current;
  }
  return {
    async execute(request, signal) {
      if (closed) throw error('ENGINE_SESSION_CLOSED');
      if (fatal) throw fatal;
      signal.throwIfAborted();
      if (busy) throw error('ENGINE_SESSION_BUSY');
      if (
        !Number.isInteger(request.timeoutMilliseconds) ||
        request.timeoutMilliseconds < 1 ||
        request.timeoutMilliseconds > 120000
      )
        throw error('ENGINE_INPUT_BUDGET');
      const initial = Buffer.from(JSON.stringify(request));
      if (initial.length < 1 || initial.length > INPUT) throw error('ENGINE_INPUT_BUDGET');
      busy = true;
      activeDone = deferred<void>();
      const deadline = Date.now() + request.timeoutMilliseconds;
      let current: Lane | undefined, outer: NodeJS.Timeout | undefined, callFailure: unknown;
      const failure = deferred<never>();
      void failure.promise.catch(() => undefined);
      const stopCall = (cause: unknown): void => {
        callFailure ??= cause;
        failure.reject(cause);
        const target = current ?? lane;
        if (target) fault(target, cause);
      };
      stopActive = stopCall;
      const guard = <T>(promise: Promise<T>): Promise<T> =>
        Promise.race([promise, failure.promise]);
      const check = (): void => {
        if (callFailure) throw callFailure;
        signal.throwIfAborted();
        if (closed) throw error('ENGINE_SESSION_CLOSED');
      };
      const abort = (): void =>
        stopCall(new PathFinderError('CALCULATION_CANCELLED', 409, 'Calculation was cancelled.'));
      signal.addEventListener('abort', abort, { once: true });
      outer = timer(
        () =>
          stopCall(
            new PathFinderError('ENGINE_DEADLINE', 408, 'Calculation exceeded its deadline.'),
          ),
        request.timeoutMilliseconds + 1500,
      );
      try {
        if (
          lane &&
          (lane.retiring ||
            lane.fault ||
            lane.exited ||
            lane.ordinal >= engineSessionPolicy.requests ||
            Date.now() + request.timeoutMilliseconds >=
              lane.born + engineSessionPolicy.lifetimeMilliseconds)
        )
          await guard(retire(lane, 'rotation'));
        signal.throwIfAborted();
        if (closed) throw error('ENGINE_SESSION_CLOSED');
        if (Date.now() >= deadline) throw error('ENGINE_DEADLINE');
        current = lane ?? (await guard(start(deadline, check)));
        clearTimeout(current.idle);
        if (current.fault) throw current.fault;
        check();
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw error('ENGINE_DEADLINE');
        const input = Buffer.from(JSON.stringify({ ...request, timeoutMilliseconds: remaining }));
        if (input.length > INPUT) throw error('ENGINE_INPUT_BUDGET');
        current.ordinal = current.ordinal < 1 ? 1 : current.ordinal + 1;
        const waiting = deferred<Reply>();
        current.waiting = waiting;
        void waiting.promise.catch(() => undefined);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(input.length);
        observe({
          type: 'dispatch',
          pid: current.pid,
          requestId: request.requestId,
          requestOrdinal: current.ordinal,
        });
        current.child.stdin.write(Buffer.concat([header, input]));
        const result = await guard(waiting.promise);
        if (current.fault) throw current.fault;
        if (signal.aborted) throw new PathFinderError('CALCULATION_CANCELLED', 409);
        if (result.response.requestId !== request.requestId)
          throw error('ENGINE_RESPONSE_IDENTITY');
        if ((request.schemaVersion === 'pathfinder.model.runner.v2') !== (result.response.schemaVersion === 'pathfinder.model.response.v3'))
          throw error('ENGINE_RESPONSE_VERSION');
        if (Date.now() > deadline + 1500) throw error('ENGINE_DEADLINE');
        observe({
          type: 'result',
          pid: current.pid,
          requestId: request.requestId,
          ...result.session,
        });
        if (
          result.session.retireAfterResponse ||
          current.ordinal >= engineSessionPolicy.requests ||
          ['deadline_exceeded', 'resource_limit', 'invalid_request'].includes(
            result.response.status,
          )
        )
          await retire(current, 'result-retirement');
        else
          current.idle = timer(() => {
            void retire(current!, 'idle').catch((cause) => {
              fatal = cause;
            });
          }, engineSessionPolicy.idleMilliseconds);
        // Cancellation/deadline can arrive while a completed response waits for
        // the retiring process group. Joining must not turn that failure into success.
        check();
        if (Date.now() > deadline + 1500) throw error('ENGINE_DEADLINE');
        return result.response;
      } catch (cause) {
        callFailure ??= cause;
        const target = current ?? lane;
        if (target) {
          target.ready.reject(cause);
          target.waiting?.reject(cause);
          await retire(target, cause instanceof PathFinderError ? cause.code : 'calculation-fault');
        }
        throw cause;
      } finally {
        clearTimeout(outer);
        signal.removeEventListener('abort', abort);
        busy = false;
        stopActive = undefined;
        activeDone?.resolve();
        activeDone = undefined;
      }
    },
    async close() {
      closed = true;
      const cause = error('ENGINE_SESSION_CLOSED'),
        done = activeDone;
      stopActive?.(cause);
      const current = lane;
      if (current) {
        current.ready.reject(cause);
        current.waiting?.reject(cause);
        await retire(current, 'shutdown');
      }
      await done?.promise;
      if (fatal) throw fatal;
    },
  };
}

export function createConfiguredEngineExecutor(
  options: { observe?: Observer } = {},
): EngineExecutor {
  const mode = process.env.PF_ENGINE_MODE ?? 'oneshot';
  if (mode === 'session') return createSessionEngineExecutor(options);
  if (mode !== 'oneshot') throw error('PATHFINDER_ENGINE_MODE_INVALID');
  return {
    execute: runEngine,
    async close() {
      /* Every one-shot invocation already owns its bounded process tree. */
    },
  };
}
