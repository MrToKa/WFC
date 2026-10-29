// @vitest-environment node
import{describe,it,expect}from'vitest';
import{producerQualificationSchema,qualificationMatches,createProducerQualification}from'./producerQualification.js';
const id=(n:number)=>`d8000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const record=()=>producerQualificationSchema.parse({schemaVersion:'wfc.pf.managed-producer-qualification.v1',installationEpoch:id(1),owner:id(2),image:'sha256:'+'a'.repeat(64),runtimeInventorySha256:'b'.repeat(64),sdkVersion:'7.130.0',playwrightVersion:'1.64.0',browserVersion:'test-controlled',browserSha256:'c'.repeat(64),sandbox:{nonroot:true,networkNone:true,readOnlyRoot:true,allCapabilitiesDropped:true,pidNamespaces:true,networkNamespaces:true,seccompBpf:true,seccompTsync:true,webgl:true,receiptSha256:'d'.repeat(64)},extraction:{projectId:id(3),modelVersionId:id(4),contentFingerprint:'e'.repeat(64),sourceAggregateId:id(5),managedAggregateId:id(6),objects:13,exactObjectOrder:true,exactCoordinates:true,exactCategories:true,exactGraph:true,exactPathFinderResults:true,receiptSha256:'f'.repeat(64)},closedBrowser:{noHumanViewer:true,prepare:true,trace:true,comparison:'complete',proposals:3,noAutomaticApply:true,receiptSha256:'0'.repeat(64)},engineeringAccepted:false,nativeParity:'not-performed',observedAt:'2026-10-19T00:00:00.000Z'});
describe('measured local producer qualification',()=>{
  it('supports each optional installation setting without hashing JavaScript undefined',()=>{
    const configuration={owner:id(2),image:'sha256:'+'a'.repeat(64),runtimeInventorySha256:'b'.repeat(64)};
    for(const optional of [{},{expectedSha256:'f'.repeat(64)},{canQualifyProject:id(3)},{expectedSha256:'f'.repeat(64),canQualifyProject:id(3)}]){
      const omitted={...configuration,...optional},explicit={...configuration,expectedSha256:undefined,canQualifyProject:undefined,...optional};
      const a=createProducerQualification(omitted),b=createProducerQualification(explicit);
      expect(b.revisionSha256).toBe(a.revisionSha256);expect(b.canQualifyProject).toBe(omitted.canQualifyProject);
    }
    expect(createProducerQualification({...configuration,expectedSha256:'e'.repeat(64)}).revisionSha256).not.toBe(createProducerQualification({...configuration,expectedSha256:'f'.repeat(64)}).revisionSha256);
  });
  it('an absent measured receipt stays unqualified and performs no implicit certification',async()=>{
    expect(await createProducerQualification().producerStatus({query:async()=>{throw Error('No query expected');}} as never,{projectId:id(3),installationEpoch:id(1)})).toEqual({status:'unqualified',reasonCode:'MANAGED_PRODUCER_QUALIFICATION_REQUIRED'});
  });
  it('pins the exact browser image/runtime/owner/installation and leaves engineering acceptance false',()=>{
    const r=record(),configuration={owner:r.owner,image:r.image,runtimeInventorySha256:r.runtimeInventorySha256};
    expect(qualificationMatches(r,configuration,r.installationEpoch)).toBe(true);
    for(const change of[{owner:id(8)},{image:'sha256:'+'8'.repeat(64)},{runtimeInventorySha256:'8'.repeat(64)}])expect(qualificationMatches(r,{...configuration,...change},r.installationEpoch)).toBe(false);
    expect(qualificationMatches(r,configuration,id(9))).toBe(false);expect(r.engineeringAccepted).toBe(false);
  });
  it.each(['sandbox','extraction','closedBrowser'])('incomplete %s proof cannot become qualified',section=>{
    const r=record();expect(producerQualificationSchema.safeParse({...r,[section]:{}}).success).toBe(false);
  });
  it('requires successful local extraction and proposals, with no automatic Apply/native acceptance',()=>{
    const r=record();for(const changed of[{...r,nativeParity:'PASS'},{...r,engineeringAccepted:true},{...r,closedBrowser:{...r.closedBrowser,proposals:0}},{...r,extraction:{...r.extraction,exactGraph:false}}])expect(producerQualificationSchema.safeParse(changed).success).toBe(false);
  });
});
