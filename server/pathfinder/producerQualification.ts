import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {policyUuidSchema,policyHashSchema,canonicalPurposeJson} from '../../shared/pathfinderPurposePolicy.js';
import type {CalculationGrantProducerStatus} from '../../shared/pathfinderCalculationGrant.js';
import {pathFinderRoot} from './storage.js';

/** A root-retained measured local compatibility receipt, not vendor certification
 * or human engineering acceptance. No public/worker route can issue this record. */
export const producerQualificationSchema=z.object({schemaVersion:z.literal('wfc.pf.managed-producer-qualification.v1'),
  installationEpoch:policyUuidSchema,owner:policyUuidSchema,image:z.string().regex(/^sha256:[a-f0-9]{64}$(?![\s\S])/),runtimeInventorySha256:policyHashSchema,
  sdkVersion:z.literal('7.130.0'),playwrightVersion:z.literal('1.64.0'),browserVersion:z.string().min(1).max(128),browserSha256:policyHashSchema,
  sandbox:z.object({nonroot:z.literal(true),networkNone:z.literal(true),readOnlyRoot:z.literal(true),allCapabilitiesDropped:z.literal(true),
    pidNamespaces:z.literal(true),networkNamespaces:z.literal(true),seccompBpf:z.literal(true),seccompTsync:z.literal(true),webgl:z.literal(true),receiptSha256:policyHashSchema}).strict(),
  extraction:z.object({projectId:policyUuidSchema,modelVersionId:policyUuidSchema,contentFingerprint:policyHashSchema,
    sourceAggregateId:policyUuidSchema,managedAggregateId:policyUuidSchema,objects:z.number().int().positive(),
    exactObjectOrder:z.literal(true),exactCoordinates:z.literal(true),exactCategories:z.literal(true),exactGraph:z.literal(true),exactPathFinderResults:z.literal(true),receiptSha256:policyHashSchema}).strict(),
  closedBrowser:z.object({noHumanViewer:z.literal(true),prepare:z.literal(true),trace:z.literal(true),comparison:z.enum(['complete','no-earlier-trace']),
    proposals:z.number().int().positive(),noAutomaticApply:z.literal(true),receiptSha256:policyHashSchema}).strict(),
  engineeringAccepted:z.literal(false),nativeParity:z.literal('not-performed'),observedAt:z.string().datetime(),
}).strict();
export type ProducerQualification=z.infer<typeof producerQualificationSchema>;
export type ProducerQualificationConfiguration={owner:string;image:string;runtimeInventorySha256:string;expectedSha256?:string;canQualifyProject?:string};
export function qualificationMatches(record:ProducerQualification,configuration:ProducerQualificationConfiguration,installationEpoch:string):boolean{
  return record.owner===configuration.owner&&record.image===configuration.image&&record.runtimeInventorySha256===configuration.runtimeInventorySha256&&record.installationEpoch===installationEpoch;
}
export function createProducerQualification(configuration?:ProducerQualificationConfiguration){
  const identity=configuration?{owner:configuration.owner,image:configuration.image,runtimeInventorySha256:configuration.runtimeInventorySha256,
    ...(configuration.expectedSha256===undefined?{}:{expectedSha256:configuration.expectedSha256}),
    ...(configuration.canQualifyProject===undefined?{}:{canQualifyProject:configuration.canQualifyProject})}:null;
  const revisionSha256=createHash('sha256').update(canonicalPurposeJson(identity)).digest('hex');
  return{
    revisionSha256,
    canQualifyProject:configuration?.canQualifyProject,
    async producerStatus(_c:Pick<PoolClient,'query'>,input:{projectId:string;installationEpoch:string}):Promise<CalculationGrantProducerStatus>{
      if(!configuration?.expectedSha256||!policyHashSchema.safeParse(configuration.expectedSha256).success)return{status:'unqualified',reasonCode:'MANAGED_PRODUCER_QUALIFICATION_REQUIRED'};
      try{
        const root=await pathFinderRoot(),filename=path.join(root,'managed-producer-qualification.json'),before=await fs.lstat(filename);
        if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>65536||await fs.realpath(filename)!==filename)return{status:'blocked',reasonCode:'MANAGED_PRODUCER_QUALIFICATION_INVALID'};
        const bytes=await fs.readFile(filename),after=await fs.lstat(filename);
        if(before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length!==before.size||
          createHash('sha256').update(bytes).digest('hex')!==configuration.expectedSha256)return{status:'blocked',reasonCode:'MANAGED_PRODUCER_QUALIFICATION_CHANGED'};
        const parsed=producerQualificationSchema.safeParse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
        if(!parsed.success||!qualificationMatches(parsed.data,configuration,input.installationEpoch))return{status:'unqualified',reasonCode:'MANAGED_PRODUCER_QUALIFICATION_SCOPE_CHANGED'};
        return{status:'ready',reasonCode:null};
      }catch{return{status:'unqualified',reasonCode:'MANAGED_PRODUCER_QUALIFICATION_UNAVAILABLE'};}
    },
  };
}
