import { pool } from '../db.js';
import { createPathFinderRepository } from './repository.js';
import { createPathFinderJobs } from './jobs.js';
import { createPathFinderApply } from './apply.js';
import { createPathFinderWorker } from './worker.js';
import { pathFinderRoot } from './storage.js';
import { createPathFinderLookups } from './lookups.js';
import { createPathFinderPreviews } from './previews.js';
import { createPreparationService } from './preparationSessions.js';
import { createPreparationPublisher } from './preparationPublisher.js';

let runtime:ReturnType<typeof createRuntime>|undefined;
function createRuntime() {
  const registry = createPathFinderRepository(pool),jobs = createPathFinderJobs(pool,registry),apply = createPathFinderApply(pool),worker = createPathFinderWorker(pool,jobs);
  return {registry,jobs,apply,worker,lookups:createPathFinderLookups(pool),previews:createPathFinderPreviews(pool),
    preparations:createPreparationService(pool,createPreparationPublisher(worker.executePreparation))};
}
export function getPathFinderRuntime() {return runtime ??= createRuntime();}
export async function initializePathFinderRuntime():Promise<void> {
  if (!process.env.PF_ROOT || !process.env.PF_ENGINE_DLL) return;
  await pathFinderRoot(); getPathFinderRuntime().worker.start();
}
export async function stopPathFinderRuntime():Promise<void> {await runtime?.worker.stop();}
