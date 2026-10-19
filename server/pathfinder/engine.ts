import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PathFinderError } from './errors.js';
import { engineResponseSchema, type EngineResponse } from './jobContracts.js';
import { residentBytes, retainPreparationEngineObservation } from './engineResources.js';

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
    if (child.pid) observeSpawn?.(child.pid);
    const chunks:Buffer[] = []; let size = 0, errors = 0, stopped = false, closed = false, reason:unknown = null;
    let killing:Promise<void> | null = null;
    const stop = (error:unknown): void => {
      if (stopped || closed) return; stopped = true; reason = error;
      if (child.pid) killing = killTree(child.pid,() => child.kill('SIGKILL'));
    };
    const abort = ():void => stop(new PathFinderError('CALCULATION_CANCELLED',409,'Calculation was cancelled.'));
    let probing: Promise<void> | undefined, maximum = 0, samples = 0;
    const sample = () => {
      if (!preparation || closed || probing || !child.pid) return;
      probing = residentBytes(child.pid).then(bytes => {
        if (closed) return;
        samples++; maximum = Math.max(maximum, bytes);
        if (bytes > 2 * 1024 ** 3) stop(new PathFinderError('PREPARATION_ENGINE_RSS_LIMIT',413));
      }).catch(error => { if (!closed && child.exitCode === null && child.signalCode === null) stop(error); }).finally(() => { probing = undefined; });
    };
    const rssTimer = preparation ? setInterval(sample,100) : undefined;
    if (preparation) sample();
    const deadline = setTimeout(() => stop(new PathFinderError('ENGINE_DEADLINE',408,'Calculation exceeded its deadline.')),request.timeoutMilliseconds+1500);
    signal.addEventListener('abort',abort,{once:true});
    child.on('error',error => {reason = error;});
    child.stdin.on('error',error => stop(error));
    child.stdout.on('data',(chunk:Buffer) => {size += chunk.length; if (size > 32*1024*1024) stop(new PathFinderError('ENGINE_OUTPUT_BUDGET',413)); else chunks.push(chunk);});
    child.stderr.on('data',(chunk:Buffer) => {errors += chunk.length; if (errors > 65536) stop(new PathFinderError('ENGINE_ERROR_BUDGET',413));});
    child.on('close',async code => {
      closed = true; clearTimeout(deadline); clearInterval(rssTimer); signal.removeEventListener('abort',abort);
      if (probing) await probing;
      if (preparation) retainPreparationEngineObservation(request.requestId,{
        mode:'oneshot',thresholdBytes:2*1024**3,intervalMilliseconds:100,observedMaximumBytes:maximum,
        samples,wallMilliseconds:performance.now()-started,exactPeak:false,outcome:reason||code!==0?'refused':'completed',
      });
      if (killing) await killing;
      if (reason) {reject(reason); return;}
      if (code !== 0 || !size) {reject(new PathFinderError('ENGINE_PROCESS_FAILED',502)); return;}
      try {
        const result = engineResponseSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
        if (result.requestId !== request.requestId) throw new PathFinderError('ENGINE_RESPONSE_IDENTITY',502);
        resolve(result);
      } catch {reject(new PathFinderError('ENGINE_RESPONSE_INVALID',502));}
    });
    child.stdin.end(input);
    if (signal.aborted) abort();
  });
}
