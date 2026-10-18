import { z } from 'zod';

export const PURPOSE_POLICY_LIMITS = Object.freeze({writeBytes:1024*1024,responseBytes:64*1024*1024,catalogRows:100000,pageSize:1000,purposes:4096,historyRows:100,rawText:65536});
const complete=(pattern:RegExp)=>(value:string)=>pattern.exec(value)?.[0]===value;
export const policyUuidSchema=z.string().length(36).refine(complete(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/));
export const policyRevisionSchema=z.string().refine(complete(/^(?:0|[1-9][0-9]{0,18})$/)).refine(value=>/^[0-9]+$/.test(value)&&BigInt(value)<=9223372036854775807n);
export const policyHashSchema=z.string().length(64).refine(complete(/^[a-f0-9]{64}$/));
const timestamp=z.string().datetime({offset:false}).refine(value=>value.endsWith('Z')&&!/[\u0000-\u0020]/u.test(value));
const control=/[\u0000-\u001f\u007f-\u009f]/u;
const wellFormed=(value:string)=>[...value].every(character=>character.length!==1||character.charCodeAt(0)<0xd800||character.charCodeAt(0)>0xdfff);
export const normalizeCatalogKey=(value:string):string=>value.normalize('NFC').trim();
export const purposeKeySchema=z.string().min(1).max(500).refine(value=>wellFormed(value)&&!control.test(value)&&normalizeCatalogKey(value)===value,'A purpose key must already be normalized.');
export const routingCategorySchema=z.enum(['MV','LV','Control']);
const categoryOrder=['MV','LV','Control'] as const;
export const routingCategoriesSchema=z.array(routingCategorySchema).max(3).refine(values=>values.every((value,index)=>index===0||categoryOrder.indexOf(values[index-1])<categoryOrder.indexOf(value)),'Categories must be unique and in MV, LV, Control order.');
export const routingRuleSchema=z.object({purposeKey:purposeKeySchema,allowedCategories:routingCategoriesSchema}).strict();
const uniquePurposes=(values:{purposeKey:string}[])=>new Set(values.map(value=>value.purposeKey)).size===values.length;
export const routePurposePolicySchema=z.object({schemaVersion:z.literal('pathfinder.routing-purpose-policy.v1'),projectId:policyUuidSchema,catalogRevision:policyRevisionSchema,routingPolicyRevision:policyRevisionSchema,rules:z.array(routingRuleSchema).max(PURPOSE_POLICY_LIMITS.purposes).refine(uniquePurposes)}).strict();
const changeSchema=z.discriminatedUnion('operation',[z.object({purposeKey:purposeKeySchema,operation:z.literal('set'),allowedCategories:routingCategoriesSchema}).strict(),z.object({purposeKey:purposeKeySchema,operation:z.literal('reset')}).strict()]);
export const routePurposeWriteSchema=z.object({schemaVersion:z.literal('pathfinder.routing-purpose-policy.write.v1'),expectedCatalogRevision:policyRevisionSchema,expectedRevision:policyRevisionSchema,idempotencyKey:policyUuidSchema,changes:z.array(changeSchema).min(1).max(PURPOSE_POLICY_LIMITS.purposes).refine(uniquePurposes)}).strict();
export const policySaveSchema=z.object({schemaVersion:z.literal('pathfinder.policy-save.v1'),projectId:policyUuidSchema,domain:z.literal('routing'),catalogRevision:policyRevisionSchema,previousRevision:policyRevisionSchema,revision:policyRevisionSchema,auditId:policyUuidSchema,duplicate:z.boolean()}).strict();
export const policyRevisionsSchema=z.object({catalogRevision:policyRevisionSchema,routingPolicyRevision:policyRevisionSchema,drawingPolicyRevision:policyRevisionSchema}).strict();
export const policyErrorSchema=z.object({schemaVersion:z.literal('pathfinder.policy-error.v1'),code:z.string().refine(complete(/^[A-Z][A-Z0-9_]{0,95}$/)),message:z.string().max(2048),currentRevisions:policyRevisionsSchema.nullable()}).strict();
export const policyAuditSchema=z.object({auditId:policyUuidSchema,projectId:policyUuidSchema,domain:z.literal('routing'),actorId:policyUuidSchema,loginId:policyUuidSchema,occurredAt:timestamp,catalogRevision:policyRevisionSchema,previousRevision:policyRevisionSchema,revision:policyRevisionSchema,idempotencyKey:policyUuidSchema,requestSha256:policyHashSchema,beforeRules:z.array(routingRuleSchema).max(PURPOSE_POLICY_LIMITS.purposes).refine(uniquePurposes),afterRules:z.array(routingRuleSchema).max(PURPOSE_POLICY_LIMITS.purposes).refine(uniquePurposes)}).strict();
export const policyHistorySchema=z.object({schemaVersion:z.literal('pathfinder.policy-history.v1'),projectId:policyUuidSchema,domain:z.literal('routing'),events:z.array(policyAuditSchema).max(PURPOSE_POLICY_LIMITS.historyRows),nextBeforeRevision:policyRevisionSchema.nullable()}).strict();
const decimal=z.string().max(100).refine(complete(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/));
// Raw legacy invalid values remain visible with diagnostics; authoring keys use the strict bound above.
const raw=z.string().max(PURPOSE_POLICY_LIMITS.rawText);
export const catalogRowSchema=z.object({projectTrayId:policyUuidSchema,rawName:raw,nameKey:raw,rawPurpose:raw.nullable(),purposeKey:raw.nullable(),dimensionsMm:z.object({width:decimal.nullable(),height:decimal.nullable(),declaredLength:decimal.nullable()}).strict()}).strict();
export const catalogDiagnosticSchema=z.object({code:z.string().refine(complete(/^[A-Z][A-Z0-9_]{0,95}$/)),projectTrayIds:z.array(policyUuidSchema).max(PURPOSE_POLICY_LIMITS.catalogRows),message:z.string().max(2048)}).strict();
const catalogMetadataSchema=z.object({schemaVersion:z.literal('pathfinder.project-tray-catalog.v1'),projectId:policyUuidSchema,catalogRevision:policyRevisionSchema,normalizationVersion:z.literal('nfc-trim-case-sensitive-v1'),snapshotId:policyUuidSchema,sourceProjectionSha256:policyHashSchema,dependencyFactsSha256:policyHashSchema,routingContentSha256:policyHashSchema,contentSha256:policyHashSchema,recordedAt:timestamp,rowCount:z.number().int().min(0).max(PURPOSE_POLICY_LIMITS.catalogRows),diagnostics:z.array(catalogDiagnosticSchema).max(PURPOSE_POLICY_LIMITS.catalogRows)}).strict();
export const catalogSchema=catalogMetadataSchema.extend({rows:z.array(catalogRowSchema).max(PURPOSE_POLICY_LIMITS.catalogRows)}).strict().refine(value=>value.rows.length===value.rowCount&&new Set(value.rows.map(row=>row.projectTrayId)).size===value.rows.length,'A complete catalog requires all unique rows.');
export const catalogManifestSchema=z.object({schemaVersion:z.literal('pathfinder.catalog-manifest.v1'),catalog:catalogMetadataSchema,pageSize:z.literal(1000),pageCount:z.number().int().min(0).max(100),manifestSha256:policyHashSchema}).strict().refine(value=>value.pageCount===Math.ceil(value.catalog.rowCount/value.pageSize));
export const catalogPageSchema=z.object({schemaVersion:z.literal('pathfinder.catalog-page.v1'),projectId:policyUuidSchema,snapshotId:policyUuidSchema,contentSha256:policyHashSchema,pageIndex:z.number().int().min(0).max(99),rowCount:z.number().int().min(0).max(PURPOSE_POLICY_LIMITS.catalogRows),rows:z.array(catalogRowSchema).max(1000),complete:z.boolean()}).strict();
export type RoutingPurposePolicy=z.infer<typeof routePurposePolicySchema>;
export type RoutingPurposeWrite=z.infer<typeof routePurposeWriteSchema>;
export type PolicySaveReceipt=z.infer<typeof policySaveSchema>;
export type PolicyHistory=z.infer<typeof policyHistorySchema>;
export type PolicyError=z.infer<typeof policyErrorSchema>;
export type CatalogEnvelope=z.infer<typeof catalogSchema>;
export type CatalogRow=z.infer<typeof catalogRowSchema>;
export type CatalogDiagnostic=z.infer<typeof catalogDiagnosticSchema>;
export type CatalogManifest=z.infer<typeof catalogManifestSchema>;
export type CatalogPage=z.infer<typeof catalogPageSchema>;
export type RoutingCatalogScope={catalogRevision:string;routingContentSha256:string};
export type RoutingPolicyScope=RoutingCatalogScope&{routingPolicyRevision:string;routingPolicySha256:string};

