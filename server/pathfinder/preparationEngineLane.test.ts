// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineExecutor } from './engineSession.js';
import type { EngineResponse } from './jobContracts.js';
import { createPreparationEngineLane } from './preparationEngineLane.js';

const request = { requestId: '11111111-1111-4111-8111-111111111111', operation: 'prepare', timeoutMilliseconds: 10000 };
const response: EngineResponse = { schemaVersion: 'pathfinder.model.response.v1', requestId: request.requestId, status: 'prepared', message: '', engineeringAccepted: false };
const signal = () => new AbortController();
const executor = (run = async () => response): EngineExecutor => ({ execute: vi.fn(run), close: vi.fn() });
afterEach(() => vi.useRealTimers());

describe('preparation admission on the existing serialized engine lane', () => {
  it('refuses before worker activation and after close', async () => {
    const lane = createPreparationEngineLane();
    await expect(lane.enqueue(request, signal().signal)).rejects.toMatchObject({ code: 'PREPARATION_WORKER_UNAVAILABLE' });
    lane.activate(); lane.close();
    await expect(lane.enqueue(request, signal().signal)).rejects.toMatchObject({ code: 'PREPARATION_WORKER_UNAVAILABLE' });
  });
  it('copies a bounded request, dispatches once and releases admission after joining', async () => {
    const lane = createPreparationEngineLane(); lane.activate();
    const source = { ...request, projectId: 'original' }, done = lane.enqueue(source, signal().signal);
    source.projectId = 'changed';
    const engine = executor();
    expect(await lane.runNext(engine, signal().signal)).toBe(true);
    await expect(done).resolves.toEqual(response);
    expect(engine.execute).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'original' }), expect.any(AbortSignal));
    expect(await lane.runNext(engine, signal().signal)).toBe(false);
  });
  it.each([{ ...request, operation: 'calculate' }, { ...request, timeoutMilliseconds: 120001 }, { ...request, timeoutMilliseconds: NaN }, { ...request, value: Infinity }, { ...request, data: 'x'.repeat(1024 * 1024) }])('refuses unsupported or excessive requests', async value => {
    const lane = createPreparationEngineLane(); lane.activate();
    await expect(lane.enqueue(value, signal().signal)).rejects.toBeDefined(); lane.close();
  });
  it('permits only one pending request and cancelled pending work never reaches engine', async () => {
    const lane = createPreparationEngineLane(); lane.activate(); const cancellation = signal();
    const done = lane.enqueue(request, cancellation.signal);
    await expect(lane.enqueue(request, signal().signal)).rejects.toMatchObject({ code: 'PREPARATION_ENGINE_BUSY' });
    const rejected = expect(done).rejects.toMatchObject({ code: 'PREPARATION_CANCELLED' }); cancellation.abort(); await rejected;
    const engine = executor(); expect(await lane.runNext(engine, signal().signal)).toBe(false); expect(engine.execute).not.toHaveBeenCalled();
  });
  it('retains running admission until cancelled engine child has joined', async () => {
    const lane = createPreparationEngineLane(); lane.activate(); const cancellation = signal();
    let join!: () => void, engineSignal!: AbortSignal;
    const engine: EngineExecutor = { close: vi.fn(), execute: vi.fn(async (_request, incoming) => { engineSignal = incoming; await new Promise<void>(resolve => { join = resolve; }); return response; }) };
    const done = lane.enqueue(request, cancellation.signal), rejected = expect(done).rejects.toMatchObject({ code: 'PREPARATION_CANCELLED' });
    const running = lane.runNext(engine, signal().signal); cancellation.abort();
    expect(engineSignal.aborted).toBe(true);
    await expect(lane.enqueue(request, signal().signal)).rejects.toMatchObject({ code: 'PREPARATION_ENGINE_BUSY' });
    expect(await lane.runNext(engine, signal().signal)).toBe(false);
    join(); await running; await rejected; lane.close();
  });
  it('bounds queue waiting and distinguishes the deadline from a manual cancellation', async () => {
    vi.useFakeTimers(); const lane = createPreparationEngineLane(); lane.activate();
    const done = lane.enqueue({ ...request, timeoutMilliseconds: 100 }, signal().signal), rejected = expect(done).rejects.toMatchObject({ code: 'PREPARATION_ENGINE_DEADLINE', status: 408 });
    await vi.advanceTimersByTimeAsync(1600); await rejected; expect(vi.getTimerCount()).toBe(0); lane.close();
  });
  it('worker shutdown cancels pending work and removes listeners/timers', async () => {
    vi.useFakeTimers(); const lane = createPreparationEngineLane(); lane.activate();
    const done = lane.enqueue(request, signal().signal), rejected = expect(done).rejects.toMatchObject({ code: 'PREPARATION_WORKER_UNAVAILABLE' });
    lane.close(); await rejected; expect(vi.getTimerCount()).toBe(0);
  });
  it('worker cancellation reaches active engine and discards its late successful response', async () => {
    const lane = createPreparationEngineLane(); lane.activate(); const worker = signal();
    const done = lane.enqueue(request, signal().signal), rejected = expect(done).rejects.toMatchObject({ code: 'PREPARATION_CANCELLED' });
    const engine = executor(async () => { worker.abort(); return response; });
    await lane.runNext(engine, worker.signal); await rejected; lane.close();
  });
  it('refuses a foreign engine response and recovers admission after a joined failure', async () => {
    const lane = createPreparationEngineLane(); lane.activate();
    const done = lane.enqueue(request, signal().signal), rejected = expect(done).rejects.toMatchObject({ code: 'ENGINE_RESPONSE_IDENTITY' });
    await lane.runNext(executor(async () => ({ ...response, requestId: '22222222-2222-4222-8222-222222222222' })), signal().signal); await rejected;
    const next = lane.enqueue(request, signal().signal); await lane.runNext(executor(), signal().signal); await expect(next).resolves.toEqual(response); lane.close();
  });
});
