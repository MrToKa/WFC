import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installModelBrowserSearch } from '../model-browser-search.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const tag = (value, names = {}) => ({ attributeName: 'Tag', displayName: 'Tag', displayValue: value, ...names });
const row = (dbId, ...properties) => ({ dbId, properties });

function fixture({ lazy = false, models = 1 } = {}) {
  const events = new Map(), calls = [], updates = [], requests = [];
  const input = new EventTarget();
  const attributes = new Map();
  Object.assign(input, {
    value: '', placeholder: 'Search',
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
  });
  const delegates = Array.from({ length: models }, (_, index) => {
    const model = {
      id: index + 1, rows: [],
      search(text, success, failure, attributeNames, options) {
        calls.push({ text, attributeNames, options, model: this });
        requests.push({ text, success, failure, model: this });
      },
      getBulkProperties2(ids, options, success) {
        calls.push({ ids, options, model: this });
        success(this.rows.filter(item => ids.includes(item.dbId)));
      },
    };
    const instanceTree = {
      prefix: `Model ${index + 1}`,
      getNodeName(id) { return id === 2 ? '15-VS-52071 named object' : 'ACPPPIPEINLINEASSET'; },
      getRootId() { return this.prefix; },
    };
    return { model, instanceTree, getRootId: () => 1 };
  });
  const native = function (text) {
    assert.equal(this, box);
    return delegates.map(delegate => ({ delegate, ids: text.toLowerCase() === '15-vs-52071' ? [2] : [] }));
  };
  const box = { searchbox: input, _searchFunction: native, searchResults: {
    setResults(text, results) { updates.push({ text, results }); },
  } };
  const panel = { searchbox: box, tree: {
    forEachDelegate(callback) { delegates.forEach(callback); },
    getDelegate(id) { return delegates.find(delegate => delegate.model.id === id); },
  } };
  const viewer = {
    modelstructure: lazy ? undefined : panel,
    addEventListener(event, listener) { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(listener); },
    removeEventListener(event, listener) { events.get(event)?.delete(listener); },
    emit(event) { for (const listener of events.get(event) ?? []) listener(); },
  };
  const viewing = { TOOLBAR_CREATED_EVENT: 'toolbar', EXTENSION_LOADED_EVENT: 'extension', OBJECT_TREE_CREATED_EVENT: 'tree' };
  const controller = installModelBrowserSearch(viewer, viewing);
  const query = text => {
    input.value = text;
    input.dispatchEvent(new Event('input'));
    const names = box._searchFunction(text);
    // Real SDK overwrites the result list synchronously after _searchFunction returns.
    box.searchResults.setResults(text, names);
    return names;
  };
  return { viewer, panel, box, input, native, delegates, calls, requests, updates, controller, events, query };
}

test('same Searchbox returns native names synchronously, then unions and deduplicates Tag matches', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  f.delegates[0].model.rows = [row(2, tag('15-VS-52071')), row(3, tag('15-VS-52071'))];
  const names = f.query('15-vs-52071');
  assert.deepEqual(names[0].ids, [2]);
  assert.equal(f.requests.length, 0);
  assert.equal(f.updates.length, 1);
  await turn(); f.requests[0].success([2, 3, 3]); await turn();
  assert.equal(f.updates.length, 2);
  assert.deepEqual(f.updates[1].results[0].ids, [2, 3]);
  assert.equal(f.calls[0].attributeNames, null);
  assert.deepEqual(f.calls[0].options, { searchHidden: true, includeInherited: true });
  assert.equal(f.input.getAttribute('aria-busy'), null);
});

test('synchronous SDK callbacks finish after native Searchbox result assignment', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  const model = f.delegates[0].model;
  model.rows = [row(3, tag('15-VS-52071'))];
  model.search = (_text, success) => success([3]);
  f.query('15-VS-52071');
  assert.deepEqual(f.updates[0].results[0].ids, [2]);
  await turn();
  assert.deepEqual(f.updates.at(-1).results[0].ids, [2, 3]);
});

test('matches raw or displayed Tag name while excluding values in unrelated properties', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  f.delegates[0].model.rows = [
    row(3, tag('15-VS-52071', { attributeName: 'Plant3D_Valve_Tag' })),
    row(4, tag('15-vs-52071', { displayName: 'Kennzeichen' })),
    row(5, { attributeName: 'Description', displayName: 'Description', displayValue: '15-VS-52071' }),
    row(6, tag('different'), { attributeName: 'Layer', displayName: 'Layer', displayValue: '15-VS-52071' }),
    row(7, tag('15-VS-52071', { attributeName: 'tAG', displayName: 'tag' })),
  ];
  f.query('15-VS-52071'); await turn();
  f.requests[0].success([3, 4, 5, 6, 7]); await turn();
  assert.deepEqual(f.updates.at(-1).results[0].ids, [2, 3, 4, 7]);
});

test('Tag result labels support native highlighting without mutating model names or identities', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  const original = f.delegates[0]; original.model.rows = [row(3, tag('15-VS-52071'))];
  f.query('15-VS-52071'); await turn(); f.requests[0].success([3]); await turn();
  const result = f.updates.at(-1).results[0].delegate;
  assert.equal(result.model, original.model);
  assert.equal(result.getRootId(), original.getRootId());
  assert.equal(result.instanceTree.getNodeName(3), 'ACPPPIPEINLINEASSET — 15-VS-52071');
  assert.equal(result.instanceTree.getNodeName(2), original.instanceTree.getNodeName(2));
  assert.equal(result.instanceTree.getRootId(), original.instanceTree.getRootId());
  assert.equal(original.instanceTree.getNodeName(3), 'ACPPPIPEINLINEASSET');
});

