// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mapProjectRow, type ProjectRow } from './project.js';
import { createProjectSchema, updateProjectSchema } from '../validators.js';
import { drawingProjectSchema } from '../../shared/trayDrawingSnapshot.js';

const row = {
  id: '11111111-1111-4111-8111-111111111111', project_number: 'CAP', name: 'Capacity project', customer: 'Local fixture',
  created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z',
} as ProjectRow;

describe('project automatic free-space rerouting setting', () => {
  it.each([null, {}, { autoRerouteForFreeSpace: false }, { autoRerouteForFreeSpace: 'true' }, { autoRerouteForFreeSpace: 1 }])(
    'defaults missing or invalid historical settings to disabled: %j', cable_layout_settings => {
      const project = mapProjectRow({ ...row, cable_layout_settings } as ProjectRow);
      expect(project.cableLayout.autoRerouteForFreeSpace).toBe(false);
    },
  );
  it('retains the opted-in flag beside the actual project minimum and other layout fields', () => {
    const project = mapProjectRow({ ...row, cable_layout_settings: { autoRerouteForFreeSpace: true, minFreeSpacePercent: 42,
      maxFreeSpacePercent: 80, cableSpacing: 2, considerBundleSpacingAsFree: true, control: { maxRows: 4 } } });
    expect(project.cableLayout).toMatchObject({ autoRerouteForFreeSpace: true, minFreeSpacePercent: 42,
      maxFreeSpacePercent: 80, cableSpacing: 2, considerBundleSpacingAsFree: true, control: { maxRows: 4 } });
  });
  it.each([true, false])('accepts boolean %s for project creation and a partial update', flag => {
    const cableLayout = { autoRerouteForFreeSpace: flag };
    expect(updateProjectSchema.parse({ cableLayout }).cableLayout).toEqual(cableLayout);
    expect(createProjectSchema.parse({ projectNumber: 'CAP', name: 'Capacity project', customer: 'Fixture', cableLayout }).cableLayout).toEqual(cableLayout);
  });
  it.each(['true', 1, null, []])('rejects a nonboolean opt-in value: %j', flag => {
    expect(updateProjectSchema.safeParse({ cableLayout: { autoRerouteForFreeSpace: flag } }).success).toBe(false);
  });
  it('keeps legacy drawing inputs unchanged while accepting the new optional setting', () => {
    const project = mapProjectRow({ ...row, cable_layout_settings: { autoRerouteForFreeSpace: true, minFreeSpacePercent: 42 } });
    expect(drawingProjectSchema.parse(project).cableLayout.autoRerouteForFreeSpace).toBe(true);
    const old = structuredClone(project);
    delete old.cableLayout.autoRerouteForFreeSpace;
    expect(drawingProjectSchema.parse(old).cableLayout).not.toHaveProperty('autoRerouteForFreeSpace');
  });
});
