import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWfcFacts, summarizeKnownFacts } from '../lib/wfc-baseline.mjs';
import { createWfcFactsFixture, createEquipmentSummaryFixture } from './wfc-facts-fixture.mjs';

test('synthetic full snapshot validates and retains original cable and category facts', () => {
  const facts=createWfcFactsFixture();
  assert.equal(validateWfcFacts(facts,{projectId:facts.projectId}),facts);
  assert.equal(facts.cables[0].from,'15-PTC4005'); assert.equal(facts.cables[0].mto,'Instrumentation');
  const result=summarizeKnownFacts(facts,createEquipmentSummaryFixture());
  assert.equal(result.counts.cables,1); assert.equal(result.counts.endpointNames,2);
  assert.equal(result.endpoints[0].occurrences[0].originalName,'15-PTC4005');
  assert.equal(result.endpoints[0].documentCandidates[0].match,'exact-original');
  assert.equal(result.endpoints[0].documentCandidates[0].parentFacts.geometry.kind,'saved-model-observation');
  assert.equal(result.endpoints[0].wfc.geometry.kind,'none');
  assert.equal(result.endpoints[0].automaticBindingAllowed,false);
  assert.equal(result.writesPerformed,0); assert.equal(result.rawWfcFactsForExternalApi,false);
});

test('matching ignores case only for lookup and labels case-only evidence', () => {
  const docs=createEquipmentSummaryFixture(); docs.parents[0].consumerTag='15-ptc4005';
  const result=summarizeKnownFacts(createWfcFactsFixture(),docs);
  assert.equal(result.endpoints[0].documentCandidates[0].match,'case-only');
  assert.deepEqual(result.endpoints[0].originalNames,['15-PTC4005']);
  assert.equal(result.endpoints[0].wfc.geometry.kind,'none');
});

test('normalization never removes punctuation or collapses consumers into parent equipment', () => {
  const docs=createEquipmentSummaryFixture(); docs.parents[0].consumerTag='15-PTC-4005';
  const result=summarizeKnownFacts(createWfcFactsFixture(),docs);
  assert.equal(result.endpoints[0].documentCandidates.length,0);
  assert.equal(result.documentOnly[0].consumerTag,'15-PTC-4005');
  assert.equal(result.documentOnly[0].cableOccurrences,0);
  assert.equal(result.endpoints[0].disposition,'needs-resolution');
});

test('all cable occurrences are reconciled, including duplicate logical endpoint names', () => {
  const facts=createWfcFactsFixture();
  facts.cables.push({...facts.cables[0],id:'00000000-0000-0000-0000-000000000101',tag:'SYNTHETIC-SECOND'});
  for(const endpoint of facts.endpoints){endpoint.fromOccurrences*=2;endpoint.toOccurrences*=2;endpoint.distinctCables=2;}
  const result=summarizeKnownFacts(facts,createEquipmentSummaryFixture());
  assert.equal(result.counts.cables,2); assert.equal(result.endpoints[0].occurrences.length,2);
});

test('documents cannot overwrite a current WFC binding; conflicts retain both sources', () => {
  const facts=createWfcFactsFixture(),docs=createEquipmentSummaryFixture();
  const rio=structuredClone(docs.parents[0]); rio.consumerTag='RIO1'; rio.parentTag='OTHER-EQUIPMENT';
  docs.parents.push(rio,{...rio,parentTag:'THIRD-EQUIPMENT'});
  const original=structuredClone(facts.locations[1].binding);
  const result=summarizeKnownFacts(facts,docs);
  const known=result.endpoints.find(value=>value.originalNames.includes('RIO1'));
  assert.equal(known.disposition,'preserve-current-binding');
  assert.deepEqual(known.wfc.binding,original);
  assert.equal(known.documentCandidates.length,2); assert.equal(result.counts.conflicts,1);
  assert.ok(known.reasonCodes.includes('CONFLICTING_DOCUMENT_PARENTS'));
});

