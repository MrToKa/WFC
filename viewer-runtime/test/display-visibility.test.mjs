import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDisplayVisibility, sameDisplayVisibility } from '../display-visibility.mjs';

function fixture() {
  const hidden = new Set(), off = new Set(), hiddenFragments = new Set(), ids = [1, 2, 3, 4];
  const children = { 1: [2, 4], 2: [3], 3: [], 4: [] }, parents = { 1: 0, 2: 1, 3: 2, 4: 1 };
  const tree = { getRootId: () => 1, getNodeParentId: id => parents[id], isNodeHidden: id => hidden.has(id), isNodeOff: id => off.has(id), getNodeBox: (_id, box) => box.set([0, 0, 0, 1, 1, 1]), enumNodeFragments(id, visit) { if (id === 3) visit(0); if (id === 4) visit(1); }, enumNodeChildren(id, visit, recursive) { for (const child of children[id]) { visit(child); if (recursive) this.enumNodeChildren(child, visit, true); } } };
  const fragments = { getCount: () => 2, isFragVisible: id => !hiddenFragments.has(id) }, model = { getFragmentList: () => fragments }, viewer = { model };
  return { hidden, off, hiddenFragments, ids, tree, fragments, model, viewer, observe: () => captureDisplayVisibility(viewer, tree, ids) };
}
test('display scope and all recursive fragments provide exact versioned visibility without native proof', async () => {
  const f = fixture(), observed = await f.observe(); assert.match(observed.scope.contentSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(observed.equipmentEligibility(2), { schemaVersion: 'wfc.pf.equipment-eligibility.v1', matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v3', visibilityScopeSha256: observed.scope.contentSha256, visibility: 'visible', checkedAncestorCount: 2, fragmentStatus: 'all-visible', fragmentCount: 1 });
  assert.equal(sameDisplayVisibility(observed.scope, (await f.observe()).scope), true);
});
test('pinned SDK recursive enumeration includes its source node without making every endpoint a cycle', async () => {
  const f=fixture(),children={1:[2,4],2:[3],3:[],4:[]},calls=[];
  // viewer3D 7.130.0: enumNodeChildren(id,visit,true) calls visit(id)
  // before descendants; nonrecursive enumeration visits direct children only.
  f.tree.enumNodeChildren=(id,visit,recursive)=>{
    calls.push({id,recursive});
    if(recursive&&visit(id))return id;
    const descend=parent=>{for(const child of children[parent]){if(visit(child,parent))return child;if(recursive){const stop=descend(child);if(stop)return stop;}}};
    return descend(id);
  };
  const observed=await f.observe();
  assert.equal(observed.equipmentEligibility(2).fragmentCount,1);
  assert.equal(observed.equipmentEligibility(1).fragmentCount,2);
  assert.ok(calls.every(call=>call.recursive===false));
  f.hidden.add(3);assert.equal((await f.observe()).equipmentEligibility(2),null);
});
for (const [name, change] of [['own hidden', f => f.hidden.add(2)], ['hidden ancestor', f => f.hidden.add(1)], ['own off', f => f.off.add(2)], ['hidden descendant', f => f.hidden.add(3)], ['all hidden fragment', f => f.hiddenFragments.add(0)]]) test('automatic endpoint excludes ' + name, async () => {
  const f = fixture(), before = await f.observe(); change(f); const after = await f.observe(); assert.equal(after.equipmentEligibility(2), null); assert.equal(sameDisplayVisibility(before.scope, after.scope), false);
});
test('a partly hidden recursive geometry cannot authorize aggregate equipment bounds', async () => { const f = fixture(); f.hiddenFragments.add(1); assert.equal((await f.observe()).equipmentEligibility(1), null); });
test('geometry-free node bounds require finite SDK evidence and supported placement', async () => {
  const f = fixture(); f.tree.enumNodeFragments = () => {}; const visible = await f.observe(); assert.equal(visible.equipmentEligibility(2).fragmentStatus, 'geometry-free-node-bounds');
  f.tree.getNodeBox = () => {}; assert.equal((await f.observe()).equipmentEligibility(2), null);
  f.tree.getNodeBox = (_id, box) => box.set([0, 0, 0, 1, 1, 1]); f.model.getPlacementTransform = () => ({ elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1] }); assert.equal((await f.observe()).equipmentEligibility(2), null);
});
test('hiding and showing again always produces a fresh observation rather than cached eligibility', async () => {
  const f = fixture(), before = await f.observe(); f.hidden.add(2); assert.equal((await f.observe()).equipmentEligibility(2), null); f.hidden.delete(2); const shown = await f.observe(); assert.ok(shown.equipmentEligibility(2)); assert.equal(sameDisplayVisibility(before.scope, shown.scope), true);
});
for (const api of ['isNodeHidden', 'isNodeOff', 'enumNodeChildren', 'enumNodeFragments', 'getNodeParentId']) test('missing visibility API ' + api + ' refuses completeness', async () => { const f = fixture(); delete f.tree[api]; await assert.rejects(f.observe, { code: 'PREPARATION_VISIBILITY_UNAVAILABLE' }); });
test('nonboolean fragment/node visibility and missing fragment inventory fail closed', async () => { const f = fixture(); f.fragments.isFragVisible = () => undefined; await assert.rejects(f.observe); f.fragments.isFragVisible = () => true; f.tree.isNodeHidden = () => 0; await assert.rejects(f.observe); f.tree.isNodeHidden = () => false; delete f.fragments.getCount; await assert.rejects(f.observe); });
test('foreign fragments, duplicate hierarchy enumeration and cycles cannot acquire endpoint proof', async () => {
  const f = fixture(), first = await f.observe(); f.tree.enumNodeFragments = (_id, visit) => visit(2); assert.throws(() => first.equipmentEligibility(2));
  f.tree.enumNodeFragments = () => {}; f.tree.enumNodeChildren = (_id, visit) => visit(2); assert.throws(() => first.equipmentEligibility(2));
  f.tree.getNodeParentId = id => id === 2 ? 3 : id === 3 ? 2 : id === 1 ? 0 : 1; const cyclic = await f.observe(); assert.throws(() => cyclic.equipmentEligibility(2));
});
test('abort and model replacement cannot publish a display observation', async () => { const f = fixture(); let calls = 0; await assert.rejects(() => captureDisplayVisibility(f.viewer, f.tree, f.ids, { check: () => { if (++calls === 3) throw new DOMException('Cancelled', 'AbortError'); } }), { name: 'AbortError' }); calls=0;await assert.rejects(() => captureDisplayVisibility(f.viewer, f.tree, f.ids, { check: () => {if(++calls===3)f.viewer.model={};} })); });
test('scope comparison rejects forged basis/schema/hash', async () => { const f = fixture(), { scope } = await f.observe(); for (const changed of [{ ...scope, basis: 'native' }, { ...scope, schemaVersion: 'other' }, { ...scope, contentSha256: 'bad' }]) assert.equal(sameDisplayVisibility(scope, changed), false); assert.equal(sameDisplayVisibility({ ...scope, contentSha256: 'bad' }, { ...scope, contentSha256: 'bad' }), false); });
test('reused inventory indexes are checked exactly and refresh retains model ownership', async () => { const f=fixture(),indexById=new Map(f.ids.map((id,index)=>[id,index]));const observed=await captureDisplayVisibility(f.viewer,f.tree,f.ids,{indexById});assert.equal(sameDisplayVisibility(observed.scope,(await observed.refresh()).scope),true);indexById.set(2,0);await assert.rejects(()=>captureDisplayVisibility(f.viewer,f.tree,f.ids,{indexById}));await assert.rejects(observed.refresh); });
