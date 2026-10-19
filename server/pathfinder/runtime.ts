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
import { createGeometryTraceRepository } from './geometryTraceRepository.js';
import { createGeometryTraceEngine } from './geometryTraceEngine.js';
import { createEndpointBindingRepository } from './endpointBindingRepository.js';
import { createRevisionComparisonRepository } from './revisionComparisonRepository.js';
import { createRevisionEndpointAdapters } from './revisionComparisonEndpointAdapter.js';
import { createRecalculationRepository } from './recalculationRepository.js';
import { createRecalculationProducer } from './recalculationProducer.js';
import { createCalculationEngineObserver } from './calculationEngineObserver.js';

let runtime:ReturnType<typeof createRuntime>|undefined;
function createRuntime() {
  const registry = createPathFinderRepository(pool),jobs = createPathFinderJobs(pool,registry),apply = createPathFinderApply(pool),worker = createPathFinderWorker(pool,jobs);
  const recalculations=createRecalculationRepository(pool,jobs);
  const producer=createRecalculationProducer(recalculations,{beforeTick:createCalculationEngineObserver(pool,()=>worker.failureCode)});
  return {registry,jobs,apply,worker,recalculations,producer,lookups:createPathFinderLookups(pool),previews:createPathFinderPreviews(pool),
    preparations:createPreparationService(pool,createPreparationPublisher(worker.executePreparation)),
    geometryTraces:createGeometryTraceRepository(pool,createGeometryTraceEngine(worker.executePreparation)),
    endpointBindings:createEndpointBindingRepository(pool,createRevisionEndpointAdapters()),
    revisionComparisons:createRevisionComparisonRepository(pool)};
}
export function getPathFinderRuntime() {return runtime ??= createRuntime();}
export async function initializePathFinderRuntime():Promise<void> {
  if (!process.env.PF_ROOT || !process.env.PF_ENGINE_DLL) return;
  await pathFinderRoot();const active=getPathFinderRuntime();active.worker.start();active.producer.start();
}
export async function stopPathFinderRuntime():Promise<void> {await runtime?.producer.stop();await runtime?.worker.stop();}
