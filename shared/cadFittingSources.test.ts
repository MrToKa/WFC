// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FITTING_SOURCES } from './cadFittingSources.js';
import { getAalborgPocPorts } from './cadPocPorts.js';
import { getInstanceCadPorts, supportsStraightCut } from './cadLengths.js';
import { rotateVector } from './cadTransforms.js';
import measurements from './fixtures/cad-fitting-terminals.json';

describe('source-pinned Niedax fitting terminal frames', () => {
  it.each(FITTING_SOURCES)(
    'matches STEP terminal planes and outward normals: $filename',
    (source) => {
      const measured = measurements.find((row) => row.name === source.filename)!;
      expect(measured.sha256).toBe(source.sha256);
      expect(measured.valid).toBe(true);
      expect(measured.solids).toBe(1);
      const ports = getAalborgPocPorts(source.filename, source.sha256);
      expect(ports).toHaveLength(measured.endPlanes.length);
      for (const plane of measured.endPlanes) {
        const center = plane.bounds
          .slice(0, 3)
          .map((value, index) => (value + plane.bounds[index + 3]) / 2);
        const port = ports.find((row) =>
          [row.local.position.x, row.local.position.y, row.local.position.z].every(
            (value, index) => Math.abs(value - center[index]) < 1e-6,
          ),
        );
        expect(port).toBeDefined();
        const outward = rotateVector({ x: 0, y: 0, z: 1 }, port!.local.rotation);
        [outward.x, outward.y, outward.z].forEach((value, index) => {
          expect(value).toBeCloseTo(plane.faces[0].normal[index], 6);
        });
        expect(port!.profile).toBe('60x300');
        expect(plane.faceCount).toBe(2);
        expect(plane.totalArea).toBeCloseTo(301.5, 6);
      }
    },
  );

  it.each(FITTING_SOURCES)(
    'rejects altered or crossed source identities and cuts: $filename',
    (source) => {
      expect(getAalborgPocPorts(source.filename, '0'.repeat(64))).toEqual([]);
      expect(getAalborgPocPorts('unverified.step', source.sha256)).toEqual([]);
      const other = FITTING_SOURCES.find((row) => row.sha256 !== source.sha256)!;
      expect(getAalborgPocPorts(source.filename, other.sha256)).toEqual([]);
      expect(supportsStraightCut(source.filename, source.sha256)).toBe(false);
      expect(getInstanceCadPorts(source.filename, source.sha256, 1500)).toEqual([]);
    },
  );
});
