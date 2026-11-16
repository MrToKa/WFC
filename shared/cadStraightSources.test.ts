// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getStraightSource, STRAIGHT_SOURCES } from './cadStraightSources.js';

describe('measured Niedax straight sources', () => {
  it('matches all 30 independently measured STEP sources', () => {
    const measured = JSON.parse(readFileSync(new URL('../docs/routings-builder/evidence/niedax-straights-20261116/measured-registry.json', import.meta.url), 'utf8')) as Array<{
      filename: string; sha256: string; widthMm: number; heightMm: number; stockLengthMm: number;
    }>;
    expect(measured).toHaveLength(30);
    expect(STRAIGHT_SOURCES).toHaveLength(measured.length);
    for (const source of measured) {
      expect(getStraightSource(source.filename, source.sha256)).toEqual({
        filename: source.filename, sha256: source.sha256, widthMm: source.widthMm,
        heightMm: source.heightMm, lengthMm: source.stockLengthMm,
        centerXmm: 0, centerYmm: source.heightMm / 2,
      });
    }
  });

  it('rejects altered bytes, renamed geometry and crossed variant identities', () => {
    for (const [index, source] of STRAIGHT_SOURCES.entries()) {
      expect(getStraightSource(` ${source.filename.toLowerCase()} `, source.sha256)).toBe(source);
      expect(getStraightSource(source.filename, '0'.repeat(64))).toBeUndefined();
      expect(getStraightSource('NDX_KLBK_60-303_MED_214.step', source.sha256)).toBeUndefined();
      expect(getStraightSource(source.filename, STRAIGHT_SOURCES[(index + 1) % STRAIGHT_SOURCES.length].sha256)).toBeUndefined();
    }
  });
});