export function canonicalPurposeJson(value:unknown):string {
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('NON_FINITE_POLICY_JSON');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(canonicalPurposeJson).join(',')+']';
  if(value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value)))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalPurposeJson((value as Record<string,unknown>)[key])).join(',')+'}';
  throw new Error('INVALID_POLICY_JSON_VALUE');
}
export function catalogContentHashInput(catalog:CatalogEnvelope):unknown {const {contentSha256:_hash,snapshotId:_id,recordedAt:_time,...input}=catalog;return input;}
export function catalogManifestHashInput(manifest:CatalogManifest):unknown {const {manifestSha256:_hash,...input}=manifest;return input;}
const routingDiagnosticCodes=new Set(['TRAY_NAME_COLLISION','PURPOSE_NORMALIZATION_COLLISION','MISSING_TRAY_PURPOSE','INVALID_TRAY_NAME','INVALID_TRAY_PURPOSE','UNSUPPORTED_ROUTE_CODE']);
/** Routing authoring and its hash share an explicit allowlist; drawing and unknown codes stay outside this domain. */
export function routingCatalogDiagnostics(diagnostics:CatalogDiagnostic[]):CatalogDiagnostic[] {
  return diagnostics.filter(item=>routingDiagnosticCodes.has(item.code));
}
export function catalogRoutingHashInput(projectId:string,rows:CatalogRow[],diagnostics:CatalogDiagnostic[]):unknown {
  return {schemaVersion:'pathfinder.routing-catalog-content.v1',projectId,rows:rows.map(({projectTrayId,rawName,nameKey,rawPurpose,purposeKey})=>({projectTrayId,rawName,nameKey,rawPurpose,purposeKey})),diagnostics:routingCatalogDiagnostics(diagnostics)};
}