test('keeps model-specific result groups and dbIds when different models share ids', async t => {
  const f = fixture({ models: 2 }); t.after(() => f.controller.dispose());
  for (const delegate of f.delegates) delegate.model.rows = [row(3, tag('15-VS-52071'))];
  f.query('15-VS-52071'); await turn();
  f.requests[1].success([3]); f.requests[0].success([3]); await turn();
  const groups = f.updates.at(-1).results;
  assert.deepEqual(groups.map(group => group.delegate.model.id), [1, 2]);
  assert.deepEqual(groups.map(group => group.ids), [[2, 3], [2, 3]]);
});

test('older query cannot overwrite newer query even when callbacks arrive out of order', async t => {
  const f = fixture(); t.after(() => f.controller.dispose());
  f.delegates[0].model.rows = [row(3, tag('15-VS-52071')), row(4, tag('new-value'))];
  f.query('15-VS-52071'); await turn(); f.query('new-value'); await turn();
  f.requests[1].success([4]); await turn();
  const updateCount = f.updates.length;
  f.requests[0].success([3]); await turn();
  assert.equal(f.updates.length, updateCount);
  assert.equal(f.updates.at(-1).text, 'new-value');
  assert.deepEqual(f.updates.at(-1).results[0].ids, [4]);
});

for (const mode of ['input-change', 'clear-without-input-event', 'dispose', 'panel-replaced']) {
  test(`pending query cannot update results after ${mode}`, async t => {
    const f = fixture(); t.after(() => f.controller.dispose());
    f.delegates[0].model.rows = [row(3, tag('15-VS-52071'))];
    f.query('15-VS-52071'); await turn();
    if (mode === 'input-change') { f.input.value = 'changed'; f.input.dispatchEvent(new Event('input')); }
    if (mode === 'clear-without-input-event') f.input.value = '';
    if (mode === 'dispose') f.controller.dispose();
    if (mode === 'panel-replaced') f.viewer.modelstructure = {};
    const updateCount = f.updates.length;
    f.requests[0].success([3]); await turn();
    assert.equal(f.updates.length, updateCount);
  });
}

test('unloaded model is excluded when its pending result completes', async t => {
  const f = fixture({ models: 2 }); t.after(() => f.controller.dispose());
  for (const delegate of f.delegates) delegate.model.rows = [row(3, tag('15-VS-52071'))];
  f.query('15-VS-52071'); await turn(); f.delegates.splice(0, 1);
  for (const request of f.requests) request.success([3]); await turn();
  assert.deepEqual(f.updates.at(-1).results.map(group => group.delegate.model.id), [2]);
});

for (const failure of ['search', 'properties']) {
  test(`${failure} failure preserves native name results and clears busy state`, async t => {
    const f = fixture(); t.after(() => f.controller.dispose());
    if (failure === 'properties') f.delegates[0].model.getBulkProperties2 = (_ids, _options, _success, reject) => reject(Error('properties unavailable'));
    f.query('15-VS-52071'); await turn();
    if (failure === 'search') f.requests[0].failure(Error('search unavailable'));
    else f.requests[0].success([3]);
    await turn();
    assert.deepEqual(f.updates.at(-1).results[0].ids, [2]);
    assert.equal(f.updates.at(-1).results[0].delegate, f.delegates[0]);
    assert.equal(f.input.getAttribute('aria-busy'), null);
  });
}

test('lazy panel installs once on lifecycle events and disposal restores field and removes listeners', () => {
  const f = fixture({ lazy: true });
  assert.equal(f.box._searchFunction, f.native);
  f.viewer.modelstructure = f.panel; f.viewer.emit('toolbar');
  const installed = f.box._searchFunction;
  assert.notEqual(installed, f.native);
  f.viewer.emit('extension'); f.viewer.emit('tree');
  assert.equal(f.box._searchFunction, installed);
  assert.equal(f.input.placeholder, 'Search name or Tag');
  assert.equal(f.input.getAttribute('aria-label'), 'Search name or Tag');
  f.controller.dispose(); f.controller.dispose();
  assert.equal(f.box._searchFunction, f.native);
  assert.equal(f.input.placeholder, 'Search');
  assert.equal(f.input.getAttribute('aria-label'), null);
  assert.ok([...f.events.values()].every(listeners => listeners.size === 0));
  f.viewer.emit('toolbar'); assert.equal(f.box._searchFunction, f.native);
});

test('pinned SDK retains the synchronous Searchbox and delegate result contracts used by this adapter', () => {
  const sdk = readFileSync(new URL('../sdk/7.130.0/viewer3D.min.js', import.meta.url), 'utf8');
  assert.ok(sdk.includes('var t=h._searchFunction(e);h.searchResults.setResults(e,t)'));
  assert.ok(sdk.includes('this._searchFunction=this._options.searchFunction'));
  assert.ok(sdk.includes('r.push({ids:s,delegate:e})'));
  assert.ok(sdk.includes('search(e,t,i,r,n={searchHidden:!1})'));
});
