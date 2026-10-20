// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mocked = vi.hoisted(() => ({ spawn: vi.fn(), residentBytes: vi.fn(), retain: vi.fn(), rssFailureDetail:vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocked.spawn, execFile: vi.fn((...args: unknown[]) => { const callback=args.at(-1);if(typeof callback==='function')callback(); }) }));
vi.mock('node:fs/promises', () => ({ default: { lstat: vi.fn(async () => ({ isFile: () => true, isSymbolicLink: () => false })) } }));
vi.mock('./engineResources.js', () => ({ residentBytes: mocked.residentBytes, retainPreparationEngineObservation: mocked.retain,getEngineRssFailureDetail:mocked.rssFailureDetail }));
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
  it('retains sanitized failed-probe and refusal/exit/close ordering without weakening a refusal before exit acknowledgement',async()=>{
    vi.useFakeTimers();vi.stubEnv('PF_ENGINE_DLL',process.platform==='win32'?'C:/owned/runner.dll':'/owned/runner.dll');
    const failure=Object.assign(new Error('private path and command must not be retained'),{code:'ENGINE_RSS_UNAVAILABLE'}),detail={stage:'root-rss',errno:null,role:'root',rootStatusPresent:true,rootState:'Z',enumeratedCount:9,retainedCount:1,statusReadCount:1};
    mocked.residentBytes.mockRejectedValue(failure);mocked.rssFailureDetail.mockReturnValue(detail);
    const child=Object.assign(new EventEmitter(),{pid:123456,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),exitCode:null as number|null,signalCode:null as string|null});mocked.spawn.mockReturnValue(child);vi.spyOn(process,'kill').mockImplementation(()=>true);
    const done=runEngine({requestId,operation:'prepare',timeoutMilliseconds:1000},new AbortController().signal),rejected=expect(done).rejects.toBe(failure);
    let settled=false;void done.then(()=>{settled=true;},()=>{settled=true;});await vi.advanceTimersByTimeAsync(25);expect(settled).toBe(false);
    child.exitCode=0;child.emit('exit',0,null);await vi.advanceTimersByTimeAsync(10);child.emit('close',0,null);await rejected;
    expect(mocked.rssFailureDetail).toHaveBeenCalledWith(failure);
    const observation=mocked.retain.mock.calls[0][1];expect(observation).toMatchObject({outcome:'refused',rssFailure:detail,lifecycle:{refusal:{exitCode:null,signalCode:null},exit:{exitCode:0,signalCode:null},close:{exitCode:0,signalCode:null}}});
    expect(observation.lifecycle.refusal.elapsedMilliseconds).toBeLessThanOrEqual(observation.lifecycle.exit.elapsedMilliseconds);expect(observation.lifecycle.exit.elapsedMilliseconds).toBeLessThanOrEqual(observation.lifecycle.close.elapsedMilliseconds);
    expect(JSON.stringify(observation)).not.toMatch(/private|123456|runner\.dll|dotnet|requestId/);expect(vi.getTimerCount()).toBe(0);
  });
  it('records a probe failure after known child exit while preserving the existing non-refusal branch and successful result',async()=>{
    vi.stubEnv('PF_ENGINE_DLL',process.platform==='win32'?'C:/owned/runner.dll':'/owned/runner.dll');
    let rejectProbe!:(error:Error)=>void;mocked.residentBytes.mockImplementation(()=>new Promise<number>((_resolve,reject)=>{rejectProbe=reject;}));
    const detail={stage:'root-rss',errno:null,role:'root',rootStatusPresent:false,rootState:null,enumeratedCount:5,retainedCount:1,statusReadCount:0};mocked.rssFailureDetail.mockReturnValue(detail);
    const child=Object.assign(new EventEmitter(),{pid:123456,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),exitCode:null as number|null,signalCode:null});mocked.spawn.mockReturnValue(child);const kill=vi.spyOn(process,'kill').mockImplementation(()=>true);
    const done=runEngine({requestId,operation:'prepare',timeoutMilliseconds:1000},new AbortController().signal);await Promise.resolve();await Promise.resolve();
    child.stdout.emit('data',Buffer.from(JSON.stringify({schemaVersion:'pathfinder.model.response.v1',requestId,status:'prepared',message:'',engineeringAccepted:false})));child.exitCode=0;child.emit('exit',0,null);rejectProbe(new Error('already exited private path'));await new Promise(resolve=>setImmediate(resolve));child.emit('close',0,null);
    await expect(done).resolves.toMatchObject({status:'prepared'});expect(kill).not.toHaveBeenCalled();expect(child.kill).not.toHaveBeenCalled();
    expect(mocked.retain).toHaveBeenCalledWith(requestId,expect.objectContaining({outcome:'completed',rssFailure:detail,lifecycle:expect.objectContaining({refusal:null,exit:expect.objectContaining({exitCode:0}),close:expect.objectContaining({exitCode:0})})}));
  });
  it('keeps lifecycle metadata bounded when child events carry unexpected diagnostic values',async()=>{
    vi.stubEnv('PF_ENGINE_DLL',process.platform==='win32'?'C:/owned/runner.dll':'/owned/runner.dll');mocked.residentBytes.mockResolvedValue(4096);
    const child=Object.assign(new EventEmitter(),{pid:undefined,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),exitCode:null,signalCode:null});mocked.spawn.mockReturnValue(child);
    const done=runEngine({requestId,operation:'prepare',timeoutMilliseconds:1000},new AbortController().signal),rejected=expect(done).rejects.toMatchObject({code:'ENGINE_PROCESS_FAILED'});await Promise.resolve();await Promise.resolve();
    child.emit('exit',Infinity,'secret path and arguments');child.emit('close',-1,'SIGKILL');await rejected;
    expect(mocked.retain).toHaveBeenCalledWith(requestId,expect.objectContaining({outcome:'refused',lifecycle:{refusal:expect.objectContaining({exitCode:-1,signalCode:'SIGKILL'}),exit:expect.objectContaining({exitCode:null,signalCode:'OTHER'}),close:expect.objectContaining({exitCode:-1,signalCode:'SIGKILL'})}}));
  });
  it.each(['helper','sink','both'] as const)('a throwing diagnostic %s preserves the original RSS refusal and joined settlement',async throwing=>{
    vi.stubEnv('PF_ENGINE_DLL',process.platform==='win32'?'C:/owned/runner.dll':'/owned/runner.dll');
    const failure=Object.assign(new Error('original RSS refusal'),{code:'ENGINE_RSS_UNAVAILABLE'});mocked.residentBytes.mockRejectedValue(failure);
    if(throwing!=='sink')mocked.rssFailureDetail.mockImplementation(()=>{throw new Error('diagnostic helper failure');});
    if(throwing!=='helper')mocked.retain.mockImplementation(()=>{throw new Error('diagnostic sink failure');});
    const child=Object.assign(new EventEmitter(),{pid:123456,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),exitCode:null as number|null,signalCode:null});mocked.spawn.mockReturnValue(child);vi.spyOn(process,'kill').mockImplementation(()=>true);
    const done=runEngine({requestId,operation:'prepare',timeoutMilliseconds:1000},new AbortController().signal),rejected=expect(done).rejects.toBe(failure);
    let settled=false;void done.then(()=>{settled=true;},()=>{settled=true;});await new Promise(resolve=>setImmediate(resolve));expect(settled).toBe(false);
    child.exitCode=0;child.emit('exit',0,null);child.emit('close',0,null);await rejected;
    expect(mocked.rssFailureDetail).toHaveBeenCalledWith(failure);expect(mocked.retain).toHaveBeenCalledWith(requestId,expect.objectContaining({outcome:'refused'}));
  });
  it.each(['helper','sink','both'] as const)('a throwing diagnostic %s preserves a successful response after the already-known exit',async throwing=>{
    vi.stubEnv('PF_ENGINE_DLL',process.platform==='win32'?'C:/owned/runner.dll':'/owned/runner.dll');
    let rejectProbe!:(error:Error)=>void;mocked.residentBytes.mockImplementation(()=>new Promise<number>((_resolve,reject)=>{rejectProbe=reject;}));
    if(throwing!=='sink')mocked.rssFailureDetail.mockImplementation(()=>{throw new Error('diagnostic helper failure');});
    if(throwing!=='helper')mocked.retain.mockImplementation(()=>{throw new Error('diagnostic sink failure');});
    const child=Object.assign(new EventEmitter(),{pid:123456,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),exitCode:null as number|null,signalCode:null});mocked.spawn.mockReturnValue(child);const kill=vi.spyOn(process,'kill').mockImplementation(()=>true);
    const done=runEngine({requestId,operation:'prepare',timeoutMilliseconds:1000},new AbortController().signal);await Promise.resolve();await Promise.resolve();
    child.stdout.emit('data',Buffer.from(JSON.stringify({schemaVersion:'pathfinder.model.response.v1',requestId,status:'prepared',message:'',engineeringAccepted:false})));child.exitCode=0;child.emit('exit',0,null);rejectProbe(new Error('probe failed after known exit'));await new Promise(resolve=>setImmediate(resolve));child.emit('close',0,null);
    await expect(done).resolves.toMatchObject({status:'prepared'});expect(kill).not.toHaveBeenCalled();expect(child.kill).not.toHaveBeenCalled();expect(mocked.retain).toHaveBeenCalledWith(requestId,expect.objectContaining({outcome:'completed'}));
  });
});
