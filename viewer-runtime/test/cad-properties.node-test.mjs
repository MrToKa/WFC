import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import {
  cadPropertyRows,
  installCadPropertyPanel,
  validateCadProperties,
} from '../cad-properties.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const metadata = {
  instanceId: id(1),
  name: `BC182 / ${id(1)}`,
  actualLengthMm: 3750,
  widthMm: 300,
  heightMm: 60,
  partNumber: 'KL 60.303 F',
  manufacturer: 'Niedax',
  purpose: 'LV and I and C cable tray',
  componentKind: 'straight',
  cadAssetId: id(2),
  cadRevision: 3,
};
const route = { id: id(3), name: 'BC182', purpose: metadata.purpose };
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
class PropertySet {
  constructor(map) {
    this.map = map;
  }
  getVisibleKeys() {
    return Object.keys(this.map).filter((key) => key !== '__selected_dbIds__');
  }
  getValidIds(_name, category) {
    return this.getVisibleKeys().filter((key) => key.startsWith(`${category}/`));
  }
  merge(other) {
    for (const [key, values] of Object.entries(other.map))
      this.map[key] = [...(this.map[key] ?? []), ...values];
    return this;
  }
}
const sourceSet = (value) =>
  new PropertySet({ __selected_dbIds__: [0], 'Source/Tag': [{ dbId: 0, displayValue: value }] });
function fixture() {
  const own = {},
    source = { getData: () => ({}), getPropertySetAsync: async () => sourceSet('SVF') };
  const sections = new Map([
    [0, { metadata: structuredClone(metadata), route: structuredClone(route) }],
  ]);
  const frames = [],
    listeners = [];
  const viewer = {
    selection: [],
    visible: true,
    rendered: [],
    sourceReads: 0,
    resizeCount: 0,
    container: {
      ownerDocument: {
        defaultView: { requestAnimationFrame: (callback) => frames.push(callback) },
      },
    },
  };
  viewer.autoOpen = false;
  viewer.prefs = { get: () => viewer.autoOpen };
  viewer.getAggregateSelection = () => viewer.selection;
  viewer.addEventListener = (_name, callback) => listeners.push(callback);
  viewer.removeEventListener = (_name, callback) => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
  class NativePanel {
    constructor(v) {
      this.viewer = v;
      this.currentSelections = v.selection;
      this.currentModel = v.selection[0]?.model ?? null;
      this.isDirty = true;
      this.visible = false;
      this.container = {
        style: {},
        getBoundingClientRect: () => ({
          top: Number.parseFloat(this.container.style.top ?? '180'),
        }),
      };
      this.onSelection = (event) => {
        if (event.selections.length) {
          this.currentModel = event.selections[0].model;
          this.currentSelections = event.selections.map((row) => ({
            model: row.model,
            selection: row.dbIdArray,
          }));
        } else this.resetCurrentModel();
        this.isDirty = true;
        this.requestProperties();
      };
      v.addEventListener('aggregate', this.onSelection);
    }
    setVisible(visible) {
      this.visible = visible;
      this.requestProperties();
    }
    isVisible() {
      return this.visible;
    }
    requestProperties() {
      if (this.visible && this.isDirty) {
        if (this.currentSelections.length)
          this.requestAggregatedNodeProperties(this.currentSelections);
        else this.onPropError();
        this.isDirty = false;
      }
    }
    setPropertiesIntoUI(value) {
      this.viewer.rendered.push({ kind: 'single', ...value });
    }
    setAggregatedPropertiesIntoUI(value) {
      this.viewer.rendered.push({ kind: 'aggregate', value });
    }
    onPropError() {
      this.viewer.rendered.push({ kind: 'empty' });
    }
    getContentSize() {
      return { height: 608 };
    }
    getContainerBoundingRect() {
      return { top: 0, height: 416 };
    }
    resizeToContent() {
      this.viewer.resizeCount++;
      this.container.style.height =
        Math.min(
          this.getContentSize().height,
          416 - this.container.getBoundingClientRect().top - 75,
        ) + 'px';
    }
    respositionPanel() {}
    resetCurrentModel() {
      this.currentSelections = [];
      this.currentModel = null;
    }
    uninitialize() {
      this.viewer.removeEventListener('aggregate', this.onSelection);
      this.viewer = null;
    }
  }
  let panel = { isVisible: () => viewer.visible, uninitialize() {} },
    resets = 0;
  const manager = {
    getPanel: () => panel,
    setPanel(next) {
      panel.uninitialize();
      panel = next;
      return true;
    },
    setDefaultPanel() {
      panel.uninitialize();
      resets++;
      panel = new NativePanel(viewer);
    },
  };
  // Reproduce the native manager listener registered before its panel listener.
  viewer.addEventListener('aggregate', (event) => {
    if (viewer.autoOpen) panel.setVisible(event.selections.some((row) => row.dbIdArray.length));
  });
  viewer.getExtension = () => manager;
  viewer.selection = [{ model: own, selection: [0] }];
  const provider = installCadPropertyPanel(
    viewer,
    {
      Extensions: { ViewerPropertyPanel: NativePanel },
      PropertySet,
      AGGREGATE_SELECTION_CHANGED_EVENT: 'aggregate',
    },
    (model, sdkId) => (model === own ? (sections.get(sdkId) ?? null) : undefined),
  );
  const select = (selections) => {
    viewer.selection = selections;
    panel.currentSelections = selections;
    panel.currentModel = selections[0]?.model ?? null;
    panel.isDirty = true;
    if (!selections.length) panel.resetCurrentModel();
    panel.requestProperties();
  };
  const emitSelection = (selected) => {
    viewer.selection = selected;
    const event = {
      selections: selected
        .map((row) => ({ model: row.model, dbIdArray: row.selection.filter(Boolean) }))
        .filter((row) => row.dbIdArray.length),
    };
    for (const callback of [...listeners]) callback(event);
  };
  return {
    viewer,
    own,
    source,
    sections,
    provider,
    select,
    emitSelection,
    panel: () => panel,
    resets: () => resets,
    flushFrames: () => {
      for (const callback of frames.splice(0)) callback();
    },
  };
}

