import {z} from 'zod';
import {policyUuidSchema,policyRevisionSchema,canonicalPurposeJson} from './pathfinderPurposePolicy.js';
import {backgroundRecalculationPreferencesSchema,recalculationTimeoutSchema,recalculationReasonSchema} from './pathfinderRecalculation.js';

export const CALCULATION_GRANT_OPERATIONS=['prepare','trace','compare','match-suggest','calculate'] as const;
export const CALCULATION_GRANT_LIMITS=Object.freeze({controlBytes:64*1024,responseBytes:1024*1024,executionLeaseMilliseconds:15*60_000,
  acquisitionMilliseconds:5000,lockMilliseconds:3000,statementMilliseconds:15000,idleMilliseconds:30000,commandsPerProject:4096,
  revisionsPerProject:4096,leaseHistoryPerProject:4096,activeGlobalLeases:1,activeProjectLeases:1,reasonCodes:64} as const);
export const calculationGrantOperationSchema=z.enum(CALCULATION_GRANT_OPERATIONS);
export type CalculationGrantOperation=z.infer<typeof calculationGrantOperationSchema>;
/** Persistent audit/currentness reference. Finite execution secrets never enter proposal or capture history. */
export const calculationGrantProvenanceSchema=z.object({kind:z.literal('calculation-grant'),projectId:policyUuidSchema,grantId:policyUuidSchema,
  grantRevision:policyRevisionSchema,grantEpoch:policyRevisionSchema,installationEpoch:policyUuidSchema,issuerId:policyUuidSchema,issuerAdminRevision:policyRevisionSchema}).strict();
export type CalculationGrantProvenance=z.infer<typeof calculationGrantProvenanceSchema>;
const timestamp=z.string().datetime({offset:false}).refine(value=>value.endsWith('Z')&&!/[\u0000-\u0020]/u.test(value));
const text=z.string().max(2048).refine(value=>!/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  &&[...value].every(character=>character.length!==1||character.charCodeAt(0)<0xd800||character.charCodeAt(0)>0xdfff));
const operations=z.array(calculationGrantOperationSchema).length(CALCULATION_GRANT_OPERATIONS.length)
  .refine(values=>values.every((value,index)=>value===CALCULATION_GRANT_OPERATIONS[index]));
export const calculationGrantSchema=z.object({schemaVersion:z.literal('wfc.pf.calculation-grant.v1'),projectId:policyUuidSchema,id:policyUuidSchema,
  grantRevision:policyRevisionSchema,grantEpoch:policyRevisionSchema,installationEpoch:policyUuidSchema,enabled:z.boolean(),enabledBy:policyUuidSchema,
  enabledAt:timestamp,updatedAt:timestamp,issuerAdminRevision:policyRevisionSchema,scope:z.literal('active-model'),operations,
  limitsProfile:z.literal('local-bounded-v1'),preferences:backgroundRecalculationPreferencesSchema,timeoutMilliseconds:recalculationTimeoutSchema}).strict();
export const calculationGrantProducerStatusSchema=z.object({status:z.enum(['unqualified','ready','running','blocked','quarantined']),reasonCode:recalculationReasonSchema.nullable()}).strict();
export const calculationGrantContextSchema=z.object({schemaVersion:z.literal('wfc.pf.calculation-grant-context.v1'),projectId:policyUuidSchema,
  controlRevision:policyRevisionSchema,grant:calculationGrantSchema.nullable(),status:z.enum(['disabled','enabled','revoked','restore-fenced','blocked']),
  reasonCodes:z.array(recalculationReasonSchema).max(CALCULATION_GRANT_LIMITS.reasonCodes).refine(values=>new Set(values).size===values.length),
  producer:calculationGrantProducerStatusSchema}).strict().superRefine((value,context)=>{
    if(value.grant&&value.grant.projectId!==value.projectId)context.addIssue({code:'custom',message:'The grant belongs to this exact project.'});
    if(value.grant&&value.grant.grantRevision!==value.controlRevision)context.addIssue({code:'custom',message:'The live head and grant revision agree.'});
    if((!value.grant||!value.grant.enabled)&&value.status!=='disabled')context.addIssue({code:'custom',message:'An absent or disabled grant is disabled.'});
    if(value.status==='enabled'&&!value.grant?.enabled)context.addIssue({code:'custom',message:'Enabled status requires a live enabled grant.'});
  });
const base={schemaVersion:z.literal('wfc.pf.calculation-grant-command.v1'),expectedControlRevision:policyRevisionSchema,idempotencyKey:policyUuidSchema,
  reason:text.refine(value=>value.trim().length>0)};
export const calculationGrantCommandSchema=z.discriminatedUnion('action',[
  z.object({...base,action:z.literal('enable'),preferences:backgroundRecalculationPreferencesSchema,timeoutMilliseconds:recalculationTimeoutSchema}).strict(),
  z.object({...base,action:z.literal('disable')}).strict(),
]);
export const calculationGrantReceiptSchema=z.object({schemaVersion:z.literal('wfc.pf.calculation-grant-receipt.v1'),duplicate:z.boolean(),context:calculationGrantContextSchema}).strict();
export const calculationGrantErrorSchema=z.object({schemaVersion:z.literal('wfc.pf.calculation-grant-error.v1'),code:recalculationReasonSchema,message:text,
  outcome:z.enum(['refused','unknown']),currentControlRevision:policyRevisionSchema.nullable()}).strict();
export type CalculationGrant=z.infer<typeof calculationGrantSchema>;
export type CalculationGrantContext=z.infer<typeof calculationGrantContextSchema>;
export type CalculationGrantCommand=z.infer<typeof calculationGrantCommandSchema>;
export type CalculationGrantReceipt=z.infer<typeof calculationGrantReceiptSchema>;
export type CalculationGrantError=z.infer<typeof calculationGrantErrorSchema>;
export type CalculationGrantProducerStatus=z.infer<typeof calculationGrantProducerStatusSchema>;
export function calculationGrantCommandCanonicalJson(command:CalculationGrantCommand):string{return canonicalPurposeJson(calculationGrantCommandSchema.parse(command));}
