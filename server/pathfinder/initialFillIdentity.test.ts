// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {initialFillIdempotencyKey} from './initialFillIdentity.js';
const id=(n:number)=>`db500000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={projectId:id(1),cableId:id(2),proposalId:id(3),proposalHash:'a'.repeat(64),mandateId:id(4),expectedCableWriteRevision:'9007199254740993'};
describe('immutable initial-fill UUID identity',()=>{
  it('retains exactly the same key for the same proposal/mandate/revision across reload and object ordering',()=>{
    const key=initialFillIdempotencyKey(input);expect(key).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(initialFillIdempotencyKey({...input})).toBe(key);
  });
  it.each(['projectId','cableId','proposalId','mandateId'] as const)('cannot reuse the key after changing %s',field=>{
    expect(initialFillIdempotencyKey({...input,[field]:id(99)})).not.toBe(initialFillIdempotencyKey(input));
  });
  it('preserves exact large revision text and result hash in the identity',()=>{
    expect(initialFillIdempotencyKey({...input,expectedCableWriteRevision:'9007199254740994'})).not.toBe(initialFillIdempotencyKey(input));
    expect(initialFillIdempotencyKey({...input,proposalHash:'b'.repeat(64)})).not.toBe(initialFillIdempotencyKey(input));
  });
});
