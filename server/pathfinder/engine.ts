import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PathFinderError } from './errors.js';
import { engineResponseSchema, type EngineResponse } from './jobContracts.js';
import { residentBytes, retainPreparationEngineObservation, getEngineRssFailureDetail, type PreparationEngineObservation } from './engineResources.js';

type EngineLifecycle=NonNullable<PreparationEngineObservation['lifecycle']>;
const observedSignals=new Set(['SIGHUP','SIGINT','SIGQUIT','SIGILL','SIGTRAP','SIGABRT','SIGIOT','SIGBUS','SIGFPE','SIGKILL','SIGUSR1','SIGSEGV','SIGUSR2','SIGPIPE','SIGALRM','SIGTERM','SIGSTKFLT','SIGCHLD','SIGCONT','SIGSTOP','SIGTSTP','SIGTTIN','SIGTTOU','SIGURG','SIGXCPU','SIGXFSZ','SIGVTALRM','SIGPROF','SIGWINCH','SIGIO','SIGPOLL','SIGPWR','SIGSYS','SIGUNUSED','SIGBREAK','SIGLOST','SIGINFO']);
const observedExitCode=(value:unknown):number|null=>typeof value==='number'&&Number.isInteger(value)&&value>=-2147483648&&value<=2147483647?value:null;
const observedSignal=(value:unknown):string|null=>value===null||value===undefined?null:typeof value==='string'&&observedSignals.has(value)?value:'OTHER';

