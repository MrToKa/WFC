// @vitest-environment node
import { describe,expect,it } from 'vitest';
import { designLengthCompatibilityIssue } from './jobContracts.js';

describe('shared WFC design-length applicability boundary',()=>{
  it.each(['0','1','1000000'])('permits canonical supported length %s',value=>{
    expect(designLengthCompatibilityIssue(value)).toBeNull();
  });
  it.each([undefined,null,1000000,'1000001','1.1','01','+1','-1','1e6',' 1','1 ','1\n','1.0','10000000000000000000000000'])('rejects unsupported or noncanonical length %s',value=>{
    expect(designLengthCompatibilityIssue(value)).toContain('1,000,000');
  });
});
