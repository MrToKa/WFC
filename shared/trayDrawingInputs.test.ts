import { describe, expect, it } from 'vitest';
import { DRAWING_DEFAULTS, drawingCategory, drawingRoutingContainsTray, makeTrayDrawingInput } from './trayDrawingInputs.js';
import { DEFAULT_DRAWING_MODES } from './pathfinderDrawingPolicy.js';
import { computeTrayDrawing, classifyDrawingCategory } from './trayDrawing/index.js';
import type { TrayDrawingResponse, TrayBundleOverride } from './trayDrawingSnapshot.js';
import { DEFAULT_CATEGORY_SETTINGS } from '../src/pages/ProjectDetails/hooks/cableLayoutDefaults';
import { matchCableCategory, routingContainsTray } from '../src/pages/TrayDetails/TrayDetails.utils';

type Data = TrayDrawingResponse['data'];
/** Only synthetic helper inputs; these are neither source business rows nor acceptance evidence. */
function data(): Data {
  const tray = { name: 'SYNTHETIC-TRAY', widthMm: 600, heightMm: 150, useTrefoilClamps: false };
  return {
    project: { cableLayout: { cableSpacing: null, mv: null, power: null, vfd: null, control: null, customBundleRanges: null } },
    tray, reportTrays: [tray],
    trayCables: [
      { id: 'synthetic-power', cableId: 1, purpose: 'Power', diameterMm: 20, fromLocation: 'A', toLocation: 'B' },
      { id: 'synthetic-control', cableId: 2, purpose: 'Control', diameterMm: 20, fromLocation: 'A', toLocation: 'B' },
    ], materialTrays: [],
  } as unknown as Data;
}
const override = (value: Partial<TrayBundleOverride> = {}): TrayBundleOverride => ({ useCustom: true, categories: {}, ...value });

