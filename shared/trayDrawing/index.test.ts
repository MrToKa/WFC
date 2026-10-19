import { describe, expect, it, vi } from 'vitest';
import { computeTrayDrawing, parseTrayDrawingLayout, replayTrayDrawing, classifyDrawingCategory, defaultCategoryLayoutConfig,
  determineCableDiameterGroup, type DrawingCable, type TrayDrawingInput, type CategoryKey, type CategoryModes } from './index.js';
import { createRecordingCanvas, validateDrawingCommands } from './recording.js';

const cable = (id: number, purpose: string, diameterMm = 20): DrawingCable => ({ id: `cable-${id}`, cableId: id, purpose, diameterMm, fromLocation: 'A', toLocation: 'B' });
const modes = (value: Partial<CategoryModes> = {}): CategoryModes => ({ mv: 'use-default', power: 'use-default', vfd: 'use-default', control: 'use-default', ...value });
function input(cables: DrawingCable[], categoryModes = modes(), options: Partial<TrayDrawingInput> = {}): TrayDrawingInput {
  const cableBundles: NonNullable<TrayDrawingInput['cableBundles']> = {};
  for (const item of cables) {
    const category = classifyDrawingCategory(item.purpose)!;
    const key = determineCableDiameterGroup(item.diameterMm);
    ((cableBundles[category] ??= {})[key] ??= []).push(item);
  }
  return { tray: { name: 'Synthetic tray', widthMm: 600, heightMm: 150 }, cablesOnTray: cables, cableBundles, canvasScale: 1, spacingMm: 1,
    layoutConfig: defaultCategoryLayoutConfig(1), options: { categoryModes }, ...options };
}
const byId = (result: ReturnType<typeof computeTrayDrawing>, id: number) => result.placements.find(placement => placement.cableId === `cable-${id}`)!;
function dividers(result: ReturnType<typeof computeTrayDrawing>) {
  let width = 1;
  return result.commands.filter(command => {
    if (command.op === 'set' && command.key === 'lineWidth') width = command.value as number;
    return command.op === 'lineTo' && width === 2;
  });
}

