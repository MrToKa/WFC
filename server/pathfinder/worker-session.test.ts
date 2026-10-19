// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import type { EngineExecutor } from './engineSession.js';
import type { PathFinderJobs } from './jobs.js';
import { createPathFinderWorker } from './worker.js';

function harness(close: () => Promise<void>) {
  const events: string[] = [],
    owner = new EventEmitter() as EventEmitter & {
      query: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
  owner.query = vi.fn(async (sql: string) => {
    if (sql.includes('pg_try_advisory_lock')) {
      events.push('lock');
      return { rows: [{ locked: true }] };
    }
    if (sql.includes('pg_advisory_unlock')) events.push('unlock');
    return { rows: [] };
  });
  owner.release = vi.fn(() => events.push('release'));
  owner.end = vi.fn(async () => {
    events.push('end');
  });
  const claim = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() },
    pool = {
      connect: vi.fn().mockResolvedValueOnce(owner).mockResolvedValue(claim),
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as Pool;
  const engine: EngineExecutor = {
      execute: vi.fn(),
      close: vi.fn(async () => {
        events.push('close');
        await close();
        events.push('joined');
      }),
    },
    factory = vi.fn(() => {
      events.push('factory');
      return engine;
    });
  const worker = createPathFinderWorker(pool, {} as PathFinderJobs, factory);
  return { worker, owner, engine, factory, events };
}
describe('session lane follows durable advisory-owner lifetime', () => {
  it('dispatches preparation only after advisory ownership and on the same engine', async () => {
    const h = harness(async () => {}), request = { requestId: '11111111-1111-4111-8111-111111111111', operation: 'prepare', timeoutMilliseconds: 10000 };
    const response = { schemaVersion: 'pathfinder.model.response.v1' as const, requestId: request.requestId, status: 'prepared' as const, message: '', engineeringAccepted: false as const };
    vi.mocked(h.engine.execute).mockImplementation(async () => { h.events.push('prepare'); return response; });
    await expect(h.worker.executePreparation(request, new AbortController().signal)).rejects.toMatchObject({ code: 'PREPARATION_WORKER_UNAVAILABLE' });
    h.worker.start();
    await expect(h.worker.executePreparation(request, new AbortController().signal)).resolves.toEqual(response);
    expect(h.events.slice(0, 3)).toEqual(['lock', 'factory', 'prepare']);
    expect(h.factory).toHaveBeenCalledOnce();
    await h.worker.stop();
    expect(h.events.slice(-4)).toEqual(['close', 'joined', 'unlock', 'release']);
    await expect(h.worker.executePreparation(request, new AbortController().signal)).rejects.toMatchObject({ code: 'PREPARATION_WORKER_UNAVAILABLE' });
  });
  it('creates only after lock and awaits engine close before unlocking and releasing', async () => {
    let finish!: () => void;
    const h = harness(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    h.worker.start();
    await vi.waitFor(() => expect(h.factory).toHaveBeenCalledOnce());
    const stopping = h.worker.stop();
    await vi.waitFor(() => expect(h.engine.close).toHaveBeenCalledOnce());
    expect(h.events).toEqual(['lock', 'factory', 'close']);
    expect(h.owner.release).not.toHaveBeenCalled();
    finish();
    await stopping;
    expect(h.events).toEqual(['lock', 'factory', 'close', 'joined', 'unlock', 'release']);
    expect(h.owner.listenerCount('error')).toBe(0);
    expect(h.owner.release).toHaveBeenCalledWith();
  });
  it('repeated lock connection errors stay handled through delayed lane join and terminal discard', async () => {
    let finish!: () => void;
    const h = harness(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    h.owner.end.mockImplementation(async () => {
      h.events.push('end');
      expect(() => h.owner.emit('error', Error('transport closing'))).not.toThrow();
      await Promise.resolve();
      expect(() => h.owner.emit('error', Error('transport ended unexpectedly'))).not.toThrow();
    });
    h.worker.start();
    await vi.waitFor(() => expect(h.factory).toHaveBeenCalledOnce());
    expect(() => h.owner.emit('error', Error('test lock lost'))).not.toThrow();
    const stopping = h.worker.stop();
    await vi.waitFor(() => expect(h.engine.close).toHaveBeenCalledOnce());
    expect(() => h.owner.emit('error', Error('second error during join'))).not.toThrow();
    expect(h.owner.release).not.toHaveBeenCalled();
    expect(h.owner.end).not.toHaveBeenCalled();
    finish();
    await stopping;
    expect(h.events).toEqual(['lock', 'factory', 'close', 'joined', 'end', 'release']);
    expect(h.owner.release).toHaveBeenCalledWith(true);
    expect(() => h.owner.emit('error', Error('terminal client late event'))).not.toThrow();
    expect(h.factory).toHaveBeenCalledOnce();
  });
  it('lock connection loss stops and joins the owned lane before discarding its transport', async () => {
    const h = harness(async () => undefined);
    h.worker.start();
    await vi.waitFor(() => expect(h.factory).toHaveBeenCalledOnce());
    h.owner.emit('error', Error('test lock lost'));
    await h.worker.stop();
    expect(h.events).toEqual(['lock', 'factory', 'close', 'joined', 'end', 'release']);
    expect(h.owner.release).toHaveBeenCalledWith(true);
  });
  it('quarantines an unreaped lane, refuses new ownership and exposes fatal shutdown', async () => {
    const failure = Object.assign(Error('lane remains'), { code: 'ENGINE_SESSION_REAP_FAILED' }),
      h = harness(async () => {
        throw failure;
      });
    h.worker.start();
    await vi.waitFor(() => expect(h.factory).toHaveBeenCalledOnce());
    await expect(h.worker.stop()).rejects.toBe(failure);
    expect(h.events).toEqual(['lock', 'factory', 'close']);
    expect(h.owner.release).not.toHaveBeenCalled();
    expect(h.owner.end).not.toHaveBeenCalled();
    expect(() => h.owner.emit('error', Error('late quarantined client error'))).not.toThrow();
    expect(() => h.owner.emit('error', Error('second quarantined client error'))).not.toThrow();
    h.worker.start();
    expect(h.factory).toHaveBeenCalledOnce();
  });
  it('handles error between checkout and lock-query completion without creating a lane', async () => {
    let answer!: (value: { rows: Array<{ locked: boolean }> }) => void;
    const h = harness(async () => undefined);
    h.owner.query.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    h.worker.start();
    await vi.waitFor(() => expect(h.owner.query).toHaveBeenCalledOnce());
    expect(() => h.owner.emit('error', Error('connection lost during lock query'))).not.toThrow();
    expect(() => h.owner.emit('error', Error('connection end during lock query'))).not.toThrow();
    answer({ rows: [{ locked: true }] });
    await h.worker.stop();
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.owner.query).toHaveBeenCalledOnce();
    expect(h.owner.release).toHaveBeenCalledWith(true);
    expect(h.events).toEqual(['end', 'release']);
  });
  it('discards a failed unlock only after engine join and handles errors during client end', async () => {
    const h = harness(async () => undefined),
      query = h.owner.query.getMockImplementation()!;
    h.owner.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_advisory_unlock')) {
        h.events.push('unlock-failed');
        throw Error('unlock transport failure');
      }
      return query(sql);
    });
    h.owner.end.mockImplementation(async () => {
      h.events.push('end');
      h.owner.emit('error', Error('late unlock connection error'));
    });
    h.worker.start();
    await vi.waitFor(() => expect(h.factory).toHaveBeenCalledOnce());
    await h.worker.stop();
    expect(h.events).toEqual([
      'lock',
      'factory',
      'close',
      'joined',
      'unlock-failed',
      'end',
      'release',
    ]);
    expect(h.owner.release).toHaveBeenCalledWith(true);
  });
  it('does not return a failed lock-query connection to the pool', async () => {
    const h = harness(async () => undefined),
      log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.owner.query.mockRejectedValue(Error('lock query failed'));
    try {
      h.worker.start();
      await vi.waitFor(() => expect(h.owner.query).toHaveBeenCalledOnce());
      await h.worker.stop();
      expect(h.factory).not.toHaveBeenCalled();
      expect(h.owner.end).toHaveBeenCalledOnce();
      expect(h.owner.release).toHaveBeenCalledWith(true);
    } finally {
      log.mockRestore();
    }
  });
  it('quarantines a damaged client if terminal transport close fails, retaining its error handler', async () => {
    const h = harness(async () => undefined);
    h.owner.end.mockRejectedValue(Error('terminal close failed'));
    h.worker.start();
    await vi.waitFor(() => expect(h.factory).toHaveBeenCalledOnce());
    h.owner.emit('error', Error('lock lost'));
    await expect(h.worker.stop()).rejects.toMatchObject({ code: 'WORKER_OWNER_CLOSE_FAILED' });
    expect(h.owner.release).not.toHaveBeenCalled();
    expect(() =>
      h.owner.emit('error', Error('another error on quarantined transport')),
    ).not.toThrow();
    h.worker.start();
    expect(h.factory).toHaveBeenCalledOnce();
  });
  it('hands an unlocked healthy client back to the pool without retaining its handler', async () => {
    const h = harness(async () => undefined);
    h.owner.query.mockResolvedValue({ rows: [{ locked: false }] });
    h.worker.start();
    await vi.waitFor(() => expect(h.owner.release).toHaveBeenCalledOnce());
    await h.worker.stop();
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.owner.end).not.toHaveBeenCalled();
    expect(h.owner.release).toHaveBeenCalledWith();
    expect(h.owner.listenerCount('error')).toBe(0);
  });
  it('unlocks when configured executor construction itself fails before any child exists', async () => {
    const h = harness(async () => undefined),
      log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.factory.mockImplementation(() => {
      throw Error('invalid mode');
    });
    try {
      h.worker.start();
      await vi.waitFor(() => expect(h.factory).toHaveBeenCalledOnce());
      await h.worker.stop();
      expect(h.events).toEqual(['lock', 'unlock', 'release']);
    } finally {
      log.mockRestore();
    }
  });
});
