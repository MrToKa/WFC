// @vitest-environment node
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalPurposeJson, catalogRoutingHashInput } from '../../shared/pathfinderPurposePolicy.js';
import { encodeCadOverlay, readCadOverlay } from './cadOverlay.js';
import { projectRoutingCatalogRows } from './catalog.js';
import { equalRoutingScope } from './routingScope.js';

const projectId='00000000-0000-4000-8000-000000000001',modelVersionId='00000000-0000-4000-8000-000000000002';
const artifactId='00000000-0000-4000-8000-000000000003',sha='a'.repeat(64);
const payload={schemaVersion:'wfc.pf.cad-overlay-payload.v1',projectId,modelVersionId,baseSnapshotSha256:sha,segments:[{
  id:'cad:00000000-0000-4000-8000-000000000004',name:'/CAD001',allowedCategoryMask:4,pointsMetres:[[0,0,0],[0,0,1]],
  ports:[{pointMetres:[0,0,0],outward:[0,0,-1],u:[1,0,0],v:[0,1,0],widthMetres:.3,heightMetres:.06}],
}]};
const source=[{id:'00000000-0000-4000-8000-000000000005',name:'BASE',purpose:'Control'}];
const projection=projectRoutingCatalogRows(source);
const routingSha=createHash('sha256').update(canonicalPurposeJson(catalogRoutingHashInput(projectId,projection.rows,projection.diagnostics))).digest('hex');
const prepared={catalogRevision:'1',routingContentSha256:routingSha,routingPolicyRevision:'1',routingPolicySha256:'b'.repeat(64)};
const current={...prepared,catalogRevision:'2',routingContentSha256:'c'.repeat(64)};
const traySnapshot={id:'00000000-0000-4000-8000-000000000006',name:'CAD001',purpose:'Control',trayType:'KL',widthMm:300,heightMm:60,lengthMm:1000};
const actual={id:traySnapshot.id,name:'CAD001',purpose:'Control',tray_type:'KL',width_mm:'300',height_mm:'60',length_mm:'1000'};
const group=(publication:unknown={baseArtifactId:artifactId,overlay:payload,traySnapshot})=>({status:'published',project_tray_id:traySnapshot.id,publication});
const fake=(rows:unknown[],base=source,trays=[actual])=>({query:vi.fn().mockResolvedValueOnce({rows}).mockResolvedValueOnce({rows:trays}).mockResolvedValueOnce({rows:base})});
afterEach(()=>vi.unstubAllEnvs());
describe('immutable CAD overlay and additive base-network scope',()=>{
  it('makes bytes, hash, and orientation/length changes part of the immutable envelope',()=>{
    const first=encodeCadOverlay(payload),second=encodeCadOverlay({...payload,segments:[{...payload.segments[0],pointsMetres:[[0,0,0],[0,0,2]]}]});
    expect(first.sha256).not.toBe(second.sha256);
    expect(createHash('sha256').update(Buffer.from(first.payloadBase64,'base64')).digest('hex')).toBe(first.sha256);
    expect(equalRoutingScope({...current,cadOverlay:first},{...current,cadOverlay:second})).toBe(false);
    expect(equalRoutingScope({...current,cadOverlay:first},{...current,cadOverlay:first})).toBe(true);
  });
  it('does not touch absent CAD tables when the feature is disabled',async()=>{
    vi.stubEnv('WFC_CAD_DESIGN_ENABLED','false');const db=fake([]);
    expect(await readCadOverlay(db as unknown as PoolClient,projectId,artifactId,sha,modelVersionId,prepared,current)).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });
  it('accepts only the exact base catalog plus separately pinned CAD rows',async()=>{
    vi.stubEnv('WFC_CAD_DESIGN_ENABLED','true');const db=fake([group()]);
    expect(await readCadOverlay(db as unknown as PoolClient,projectId,artifactId,sha,modelVersionId,prepared,current)).toEqual(encodeCadOverlay(payload));
    expect(db.query.mock.calls[1][1]).toEqual([projectId,[traySnapshot.id]]);
  });
  it('rejects unrelated base network changes and routing policy revisions',async()=>{
    vi.stubEnv('WFC_CAD_DESIGN_ENABLED','true');
    const rows=[group()];
    await expect(readCadOverlay(fake(rows,[{...source[0],name:'CHANGED'}]) as unknown as PoolClient,projectId,artifactId,sha,modelVersionId,prepared,current)).rejects.toMatchObject({code:'ROUTING_PREPARATION_REQUIRED'});
    await expect(readCadOverlay(fake(rows) as unknown as PoolClient,projectId,artifactId,sha,modelVersionId,prepared,{...current,routingPolicyRevision:'2'})).rejects.toMatchObject({code:'ROUTING_PREPARATION_REQUIRED'});
  });
  it('rejects an overlay pinned to another base artifact or source hash',async()=>{
    vi.stubEnv('WFC_CAD_DESIGN_ENABLED','true');
    for(const publication of [{baseArtifactId:'other',overlay:payload,traySnapshot},{baseArtifactId:artifactId,overlay:{...payload,baseSnapshotSha256:'d'.repeat(64)},traySnapshot}])
      await expect(readCadOverlay(fake([group(publication)]) as unknown as PoolClient,projectId,artifactId,sha,modelVersionId,prepared,current)).rejects.toMatchObject({code:'CAD_ROUTE_BASE_CHANGED'});
  });
  it.each([{...actual,name:'EDITED'},{...actual,purpose:'LV'},{...actual,width_mm:'600'},{...actual,length_mm:'2000'},{...actual,tray_type:'OTHER'}])('rejects changes to the owned published project tray: %j',async tray=>{
    vi.stubEnv('WFC_CAD_DESIGN_ENABLED','true');
    await expect(readCadOverlay(fake([group()],source,[tray]) as unknown as PoolClient,projectId,artifactId,sha,modelVersionId,prepared,current)).rejects.toMatchObject({code:'CAD_ROUTE_CATALOG_CHANGED'});
  });
  it('retains exact base provenance after withdrawal without keeping a deleted project tray in the graph',async()=>{
    vi.stubEnv('WFC_CAD_DESIGN_ENABLED','true');
    const db=fake([{...group(),status:'draft',project_tray_id:null}],source,[]);
    expect(await readCadOverlay(db as unknown as PoolClient,projectId,artifactId,sha,modelVersionId,prepared,current)).toBe('retired-base-proof');
  });
  it('keeps a previously exported row inside the prepared base catalogue during publication and withdrawal',async()=>{
    vi.stubEnv('WFC_CAD_DESIGN_ENABLED','true');
    const included=[...source,{id:actual.id,name:actual.name,purpose:actual.purpose}],base=projectRoutingCatalogRows(included);
    const scope={...prepared,routingContentSha256:createHash('sha256').update(canonicalPurposeJson(catalogRoutingHashInput(projectId,base.rows,base.diagnostics))).digest('hex')};
    const publication={baseArtifactId:artifactId,overlay:payload,traySnapshot,trayInBaseCatalog:true};
    const active=fake([group(publication)],included);
    expect(await readCadOverlay(active as unknown as PoolClient,projectId,artifactId,sha,modelVersionId,scope,scope)).toEqual(encodeCadOverlay(payload));
    expect(active.query.mock.calls[2][1]).toEqual([projectId,[]]);
    const retired=fake([{...group(publication),status:'draft',project_tray_id:null}],included,[]);
    expect(await readCadOverlay(retired as unknown as PoolClient,projectId,artifactId,sha,modelVersionId,scope,scope)).toBe('retired-base-proof');
  });
  it('requires fresh preparation when a publication-created row is later exported and retained on withdrawal',async()=>{
    vi.stubEnv('WFC_CAD_DESIGN_ENABLED','true');
    const publication={baseArtifactId:artifactId,overlay:payload,traySnapshot,trayInBaseCatalog:false};
    const retained=[...source,{id:actual.id,name:actual.name,purpose:actual.purpose}];
    await expect(readCadOverlay(fake([{...group(publication),status:'draft',project_tray_id:null}],retained,[]) as unknown as PoolClient,
      projectId,artifactId,sha,modelVersionId,prepared,current)).rejects.toMatchObject({code:'ROUTING_PREPARATION_REQUIRED'});
  });
});