describe('authoritative drawing input interpretation', () => {
  it('retains existing project category defaults and explicit Control trefoil restrictions', () => {
    expect(DRAWING_DEFAULTS).toEqual(DEFAULT_CATEGORY_SETTINGS);
    const result = makeTrayDrawingInput(data(), null, DEFAULT_DRAWING_MODES);
    expect(result.canvasScale).toBe(6); expect(result.spacingMm).toBe(1);
    expect(result.options.rungHeightMm).toBe(15); expect(result.options.useTrefoilClamps).toBe(false);
    for (const category of ['mv', 'power', 'vfd'] as const) expect(result.layoutConfig[category]).toMatchObject(DRAWING_DEFAULTS[category]);
    expect(result.layoutConfig.control).toMatchObject({ maxRows: 7, maxColumns: 20, trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false });
  });
  it.each([null, '', ' ', 'Grounding', 'Power ground', 'MV', ' medium voltage ', 'VFD', 'power VFD', 'Power', 'UPS power', 'Control', 'Instrumentation', 'LV', 'unknown'])('preserves drawing classifier parity for %s', purpose => {
    expect(drawingCategory(purpose)).toBe(matchCableCategory(purpose));
    expect(drawingCategory(purpose)).toBe(classifyDrawingCategory(purpose));
  });
  it.each([
    [null, 'A'], ['', 'A'], ['/A/B', 'A'], ['/A/B', 'a'], ['/ A / B ', ' A '], ['/AA/BA', 'A'], ['/SECONDARY', 'SECONDARY'], ['/A/B', '/A'], ['/A/B', ''],
  ] as const)('retains exact slash-segment membership for %s and %s', (routing, trayName) => {
    expect(drawingRoutingContainsTray(routing, trayName)).toBe(routingContainsTray(routing, trayName));
  });
  it('keeps zero spacing/rung values and explicit false settings instead of replacing them with defaults', () => {
    const source = data(); source.project.cableLayout.cableSpacing = 0;
    source.project.cableLayout.power = { maxRows: 1, maxColumns: 1, bundleSpacing: '0', trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false };
    source.materialTrays = [{ rungHeightMm: 0 }] as Data['materialTrays']; source.tray.useTrefoilClamps = true;
    const result = makeTrayDrawingInput(source, null, DEFAULT_DRAWING_MODES);
    expect(result.spacingMm).toBe(0); expect(result.options.rungHeightMm).toBe(0); expect(result.options.useTrefoilClamps).toBe(true);
    expect(result.layoutConfig.power).toMatchObject({ maxRows: 1, maxColumns: 1, bundleSpacing: '0', trefoil: false, cableSpacing: 0 });
  });
  it('merges selected server overrides with project settings without mutating either source', () => {
    const source = data(); source.project.cableLayout.power = { maxRows: 4, maxColumns: 9, bundleSpacing: '1D', trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false };
    const selected = override({ categories: { power: { maxRows: 2, maxColumns: 5, bundleSpacing: '0', trefoil: true, trefoilSpacingBetweenBundles: true, applyPhaseRotation: false } } });
    const before = JSON.stringify({ source, selected });
    const result = makeTrayDrawingInput(source, selected, { ...DEFAULT_DRAWING_MODES, power: 'right' });
    expect(result.layoutConfig.power).toMatchObject({ maxRows: 2, maxColumns: 5, bundleSpacing: '0', trefoil: true });
    expect(result.options.categoryModes.power).toBe('right'); expect(result.layoutConfig.mv.maxRows).toBe(2);
    expect(JSON.stringify({ source, selected })).toBe(before);
  });
  it('ignores inactive stored custom settings and uses authoritative project custom ranges', () => {
    const source = data(); source.project.cableLayout.customBundleRanges = { power: [{ id: 'project-range', min: 19, max: 21, maxRows: 1 }] };
    const selected = override({ useCustom: false, customBundleRanges: { power: [{ id: 'inactive', min: 1, max: 100, maxRows: 9 }] } });
    const result = makeTrayDrawingInput(source, selected, DEFAULT_DRAWING_MODES);
    expect(result.cableBundles.power['19-21']).toEqual([source.trayCables[0]]);
    expect(result.layoutConfig.power.bundleMaxRowsByKey).toEqual({ '19-21': 1 });
  });
  it('uses explicit per-tray custom range scope and drops unselected project ranges exactly as retained UI did', () => {
    const source = data(); source.project.cableLayout.customBundleRanges = { power: [{ id: 'project', min: 19, max: 21 }] };
    const result = makeTrayDrawingInput(source, override(), DEFAULT_DRAWING_MODES);
    expect(result.options.customRanges).toEqual({});
    expect(result.cableBundles.power['15.1-21']).toEqual([source.trayCables[0]]);
  });
  it('uses inclusive custom range bounds and retained default fallback outside them', () => {
    const source = data(); source.trayCables = [19, 21, 21.5].map((diameterMm, index) => ({ ...source.trayCables[0], id: `synthetic-${index}`, cableId: index, diameterMm }));
    const result = makeTrayDrawingInput(source, override({ customBundleRanges: { power: [{ id: 'narrow', min: 19, max: 21, maxRows: 1 }] } }), DEFAULT_DRAWING_MODES);
    expect(result.cableBundles.power['19-21'].map(c => c.diameterMm)).toEqual([19, 21]);
    expect(result.cableBundles.power['21.1-30'].map(c => c.diameterMm)).toEqual([21.5]);
    expect(result.layoutConfig.power.bundleMaxRowsByKey).toEqual({ '19-21': 1 });
  });
  it('preserves complete input order/identities and does not reinterpret unknown categories as Control', () => {
    const source = data(); source.trayCables.unshift({ ...source.trayCables[0], id: 'unknown', cableId: 3, purpose: 'Instrumentation' });
    const before = source.trayCables.map(c => c.id);
    const result = makeTrayDrawingInput(source, null, DEFAULT_DRAWING_MODES);
    expect(result.cablesOnTray.map(c => c.id)).toEqual(['synthetic-power', 'synthetic-control']);
    expect(result.cableBundles.control['15.1-21'].map(c => c.id)).toEqual(['synthetic-control']);
    expect(source.trayCables.map(c => c.id)).toEqual(before); // Caller still owns unknown IDs for the blocking snapshot diagnostic.
  });
  it('keeps routed grounding distinct from an optional tray-weight grounding setting', () => {
    const source = data(); source.tray.includeGroundingCable = true; source.tray.groundingCableTypeId = 'weight-only';
    const first = makeTrayDrawingInput(source, null, DEFAULT_DRAWING_MODES);
    expect(first.cablesOnTray).toHaveLength(2);
    source.trayCables.push({ ...source.trayCables[0], id: 'routed-ground', purpose: 'Grounding' });
    expect(makeTrayDrawingInput(source, null, DEFAULT_DRAWING_MODES).cableBundles.mv['15.1-21'].map(c => c.id)).toEqual(['routed-ground']);
  });
  it('produces the same shared computed result for independent serialized normal-reader inputs', () => {
    const source = data(); const selected = override({ categories: {} });
    const modes = { ...DEFAULT_DRAWING_MODES, control: 'left' as const };
    const admin = computeTrayDrawing(makeTrayDrawingInput(source, selected, modes));
    const normal = computeTrayDrawing(makeTrayDrawingInput(JSON.parse(JSON.stringify(source)), JSON.parse(JSON.stringify(selected)), { ...modes }));
    expect(normal).toEqual(admin); expect(admin.placements).toHaveLength(2);
  });
});
