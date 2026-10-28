import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { drawingInputHashInput, trayDrawingDataSchema } from '../../shared/trayDrawingSnapshot.js';
import { mapCableRow, type CableWithTypeRow } from './cable.js';

const cable: CableWithTypeRow = {
  id: '00000000-0000-4000-8000-000000000001', project_id: '00000000-0000-4000-8000-000000000002',
  cable_id: 1, revision: 'A', mto: 'LV', tag: 'Synthetic cable', cable_type_id: '00000000-0000-4000-8000-000000000003',
  from_location: 'Synthetic From', to_location: 'Synthetic To', routing: '/SYNTHETIC', delivery: null,
  design_length: '37', install_length: '42', pull_date: null, connected_from: null, connected_to: null, tested: null,
  created_at: '2026-10-21T00:00:00.000Z', updated_at: '2026-10-21T00:00:00.000Z', type_name: 'Synthetic type',
  type_purpose: 'power', type_diameter_mm: '12', type_weight_kg_per_m: '0.3',
};

describe('ordinary cable model and the read-only Auto projection', () => {
  it('does not invent Auto from existing routing, design or tray lengths', () => {
    expect(mapCableRow(cable)).toEqual(expect.objectContaining({
      routing: '/SYNTHETIC', designLength: 37, installLength: 42,
    }));
    expect(mapCableRow(cable)).not.toHaveProperty('autoCalculatedLength');
    expect(mapCableRow(cable)).not.toHaveProperty('autoLengthStatus');
  });

  it('does not accept Auto-shaped fields incidentally supplied on the business row', () => {
    const injected = { ...cable, autoCalculatedLength: 800, autoLengthStatus: 'calculated',
      autoLengthCalculatedAt: '2026-10-21T12:00:00.000Z', autoLengthMatchesLatestRequest: true };
    expect(mapCableRow(injected)).toEqual(mapCableRow(cable));
  });

  it('remains safe as an Array.map callback used by drawing snapshots', () => {
    expect([cable, { ...cable, design_length: 81 }].map(mapCableRow)).toEqual([
      expect.objectContaining({ designLength: 37 }),
      expect.objectContaining({ designLength: 81 }),
    ]);
  });

  it('preserves the existing v1 drawing input hash instead of adding ordinary API display metadata', () => {
    // Explicit pre-Auto business payload: passthrough drawing schemas retain
    // extra fields, so an accidental Auto default would change this real hash.
    const legacyCable = {
      id: cable.id, projectId: cable.project_id, cableId: 1, revision: 'A', mto: 'LV', tag: 'Synthetic cable',
      cableTypeId: cable.cable_type_id, typeName: 'Synthetic type', purpose: 'power', diameterMm: 12, weightKgPerM: 0.3,
      fromLocation: 'Synthetic From', toLocation: 'Synthetic To', routing: '/SYNTHETIC', delivery: null,
      designLength: 37, installLength: 42, pullDate: null, connectedFrom: null, connectedTo: null, tested: null,
      createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
    };
    const dates = { createdAt: legacyCable.createdAt, updatedAt: legacyCable.updatedAt };
    const tray = { id: '00000000-0000-4000-8000-000000000004', projectId: cable.project_id, name: 'SYNTHETIC',
      type: 'Synthetic', purpose: 'Shared', widthMm: 300, heightMm: 100, lengthMm: 1000,
      includeGroundingCable: false, groundingCableTypeId: null, ...dates };
    const project = { id: cable.project_id, projectNumber: 'SYN', name: 'Synthetic', customer: 'Test', manager: null,
      description: null, connectionGap: 1, secondaryTrayLength: 7, supportDistance: null, supportWeight: null,
      additionalBendingPercent: 10, endConnectionLength: 5, trayLoadSafetyFactor: null, supportDistanceOverrides: {},
      trayPurposeTemplates: {}, cableLayout: { cableSpacing: 1, considerBundleSpacingAsFree: false, minFreeSpacePercent: null,
        maxFreeSpacePercent: null, mv: null, power: null, vfd: null, control: null, customBundleRanges: null }, ...dates };
    const drawingData = (input: typeof legacyCable) => trayDrawingDataSchema.parse({ project, tray, reportTrays: [tray],
      cables: [input], trayCables: [input], materialTrays: [], cableTypes: [], materialSupports: [], loadCurves: [] });
    const hash = (input: unknown) => createHash('sha256').update(canonicalPurposeJson(input)).digest('hex');
    const actual = drawingInputHashInput(drawingData(mapCableRow(cable) as typeof legacyCable), 'a'.repeat(64));
    const baseline = drawingInputHashInput(drawingData(legacyCable), 'a'.repeat(64));
    expect(hash(actual)).toBe(hash(baseline));
  });
});
