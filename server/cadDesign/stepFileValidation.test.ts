// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { csvCell, hasStepEnvelope, MAX_STEP_BYTES } from './stepFileValidation.js';

const valid = Buffer.from('ISO-10303-21;\nHEADER;\n' + 'A'.repeat(128) + '\nENDSEC;\nEND-ISO-10303-21;\n');

describe('STEP import preflight', () => {
  it('accepts a bounded STEP Part-21 envelope', () => {
    expect(hasStepEnvelope('NDX_KL_60-303_F_MED_214.step', valid)).toBe(true);
    expect(hasStepEnvelope('NDX_KLBK_60-303_MED_214.stp', valid)).toBe(true);
  });
  it('does not treat an arbitrary renamed file as STEP', () => {
    expect(hasStepEnvelope('bad.step', Buffer.from('hello world'))).toBe(false);
    expect(hasStepEnvelope('renamed.pdf', valid)).toBe(false);
    expect(hasStepEnvelope('truncated.step', valid.subarray(0, 40))).toBe(false);
  });
  it('rejects a file exceeding the gateway import limit', () => {
    const oversized = Buffer.alloc(MAX_STEP_BYTES + 1, 65);
    expect(hasStepEnvelope('too-big.step', oversized)).toBe(false);
  });
});
describe('MTO spreadsheet safety', () => {
  it.each(['=1+2', '+SUM(1,1)', '-2+3', '@formula', ' \t=HYPERLINK("x")'])('neutralizes formula-looking cell %s', value => {
    expect(csvCell(value)).toMatch(/^"'[\s\S]*"$/);
  });
  it('quotes and escapes ordinary cells', () => {
    expect(csvCell('Product "A", 300mm')).toBe('"Product ""A"", 300mm"');
  });
});
