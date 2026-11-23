import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { main, MODEL } from '../cli.mjs';
import { createOpenAIAdapter } from '../lib/openai.mjs';
import { createWfcFactsFixture } from './wfc-facts-fixture.mjs';

const tags = ['15-MS4005','15-PTC4005','15-SC014005','15-M4005'];
const parent = '15-P4005';

function fakeService(requests, unreadable) {
  return () => createOpenAIAdapter({
    apiKey: 'synthetic-in-process', model: MODEL, maxAttempts: 1, maxOutputTokens: 12000,
    async fetchImpl(url, init) {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const { input, store, tools } = JSON.parse(init.body);
      assert.equal(store, false);
      assert.deepEqual(tools, []);
      assert.doesNotMatch(init.body, /SYNTHETIC-PTC-CABLE|operator-read-only-database-snapshot|RIO1/);
      const { projectId } = JSON.parse(input[1].content[0].text);
      const { documentId, page } = JSON.parse(input[1].content[1].text);
      requests.push(documentId);
      const evidence = quote => [{ documentId, page, basis: 'local-text', quote, bbox: null }];
      const diagram = documentId.endsWith('.txt');
      const analysis = {
        schemaVersion: 'wfc.ai.document-analysis.v1', projectId,
        coverage: [{ documentId, page, status: !diagram && unreadable ? 'unreadable' : 'analyzed',
          reason: !diagram && unreadable ? 'Synthetic unreadable page' : '' }],
        entities: diagram ? [
          { id: 'pump', tag: parent, kind: 'equipment', evidence: evidence(parent) },
          ...tags.map(tag => ({ id: tag, tag, kind: 'signal', evidence: evidence(tag) })),
        ] : [],
        relations: diagram ? tags.map(tag => ({ fromEntityId: tag, toEntityId: 'pump',
          type: 'signal-of', status: 'supported', evidence: evidence(tag + ' belongs to ' + parent) })) : [],
        unresolved: [],
      };
      return Response.json({ status: 'completed', id: 'resp_test_' + requests.length, model: MODEL,
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } });
    },
  });
}

for (const unreadable of [false, true]) {
  test('document + WFC review through the operator CLI, unreadable=' + unreadable, async () => {
    const root = await mkdtemp(join(tmpdir(), 'wfc-cli-'));
    try {
      const textFile = join(root, 'synthetic-pump.txt');
      const imageFile = join(root, 'synthetic-note.png');
      await writeFile(textFile, tags.map(tag => tag + ' belongs to ' + parent).join('\n'));
      await writeFile(imageFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1cAAAAASUVORK5CYII=', 'base64'));
      const requests = [];
      const options = { root, provider: fakeService(requests, unreadable) };
      const batch = await main(['prepare', textFile, imageFile], options);
      await assert.rejects(main(['analyze', batch.corpusId], options), { code: 'WFC_FACT_SNAPSHOT_REQUIRED' });
      assert.equal(requests.length, 0);
      const facts = createWfcFactsFixture();
      await main(['import-facts'], { ...options, input: Readable.from([JSON.stringify(facts)]) });
      const checked = await main(['preflight', batch.corpusId], options);
      assert.equal(checked.totalPages, 2);
      assert.equal(checked.visualPages, 1);
      assert.equal(checked.externalRequests, 0);
      const result = await main(['analyze', batch.corpusId], options);
      assert.equal(requests.length, 2);
      assert.equal(result.endpointWrites, 0);
      const report = await main(['report', result.reportId], options);
      if (unreadable) {
        assert.equal(result.status, 'incomplete');
        assert.equal(report.reconciliation, null);
        assert.equal(report.documentAnalysis.pages.filter(p => p.status === 'unreadable').length, 1);
      } else {
        assert.equal(result.status, 'analyzed');
        assert.equal(report.equipment.parents.length, 4);
        assert.ok(report.equipment.parents.every(p => p.parentTag === parent));
        const review = report.reconciliation;
        assert.equal(review.endpoints.find(e => e.originalNames.includes('15-PTC4005')).documentCandidates.length, 1);
        assert.equal(review.documentOnly.length, 3);
        assert.equal(review.endpoints.find(e => e.originalNames.includes('RIO1')).disposition, 'preserve-current-binding');
      }
      const repeat = await main(['analyze', batch.corpusId], options);
      assert.equal(repeat.cacheHits, 2);
      assert.equal(requests.length, 2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

