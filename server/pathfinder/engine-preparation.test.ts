// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mocked = vi.hoisted(() => ({ spawn: vi.fn(), residentBytes: vi.fn(), retain: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocked.spawn, execFile: vi.fn((...args: unknown[]) => { const callback=args.at(-1);if(typeof callback==='function')callback(); }) }));
vi.mock('node:fs/promises', () => ({ default: { lstat: vi.fn(async () => ({ isFile: () => true, isSymbolicLink: () => false })) } }));
vi.mock('./engineResources.js', () => ({ residentBytes: mocked.residentBytes, retainPreparationEngineObservation: mocked.retain }));
import { runEngine } from './engine.js';
const requestId = '11111111-1111-4111-8111-111111111111';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe('joined preparation child and RSS probe fencing', () => {
  it('detaches cancellation/deadline before awaiting a delayed read-only RSS probe', async () => {
    vi.useFakeTimers(); vi.stubEnv('PF_ENGINE_DLL', process.platform === 'win32' ? 'C:/owned/runner.dll' : '/owned/runner.dll');
    let probe!: (bytes: number) => void; mocked.residentBytes.mockImplementation(() => new Promise<number>(resolve => { probe = resolve; }));
    const child = Object.assign(new EventEmitter(), { pid: 123456, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), exitCode: null as number | null, signalCode: null });
    mocked.spawn.mockReturnValue(child);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true), controller = new AbortController();
    const done = runEngine({ requestId, operation: 'prepare', timeoutMilliseconds: 100 }, controller.signal);
    await Promise.resolve(); await Promise.resolve();
    child.stdout.emit('data', Buffer.from(JSON.stringify({ schemaVersion: 'pathfinder.model.response.v1', requestId, status: 'prepared', message: '', engineeringAccepted: false })));
    child.exitCode = 0; child.emit('close', 0);
    controller.abort(); await vi.advanceTimersByTimeAsync(5000);
    expect(kill).not.toHaveBeenCalled(); expect(child.kill).not.toHaveBeenCalled();
    probe(4096); await expect(done).resolves.toMatchObject({ status: 'prepared' });
    expect(mocked.retain).toHaveBeenCalledWith(requestId, expect.objectContaining({ exactPeak: false, outcome: 'completed' }));
    expect(vi.getTimerCount()).toBe(0);
  });
  it('settles a failed spawn without attempting to sample a nonexistent process', async () => {
    vi.stubEnv('PF_ENGINE_DLL', process.platform === 'win32' ? 'C:/owned/runner.dll' : '/owned/runner.dll');
    mocked.residentBytes.mockResolvedValue(2 * 1024 ** 3 + 1);
    const child = Object.assign(new EventEmitter(), { pid: undefined, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), exitCode: null, signalCode: null });
    // A spawn without a process ID cannot be sampled; process failure must still settle normally.
    mocked.spawn.mockReturnValue(child);
    const done = runEngine({ requestId, operation: 'prepare', timeoutMilliseconds: 1000 }, new AbortController().signal);
    const rejected = expect(done).rejects.toMatchObject({ code: 'ENGINE_PROCESS_FAILED' });
    await Promise.resolve(); await Promise.resolve(); child.emit('close', 1); await rejected;
    expect(mocked.residentBytes).not.toHaveBeenCalled();
  });
  it('refuses excessive sampled RSS and settles only after the child closes', async () => {
    vi.stubEnv('PF_ENGINE_DLL', process.platform === 'win32' ? 'C:/owned/runner.dll' : '/owned/runner.dll');
    mocked.residentBytes.mockResolvedValue(2 * 1024 ** 3 + 1);
    const child = Object.assign(new EventEmitter(), { pid: 123456, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), exitCode: null, signalCode: null });
    mocked.spawn.mockReturnValue(child);vi.spyOn(process,'kill').mockImplementation(()=>true);
    const done = runEngine({requestId,operation:'prepare',timeoutMilliseconds:1000},new AbortController().signal);
    const rejected=expect(done).rejects.toMatchObject({code:'PREPARATION_ENGINE_RSS_LIMIT'});
    await new Promise(resolve=>setImmediate(resolve));child.emit('close',1);await rejected;
    expect(mocked.retain).toHaveBeenCalledWith(requestId,expect.objectContaining({outcome:'refused',observedMaximumBytes:2*1024**3+1}));
  });
});
