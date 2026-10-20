import { pool } from '../db.js';
import { LEGACY_PREPARATION_CAPACITY_PROFILE, preparationCapacityProfileSchema } from '../../shared/pathfinderCapacity.js';
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
import { createCalculationGrantRepository } from './calculationGrantRepository.js';
import { applyCalculationGrantCommand } from './calculationGrantIntegration.js';
import { createProducerResourceService } from './producerResourceService.js';
import { getViewerRuntime } from '../viewerSessions/runtime.js';
import { createGrantRecalculationProducer } from './grantRecalculationProducer.js';
import {createManagedProducerControl,type ManagedControlConfiguration} from './managedProducerControl.js';
import {createProducerQualification} from './producerQualification.js';
import {createManagedPreparationProducer} from './managedPreparationProducer.js';
import {createGrantPreparedMaintenance} from './grantPreparedMaintenance.js';
import { createLocationImpactRepository } from './locationImpactRepository.js';
import { createLocationImpactProducer } from './locationImpactProducer.js';
import { locationImpactAdmission } from './locationImpactAdmission.js';
import {createInitialFillWriter} from './initialFillWriter.js';
import {createInitialFillAttempts} from './initialFillAttempts.js';
import {createInitialFillProducer} from './initialFillProducer.js';

let runtime:ReturnType<typeof createRuntime>|undefined;
function createRuntime() {
  const registry = createPathFinderRepository(pool),jobs = createPathFinderJobs(pool,registry),apply = createPathFinderApply(pool),worker = createPathFinderWorker(pool,jobs);
  const recalculations=createRecalculationRepository(pool,jobs);
  const producer=createRecalculationProducer(recalculations,{beforeTick:createCalculationEngineObserver(pool,()=>worker.failureCode)});
  const grantProducer=createGrantRecalculationProducer(pool,jobs);
  const locationImpacts=createLocationImpactRepository(pool,{admitInTransaction:locationImpactAdmission});
  const locationImpactProducer=createLocationImpactProducer(locationImpacts);
  const initialFillAttempts=createInitialFillAttempts(pool),initialFillWriter=createInitialFillWriter(pool);
  const initialFillProducer=createInitialFillProducer(initialFillAttempts,initialFillWriter);
  const controlConfiguration=process.env.PF_PRODUCER_CONTROL_KEY?{
    key:process.env.PF_PRODUCER_CONTROL_KEY,owner:process.env.PF_PRODUCER_OWNER,project:process.env.PF_PRODUCER_PROJECT,
    image:process.env.PF_PRODUCER_IMAGE,runtimeInventorySha256:process.env.PF_PRODUCER_RUNTIME_SHA256,
  } as ManagedControlConfiguration:undefined;
  const managedControl=createManagedProducerControl(controlConfiguration);
  const producerQualification=createProducerQualification(controlConfiguration?{
    owner:controlConfiguration.owner,image:controlConfiguration.image,runtimeInventorySha256:controlConfiguration.runtimeInventorySha256,
    expectedSha256:process.env.PF_PRODUCER_QUALIFICATION_SHA256||undefined,canQualifyProject:process.env.PF_PRODUCER_QUALIFY_PROJECT||undefined,
  }:undefined);
  const calculationGrants=createCalculationGrantRepository(pool,{afterCommand:applyCalculationGrantCommand,producerStatus:producerQualification.producerStatus});
  const viewer=getViewerRuntime(),producerResourceService=createProducerResourceService({pool});
  const producerResources={service:producerResourceService,storage:viewer.storage,run:viewer.run.bind(viewer),resource:viewer.resource.bind(viewer)};
  const preparations=createPreparationService(pool,createPreparationPublisher(worker.executePreparation),{
      capacityProfile:preparationCapacityProfileSchema.parse(process.env.PF_PREPARATION_CAPACITY_PROFILE??LEGACY_PREPARATION_CAPACITY_PROFILE),
    }),
    geometryTraces=createGeometryTraceRepository(pool,createGeometryTraceEngine(worker.executePreparation)),
    revisionComparisons=createRevisionComparisonRepository(pool);
  const preparedMaintenance=createGrantPreparedMaintenance(pool,{traces:geometryTraces,comparisons:revisionComparisons});
  const managedPreparationProducer=createManagedPreparationProducer(pool,{control:managedControl,resources:producerResourceService,preparations,traces:geometryTraces,
    qualification:producerQualification,onPrepared:async({candidate,result},signal)=>{
      await preparedMaintenance.onPrepared({candidate:{projectId:candidate.projectId,grant:candidate.grant,...candidate.model},result},signal);
    }});
  return {registry,jobs,apply,worker,recalculations,producer,grantProducer,locationImpacts,locationImpactProducer,initialFillAttempts,initialFillWriter,initialFillProducer,managedControl,producerQualification,calculationGrants,producerResources,
    preparedMaintenance,managedPreparationProducer,lookups:createPathFinderLookups(pool),previews:createPathFinderPreviews(pool),
    preparations,geometryTraces,revisionComparisons,endpointBindings:createEndpointBindingRepository(pool,createRevisionEndpointAdapters())};
}
export function getPathFinderRuntime() {return runtime ??= createRuntime();}
export async function initializePathFinderRuntime():Promise<void> {
  if (!process.env.PF_ROOT || !process.env.PF_ENGINE_DLL) return;
  await pathFinderRoot();const active=getPathFinderRuntime();active.worker.start();active.producer.start();active.managedPreparationProducer.start();active.grantProducer.start();active.locationImpactProducer.start();active.initialFillProducer.start();
}
export async function stopPathFinderRuntime():Promise<void> {
  await runtime?.managedPreparationProducer.stop();
  runtime?.managedControl.stop();runtime?.producerResources.service.close();
  await runtime?.locationImpactProducer.stop();
  await runtime?.initialFillProducer.stop();
  await runtime?.producer.stop();await runtime?.grantProducer.stop();await runtime?.worker.stop();
}