test('bounded canonical properties reject forged IDs, invalid dimensions and unknown fields', () => {
  assert.ok(validateCadProperties(id(1), metadata, route));
  for (const bad of [
    { ...metadata, instanceId: id(9) },
    { ...metadata, widthMm: true },
    { ...metadata, actualLengthMm: NaN },
    { ...metadata, heightMm: -1 },
    { ...metadata, dbId: 42 },
    { ...metadata, purpose: 'OTHER' },
  ])
    assert.equal(validateCadProperties(id(1), bad, route), false);
  const rows = cadPropertyRows({ ...metadata, actualLengthMm: null }, route, 0);
  assert.deepEqual(rows.find((row) => row.displayName === 'Actual length').displayValue, 'Unknown');
  assert.deepEqual(rows.find((row) => row.displayName === 'Width').units, 'mm');
});
test('native panel shows owned instance zero properties and refreshes route Purpose without geometry changes', () => {
  const f = fixture();
  assert.equal(f.viewer.rendered.at(-1).name, metadata.name);
  assert.equal(
    f.viewer.rendered.at(-1).properties.find((row) => row.displayName === 'Actual length')
      .displayValue,
    3750,
  );
  const updated = {
    metadata: { ...metadata, purpose: 'New purpose' },
    route: { ...route, purpose: 'New purpose' },
  };
  f.sections.set(0, updated);
  f.provider.refresh();
  assert.equal(
    f.viewer.rendered.at(-1).properties.find((row) => row.displayName === 'Purpose').displayValue,
    'New purpose',
  );
});
test('raw getter rescues zero without opening a manually closed panel when preference is off', () => {
  const f = fixture();
  f.panel().setVisible(false);
  const count = f.viewer.rendered.length;
  f.emitSelection([{ model: f.own, selection: [0] }]);
  assert.equal(f.panel().isVisible(), false);
  assert.equal(f.viewer.rendered.length, count);
  f.panel().setVisible(true);
  assert.equal(f.viewer.rendered.at(-1).name, metadata.name);
});
test('native auto-open restores owned zero after manager deactivation but respects a later manual close', () => {
  const f = fixture();
  f.viewer.autoOpen = true;
  f.panel().setVisible(false);
  f.emitSelection([{ model: f.own, selection: [0] }]);
  assert.equal(f.panel().isVisible(), true);
  assert.equal(f.viewer.rendered.at(-1).name, metadata.name);
  f.panel().setVisible(false);
  f.provider.refresh();
  assert.equal(f.panel().isVisible(), false);
  f.emitSelection([]);
  assert.equal(f.panel().isVisible(), false);
  assert.deepEqual(f.panel().currentSelections, []);
});
test('zero normalization preserves mixed source IDs and clears on a real deselection', async () => {
  const f = fixture();
  f.emitSelection([
    { model: f.source, selection: [91] },
    { model: f.own, selection: [0] },
  ]);
  await turn();
  assert.deepEqual(f.panel().currentSelections, [
    { model: f.source, selection: [91] },
    { model: f.own, selection: [0] },
  ]);
  assert.equal(
    f.viewer.rendered.at(-1).value.map['CAD section/Purpose'][0].displayValue,
    metadata.purpose,
  );
  f.emitSelection([]);
  assert.equal(f.viewer.rendered.at(-1).kind, 'empty');
  assert.deepEqual(f.panel().currentSelections, []);
});
test('CAD panel uses native sizing after rows are laid out and ignores hidden or stale frames', () => {
  const f = fixture();
  assert.equal(f.viewer.resizeCount, 0);
  f.flushFrames();
  assert.equal(f.viewer.resizeCount, 1);
  assert.equal(f.panel().container.style.top, '0px');
  assert.equal(f.panel().container.style.height, '341px');
  f.provider.refresh();
  f.panel().setVisible(false);
  f.flushFrames();
  assert.equal(f.viewer.resizeCount, 1);
  f.panel().setVisible(true);
  f.provider.refresh();
  f.provider.dispose();
  f.flushFrames();
  assert.equal(f.viewer.resizeCount, 1);
});
test('source and mixed selection preserve real model identity even when SDK IDs collide', async () => {
  const f = fixture();
  let reads = 0;
  f.source.getPropertySetAsync = async (ids) => {
    reads++;
    assert.deepEqual(ids, [0]);
    return sourceSet('ORIGINAL');
  };
  f.select([{ model: f.source, selection: [0] }]);
  await turn();
  assert.equal(f.viewer.rendered.at(-1).value.map['Source/Tag'][0].displayValue, 'ORIGINAL');
  f.select([
    { model: f.source, selection: [0] },
    { model: f.own, selection: [0] },
  ]);
  await turn();
  const mixed = f.viewer.rendered.at(-1).value.map;
  assert.equal(mixed['Source/Tag'][0].displayValue, 'ORIGINAL');
  assert.equal(mixed['CAD section/Purpose'][0].displayValue, metadata.purpose);
  assert.deepEqual(mixed.__selected_dbIds__, [0, 0]);
  assert.equal(reads, 2);
});