test('document-only and uncertain consumers stay in the complete reconciliation', () => {
  const docs=createEquipmentSummaryFixture();
  docs.review.push({consumerTag:'OTHER-CONSUMER',reasonCodes:['OWNERSHIP_EVIDENCE_MISSING'],candidateParentTags:[],sources:[]});
  docs.unresolved.push({reason:'Unreadable label',evidence:[]});
  const result=summarizeKnownFacts(createWfcFactsFixture(),docs);
  assert.equal(result.documentOnly[0].consumerTag,'OTHER-CONSUMER');
  assert.equal(result.documentOnly[0].automaticBindingAllowed,false);
  assert.equal(result.documentUnresolved[0].reason,'Unreadable label');
});

test('immutable references are distinct from saved SDK observations and fresh 3D search', () => {
  const facts=createWfcFactsFixture(),location=facts.locations[1];
  location.binding.sourceObject={traceId:facts.current.traceId,objectRevisionId:'00000000-0000-0000-0000-000000000077',recordSha256:'c'.repeat(64)};
  const result=summarizeKnownFacts(facts,createEquipmentSummaryFixture());
  assert.equal(result.endpoints[1].wfc.geometry.kind,'immutable-object-reference');
  assert.equal(result.endpoints[1].automaticBindingAllowed,false);
});

test('cross-project facts, malformed revisions, false readiness and secret fields refuse validation', () => {
  const mutations=[facts=>{facts.projectId='other';},facts=>{facts.registryRevision='-1';},
    facts=>{facts.locations[1].binding.modelVersionId='00000000-0000-0000-0000-000000000099';},
    facts=>{facts.password='never-allowed';},facts=>{facts.cables[0].token='never-allowed';},
    facts=>{facts.locations[1].calculationReady=true;facts.locations[1].binding=null;}];
  for(const mutate of mutations){const facts=createWfcFactsFixture();mutate(facts);assert.throws(()=>validateWfcFacts(facts),{code:'WFC_FACTS_INVALID'});}
  const facts=createWfcFactsFixture();
  assert.throws(()=>validateWfcFacts(facts,{projectId:'00000000-0000-0000-0000-000000000099'}),{code:'WFC_FACTS_INVALID'});
});

test('incomplete cable set, alias collision and altered endpoint occurrence counts cannot masquerade as facts', () => {
  for(const mutate of [facts=>{facts.endpoints.pop();},facts=>{facts.endpoints[0].distinctCables=7;},
    facts=>{facts.locations[1].aliases=['15-P4005'];},facts=>{facts.cables.push(facts.cables[0]);}]){
    const facts=createWfcFactsFixture();mutate(facts);assert.throws(()=>validateWfcFacts(facts),{code:'WFC_FACTS_INVALID'});
  }
});

test('evidence scope remains explicit and stale selected objects cannot become current geometry', () => {
  const facts=createWfcFactsFixture();
  facts.locations[0].binding.selectedObjectEvidence.modelVersionId='00000000-0000-0000-0000-000000000099';
  const result=summarizeKnownFacts(facts,createEquipmentSummaryFixture());
  assert.equal(result.endpoints[0].documentCandidates[0].parentFacts.geometry.kind,'none');
});

test('different comparable current objects flag WFC/document target review and preserve current binding', () => {
  const facts=createWfcFactsFixture(),docs=createEquipmentSummaryFixture();
  const consumer=structuredClone(facts.locations[1]);
  consumer.id='00000000-0000-0000-0000-000000000012';consumer.name='15-PTC4005';
  consumer.binding.id='00000000-0000-0000-0000-000000000022';
  consumer.binding.selectedObjectEvidence=structuredClone(facts.locations[0].binding.selectedObjectEvidence);
  consumer.binding.selectedObjectEvidence.objectIds=[99];facts.locations.push(consumer);
  Object.assign(facts.endpoints[0],{locationId:consumer.id,bindingId:consumer.binding.id,bindingStatus:'confirmed',calculationReady:true,status:'ready'});
  const result=summarizeKnownFacts(facts,docs),endpoint=result.endpoints[0];
  assert.ok(endpoint.reasonCodes.includes('WFC_DOCUMENT_TARGET_REVIEW'));
  assert.equal(endpoint.targetReviews[0].basis,'different-current-model-object-ids');
  assert.equal(endpoint.disposition,'preserve-current-binding');assert.deepEqual(endpoint.wfc.binding,consumer.binding);
  assert.equal(result.counts.wfcDocumentTargetReviewConsumers,1);assert.equal(result.counts.documentParentConflicts,0);assert.equal(result.counts.conflicts,1);
});

