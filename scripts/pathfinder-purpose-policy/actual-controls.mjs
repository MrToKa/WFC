// Root-operated controls. Execute only inside the explicitly bound owned5191 API.
// Emits aggregate test labels/statuses; real catalog rows and tokens never leave it.
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import httpNode from 'node:http';
import { pool } from '/app/server/dist/server/db.js';
import { signAccessToken, verifyAccessToken } from '/app/server/dist/server/auth.js';
import { readCatalog, readCatalogManifest, readCatalogPage } from '/app/server/dist/server/pathfinder/catalog.js';
import { readPurposePolicyState } from '/app/server/dist/server/pathfinder/policySchema.js';
import { purposePolicyTransaction, readRoutingPolicyScope } from '/app/server/dist/server/pathfinder/purposePolicy.js';
import { requirePreparedRoutingScope } from '/app/server/dist/server/pathfinder/routingScope.js';
import { collectDependencies } from '/app/server/dist/server/pathfinder/dependencies.js';
import { defaultOptions } from '/app/server/dist/server/pathfinder/jobContracts.js';
import { policyErrorSchema, routePurposePolicySchema, policySaveSchema, policyHistorySchema, policyUuidSchema } from '/app/server/dist/shared/pathfinderPurposePolicy.js';

const report={schemaVersion:'pathfinder.purpose-policy.actual-controls.v1',status:'FAIL',startedAt:new Date().toISOString(),checks:[],cleanup:'NOT_RUN'};
const owned={projectId:process.env.PF_R2_FIXTURE_ID,adminId:randomUUID(),engineerId:randomUUID(),trayId:randomUUID(),otherTrayId:randomUUID()};
const number='PF-R2-CONTROL-'+randomUUID();
const demoProject='1af0f807-7653-40ea-8391-7eea6c54e7d4';
const demand=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const check=async(name,run)=>{await run();report.checks.push({name,status:'PASS'});};
const whoFor=token=>{const v=verifyAccessToken(token);return {userId:v.sub,loginId:v.jti,loginExpiresAt:v.exp*1000};};
let adminToken,engineerToken,who,fixtureCreated=false,usersCreated=false,runtimeAuthorized=false;
const route=(suffix,pid=owned.projectId)=>'http://web/api/projects/'+pid+'/pathfinder'+suffix;
async function http(suffix,{token=adminToken,body,raw,method=body===undefined&&raw===undefined?'GET':'PUT',projectId=owned.projectId}={}) {
  const res=await fetch(route(suffix,projectId),{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined&&raw===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined&&raw===undefined?{}:{body:raw??JSON.stringify(body)}),signal:AbortSignal.timeout(8000)});
  const value=await res.json();if(!res.ok)policyErrorSchema.parse(value);return {status:res.status,value};
}
const command=(policy,categories,key=randomUUID())=>({schemaVersion:'pathfinder.routing-purpose-policy.write.v1',expectedCatalogRevision:policy.catalogRevision,expectedRevision:policy.routingPolicyRevision,idempotencyKey:key,changes:[{purposeKey:'R2 synthetic purpose',operation:'set',allowedCategories:categories}]});
const current=async()=>{const r=await http('/routing-permissions');demand(r.status===200,'READ_POLICY');return routePurposePolicySchema.parse(r.value);};
async function state() {const c=await pool.connect();try{return await readPurposePolicyState(c,owned.projectId);}finally{c.release();}}
async function save(input) {const r=await http('/routing-permissions',{body:input});demand(r.status===200,'SAVE_POLICY');return policySaveSchema.parse(r.value);}
async function rollback(run) {const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='20s'");await c.query("SET LOCAL lock_timeout='3s'");await run(c);}finally{await c.query('ROLLBACK');c.release();}}
async function headerOnly(token) {
  return new Promise((resolve,reject)=>{
    const req=httpNode.request(route('/routing-permissions'),{method:'PUT',headers:{'Content-Type':'application/json','Content-Length':1048577,Connection:'close',...(token?{Authorization:'Bearer '+token}:{})}},res=>{
      let raw='';res.on('data',chunk=>{raw+=chunk;if(raw.length>8192)req.destroy(Error('BODY_ERROR_BOUND'));});res.on('end',()=>{try{const value=JSON.parse(raw);policyErrorSchema.parse(value);resolve({status:res.statusCode,value});}catch(error){reject(error);}});
    });req.setTimeout(8000,()=>req.destroy(Error('HEADER_ONLY_TIMEOUT')));req.on('error',reject);req.flushHeaders();
  });
}
try {
  const owner=process.env.PF_LOCAL_DEMO;
  demand(owner==='true'&&process.env.PF_ENGINE_MODE==='oneshot'&&process.env.PF_ROOT==='/var/lib/wfc/pathfinder'
    &&process.env.PF_R2_TARGET_OWNER==='8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46'
    &&policyUuidSchema.safeParse(owned.projectId).success,'ISOLATED_RUNTIME_REQUIRED');
  demand((await pool.query('SELECT id FROM projects WHERE id=$1',[demoProject])).rows.length===1,'OWNED_PROJECT_REQUIRED');runtimeAuthorized=true;
  await pool.query("INSERT INTO projects(id,project_number,name,customer) VALUES($1,$2,'PF R2 synthetic controls','Synthetic test')",[owned.projectId,number]);fixtureCreated=true;
  await pool.query("INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,$2,'unusable-test-hash',true,'admin'),($3,$4,'unusable-test-hash',false,'engineer')",[owned.adminId,owned.adminId+'@pf-r2.invalid',owned.engineerId,owned.engineerId+'@pf-r2.invalid']);
  usersCreated=true;
  adminToken=signAccessToken(owned.adminId,owned.adminId+'@pf-r2.invalid',true).token;
  engineerToken=signAccessToken(owned.engineerId,owned.engineerId+'@pf-r2.invalid',true).token; // stale signed role must not grant authority
  who=whoFor(adminToken);
  await pool.query("INSERT INTO trays(id,project_id,name,purpose,width_mm,height_mm,length_mm) VALUES($1,$2,'/R2A','R2 synthetic purpose',0,50,123.4500),($3,$2,'/R2B','R2 synthetic purpose',100,50,NULL)",[owned.trayId,owned.projectId,owned.otherTrayId]);
  await check('actual catalog decimal null and zero; retained immutable pages',async()=>rollback(async c=>{
    const first=await readCatalog(c,owned.projectId),manifest=await readCatalogManifest(c,owned.projectId),page=await readCatalogPage(c,owned.projectId,manifest.catalog.snapshotId,0);
    demand(first.rowCount===2&&page.complete&&page.rows.length===2,'CATALOG_COUNT');
    const row=page.rows.find(v=>v.projectTrayId===owned.trayId),other=page.rows.find(v=>v.projectTrayId===owned.otherTrayId);
    demand(row.dimensionsMm.width==='0'&&row.dimensionsMm.declaredLength==='123.4500'&&other.dimensionsMm.declaredLength===null,'DECIMAL_LOSS');
    await c.query('UPDATE trays SET width_mm=125 WHERE id=$1',[owned.trayId]);const next=await readCatalog(c,owned.projectId);
    demand(next.catalogRevision===first.catalogRevision&&next.routingContentSha256===first.routingContentSha256&&next.snapshotId!==first.snapshotId&&next.contentSha256!==first.contentSha256,'DRAWING_SCOPE_LEAK');
    demand((await readCatalogPage(c,owned.projectId,first.snapshotId,0)).rows.find(v=>v.projectTrayId===owned.trayId).dimensionsMm.width==='0','OLD_PAGE_MUTATED');
  }));
  await check('timestamp and changelog edits do not advance catalog or drawing domain',async()=>rollback(async c=>{
    const before=await readPurposePolicyState(c,owned.projectId);await c.query("UPDATE trays SET updated_at=now(),change_log='[{\"synthetic\":true}]' WHERE id=$1",[owned.trayId]);
    const after=await readPurposePolicyState(c,owned.projectId);demand(JSON.stringify(before)===JSON.stringify(after),'VOLATILE_REVISION');
  }));
  await check('rollback reverses tray routing epochs',async()=>{
    const before=await state();await rollback(async c=>{await c.query("UPDATE trays SET name='/R2ROLLBACK' WHERE id=$1",[owned.trayId]);demand(BigInt((await readPurposePolicyState(c,owned.projectId)).catalogRevision)>BigInt(before.catalogRevision),'ROUTING_BUMP');});
    demand(JSON.stringify(await state())===JSON.stringify(before),'ROLLBACK_REVISION');
  });
  await check('paginated 1001 row immutable manifest has no truncation',async()=>rollback(async c=>{
    const pid=randomUUID();await c.query("INSERT INTO projects(id,project_number,name,customer) VALUES($1,$2,'Synthetic pages','Synthetic')",[pid,'PF-R2-PAGES-'+pid]);
    await c.query("INSERT INTO trays(id,project_id,name,purpose) SELECT gen_random_uuid(),$1,'/PAGE'||n,'Page purpose' FROM generate_series(1,1001)n",[pid]);
    const m=await readCatalogManifest(c,pid),a=await readCatalogPage(c,pid,m.catalog.snapshotId,0),b=await readCatalogPage(c,pid,m.catalog.snapshotId,1);
    demand(m.catalog.rowCount===1001&&m.pageCount===2&&a.rows.length===1000&&!a.complete&&b.rows.length===1&&b.complete&&a.contentSha256===b.contentSha256,'PAGING');
  }));
  await check('SQL Unicode normalization matches actual ECMAScript NFC trim',async()=>rollback(async c=>{
    for(const v of ['\ufeffCafe\u0301\u00a0','Case  Sensitive','\u2007x\u202f'])demand((await c.query('SELECT pf_catalog_key($1) AS key',[v])).rows[0].key===v.normalize('NFC').trim(),'NORMALIZATION');
  }));
  await check('strict current admin; signed engineer role cannot read catalog policy or history',async()=>{
    for(const suffix of ['/catalog','/routing-permissions','/routing-permissions/history']){
      const anonymous=await http(suffix,{token:null}),engineer=await http(suffix,{token:engineerToken});
      demand(anonymous.status===401&&anonymous.value.currentRevisions===null&&engineer.status===403&&engineer.value.currentRevisions===null,'ADMIN_FENCE');
    }
  });
  await check('authorized missing project 404; unauthorized project identity remains private',async()=>{
    const pid=randomUUID();demand((await http('/routing-permissions',{projectId:pid})).status===404,'PROJECT_404');
    const denied=await http('/routing-permissions',{projectId:pid,token:engineerToken});demand(denied.status===403&&denied.value.currentRevisions===null,'PROJECT_LEAK');
  });
  await check('nginx streaming and current authority precede declared oversized body',async()=>{
    const denied=await headerOnly(null),engineer=await headerOnly(engineerToken),oversize=await headerOnly(adminToken);
    demand(denied.status===401&&denied.value.currentRevisions===null&&engineer.status===403&&engineer.value.currentRevisions===null&&oversize.status===413,'HEADER_ONLY_AUTH_LIMIT');
  });
  await check('duplicate decoded JSON members and unknown members are rejected before save',async()=>{
    const p=await current(),body=command(p,['Control']);
    const text=JSON.stringify(body).replace('"expectedRevision":','"expectedRevision":"0","expected\\u0052evision":');
    demand((await http('/routing-permissions',{raw:text})).status===400,'DUPLICATE_ACCEPTED');
    demand((await http('/routing-permissions',{body:{...body,extra:true}})).status===400,'UNKNOWN_KEY_ACCEPTED');
    demand((await http('/routing-permissions?extra=1',{body})).status===400,'UNKNOWN_QUERY_ACCEPTED');
  });
  const initial=await current();demand(initial.rules.length===0,'FIXTURE_UNCONFIGURED');let firstCommand,firstReceipt;
  await check('explicit empty mask is excluded and reset is unconfigured',async()=>{
    const excluded=await save(command(await current(),[]));demand(excluded.duplicate===false&&(await current()).rules[0].allowedCategories.length===0,'EXCLUDED');
    const p=await current();await save({...command(p,[]),changes:[{purposeKey:'R2 synthetic purpose',operation:'reset'}]});demand((await current()).rules.length===0,'RESET');
  });
  await check('drawing-only dimension diagnostic cannot block valid routing authoring',async()=>{
    const before=await current();await pool.query('UPDATE trays SET width_mm=-1 WHERE id=$1',[owned.trayId]);
    const manifest=await http('/catalog');demand(manifest.status===200&&manifest.value.catalog.diagnostics.some(v=>v.code==='INVALID_DIMENSION'),'DIMENSION_DIAGNOSTIC');
    const same=await current();demand(same.catalogRevision===before.catalogRevision&&same.routingPolicyRevision===before.routingPolicyRevision,'DRAWING_INVALIDATED_ROUTING');
    await save(command(same,['Control']));await pool.query('UPDATE trays SET width_mm=0 WHERE id=$1',[owned.trayId]);
  });
  await check('concurrent identical keys save once with one audit event',async()=>{
    firstCommand=command(await current(),['LV','Control']);const results=await Promise.all([http('/routing-permissions',{body:firstCommand}),http('/routing-permissions',{body:firstCommand})]);
    demand(results.every(r=>r.status===200)&&results.filter(r=>r.value.duplicate).length===1,'DUPLICATE_CONCURRENCY');firstReceipt=results.find(r=>!r.value.duplicate).value;
    const n=(await pool.query('SELECT count(*)::text AS n FROM pf_routing_policy_history WHERE project_id=$1 AND idempotency_key=$2',[owned.projectId,firstCommand.idempotencyKey])).rows[0].n;demand(n==='1','DOUBLE_AUDIT');
  });
  await check('new concurrent commands use CAS, not last write wins',async()=>{
    const p=await current(),results=await Promise.all([http('/routing-permissions',{body:command(p,['MV'])}),http('/routing-permissions',{body:command(p,['Control'])})]);
    demand(results.map(r=>r.status).sort().join(',')==='200,409','CAS_CONCURRENCY');
  });
  await check('historical exact replay precedes current CAS; changed payload conflicts',async()=>{
    const replay=await save(firstCommand);demand(replay.duplicate&&replay.auditId===firstReceipt.auditId&&replay.revision===firstReceipt.revision,'HISTORICAL_REPLAY');
    demand((await http('/routing-permissions',{body:{...firstCommand,changes:[{purposeKey:'R2 synthetic purpose',operation:'set',allowedCategories:[]}]}})).status===409,'KEY_PAYLOAD_CONFLICT');
    demand((await http('/routing-permissions',{body:{...firstCommand,idempotencyKey:randomUUID()}})).status===409,'STALE_NEW_COMMAND');
  });
  await check('routing ABA in separate commits advances epochs; remove and readd cannot revive rules',async()=>{
    const before=await state();await pool.query("UPDATE trays SET purpose='Temporary purpose' WHERE project_id=$1",[owned.projectId]);
    demand((await current()).rules.length===0,'DETACHED_RULE');await pool.query("UPDATE trays SET purpose='R2 synthetic purpose' WHERE project_id=$1",[owned.projectId]);
    demand(BigInt((await state()).catalogRevision)>BigInt(before.catalogRevision)&&(await current()).rules.length===0,'RESURRECTED_RULE');
    const replay=await save(firstCommand);demand(replay.duplicate&&replay.auditId===firstReceipt.auditId,'REPLAY_AFTER_CATALOG');
  });
  await check('normalization collisions and unknown purpose cannot be authored',async()=>{
    await pool.query("UPDATE trays SET purpose='R2 synthetic purpose ' WHERE id=$1",[owned.otherTrayId]);
    demand((await http('/routing-permissions',{body:command(await current(),['Control'])})).status===409,'COLLISION_AUTHORED');
    await pool.query("UPDATE trays SET purpose='R2 synthetic purpose' WHERE id=$1",[owned.otherTrayId]);
    const p=await current();demand((await http('/routing-permissions',{body:{...command(p,['Control']),changes:[{purposeKey:'Unknown purpose',operation:'set',allowedCategories:['Control']}]}})).status===409,'UNKNOWN_PURPOSE');
  });
  await check('append-only history has bounded cursor pages',async()=>{
    const first=await http('/routing-permissions/history?limit=2');const page=policyHistorySchema.parse(first.value);demand(first.status===200&&page.events.length===2&&page.nextBeforeRevision!==null,'HISTORY');
    const next=await http('/routing-permissions/history?limit=2&beforeRevision='+page.nextBeforeRevision);demand(next.status===200&&next.value.events.every(v=>BigInt(v.revision)<BigInt(page.nextBeforeRevision)),'HISTORY_CURSOR');
    await rollback(async c=>{await c.query('SAVEPOINT immutable');let denied=false;try{await c.query("UPDATE pf_routing_policy_history SET occurred_at=now() WHERE project_id=$1",[owned.projectId]);}catch{denied=true;}await c.query('ROLLBACK TO immutable');demand(denied,'AUDIT_MUTABLE');});
  });
  await check('current role revocation and revoked login also deny replay without revision leak',async()=>{
    await pool.query('UPDATE users SET is_admin=false WHERE id=$1',[owned.adminId]);const denied=await http('/routing-permissions',{body:firstCommand});demand(denied.status===403&&denied.value.currentRevisions===null,'REPLAY_AFTER_ROLE_REVOKED');
    await pool.query('UPDATE users SET is_admin=true WHERE id=$1',[owned.adminId]);
    await pool.query('UPDATE viewer_login_bindings SET revoked_at=now() WHERE login_id=$1',[who.loginId]);const revoked=await http('/routing-permissions',{body:firstCommand});demand(revoked.status===401&&revoked.value.currentRevisions===null,'REPLAY_AFTER_LOGOUT');
    adminToken=signAccessToken(owned.adminId,owned.adminId+'@pf-r2.invalid',true).token;who=whoFor(adminToken);demand((await current()).projectId===owned.projectId,'FRESH_LOGIN');
  });
  await check('admin and login locks remain held until policy transaction commit',async()=>{
    await purposePolicyTransaction(pool,owned.projectId,who,async()=>{
      const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='100ms'");let code;try{await c.query('UPDATE users SET is_admin=false WHERE id=$1',[owned.adminId]);}catch(e){code=e.code;}demand(code==='55P03','ROLE_LOCK_RELEASED');await c.query('ROLLBACK');
        await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='100ms'");code=null;try{await c.query('UPDATE viewer_login_bindings SET revoked_at=now() WHERE login_id=$1',[who.loginId]);}catch(e){code=e.code;}demand(code==='55P03','LOGIN_LOCK_RELEASED');await c.query('ROLLBACK');
      }finally{c.release();}
    });
  });
  await check('expiry during transaction rolls back dependent write',async()=>{
    const before=await state(),short={...who,loginId:randomUUID(),loginExpiresAt:Date.now()+250};let code;
    try{await purposePolicyTransaction(pool,owned.projectId,short,async c=>{await c.query('UPDATE pf_purpose_project_state SET routing_policy_revision=routing_policy_revision+1 WHERE project_id=$1',[owned.projectId]);await delay(350);});}catch(e){code=e.code;}
    demand(code==='LOGIN_EXPIRED'&&JSON.stringify(before)===JSON.stringify(await state()),'EXPIRY_COMMITTED');
  });
  await check('actual copied model has no invented permissions; legacy calculation is blocked',async()=>{
    await purposePolicyTransaction(pool,demoProject,who,async c=>{
      const scope=await readRoutingPolicyScope(c,demoProject);demand(scope.routingPolicyRevision==='0','REAL_PERMISSIONS_INVENTED');
      const artifact=(await c.query("SELECT id FROM pf_artifacts WHERE project_id=$1 AND purpose='planning' ORDER BY created_at DESC,id DESC LIMIT 1",[demoProject])).rows[0];demand(artifact,'REAL_ARTIFACT_MISSING');
      let code;try{await requirePreparedRoutingScope(c,demoProject,artifact.id);}catch(e){code=e.code;}demand(code==='ROUTING_PREPARATION_REQUIRED','LEGACY_ARTIFACT_ADMITTED');
      const cable=(await c.query('SELECT id FROM cables WHERE project_id=$1 ORDER BY id LIMIT 1',[demoProject])).rows[0];const result=await collectDependencies(c,demoProject,cable.id,defaultOptions);
      demand(result.dependencies===null&&result.status==='routing_preparation_required','LEGACY_CALCULATION_ADMITTED');
    });
  });
  report.status='PASS';
} catch(error) {report.error=/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'ACTUAL_CONTROL_FAILED';}
finally {
  try {
    if(!runtimeAuthorized){report.cleanup='NOT_NEEDED';throw Object.assign(Error('RUNTIME_REFUSED'),{code:'RUNTIME_REFUSED'});}
    if(fixtureCreated){const row=(await pool.query('SELECT project_number FROM projects WHERE id=$1',[owned.projectId])).rows[0];demand(row?.project_number===number,'CLEANUP_OWNERSHIP');await pool.query('DELETE FROM projects WHERE id=$1',[owned.projectId]);}
    if(usersCreated){const rows=(await pool.query('SELECT id,email FROM users WHERE id=ANY($1::uuid[])',[[owned.adminId,owned.engineerId]])).rows;demand(rows.length===2&&rows.every(row=>row.email===row.id+'@pf-r2.invalid'),'AUTH_CLEANUP_OWNERSHIP');
      await pool.query('DELETE FROM viewer_login_bindings WHERE user_id=ANY($1::uuid[])',[[owned.adminId,owned.engineerId]]);await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[owned.adminId,owned.engineerId]]);}
    demand((await pool.query('SELECT id FROM projects WHERE id=$1',[owned.projectId])).rows.length===0,'FIXTURE_REMAINS');report.cleanup='PASS';
  }catch(error){if(runtimeAuthorized)report.cleanup='FAIL';report.cleanupError=/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'CLEANUP_FAILED';report.status='FAIL';}
  report.finishedAt=new Date().toISOString();await pool.end();process.stdout.write(JSON.stringify(report));process.exitCode=report.status==='PASS'?0:1;
}
