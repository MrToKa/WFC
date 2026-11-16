import { getAalborgPocPorts } from './cadPocPorts.js';
import { getStraightSource } from './cadStraightSources.js';

export const STRAIGHT_SOURCE_LENGTH_MM = 6000;
export const STRAIGHT_SOURCE_SHA256 = 'd381a3f4a09559e99119e3e591137f73780d16bf832019f93b20627adc5609cd';

/** Verified sources share the local-Z 0..6000 mm stock cutting contract. */
export function supportsStraightCut(filename: string, sha256: string): boolean {
  return getStraightSource(filename, sha256) !== undefined;
}

export function normalizeCutLengthMm(value: number | null | undefined): number | null {
  if (value === undefined || value === null || value === STRAIGHT_SOURCE_LENGTH_MM) return null;
  if (!Number.isFinite(value) || value < 1 || value > STRAIGHT_SOURCE_LENGTH_MM) throw new Error('Length must be between 1 and 6000 mm.');
  return value;
}

export function effectiveStraightLengthMm(lengthMm?: number | null): number {
  return normalizeCutLengthMm(lengthMm) ?? STRAIGHT_SOURCE_LENGTH_MM;
}

export function getInstanceCadPorts(filename: string, sha256: string, lengthMm?: number | null) {
  const ports = getAalborgPocPorts(filename, sha256);
  if (lengthMm == null) return ports;
  if (!supportsStraightCut(filename, sha256)) return [];
  const length = effectiveStraightLengthMm(lengthMm);
  return ports.map(port => port.id === 'end' ? {
    ...port, label: `End end-face (Z=${length})`,
    local: { ...port.local, position: { ...port.local.position, z: length } },
  } : port);
}
