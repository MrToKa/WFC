import { describe, expect, it } from 'vitest';
import { createProjectSchema, updateProjectSchema } from './validators.js';

describe('project cable length settings', () => {
  it('accepts updates containing only one allowance, including zero and decimals', () => {
    expect(updateProjectSchema.parse({ additionalBendingPercent: 0 })).toEqual({ additionalBendingPercent: 0 });
    expect(updateProjectSchema.parse({ endConnectionLength: 2.5 })).toEqual({ endConnectionLength: 2.5 });
  });

  it.each(['additionalBendingPercent', 'endConnectionLength'])('rejects invalid %s values', (field) => {
    for (const value of [-1, null, Infinity, NaN, 1_000_001]) {
      expect(updateProjectSchema.safeParse({ [field]: value }).success).toBe(false);
    }
  });

  it('accepts project creation with and without custom allowances', () => {
    const project = { projectNumber: 'P1', name: 'Project', customer: 'Customer' };
    expect(createProjectSchema.safeParse(project).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...project, additionalBendingPercent: 15, endConnectionLength: 3 }).success).toBe(true);
  });
});
