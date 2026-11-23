// Entirely synthetic WFC facts for integration tests. Never report as GVL244 inventory.
export const FIXTURE_PROJECT = 'da667921-1f13-4c1d-9f87-063d127b98ce';
const id = number => `00000000-0000-0000-0000-${String(number).padStart(12,'0')}`;
export function createWfcFactsFixture() {
  const current = {modelVersionId:id(1),selectionRevision:'2',contentFingerprint:'a'.repeat(64),aggregateId:id(2),artifactId:id(3),
    projectionSha256:'b'.repeat(64),captureFrameId:id(4),geometryRevision:'19',traceId:id(5)};
  const binding = number => ({id:id(number),status:'confirmed',mode:'fixed-world',pointProjectMetres:[1,2,3],
    modelVersionId:current.modelVersionId,aggregateId:current.aggregateId,artifactId:current.artifactId,
    captureFrameId:current.captureFrameId,sourceObject:null,selectedObjectEvidence:null});
  const pump = binding(20);
  pump.selectedObjectEvidence = {kind:'saved-model-observation',modelVersionId:current.modelVersionId,artifactId:current.artifactId,
    captureFrameId:current.captureFrameId,objectIds:[42],bounds:{minimum:[0,0,0],maximum:[2,2,2]},approximate:true,engineeringAccepted:false};
  return {schemaVersion:'wfc.ai.wfc-facts.v1',projectId:FIXTURE_PROJECT,capturedAt:'2026-11-20T20:00:00.000Z',
    source:{kind:'local-operator-read-only',consistency:'repeatable-read',readOnly:true},registryRevision:'12',current,
    cables:[{id:id(100),tag:'SYNTHETIC-PTC-CABLE',from:'15-PTC4005',to:'RIO1',mto:'Instrumentation',purpose:'Signal',writeRevision:'1'}],
    locations:[{id:id(10),name:'15-P4005',aliases:[],revision:'1',binding:pump,calculationReady:true},
      {id:id(11),name:'RIO1',aliases:[],revision:'1',binding:binding(21),calculationReady:true}],
    endpoints:[{name:'15-PTC4005',rawNames:['15-PTC4005'],locationId:null,bindingId:null,bindingStatus:null,calculationReady:false,
      status:'missing',fromOccurrences:1,toOccurrences:0,distinctCables:1},
    {name:'RIO1',rawNames:['RIO1'],locationId:id(11),bindingId:id(21),bindingStatus:'confirmed',calculationReady:true,
      status:'ready',fromOccurrences:0,toOccurrences:1,distinctCables:1}]};
}
export function createEquipmentSummaryFixture() {
  return {schemaVersion:'wfc.ai.equipment-summary.v1',projectId:FIXTURE_PROJECT,
    parents:[{consumerTag:'15-PTC4005',parentTag:'15-P4005',status:'candidate',relationTypes:['ptc-of'],evidenceBasis:['local-text'],
      sources:[{projectId:FIXTURE_PROJECT,fromTag:'15-PTC4005',toTag:'15-P4005',evidence:[{documentId:'synthetic.txt',page:1,basis:'local-text',quote:'15-PTC4005 belongs to 15-P4005',bbox:null}]}]}],
    review:[],unresolved:[]};
}