test('native route/root selection aggregates individual section properties and deduplicates a selected child', async () => {
  const f = fixture(),
    first = f.sections.get(0);
  const second = {
    metadata: { ...metadata, instanceId: id(9), name: 'BC182 / ' + id(9), actualLengthMm: 1500 },
    route,
  };
  f.sections.set(2, first);
  f.sections.set(3, second);
  f.sections.set(10, {
    members: [
      { objectId: 2, section: first },
      { objectId: 3, section: second },
    ],
  });
  f.select([{ model: f.own, selection: [10, 2] }]);
  await turn();
  const aggregate = f.viewer.rendered.at(-1).value.map;
  assert.deepEqual(aggregate.__selected_dbIds__, [2, 3]);
  assert.deepEqual(
    aggregate['CAD section/Actual length'].map((row) => row.displayValue),
    [3750, 1500],
  );
  assert.equal(aggregate['CAD section/Purpose'][0].displayValue, metadata.purpose);
  f.select([
    { model: f.source, selection: [91] },
    { model: f.own, selection: [10] },
  ]);
  await turn();
  assert.equal(f.viewer.rendered.at(-1).value.map['Source/Tag'][0].displayValue, 'SVF');
  assert.deepEqual(
    f.viewer.rendered.at(-1).value.map['CAD section/Actual length'].map((row) => row.displayValue),
    [3750, 1500],
  );
});

