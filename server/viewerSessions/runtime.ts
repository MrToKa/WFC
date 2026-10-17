import { pool } from '../db.js';
import { createModelStorage } from '../modelRegistry/storage.js';
import { createViewerSessionService } from './service.js';
import { ViewerSessionError } from './errors.js';

export function createViewerRuntime(options: {
  service: ReturnType<typeof createViewerSessionService>;
  storage: Pick<ReturnType<typeof createModelStorage>,'readVerifiedResource'>;
}) {
  let stopped = false,spools = 0,spoolBytes = 0;
  const active = new Map<AbortController,Promise<unknown>>();
  return {
    ...options,
    async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (stopped) throw new ViewerSessionError('VIEWER_STOPPED',503);
      const controller = new AbortController();
      const promise = Promise.resolve().then(() => work(controller.signal));
      active.set(controller,promise);
      try { return await promise; } finally { active.delete(controller); }
    },
    async resource<T>(bytes: number,work: () => Promise<T>): Promise<T> {
      if (stopped) throw new ViewerSessionError('VIEWER_STOPPED',503);
      if (spools >= 16 || spoolBytes + bytes > 8*1024**3) throw new ViewerSessionError('VIEWER_BUSY',503);
      spools++; spoolBytes += bytes;
      try { return await work(); } finally { spools--; spoolBytes -= bytes; }
    },
    async close(): Promise<void> {
      stopped = true;
      for (const controller of active.keys()) controller.abort();
      while (active.size) await Promise.allSettled([...active.values()]);
    },
  };
}
export type ViewerRuntime = ReturnType<typeof createViewerRuntime>;
let runtime: ViewerRuntime | undefined;
export function getViewerRuntime(): ViewerRuntime {
  return runtime ??= createViewerRuntime({ service: createViewerSessionService({pool}),storage: createModelStorage() });
}
export async function stopViewerSessions(): Promise<void> { await runtime?.close(); }