async function killTree(pid: number, kill: () => boolean): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => execFile('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,timeout:10_000},() => resolve()));
  } else {
    try { process.kill(-pid,'SIGKILL'); } catch { kill(); }
  }
}
/** Private owned child only; no shell, client executable, path, credentials or stdout logging. */
export async function runEngine(request: Record<string,unknown> & {requestId:string;timeoutMilliseconds:number}, signal: AbortSignal, observeSpawn?:(pid:number) => void): Promise<EngineResponse> {
  const dll = process.env.PF_ENGINE_DLL;
  if (!dll || !path.isAbsolute(dll)) throw new PathFinderError('PATHFINDER_ENGINE_NOT_CONFIGURED',503);
  const stat = await fs.lstat(dll);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new PathFinderError('PATHFINDER_ENGINE_NOT_CONFIGURED',503);
  const input = Buffer.from(JSON.stringify(request));
  if (input.length > 1024 * 1024) throw new PathFinderError('ENGINE_INPUT_BUDGET',413);
  signal.throwIfAborted();
  return new Promise<EngineResponse>((resolve,reject) => {
    const started = performance.now(), preparation = request.operation === 'prepare';
    const child = spawn('dotnet',[dll],{stdio:['pipe','pipe','pipe'],windowsHide:true,detached:process.platform !== 'win32',env:process.env});
    const ownedPid=child.pid;
    if (child.pid) observeSpawn?.(child.pid);
    const chunks:Buffer[] = []; let size = 0, errors = 0, stopped = false, closed = false, reason:unknown = null;
    const checkpoint=(code:unknown,signalCode:unknown):EngineLifecycle['close']=>({elapsedMilliseconds:performance.now()-started,exitCode:observedExitCode(code),signalCode:observedSignal(signalCode)});
    let refusal:EngineLifecycle['refusal']=null,exit:EngineLifecycle['exit']=null,rssFailure:PreparationEngineObservation['rssFailure'];
    let rawExit:{code:unknown;signalCode:unknown}|undefined,terminalFailure:unknown=null,terminalExpiresAt=0,originalDeadlineAt=0,terminalReconciled=false;
    let terminalTimer:ReturnType<typeof setTimeout>|undefined;
    const clearTerminalTimer=():void=>{if(terminalTimer!==undefined){clearTimeout(terminalTimer);terminalTimer=undefined;}};
    let killing:Promise<void> | null = null;
    const stop = (error:unknown): void => {
      if (stopped || closed) return; stopped = true; reason = error;
      clearTerminalTimer();
      if(preparation)refusal??=checkpoint(child.exitCode,child.signalCode);
      if (child.pid) killing = killTree(child.pid,() => child.kill('SIGKILL'));
    };
    const abort = ():void => stop(new PathFinderError('CALCULATION_CANCELLED',409,'Calculation was cancelled.'));
    let probing: Promise<void> | undefined, maximum = 0, samples = 0;
    const sample = () => {
      if (!preparation || closed || probing || terminalFailure!==null || !child.pid) return;
      probing = residentBytes(child.pid).then(bytes => {
        if (closed) return;
        samples++; maximum = Math.max(maximum, bytes);
        if (bytes > 2 * 1024 ** 3) stop(new PathFinderError('PREPARATION_ENGINE_RSS_LIMIT',413));
      }).catch(error => {
        let detail:PreparationEngineObservation['rssFailure'];
        try { detail=getEngineRssFailureDetail(error)??undefined;rssFailure??=detail; } catch { /* Diagnostic extraction cannot replace the original refusal. */ }
        if (!closed && child.exitCode === null && child.signalCode === null) {
          // A missing terminal-root sample is not a zero-byte sample. Only this
          // exact owned Linux zombie race may wait briefly for normal child close.
          if(process.platform==='linux'&&!stopped&&!reason&&!signal.aborted&&samples>0&&ownedPid===child.pid&&typeof ownedPid==='number'&&Number.isSafeInteger(ownedPid)&&ownedPid>0&&rawExit===undefined&&error instanceof PathFinderError&&error.code==='ENGINE_RSS_UNAVAILABLE'&&detail?.stage==='root-rss'&&detail.errno===null&&detail.role==='root'&&detail.rootStatusPresent===true&&detail.rootState==='Z'&&detail.retainedCount===1&&detail.statusReadCount===1&&detail.enumeratedCount>=1){
            terminalFailure=error;terminalExpiresAt=Math.min(performance.now()+1000,originalDeadlineAt);
            // The original deadline remains armed. If it is the earlier bound,
            // it alone wins; a grace timer never renews or replaces that deadline.
            const remaining=originalDeadlineAt-performance.now();
            if(remaining<=0)stop(new PathFinderError('ENGINE_DEADLINE',408,'Calculation exceeded its deadline.'));
            else if(remaining>1000)terminalTimer=setTimeout(()=>{if(!closed&&!stopped)stop(error);},Math.max(0,terminalExpiresAt-performance.now()));
          }else stop(error);
        }
      }).finally(() => { probing = undefined; });
    };
    const rssTimer = preparation ? setInterval(sample,100) : undefined;
    if (preparation) sample();
    originalDeadlineAt=performance.now()+request.timeoutMilliseconds+1500;
    const deadline = setTimeout(() => stop(new PathFinderError('ENGINE_DEADLINE',408,'Calculation exceeded its deadline.')),request.timeoutMilliseconds+1500);
    signal.addEventListener('abort',abort,{once:true});
    child.on('error',error => {if(preparation)refusal??=checkpoint(child.exitCode,child.signalCode);reason = error;});
    child.on('exit',(code,signalCode) => {if(preparation){rawExit={code,signalCode};exit=checkpoint(code,signalCode);}});
    child.stdin.on('error',error => stop(error));
    child.stdout.on('data',(chunk:Buffer) => {size += chunk.length; if (size > 32*1024*1024) stop(new PathFinderError('ENGINE_OUTPUT_BUDGET',413)); else chunks.push(chunk);});
    child.stderr.on('data',(chunk:Buffer) => {errors += chunk.length; if (errors > 65536) stop(new PathFinderError('ENGINE_ERROR_BUDGET',413));});
    child.on('close',async (code,signalCode) => {
      const close=preparation?checkpoint(code,signalCode):undefined;
      let terminalCandidate=false;
      if(terminalFailure!==null&&!reason){
        let groupGone=false;
        if(code===0&&signalCode===null&&rawExit?.code===0&&rawExit.signalCode===null&&child.exitCode===0&&child.signalCode===null&&ownedPid&&performance.now()<=terminalExpiresAt){
          try{process.kill(-ownedPid,0);}catch(error){try{groupGone=(error as NodeJS.ErrnoException)?.code==='ESRCH';}catch{/* Unknown absence proof refuses. */}}
        }
        if(signal.aborted)abort();
        else if(performance.now()>=originalDeadlineAt)stop(new PathFinderError('ENGINE_DEADLINE',408,'Calculation exceeded its deadline.'));
        else if(groupGone)terminalCandidate=true;
        else stop(terminalFailure);
      }
      clearTerminalTimer();
      closed = true; clearTimeout(deadline); clearInterval(rssTimer); signal.removeEventListener('abort',abort);
      if (probing) await probing;
      const retainObservation=():void=>{if (preparation) {
        try {
          retainPreparationEngineObservation(request.requestId,{
            mode:'oneshot',thresholdBytes:2*1024**3,intervalMilliseconds:100,observedMaximumBytes:maximum,
            samples,wallMilliseconds:performance.now()-started,exactPeak:false,outcome:reason||code!==0?'refused':'completed',
            ...(rssFailure?{rssFailure}:{}),lifecycle:{refusal:refusal??(code!==0?close!:null),exit,close:close!},
            ...(terminalReconciled?{rssTerminalReconciled:true}:{}),
          });
        } catch { /* An optional diagnostic sink cannot change child settlement. */ }
      }};
      retainObservation();
      if (killing) await killing;
      if (reason) {reject(reason); return;}
      const deferredRefusal=():unknown=>signal.aborted?new PathFinderError('CALCULATION_CANCELLED',409,'Calculation was cancelled.'):performance.now()>=originalDeadlineAt?new PathFinderError('ENGINE_DEADLINE',408,'Calculation exceeded its deadline.'):terminalFailure;
      const rejectDeferred=(error:unknown):void=>{reason=error;refusal??=checkpoint(child.exitCode,child.signalCode);retainObservation();reject(error);};
      if(terminalCandidate&&(signal.aborted||performance.now()>=originalDeadlineAt||performance.now()>terminalExpiresAt)){rejectDeferred(deferredRefusal());return;}
      if (code !== 0 || !size) {if(terminalCandidate)rejectDeferred(deferredRefusal());else reject(new PathFinderError('ENGINE_PROCESS_FAILED',502));return;}
      try {
        const result = engineResponseSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
        if (result.requestId !== request.requestId) throw new PathFinderError('ENGINE_RESPONSE_IDENTITY',502);
        if ((request.schemaVersion === 'pathfinder.model.runner.v2') !== (result.schemaVersion === 'pathfinder.model.response.v3'))
          throw new PathFinderError('ENGINE_RESPONSE_VERSION',502);
        if(terminalCandidate){
          if(signal.aborted||performance.now()>=originalDeadlineAt||performance.now()>terminalExpiresAt){rejectDeferred(deferredRefusal());return;}
          terminalReconciled=true;retainObservation();
        }
        resolve(result);
      } catch {if(terminalCandidate)rejectDeferred(deferredRefusal());else reject(new PathFinderError('ENGINE_RESPONSE_INVALID',502));}
    });
    child.stdin.end(input);
    if (signal.aborted) abort();
  });
}