test('an empty owned route never attempts a missing native property database', async () => {
  const f = fixture();
  f.sections.set(10, { members: [] });
  f.own.getPropertySetAsync = () => {
    throw new Error('An owned group cannot use a source property DB.');
  };
  f.select([{ model: f.own, selection: [10] }]);
  await turn();
  assert.equal(f.viewer.rendered.at(-1).kind, 'empty');
});
test('late source A cannot replace CAD or newer source B properties', async () => {
  const f = fixture(),
    pending = deferred();
  f.source.getPropertySetAsync = () => pending.promise;
  f.select([{ model: f.source, selection: [0] }]);
  f.select([{ model: f.own, selection: [0] }]);
  f.source.getPropertySetAsync = async () => sourceSet('NEW-B');
  f.select([{ model: f.source, selection: [0] }]);
  await turn();
  pending.resolve(sourceSet('OLD-A'));
  await turn();
  assert.equal(f.viewer.rendered.at(-1).value.map['Source/Tag'][0].displayValue, 'NEW-B');
});
test('late native SolidWorks internal-reference expansion cannot replace a newer CAD selection', async () => {
  const f = fixture(),
    expanded = deferred();
  f.source.is3d = () => true;
  f.source.getDocumentNode = () => ({
    findViewableParent: () => ({ name: () => 'original.sldasm' }),
  });
  f.source.getPropertySetAsync = async () =>
    new PropertySet({ __selected_dbIds__: [0], '__internalref__/Id': [{ displayValue: 7 }] });
  f.source.getPropertySet = (_ids, yes) => {
    expanded.promise.then(yes);
  };
  f.select([{ model: f.source, selection: [0] }]);
  await turn();
  f.select([{ model: f.own, selection: [0] }]);
  expanded.resolve(sourceSet('EXPANDED-OLD'));
  await turn();
  assert.equal(f.viewer.rendered.at(-1).kind, 'single');
  assert.equal(f.viewer.rendered.at(-1).name, metadata.name);
});
test('closed panel retains current metadata for reopening, removal clears properties, teardown discards late results', async () => {
  const f = fixture();
  f.panel().setVisible(false);
  f.sections.set(0, { metadata: { ...metadata, actualLengthMm: 1500 }, route });
  f.provider.refresh();
  f.panel().setVisible(true);
  assert.equal(
    f.viewer.rendered.at(-1).properties.find((row) => row.displayName === 'Actual length')
      .displayValue,
    1500,
  );
  f.sections.delete(0);
  f.provider.refresh();
  assert.equal(f.viewer.rendered.at(-1).kind, 'empty');
  const pending = deferred();
  f.source.getPropertySetAsync = () => pending.promise;
  f.select([{ model: f.source, selection: [0] }]);
  f.provider.dispose();
  const count = f.viewer.rendered.length;
  pending.resolve(sourceSet('LATE'));
  await turn();
  assert.equal(f.viewer.rendered.length, count);
  assert.equal(f.resets(), 1);
});
test('native integration matches the pinned SDK public panel, property-set and selection contracts', () => {
  const sdk = fs.readFileSync(new URL('../sdk/7.130.0/viewer3D.min.js', import.meta.url), 'utf8');
  for (const contract of [
    'ViewerPropertyPanel:()=>bj',
    'v(RJ,l,"ave")',
    'for(let t in e.ave)a(o,e.ave,t)',
    'o=t.Extensions',
    'PropertySet:()=>RI',
    'requestAggregatedNodeProperties(e)',
    'getPropertySetAsync(e,t)',
    'Tj.setPanel=function(e)',
    'setPropertiesIntoUI(e)',
    'setDefaultPanel=function()',
    's-=i.top-r.top+75',
  ])
    assert.ok(sdk.includes(contract), contract);
});

test('native group aggregation retains each section saved world coordinates and canonical dimensions', async () => {
  const f = fixture();
  const first = { metadata, route, positionMm: { x: -100.125, y: 0, z: 340000 } };
  const second = {
    metadata: { ...metadata, instanceId: id(4) },
    route,
    positionMm: { x: 2500, y: 20.123456, z: 340000 },
  };
  f.sections.set(10, {
    members: [
      { objectId: 0, section: first },
      { objectId: 1, section: second },
    ],
  });
  f.select([{ model: f.own, selection: [10] }]);
  await turn();
  const map = f.viewer.rendered.at(-1).value.map;
  for (const axis of ['X', 'Y', 'Z']) {
    const rows = map['Position in model/Placement origin ' + axis];
    assert.deepEqual(
      rows.map((row) => row.displayValue),
      [first.positionMm[axis.toLowerCase()], second.positionMm[axis.toLowerCase()]],
    );
    assert.ok(rows.every((row) => row.units === 'mm' && row.type === 3 && row.precision === 3));
  }
  assert.deepEqual(
    map['CAD section/Actual length'].map((row) => row.displayValue),
    [3750, 3750],
  );
  assert.deepEqual(
    map['CAD section/Purpose'].map((row) => row.displayValue),
    [route.purpose, route.purpose],
  );
  f.select([{ model: f.source, selection: [0] }]);
  await turn();
  assert.deepEqual(Object.keys(f.viewer.rendered.at(-1).value.map), [
    '__selected_dbIds__',
    'Source/Tag',
  ]);
});
