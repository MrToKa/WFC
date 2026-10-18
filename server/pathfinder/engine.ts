import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PathFinderError } from './errors.js';
import { engineResponseSchema, type EngineResponse } from './jobContracts.js';

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
    const child = spawn('dotnet',[dll],{stdio:['pipe','pipe','pipe'],windowsHide:true,detached:process.platform !== 'win32',env:process.env});
    if (child.pid) observeSpawn?.(child.pid);
    const chunks:Buffer[] = []; let size = 0, errors = 0, stopped = false, reason:unknown = null;
    let killing:Promise<void> | null = null;
    const stop = (error:unknown): void => {
      if (stopped) return; stopped = true; reason = error;
      if (child.pid) killing = killTree(child.pid,() => child.kill('SIGKILL'));
    };
    const abort = ():void => stop(new PathFinderError('CALCULATION_CANCELLED',409,'Calculation was cancelled.'));
    const deadline = setTimeout(() => stop(new PathFinderError('ENGINE_DEADLINE',408,'Calculation exceeded its deadline.')),request.timeoutMilliseconds+1500);
    signal.addEventListener('abort',abort,{once:true});
    child.on('error',error => {reason = error;});
    child.stdin.on('error',error => stop(error));
    child.stdout.on('data',(chunk:Buffer) => {size += chunk.length; if (size > 32*1024*1024) stop(new PathFinderError('ENGINE_OUTPUT_BUDGET',413)); else chunks.push(chunk);});
    child.stderr.on('data',(chunk:Buffer) => {errors += chunk.length; if (errors > 65536) stop(new PathFinderError('ENGINE_ERROR_BUDGET',413));});
    child.on('close',async code => {
      clearTimeout(deadline); signal.removeEventListener('abort',abort);
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
