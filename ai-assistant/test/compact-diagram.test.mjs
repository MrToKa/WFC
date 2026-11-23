import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPACT_SCHEMA, compactAdapter, compactInput, expandCompact } from '../lib/compact-diagram.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1cAAAAASUVORK5CYII=';
const manifest = { schemaVersion: 'wfc.ai.document-manifest.v1', projectId: '11111111-1111-4111-8111-111111111111',
  documents: [{ id: 'synthetic', sha256: 'a'.repeat(64), pages: [{ page: 16, width: 3000, height: 1400,
    text: '15-P4005   15-AV-999A   15-P4005   a15-SKIP0546   15-PTC\n4005', imageDataUrl: png }] }] };
const wire = () => ({ readable: true, why: '', groups: { E: [1,2], I: [], S: [], U: [], X: [] },
  visual: [{ t: '15-PTC-4005', k: 'S', parts: [{ q: '15-PTC', b: [100,50,220,100] },{ q: '4005', b: [100,100,220,160] }] }],
  edges: [{ f: '15-PTC-4005', t: '15-P4005', k: 'P', certain: true, b: [100,50,500,700] }], issues: [] });
const paid = analysis => ({ analysis, attempts: 1, model: 'test', requestId: 'req', responseId: 'response', providerRequestId: 'provider',
  usage: { inputTokens: 300, outputTokens: 100, totalTokens: 400 } });

test('compact input preserves the full image and text and builds numbered literal pairs in occurrence order', () => {
  const input = compactInput(manifest);
  const payload = JSON.parse(input[1].content[0].text);
  assert.deepEqual(payload.dictionary, [[1,'15-P4005'],[2,'15-AV-999A']]);
  assert.equal(payload.sourceText, manifest.documents[0].pages[0].text);
  assert.deepEqual(input[1].content[1], { type: 'input_image', image_url: png, detail: 'high' });
  const focus = compactInput(manifest,true)[0].content[0].text;
  assert.match(focus, /15-P4005/);
  assert.doesNotMatch(focus, /15-MS|15-PTC|15-M4005|15-SC01/);
});

test('expands exact observed text, split visual observations and a bounded visual ownership edge', () => {
  const doc = expandCompact(wire(),manifest);
  assert.equal(doc.coverage[0].page, 16);
  assert.equal(doc.entities[0].evidence[0].quote,'15-P4005');
  assert.equal(doc.entities[0].evidence[0].basis,'local-text');
  assert.deepEqual(doc.entities[2].evidence.map(e=>e.quote), ['15-PTC','4005']);
  assert.deepEqual(doc.entities[2].evidence[0].bbox,[300,70,660,140]);
  assert.equal(doc.relations.length, 1);
  assert.equal(doc.relations[0].status, 'supported');
  assert.equal(doc.relations[0].toEntityId,doc.entities[0].id);
});

test('missing/contradictory classifications, unsupported joined tags and dangling edges stay unresolved', () => {
  const data = wire();
  data.groups.E = [1]; data.groups.S.push(1);
  data.visual[0].t = '15-OTHER4005';
  data.edges.push({ f: '15-P4005',t:'15-AV-999A',certain:true,k:'S',b:[800,0,100,400] });
  const doc = expandCompact(data,manifest);
  assert.equal(doc.entities.length, 2);
  assert.deepEqual(doc.entities.map(e=>e.kind), ['unknown','unknown']);
  assert.equal(doc.relations.length, 0);
  assert.equal(doc.unresolved.length, 5);
  const unreadable = expandCompact({ ...data, readable:false, why:'Page obscured' },manifest);
  assert.equal(unreadable.entities.length, 0);
  assert.equal(unreadable.coverage[0].status,'unreadable');
});

test('wrapper preserves original provider accounting/source and quarantinable invalid paid wire results', async () => {
  let saved, calls = 0;
  const request = { input: compactInput(manifest,true), requestId:'req', schema: {} };
  const wrapper = compactAdapter({ analyze: async req => {
    assert.equal(req.schema,COMPACT_SCHEMA);
    assert.equal(req.input,request.input);
    return paid(++calls === 1 ? wire() : { broken:'synthetic' });
  } }, { onWire: async (response,details) => { saved = [response,details]; } });
  const result = await wrapper.analyze(request);
  assert.equal(result.responseId,'response'); assert.equal(result.usage.totalTokens,400);
  assert.equal(result.analysis.relations.length,1);
  assert.deepEqual(saved[0].analysis,wire());
  assert.deepEqual(saved[1],{ manifest,focus:true,requestId:'req' });
  await assert.rejects(wrapper.analyze(request), e => e.code === 'COMPACT_OUTPUT_INVALID' && e.usage.totalTokens === 400
    && e.providerRequestId === 'provider' && e.analysis.broken === 'synthetic');
  const badStore = compactAdapter({analyze:async()=>paid(wire())},{onWire:async()=>{throw new Error('private');}});
  await assert.rejects(badStore.analyze(request), e => e.code==='COMPACT_WIRE_STORAGE_FAILED' && e.responseId==='response' && e.analysis.readable);
});
