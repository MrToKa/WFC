// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mocked = vi.hoisted(() => ({ spawn: vi.fn(), residentBytes: vi.fn(), retain: vi.fn(), rssFailureDetail:vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocked.spawn, execFile: vi.fn((...args: unknown[]) => { const callback=args.at(-1);if(typeof callback==='function')callback(); }) }));
vi.mock('node:fs/promises', () => ({ default: { lstat: vi.fn(async () => ({ isFile: () => true, isSymbolicLink: () => false })) } }));
vi.mock('./engineResources.js', () => ({ residentBytes: mocked.residentBytes, retainPreparationEngineObservation: mocked.retain,getEngineRssFailureDetail:mocked.rssFailureDetail }));
import { runEngine } from './engine.js';
import {PathFinderError} from './errors.js';
import type {RssFailureDetail} from './engineResources.js';
const requestId = '11111111-1111-4111-8111-111111111111';
const originalPlatform=Object.getOwnPropertyDescriptor(process,'platform')!;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetAllMocks();Object.defineProperty(process,'platform',originalPlatform); });

async function terminalFixture(options:{detail?:Partial<RssFailureDetail>;priorSample?:boolean;timeoutMilliseconds?:number;response?:unknown}={}){
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval','Date','performance']});Object.defineProperty(process,'platform',{...originalPlatform,value:'linux'});vi.stubEnv('PF_ENGINE_DLL','/owned/runner.dll');
  const failure=new PathFinderError('ENGINE_RSS_UNAVAILABLE',502),detail:RssFailureDetail={stage:'root-rss',errno:null,role:'root',rootStatusPresent:true,rootState:'Z',enumeratedCount:3,retainedCount:1,statusReadCount:1,...options.detail};
  mocked.rssFailureDetail.mockReturnValue(detail);if(options.priorSample!==false)mocked.residentBytes.mockResolvedValueOnce(4096);mocked.residentBytes.mockRejectedValue(failure);
  const child=Object.assign(new EventEmitter(),{pid:123456,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(),exitCode:null as number|null,signalCode:null as string|null});mocked.spawn.mockReturnValue(child);
  const kill=vi.spyOn(process,'kill').mockImplementation((_pid,signal)=>{if(signal===0)throw Object.assign(new Error('owned group absent'),{code:'ESRCH'});return true;}),controller=new AbortController();
  const done=runEngine({requestId,operation:'prepare',timeoutMilliseconds:options.timeoutMilliseconds??5000},controller.signal);let settled=false;void done.then(()=>{settled=true;},()=>{settled=true;});await Promise.resolve();await Promise.resolve();
  const response=options.response===undefined?{schemaVersion:'pathfinder.model.response.v1',requestId,status:'prepared',message:'',engineeringAccepted:false}:options.response;
  if(response!==null)child.stdout.emit('data',Buffer.from(typeof response==='string'?response:JSON.stringify(response)));
  const close=(code:number|null=0,signalCode:string|null=null,acknowledge=true):void=>{child.exitCode=code;child.signalCode=signalCode;if(acknowledge)child.emit('exit',code,signalCode);child.emit('close',code,signalCode);};
  return{child,kill,controller,done,failure,detail,close,get settled(){return settled;}};
}
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

