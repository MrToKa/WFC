import { createHash } from 'node:crypto';
import { canonicalPurposeJson,policyHashSchema,policyRevisionSchema,policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';

const namespace=Buffer.from('9d8fb2b9635552f39f6f4d8b82c24fe7','hex');
/** UUIDv5 binds one immutable initial-fill intent; no caller-chosen replacement key. */
export function initialFillIdempotencyKey(input:{projectId:string;cableId:string;proposalId:string;proposalHash:string;mandateId:string;expectedCableWriteRevision:string}):string{
  const body={projectId:policyUuidSchema.parse(input.projectId),cableId:policyUuidSchema.parse(input.cableId),
    proposalId:policyUuidSchema.parse(input.proposalId),proposalHash:policyHashSchema.parse(input.proposalHash),
    mandateId:policyUuidSchema.parse(input.mandateId),expectedCableWriteRevision:policyRevisionSchema.parse(input.expectedCableWriteRevision)};
  const bytes=createHash('sha1').update(namespace).update(canonicalPurposeJson(body),'utf8').digest().subarray(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x50;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
