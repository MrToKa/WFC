// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {createEndpointBindingRepository} from './endpointBindingRepository.js';
import {endpointBindingFixture,endpointFixtureId as id} from './endpointBindingFixtures.js';
import {endpointMigrationEvaluationSchema} from '../../shared/pathfinderEndpointBindings.js';
import {PathFinderError} from './errors.js';

describe('retained endpoint migration evidence at final confirmation',()=>{
  it('refuses a superseded evidence decision before binding writes and preserves exact committed replay',async()=>{
    const f=endpointBindingFixture(),source=await f.repo.confirm(f.f.aggregate.projectId,f.who,f.locationId,f.command());
    // A constructor-only qualified-evidence mock isolates final evidence fencing;
    // this is not a real frame qualification or a geometry mathematics check.
    const evaluateMigration=vi.fn(async()=>endpointMigrationEvaluationSchema.parse({schemaVersion:'wfc.pf.endpoint-migration-evaluation.v1',sourceBindingId:source.binding.id,sourcePointProjectMetres:source.binding.pointProjectMetres,sourcePointInTargetFrameMetres:source.binding.pointProjectMetres,targetPointProjectMetres:[3,3,4],displacementVectorMetres:[1,0,0],displacementMetres:1,proposal:{mode:'fixed-world',derivation:'manual-world-point',sourceObject:null,attachment:null,qualifiedProjectFrameId:id(700)},disposition:'carried-fixed',status:'suggested',reasonCodes:[],candidateObjectRevisionIds:[],evidenceIds:[id(701)],evidenceReferences:[{id:id(701),sha256:'a'.repeat(64),kind:'frame-mapping'}],requiresConfirmation:true,attachmentPolicyVersion:'wfc.pf.endpoint-attachment-policy.v1'}));
    const validateMigrationDecision=vi.fn().mockRejectedValue(new PathFinderError('REVISION_MAPPING_STALE',409));
    const repo=createEndpointBindingRepository(f.pool,{evaluateMigration,validateMigrationDecision});
    const command={schemaVersion:'wfc.pf.endpoint-migration-write.v1',sourceBindingId:source.binding.id,expectedRegistryRevision:f.state.registry,expectedLocationRevision:source.locationRevision,expectedHeadId:source.binding.id,expectedSelectionRevision:f.state.selectedRevision,targetModelVersionId:source.binding.modelVersionId,targetAggregateId:source.binding.aggregateId,targetProjectionSha256:source.binding.projectionSha256,targetCaptureFrameId:source.binding.captureFrameId,objectDecisionId:null,frameDecisionId:id(701),idempotencyKey:id(702),reason:'Synthetic evidence fence'};
    const decision=await repo.migrate(f.f.aggregate.projectId,f.who,command);
    const confirm={schemaVersion:'wfc.pf.endpoint-migration-confirm.v1',expectedDecisionSha256:decision.contentSha256,expectedRegistryRevision:f.state.registry,expectedLocationRevision:source.locationRevision,expectedHeadId:source.binding.id,expectedSelectionRevision:f.state.selectedRevision,idempotencyKey:id(703),reason:'Synthetic confirmation'};
    const revision=f.state.registry,commands=f.state.commands.size;
    await expect(repo.confirmMigration(f.f.aggregate.projectId,f.who,decision.id,confirm)).rejects.toMatchObject({code:'REVISION_MAPPING_STALE'});
    expect(validateMigrationDecision).toHaveBeenCalledWith(f.client,decision,undefined);
    expect(f.state.bindings.size).toBe(1);expect(f.state.registry).toBe(revision);expect(f.state.commands.size).toBe(commands);expect(f.state.heads.get(f.locationId)).toBe(source.binding.id);
    validateMigrationDecision.mockResolvedValue(undefined);
    const saved=await repo.confirmMigration(f.f.aggregate.projectId,f.who,decision.id,confirm);expect(saved.duplicate).toBe(false);expect(f.state.bindings.size).toBe(2);
    validateMigrationDecision.mockRejectedValue(new PathFinderError('REVISION_MAPPING_STALE',409));
    const calls=validateMigrationDecision.mock.calls.length;
    const replay=await repo.confirmMigration(f.f.aggregate.projectId,f.who,decision.id,confirm);expect(replay.duplicate).toBe(true);expect(replay.binding.id).toBe(saved.binding.id);expect(validateMigrationDecision).toHaveBeenCalledTimes(calls);
  });
});
