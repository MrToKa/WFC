// Run inside the built api-runtime image with PF_ROOT=/tmp/tray-length-test.
// All DB responses are synthetic; real engine and owned ephemeral files are used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { geometryTraceFixture } from '/app/server/dist/server/pathfinder/geometryTraceFixtures.js';
import { createTrayAutoLengthCaptureService, readTrayAutoLengthCaptureContext, readCapturedTrayAutoLength } from '/app/server/dist/server/services/trayAutoLengthCaptureService.js';
import { createGeometryTraceEngine } from '/app/server/dist/server/pathfinder/geometryTraceEngine.js';
import { createConfiguredEngineExecutor } from '/app/server/dist/server/pathfinder/engineSession.js';
import { modelCaptureScopeBytes } from '/app/server/dist/viewer-runtime/capture-input.mjs';
const f = geometryTraceFixture(), projectId=f.plan.projectId, trayId=f.plan.requestedScope.trays[0].projectTrayId;
const scope=Object.fromEntries(['modelVersionId','contentFingerprint','selectionRevision','catalogRevision','routingContentSha256','routingPolicyRevision','routingPolicySha256','resolutionRevision','locationRegistryRevision'].map(k=>[k,f.aggregate[k]]));
let cached;
const query=async(sql,p=[])=>{
 if(sql.includes('capture-model')) return {rows:[{tray_name:'B001',active_model_version_id:scope.modelVersionId,selection_revision:'1',content_fingerprint:scope.contentFingerprint,state:'ready',health:'healthy'}]};
 if(sql.includes('capture-assignment')) return {rows:[{resolution:{id:f.traceId,projectTrayId:trayId,mode:'roots',rootObjectIds:['dbid:9','dbid:2'],reason:'Isolated synthetic test',actorId:f.createdBy,createdAt:f.createdAt,scope},plan:null}]};
 if(sql.startsWith('SELECT name FROM trays')) return {rows:[{name:'B001'}]};
 if(sql.includes('capture-cache')) return {rows:cached?[cached]:[]};
 if(sql.includes('capture-store')) cached={context:p[2],measurement:p[3],proof:p[4],content_sha256:p[5]};
 return {rows:[]};
};
const pool={query,connect:async()=>({query,release(){}})}, context=await readTrayAutoLengthCaptureContext(pool,projectId,trayId);
const snapshot=f.snapshot; snapshot.objects.pop(); snapshot.capture.adapterVersion='wfc.protected-selected-capture.v1';snapshot.capture.sourceKind='converted';
const bytes=modelCaptureScopeBytes({equipmentNames:[],routeRules:[{id:trayId,objectIds:context.rootObjectIds,allowedCategories:['MV','LV','Control']}]});
snapshot.capture.inputScope={schemaVersion:'wfc.capture.input.v1',equipmentNameCount:0,chunkCount:0,inputUtf8Bytes:bytes.length,scopeSha256:createHash('sha256').update(bytes).digest('hex'),equipmentNamesSha256:createHash('sha256').update('[]').digest('hex'),propertyScan:{indexedObjectCount:2,attemptedObjectCount:0,returnedObjectCount:0,omittedObjectCount:0,complete:false}};
snapshot.objects.forEach((o,i)=>{
 const x=i?100:0, len=i?3:2;
 o.name='STRAIGHT';o.leafToRootNames=['STRAIGHT'];o.routeBoundaryId=o.id;delete o.routeName;delete o.shapeName;o.allowedCategories=['MV','LV','Control'];
 o.bounds={minimum:[x,0,0],maximum:[x+len,0.2,0.1]};
 const vertices=[[x,0,0],[x+len,0,0],[x+len,.2,0],[x,.2,0],[x,0,.1],[x+len,0,.1],[x+len,.2,.1],[x,.2,.1]];
 o.fragments[0].vertices=vertices;o.fragments[0].triangleIndices=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5];
});
const executor=createConfiguredEngineExecutor();
try{
 const service=createTrayAutoLengthCaptureService(pool,createGeometryTraceEngine(executor.execute));
 const measured=await service.capture(projectId,trayId,{context,snapshot},async()=>{},new AbortController().signal);
 assert.equal(measured.lengthMm,5000);assert.equal(measured.elementCount,2);
 assert.deepEqual(await readCapturedTrayAutoLength(pool,projectId,trayId),measured);
 console.log(JSON.stringify({lengthMm:measured.lengthMm,elementCount:measured.elementCount,standalone:true,cached:true,engine:cached.proof.engine.version}));
} finally{await executor.close();}
