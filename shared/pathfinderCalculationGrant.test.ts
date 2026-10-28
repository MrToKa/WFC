import {describe,expect,it} from 'vitest';
import {CALCULATION_GRANT_OPERATIONS,CALCULATION_GRANT_LIMITS,calculationGrantSchema,calculationGrantContextSchema,calculationGrantCommandSchema,
  calculationGrantReceiptSchema,calculationGrantProvenanceSchema,calculationGrantCommandCanonicalJson} from './pathfinderCalculationGrant.js';
const id=(n:number)=>`ca800000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const grant=()=>({schemaVersion:'wfc.pf.calculation-grant.v1' as const,projectId:id(1),id:id(2),grantRevision:'1',grantEpoch:'1',installationEpoch:id(3),
  enabled:true,enabledBy:id(4),enabledAt:'2026-10-19T00:00:00.000Z',updatedAt:'2026-10-19T00:00:00.000Z',issuerAdminRevision:'2',scope:'active-model' as const,
  operations:[...CALCULATION_GRANT_OPERATIONS],limitsProfile:'local-bounded-v1' as const,preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true},timeoutMilliseconds:60000});
const context=()=>({schemaVersion:'wfc.pf.calculation-grant-context.v1' as const,projectId:id(1),controlRevision:'1',grant:grant(),status:'enabled' as const,reasonCodes:[],producer:{status:'ready' as const,reasonCode:null}});
const command=()=>({schemaVersion:'wfc.pf.calculation-grant-command.v1' as const,action:'enable' as const,expectedControlRevision:'0',idempotencyKey:id(5),reason:'Explicit synthetic enable.',preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true},timeoutMilliseconds:60000});
const barrierIntent=(drillThroughWalls=false)=>{const scope={projectId:id(1),modelVersionId:id(6),contentFingerprint:'a'.repeat(64),selectionRevision:'3',captureFrameId:id(7),captureFrameSha256:'b'.repeat(64),coordinateFrame:'canonical-world-metres' as const};return{schemaVersion:'wfc.pf.barrier-admission-intent.v1' as const,scope,expectedRegistryRevision:'4',expectedSnapshot:{snapshotId:id(8),scope,registryRevision:'4',contentSha256:'c'.repeat(64),mode:'explicit-empty' as const},drillThroughWalls};};
describe('strict calculation-only grant contracts',()=>{
  it('retains exact no-drilling barrier input without introducing it into historical grants',()=>{
    expect(calculationGrantSchema.parse(grant()).preferences).not.toHaveProperty('barrierRouting');
    const preferences={...command().preferences,barrierRouting:barrierIntent()};
    expect(calculationGrantCommandSchema.parse({...command(),preferences}).action).toBe('enable');
    expect(JSON.parse(calculationGrantCommandCanonicalJson({...command(),preferences})).preferences).toEqual(preferences);
    expect(calculationGrantSchema.parse({...grant(),preferences}).preferences).toEqual(preferences);
  });
  it('refuses explicit drilling and malformed versioned intent in both saved grants and enable commands',()=>{
    for(const barrierRouting of [barrierIntent(true),null,{...barrierIntent(),drillThroughWalls:undefined},{...barrierIntent(),actorId:id(4)}]){
      const preferences={...command().preferences,barrierRouting};
      expect(calculationGrantCommandSchema.safeParse({...command(),preferences}).success).toBe(false);
      expect(calculationGrantSchema.safeParse({...grant(),preferences}).success).toBe(false);
    }
  });
  it('preserves exact revisions and fixed narrow operations without login credentials',()=>{
    expect(calculationGrantSchema.parse(grant())).toEqual(grant());expect(calculationGrantContextSchema.parse(context())).toEqual(context());
    expect(CALCULATION_GRANT_LIMITS.executionLeaseMilliseconds).toBe(900000);expect(CALCULATION_GRANT_LIMITS.activeGlobalLeases).toBe(1);
    expect(JSON.stringify(grant())).not.toMatch(/loginId|bearer|ownerToken|leaseId/);
  });
  it.each(['review','apply','edit-cables','read-arbitrary-resource'])('rejects added %s operation',operation=>expect(calculationGrantSchema.safeParse({...grant(),operations:[...CALCULATION_GRANT_OPERATIONS,operation]}).success).toBe(false));
  it.each([
    {grantRevision:'01'},{grantEpoch:'1\n'},{installationEpoch:'1'},{issuerAdminRevision:'90071992547409930\n'},
    {scope:'all-projects'},{limitsProfile:'unlimited'},{enabledAt:'2026-10-19T00:00:00+00:00'},{loginId:id(9)},
  ])('refuses malformed or broadened immutable grant %j',change=>expect(calculationGrantSchema.safeParse({...grant(),...change}).success).toBe(false));
  it('enforces current project/head consistency and never labels absent grants enabled',()=>{
    expect(calculationGrantContextSchema.safeParse({...context(),controlRevision:'2'}).success).toBe(false);
    expect(calculationGrantContextSchema.safeParse({...context(),projectId:id(9)}).success).toBe(false);
    expect(calculationGrantContextSchema.safeParse({...context(),grant:null}).success).toBe(false);
    expect(calculationGrantContextSchema.parse({...context(),grant:null,controlRevision:'0',status:'disabled',producer:{status:'unqualified',reasonCode:'MANAGED_PRODUCER_UNQUALIFIED'}}).grant).toBeNull();
  });
  it.each([{timeoutMilliseconds:99},{timeoutMilliseconds:120001},{preferences:{secondaryDistanceMeters:Infinity,preferVerticalApproach:true}},{preferences:{secondaryDistanceMeters:2,preferVerticalApproach:'true'}},{reason:'  '},{ownerToken:'a'.repeat(64)}])('rejects invalid or credential-bearing management command %j',change=>expect(calculationGrantCommandSchema.safeParse({...command(),...change}).success).toBe(false));
  it('retains only exact command fields and rejects enable preferences on disable',()=>{
    expect(JSON.parse(calculationGrantCommandCanonicalJson(command()))).toEqual(command());
    expect(calculationGrantCommandSchema.safeParse({...command(),action:'disable'}).success).toBe(false);
    const {preferences:_preferences,timeoutMilliseconds:_timeout,...base}=command();expect(calculationGrantCommandSchema.parse({...base,action:'disable'}).action).toBe('disable');
  });
  it('scrubs finite execution secrets from persistent provenance and rejects accidental lease serialization',()=>{
    const ref={kind:'calculation-grant' as const,projectId:id(1),grantId:id(2),grantRevision:'1',grantEpoch:'1',installationEpoch:id(3),issuerId:id(4),issuerAdminRevision:'2'};
    expect(calculationGrantProvenanceSchema.parse(ref)).toEqual(ref);
    for(const change of [{ownerToken:'a'.repeat(64)},{leaseId:id(8)},{leaseExpiresAt:'2026-10-19T01:00:00.000Z'},{modelVersionId:id(9)}])expect(calculationGrantProvenanceSchema.safeParse({...ref,...change}).success).toBe(false);
  });
  it('validates exact receipt context without supplying background authority through the receipt',()=>{
    const receipt={schemaVersion:'wfc.pf.calculation-grant-receipt.v1',duplicate:true,context:context()};expect(calculationGrantReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(calculationGrantReceiptSchema.safeParse({...receipt,ownerToken:'a'.repeat(64)}).success).toBe(false);
  });
});