describe('shared pure tray placement', () => {
  it('retains signed database ordering IDs while producing positive schedule display numbers', () => {
    const result = computeTrayDrawing(input([cable(7, 'Power'), cable(-2, 'Power')]));
    expect(byId(result, -2).displayNumber).toBe(1);
    expect(byId(result, 7).displayNumber).toBe(2);
    expect(result.placements.map(value => value.cableId)).toEqual(['cable-7', 'cable--2']);
    expect(result.placements.every(value => value.displayNumber > 0)).toBe(true);
  });
  for (let mask = 0; mask < 16; mask++) {
    it(`preserves whole-input default sides for category mask ${mask}`, () => {
      const categories: CategoryKey[] = ['mv', 'power', 'vfd', 'control'];
      const cables = categories.flatMap((purpose, index) => mask & 1 << index ? [cable(index + 1, purpose)] : []);
      const result = computeTrayDrawing(input(cables));
      expect(result.placements).toHaveLength(cables.length);
      const hasMv = Boolean(mask & 1), hasPower = Boolean(mask & 2);
      for (const item of cables) {
        const category = classifyDrawingCategory(item.purpose);
        const expected = category === 'mv' ? 'left' : category === 'power' ? hasMv ? 'right' : 'left' : category === 'vfd' ? hasMv || hasPower ? 'right' : 'left' : 'right';
        expect(result.placements.find(value => value.cableId === item.id)?.side).toBe(expected);
      }
      const occupied = new Set(result.placements.map(value => value.side));
      expect(dividers(result)).toHaveLength(occupied.size === 2 ? 1 : 0);
      expect(result.commands.some(command => command.op === 'fillText' && command.args[0] === 'Too many cable types on the tray!')).toBe(false);
    });
  }
  it('freezes defaults before overriding MV rather than recalculating remaining cable defaults', () => {
    const result = computeTrayDrawing(input([cable(1, 'MV'), cable(2, 'Power'), cable(3, 'VFD')], modes({ mv: 'right' })));
    expect(result.placements.map(value => value.side)).toEqual(['right', 'right', 'right']);
    expect(dividers(result)).toHaveLength(0);
  });
  it.each(['left', 'right'] as const)('jointly packs compatible mixed categories on %s using full input order', side => {
    const config = defaultCategoryLayoutConfig(1); config.control.trefoil = true; // Ignored by the retained Control family.
    const result = computeTrayDrawing(input([cable(1, 'Control'), cable(2, 'Power'), cable(3, 'Control'), cable(4, 'Power')], modes({ power: side, control: side }), { layoutConfig: config }));
    expect(byId(result, 1).xPx).toBe(byId(result, 2).xPx);
    expect(Math.abs(byId(result, 1).yPx - byId(result, 2).yPx)).toBe(21);
    expect(byId(result, 3).xPx).toBe(byId(result, 4).xPx);
    expect(Math.abs(byId(result, 1).xPx - byId(result, 3).xPx)).toBe(21);
    expect(result.placements.map(value => value.category)).toEqual(['control', 'power', 'control', 'power']);
    expect(dividers(result)).toHaveLength(0);
  });
  it('does not pool hexadecimal, destination-grouped or vertical families merely because settings match', () => {
    const result = computeTrayDrawing(input([cable(1, 'Power', 42), cable(2, 'Control', 42), cable(3, 'VFD', 42)], modes({ power: 'right', control: 'right', vfd: 'right' })));
    expect(new Set(result.placements.map(value => value.xPx)).size).toBe(3);
  });
  it('does not pool different row overrides even when the other settings match', () => {
    const config = defaultCategoryLayoutConfig(1); config.power.bundleMaxRowsByKey = { '15.1-21': 1 };
    const result = computeTrayDrawing(input([cable(1, 'Power'), cable(2, 'Control')], modes({ power: 'left', control: 'left' }), { layoutConfig: config }));
    expect(byId(result, 1).xPx).not.toBe(byId(result, 2).xPx);
  });
  it('keeps MV grounding in a separate right default family and includes it in explicit MV override', () => {
    const cables = [cable(1, 'MV'), cable(2, 'Grounding'), cable(3, 'Power'), cable(4, 'Control')];
    const result = computeTrayDrawing(input(cables));
    expect(byId(result, 1).side).toBe('left'); expect(byId(result, 2).side).toBe('right');
    const ordered = result.placements.filter(p => p.side === 'right').sort((a, b) => a.xPx - b.xPx);
    for (let index = 1; index < ordered.length; index++) expect(ordered[index].xPx - ordered[index].radiusPx).toBeGreaterThanOrEqual(ordered[index - 1].xPx + ordered[index - 1].radiusPx);
    const moved = computeTrayDrawing(input(cables, modes({ mv: 'left' })));
    expect(byId(moved, 2).side).toBe('left'); expect(moved.summary?.trefoilClamps).toHaveLength(0);
  });
  it('reserves a partial right VFD column before a second incompatible profile', () => {
    const result = computeTrayDrawing(input([cable(1, 'MV', 8), cable(2, 'VFD', 20), cable(3, 'Control', 20)]));
    const vfd = byId(result, 2), control = byId(result, 3);
    expect(control.xPx + control.radiusPx).toBeLessThanOrEqual(vfd.xPx - vfd.radiusPx - 1);
  });
  it('excludes the central free gap from both occupancy measures', () => {
    const result = computeTrayDrawing(input([cable(1, 'Power'), cable(2, 'Control')]));
    expect(result.summary?.occupiedWidthWithBundleSpacingMm).toBe(40);
    expect(result.summary?.occupiedWidthWithoutBundleSpacingMm).toBe(40);
    expect(result.summary?.centralFreeGapMm).toBe(558);
    expect(dividers(result)).toHaveLength(1);
  });
  it('reports actual side overlap and cannot draw a divider over occupied cable envelopes', () => {
    const result = computeTrayDrawing(input([cable(1, 'Power'), cable(2, 'Control')], modes(), { tray: { name: 'Narrow', widthMm: 30, heightMm: 100 } }));
    expect(result.diagnostics.map(d => d.code)).toContain('DRAWING_OVERFLOW');
    expect(result.diagnostics.map(d => d.code)).toContain('DIVIDER_GAP_UNAVAILABLE');
    expect(dividers(result)).toHaveLength(0);
    expect(result.summary?.overflowMm).toBeGreaterThan(0);
  });
  it('keeps custom inclusive bounds distinct from rounded legacy labels', () => {
    const cables = [cable(1, 'Power', 8.05), cable(2, 'Control', 8.05)];
    const source = input(cables, modes({ control: 'left' }));
    source.options!.customRanges = { control: [{ id: 'custom', min: 8.1, max: 15 }] };
    expect(() => computeTrayDrawing(source)).toThrow('DRAWING_BUNDLE_RANGE_MISMATCH');
  });
  it('honors custom range maxRows without requiring a second row-override map', () => {
    const source = input([cable(1, 'Power'), cable(2, 'Power'), cable(3, 'Power')]);
    source.cableBundles = { power: { '19-21': source.cablesOnTray } };
    source.options!.customRanges = { power: [{ id: 'custom', min: 19, max: 21, maxRows: 1 }] };
    const result = computeTrayDrawing(source);
    expect(new Set(result.placements.map(p => p.yPx)).size).toBe(1);
  });
  it('does not synthesize a grounding conductor from tray weight settings', () => {
    expect(computeTrayDrawing(input([])).placements).toHaveLength(0);
  });
  it('is deterministic and pure across repeated server/browser DTO roundtrips', () => {
    const source = input([cable(1, 'Power'), cable(2, 'Control')]); const before = JSON.stringify(source);
    const first = computeTrayDrawing(source), second = computeTrayDrawing(JSON.parse(before));
    expect(second).toEqual(first); expect(JSON.stringify(source)).toBe(before);
    const target = createRecordingCanvas(); replayTrayDrawing(target.canvas, JSON.parse(JSON.stringify(first)));
    expect(target.commands).toEqual(first.commands); expect(target.canvas.width).toBe(first.widthPx);
  });
});