describe('strict terminal-root measurement reconciliation',()=>{
  it('reconciles only the sampled own-root zombie race after acknowledged clean close, positive group absence and complete strict response',async()=>{
    const f=await terminalFixture();await vi.advanceTimersByTimeAsync(100);expect(f.settled).toBe(false);expect(f.kill).not.toHaveBeenCalled();
    f.close();await expect(f.done).resolves.toMatchObject({status:'prepared',engineeringAccepted:false});
    expect(f.kill).toHaveBeenCalledExactlyOnceWith(-f.child.pid,0);expect(f.child.kill).not.toHaveBeenCalled();
    expect(mocked.retain.mock.calls.at(-1)?.[1]).toMatchObject({outcome:'completed',rssTerminalReconciled:true,samples:1,observedMaximumBytes:4096,rssFailure:f.detail,lifecycle:{refusal:null,exit:{exitCode:0,signalCode:null},close:{exitCode:0,signalCode:null}}});expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    {stage:'proc-status'},{role:'descendant'},{errno:'EACCES'},{errno:'EPERM'},{errno:'ESRCH'},{errno:'OTHER'},
    {rootStatusPresent:false},{rootState:'R'},{rootState:'S'},{rootState:'X'},{rootState:'x'},{rootState:null},{retainedCount:2},{statusReadCount:0},{statusReadCount:2},{enumeratedCount:0},
  ] satisfies Partial<RssFailureDetail>[])('refuses mismatched terminal evidence %j without probing group absence',async detail=>{
    const f=await terminalFixture({detail});await vi.advanceTimersByTimeAsync(100);f.close();await expect(f.done).rejects.toBe(f.failure);
    expect(f.kill.mock.calls.some(([_pid,signal])=>signal===0)).toBe(false);expect(mocked.retain.mock.calls.at(-1)?.[1]).toMatchObject({outcome:'refused'});expect(mocked.retain.mock.calls.at(-1)?.[1].rssTerminalReconciled).toBeUndefined();
  });
  it.each(['win32','darwin'] as const)('never reconciles terminal metadata on unsupported %s',async platform=>{
    const f=await terminalFixture();Object.defineProperty(process,'platform',{...originalPlatform,value:platform});await vi.advanceTimersByTimeAsync(100);f.close();await expect(f.done).rejects.toBe(f.failure);expect(f.kill.mock.calls.some(([_pid,signal])=>signal===0)).toBe(false);
  });
  it('requires at least one preceding valid RSS sample and never invents a zero sample',async()=>{
    const f=await terminalFixture({priorSample:false});await vi.advanceTimersByTimeAsync(0);f.close();await expect(f.done).rejects.toBe(f.failure);
    expect(mocked.retain.mock.calls.at(-1)?.[1]).toMatchObject({outcome:'refused',samples:0,observedMaximumBytes:0});expect(mocked.retain.mock.calls.at(-1)?.[1].rssTerminalReconciled).toBeUndefined();expect(f.kill.mock.calls.some(([_pid,signal])=>signal===0)).toBe(false);
  });
  it.each(['nonzero-exit','unknown-exit','no-exit-event','signalled-exit','unknown-close-code','unknown-close-signal','unknown-exit-signal'] as const)('keeps the original RSS refusal for %s',async kind=>{
    const f=await terminalFixture();await vi.advanceTimersByTimeAsync(100);
    if(kind==='nonzero-exit')f.close(1);else if(kind==='unknown-exit')f.close(null);else if(kind==='no-exit-event')f.close(0,null,false);else if(kind==='signalled-exit')f.close(null,'SIGTERM');else{
      f.child.exitCode=0;f.child.emit('exit',0,kind==='unknown-exit-signal'?undefined:null);f.child.emit('close',kind==='unknown-close-code'?undefined:0,kind==='unknown-close-signal'?undefined:null);
    }
    await expect(f.done).rejects.toBe(f.failure);expect(f.kill.mock.calls.some(([_pid,signal])=>signal===0)).toBe(false);expect(mocked.retain.mock.calls.at(-1)?.[1].rssTerminalReconciled).toBeUndefined();
  });
  it.each(['alive','EPERM','EACCES','ENOENT','OTHER','missing-code'] as const)('requires ESRCH positive group absence rather than %s',async proof=>{
    const f=await terminalFixture();f.kill.mockImplementation((_pid,signal)=>{if(signal===0&&proof!=='alive')throw Object.assign(new Error('absence not proven'),proof==='missing-code'?{}:{code:proof});return true;});
    await vi.advanceTimersByTimeAsync(100);f.close();await expect(f.done).rejects.toBe(f.failure);expect(f.kill).toHaveBeenCalledWith(-f.child.pid,0);expect(f.kill).toHaveBeenCalledWith(-f.child.pid,'SIGKILL');expect(mocked.retain.mock.calls.at(-1)?.[1].rssTerminalReconciled).toBeUndefined();
  });
  it('does not renew the one-second terminal grace or settle before kill and child close',async()=>{
    const f=await terminalFixture();await vi.advanceTimersByTimeAsync(100);await vi.advanceTimersByTimeAsync(999);expect(f.kill).not.toHaveBeenCalled();expect(f.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);expect(f.kill).toHaveBeenCalledWith(-f.child.pid,'SIGKILL');expect(f.settled).toBe(false);expect(mocked.residentBytes).toHaveBeenCalledTimes(2);
    f.close();await expect(f.done).rejects.toBe(f.failure);expect(mocked.retain.mock.calls.at(-1)?.[1].rssTerminalReconciled).toBeUndefined();expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves cancellation during terminal grace and never accepts a later successful close',async()=>{
    const f=await terminalFixture();await vi.advanceTimersByTimeAsync(100);f.controller.abort();f.close();await expect(f.done).rejects.toMatchObject({code:'CALCULATION_CANCELLED'});expect(mocked.retain.mock.calls.at(-1)?.[1].rssTerminalReconciled).toBeUndefined();expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves the unchanged original deadline when it occurs before one second of terminal grace',async()=>{
    const f=await terminalFixture({timeoutMilliseconds:1});let laterSamples=0;mocked.residentBytes.mockImplementation(async()=>{if(++laterSamples===10)throw f.failure;return 4096;});
    await vi.advanceTimersByTimeAsync(1000);expect(f.kill).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(500);expect(f.kill).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(f.kill).toHaveBeenCalledWith(-f.child.pid,'SIGKILL');f.close();await expect(f.done).rejects.toMatchObject({code:'ENGINE_DEADLINE'});expect(mocked.retain.mock.calls.at(-1)?.[1].rssTerminalReconciled).toBeUndefined();expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps an output-budget refusal established during terminal grace',async()=>{
    const f=await terminalFixture();await vi.advanceTimersByTimeAsync(100);f.child.stdout.emit('data',{length:32*1024**2+1});f.close();await expect(f.done).rejects.toMatchObject({code:'ENGINE_OUTPUT_BUDGET'});expect(mocked.retain.mock.calls.at(-1)?.[1].rssTerminalReconciled).toBeUndefined();
  });
  it.each([null,'not-json',{schemaVersion:'wrong',requestId,status:'prepared'},{schemaVersion:'pathfinder.model.response.v1',requestId:'22222222-2222-4222-8222-222222222222',status:'prepared',message:'',engineeringAccepted:false}])('does not reconcile an empty, malformed, foreign-schema or foreign-request response %j',async response=>{
    const f=await terminalFixture({response});await vi.advanceTimersByTimeAsync(100);f.close();await expect(f.done).rejects.toBe(f.failure);expect(mocked.retain.mock.calls.at(-1)?.[1]).toMatchObject({outcome:'refused',rssFailure:f.detail});expect(mocked.retain.mock.calls.at(-1)?.[1].rssTerminalReconciled).toBeUndefined();
  });
  it('rechecks cancellation after close cleanup before committing a reconciliation success',async()=>{
    const f=await terminalFixture();
    mocked.rssFailureDetail.mockImplementation(()=>{queueMicrotask(()=>{f.close();f.controller.abort();});return f.detail;});
    // Close runs after the qualifying catch but before its finally settles the
    // probe, exercising the existing close-await-probe cancellation window.
    await vi.advanceTimersByTimeAsync(100);await expect(f.done).rejects.toMatchObject({code:'CALCULATION_CANCELLED'});expect(mocked.retain.mock.calls.at(-1)?.[1].rssTerminalReconciled).toBeUndefined();
  });
});