/** Duplicate keys, including escaped spellings, are rejected before JSON.parse discards them. */
export function parsePurposeJson(text:string,{maximumBytes=PURPOSE_POLICY_LIMITS.writeBytes}:{maximumBytes?:number}={}):unknown {
  if(typeof text!=='string'||!Number.isSafeInteger(maximumBytes)||maximumBytes<1||maximumBytes>PURPOSE_POLICY_LIMITS.responseBytes||new TextEncoder().encode(text).byteLength>maximumBytes)throw new Error('POLICY_JSON_LIMIT');
  let at=0;const invalid=():never=>{throw new Error('INVALID_POLICY_JSON');};
  const space=()=>{while(at<text.length&&/[\u0020\t\r\n]/.test(text[at]))at++;};
  const string=():string=>{const start=at++;while(at<text.length){const character=text[at++];if(character==='\\')at++;else if(character==='"'){try{return JSON.parse(text.slice(start,at)) as string;}catch{return invalid();}}}return invalid();};
  const value=(depth:number):void=>{if(depth>48)invalid();space();if(text[at]==='{'){at++;space();const keys=new Set<string>();if(text[at]==='}'){at++;return;}for(;;){if(text[at]!== '"')invalid();const key=string();if(keys.has(key))invalid();keys.add(key);space();if(text[at++]!==':')invalid();value(depth+1);space();const end=text[at++];if(end==='}')return;if(end!==',')invalid();space();}}
    if(text[at]==='['){at++;space();if(text[at]===']'){at++;return;}for(;;){value(depth+1);space();const end=text[at++];if(end===']')return;if(end!==',')invalid();}}
    if(text[at]==='"'){string();return;}const token=/^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/.exec(text.slice(at));if(!token)invalid();at+=token![0].length;};
  value(0);space();if(at!==text.length)invalid();let result:unknown;try{result=JSON.parse(text);}catch{return invalid();}
  const finite=(item:unknown):void=>{if(typeof item==='number'&&!Number.isFinite(item))invalid();if(item&&typeof item==='object')for(const child of Object.values(item))finite(child);};finite(result);return result;
}