describe('drawing DTO and bounded execution guards', () => {
  it('checks the bounded recorder deadline without waiting or mutating runtime state', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100);
    try { const recorder = createRecordingCanvas(); now.mockReturnValue(5101); expect(() => recorder.context.beginPath()).toThrow('DRAWING_COMPUTE_DEADLINE'); }
    finally { now.mockRestore(); }
  });
  it.each([NaN, Infinity, -Infinity])('rejects nonfinite scale %s before placement', value => expect(() => computeTrayDrawing({ ...input([]), canvasScale: value })).toThrow());
  it('rejects duplicate, missing, moved and category-mismatched cable membership', () => {
    const source = input([cable(1, 'Power')]);
    expect(() => computeTrayDrawing({ ...source, cablesOnTray: [...source.cablesOnTray, ...source.cablesOnTray] })).toThrow('DRAWING_DUPLICATE_CABLE');
    expect(() => computeTrayDrawing({ ...source, cableBundles: {} })).toThrow('DRAWING_MEMBERSHIP_MISMATCH');
    expect(() => computeTrayDrawing({ ...source, cableBundles: { power: { '15.1-21': [{ ...source.cablesOnTray[0], fromLocation: 'moved' }] } } })).toThrow('DRAWING_MEMBERSHIP_MISMATCH');
    expect(() => computeTrayDrawing({ ...source, cableBundles: { control: { '15.1-21': source.cablesOnTray } } })).toThrow('DRAWING_CATEGORY_MISMATCH');
  });
  it('rejects unknown bundle labels, overlapping ranges, unbounded config and canvas output', () => {
    const source = input([cable(1, 'Power')]);
    expect(() => computeTrayDrawing({ ...source, cableBundles: { power: { pretend: source.cablesOnTray } } })).toThrow('DRAWING_BUNDLE_RANGE_UNKNOWN');
    expect(() => computeTrayDrawing({ ...source, options: { customRanges: { power: [{ id: 'a', min: 1, max: 10 }, { id: 'b', min: 10, max: 20 }] } } })).toThrow('DRAWING_CUSTOM_RANGE_OVERLAP');
    const config = defaultCategoryLayoutConfig(); config.power.maxRows = 1001;
    expect(() => computeTrayDrawing({ ...source, layoutConfig: config })).toThrow();
    expect(() => computeTrayDrawing({ ...source, tray: { name: 'Huge', widthMm: 100000, heightMm: 100000 } })).toThrow();
  });
  it('retains missing diameter fallback with an explicit diagnostic and missing dimensions state', () => {
    const result = computeTrayDrawing(input([cable(1, 'Power', 0)]));
    expect(result.diagnostics[0].code).toBe('CABLE_DIAMETER_DEFAULTED'); expect(result.placements[0].radiusPx).toBe(0.5);
    const missing = computeTrayDrawing(input([], modes(), { tray: { name: 'Missing', widthMm: null, heightMm: null } }));
    expect(missing.summary).toBeNull(); expect(missing.diagnostics[0].code).toBe('TRAY_DIMENSIONS_REQUIRED');
  });
  it('rejects unknown layout versions, nonfinite placements, arbitrary canvas ops/properties and unbalanced context', () => {
    const source = computeTrayDrawing(input([]));
    for (const change of [{ schemaVersion: 'legacy' }, { algorithmVersion: 'legacy' }, { commands: [{ op: 'drawImage', args: ['https://example.invalid'] }] }, { commands: [{ op: 'set', key: '__proto__', value: 'x' }] }, { commands: [{ op: 'restore', args: [] }] }, { placements: [{ cableId: 'a', displayNumber: 1, category: 'mv', side: 'left', xPx: Infinity, yPx: 0, radiusPx: 1 }] }]) expect(() => parseTrayDrawingLayout({ ...source, ...change })).toThrow();
    expect(() => validateDrawingCommands([{ op: 'save', args: [] }])).toThrow('DRAWING_STACK_INVALID');
    expect(() => validateDrawingCommands([{ op: 'arc', args: [0, 0, -1, 0, 6.28, false] }])).toThrow('DRAWING_NUMBER_INVALID');
  });
});