test('different registry names and UUIDs alone never imply a WFC/document object discrepancy', () => {
  const facts=createWfcFactsFixture(),docs=createEquipmentSummaryFixture();
  docs.parents[0].consumerTag='RIO1';
  const result=summarizeKnownFacts(facts,docs),endpoint=result.endpoints[1];
  assert.equal(endpoint.targetReviews.length,0);assert.equal(result.counts.wfcDocumentTargetReviewConsumers,0);
});

test('same retained model object under different names is not a target discrepancy', () => {
  const facts=createWfcFactsFixture(),docs=createEquipmentSummaryFixture();docs.parents[0].consumerTag='RIO1';
  facts.locations[1].binding.selectedObjectEvidence=structuredClone(facts.locations[0].binding.selectedObjectEvidence);
  const result=summarizeKnownFacts(facts,docs);
  assert.equal(result.endpoints[1].targetReviews.length,0);
});

test('nonoverlapping same-frame bounds trigger review even when saved SDK identity overlaps', () => {
  const facts=createWfcFactsFixture(),docs=createEquipmentSummaryFixture();docs.parents[0].consumerTag='RIO1';
  facts.locations[1].binding.selectedObjectEvidence=structuredClone(facts.locations[0].binding.selectedObjectEvidence);
  facts.locations[1].binding.selectedObjectEvidence.bounds={minimum:[10,10,10],maximum:[12,12,12]};
  const result=summarizeKnownFacts(facts,docs);
  assert.equal(result.endpoints[1].targetReviews[0].basis,'nonoverlapping-current-frame-bounds');
  assert.equal(result.endpoints[1].disposition,'preserve-current-binding');
});

test('different immutable objects require comparable current trace and supported document relation', () => {
  const facts=createWfcFactsFixture(),docs=createEquipmentSummaryFixture();docs.parents[0].consumerTag='RIO1';
  for(const [index,location] of facts.locations.entries()) location.binding.sourceObject={traceId:facts.current.traceId,
    objectRevisionId:`00000000-0000-0000-0000-00000000008${index}`,recordSha256:'c'.repeat(64)};
  assert.equal(summarizeKnownFacts(facts,docs).endpoints[1].targetReviews[0].basis,'different-current-trace-object-ids');
  docs.parents[0].status='review';
  assert.equal(summarizeKnownFacts(facts,docs).endpoints[1].targetReviews.length,0);
  docs.parents[0].status='candidate';
  facts.locations[1].binding.sourceObject.traceId='00000000-0000-0000-0000-000000000099';
  assert.equal(summarizeKnownFacts(facts,docs).endpoints[1].targetReviews.length,0);
});

test('document-only conflicts are included in overall conflict counts', () => {
  const facts=createWfcFactsFixture(),docs=createEquipmentSummaryFixture();
  const first={...docs.parents[0],consumerTag:'DOCUMENT-ONLY'};
  docs.parents.push(first,{...first,parentTag:'OTHER-PARENT'});
  const result=summarizeKnownFacts(facts,docs);
  assert.equal(result.counts.documentParentConflicts,1);assert.equal(result.counts.conflicts,1);
  assert.ok(result.documentOnly[0].reasonCodes.includes('CONFLICTING_DOCUMENT_PARENTS'));
});

test('document project mismatch cannot be joined to WFC facts', () => {
  const docs=createEquipmentSummaryFixture();docs.projectId='00000000-0000-0000-0000-000000000099';
  assert.throws(()=>summarizeKnownFacts(createWfcFactsFixture(),docs),{code:'WFC_DOCUMENT_SUMMARY_INVALID'});
});
