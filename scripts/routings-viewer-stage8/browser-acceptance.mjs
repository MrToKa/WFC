import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createBrowserBoundary, instrumentContext } from '../viewer-sessions/browser-policy.mjs';

const ROUTES = [
  '/DFB018-1/DFB011/DFB012/DFB013/B002/B107-1/B107-2/B107-3/BC025/BC022-2/SECONDARY',
  '/DFBC002-2/DFC001/DFC002/DFC003/C002/C107-1/C107-2/C107-3/BC025/BC023-4/SECONDARY',
];
const sha = value => createHash('sha256').update(value).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const credentials = () => ({ email: `stage8-${randomUUID()}@fixture.invalid`, password: randomBytes(32).toString('base64url') });
const region = page => page.getByRole('region', { name: 'Routings viewer', exact: true });
const result = page => page.getByTestId('routing-result');
const button = (page, name) => region(page).getByRole('button', { name, exact: true });
async function control(state, composeArgs, spec) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...composeArgs, '--profile', 'tests', 'run', '--rm', '--no-deps', '-T', 'tests', 'node', 'scripts/routings-viewer-stage8/fixture-control.mjs'], { cwd: state.projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', () => reject(Error('FIXTURE_CONTROL_START_FAILED')));
    child.once('close', code => {
      if (code !== 0) return reject(Error('FIXTURE_CONTROL_FAILED_' + code + ': ' + stderr.slice(-1200)));
      try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); } catch { reject(Error('FIXTURE_CONTROL_RESPONSE_INVALID')); }
    }); child.stdin.end(JSON.stringify(spec));
  });
}
async function login(page, base, account) {
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/^Email\s*\*?$/).fill(account.email); await page.getByLabel(/^Password\s*\*?$/).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30_000 });
}
const collector = ({ projectId }) => {
  globalThis.__stage8Events = [];
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== document.querySelector('[data-testid="routings-model-host"] iframe')?.contentWindow) return;
    const value = event.data;
    if (value?.channel !== 'wfc-routings-viewer' || value.projectId !== projectId || !['MODEL_LOADED', 'ROUTE_RESULT', 'ROUTE_ZOOMED', 'ROUTE_CLEARED', 'ERROR', 'REQUEST_CANCELLED'].includes(value.type)) return;
    // Only public protocol data from this exact frame; never URLs, headers,
    // cookies, credentials or private SDK/controller objects.
    const snapshot = { type: value.type, instanceId: value.instanceId, projectId: value.projectId,
      modelVersionId: value.modelVersionId, loadId: value.loadId, requestId: value.requestId, payload: value.payload };
    globalThis.__stage8Events.push(snapshot);
    globalThis.__stage8ObservedBridge?.(snapshot).catch(() => {});
  });
};
const eventCount = page => page.evaluate(() => globalThis.__stage8Events.length);
async function next(page, type, after = 0, timeout = 600_000, expected = null) {
  const matches = (value, type, expected) => value.type === type && (!expected ||
    ['instanceId', 'projectId', 'modelVersionId', 'loadId'].every(key => value[key] === expected[key]) &&
    value.payload.rawRouting === expected.rawRouting && value.payload.source === expected.source && value.payload.cableId === expected.cableId);
  await page.waitForFunction(({ type, after, expected }) => {
    const matches = value => value.type === type && (!expected ||
      ['instanceId', 'projectId', 'modelVersionId', 'loadId'].every(key => value[key] === expected[key]) &&
      value.payload.rawRouting === expected.rawRouting && value.payload.source === expected.source && value.payload.cableId === expected.cableId);
    const terminalPhase = document.querySelector('[data-testid="routings-viewer-status"]')?.getAttribute('data-phase');
    return globalThis.__stage8Events.slice(after).some(value => matches(value) || !expected && value.type === 'ERROR') || expected && ['error', 'login-required', 'access-denied', 'unavailable'].includes(terminalPhase);
  }, { type, after, expected }, { timeout });
  const events = await page.evaluate(after => globalThis.__stage8Events.slice(after), after);
  const value = events.find(value => matches(value, type, expected) || !expected && value.type === 'ERROR');
  if (!value) throw Error('VIEWER_UI_TERMINAL_BEFORE_CURRENT_ROUTE_RESULT');
  if (value.type === 'ERROR' && type !== 'ERROR') throw Error('VIEWER_' + value.payload.code);
  return value;
}
async function modelReady(page, facts, after = 0) {
  const value = await next(page, 'MODEL_LOADED', after); assert.equal(value.modelVersionId, facts.model.id); assert.equal(value.payload.nodeIndexReady, true);
  await page.waitForFunction(() => document.querySelector('[data-testid="routings-viewer-status"]')?.getAttribute('data-phase') === 'ready');
  const frame = page.frames().find(value => value.url().includes('/viewer-runtime/7.130.0/index.html')); assert.ok(frame);
  const evidence = await frame.locator('#runtime-evidence').evaluate(node => ({ ...node.dataset }));
  assert.equal(evidence.geometryLoaded, 'true'); assert.equal(evidence.nodeIndexReady, 'true'); assert.equal(evidence.propertiesLoaded, 'true');
  assert.ok(Number(evidence.fragmentCount) > 600_000); assert.ok(Number(evidence.nodeCount) > 400_000); assert.ok(Number(evidence.propertiesCount) > 0);
  return { value, frame, evidence };
}
async function show(page, raw, expected, { keyboard = false } = {}) {
  const before = await eventCount(page), prior = await result(page).getAttribute('data-operation-id').catch(() => null);
  const loaded = await page.evaluate(() => globalThis.__stage8Events.filter(value => value.type === 'MODEL_LOADED').at(-1)); assert.ok(loaded);
  await region(page).getByRole('textbox', { name: 'Manual routing', exact: true }).fill(raw);
  if (keyboard) { await button(page, 'Show route').focus(); await page.keyboard.press('Enter'); } else await button(page, 'Show route').click();
  const model = await next(page, 'ROUTE_RESULT', before, 600_000, { instanceId: loaded.instanceId, projectId: loaded.projectId, modelVersionId: loaded.modelVersionId, loadId: loaded.loadId, rawRouting: raw, source: 'manual', cableId: null });
  assert.equal(model.payload.rawRouting, raw); assert.equal(model.payload.source, 'manual'); assert.equal(model.payload.cableId, null);
  await page.waitForFunction(({ expected, prior }) => {
    const value = document.querySelector('[data-testid="routing-result"]');
    return value?.getAttribute('data-route-status') === expected && value.getAttribute('data-operation-id') !== prior;
  }, { expected, prior }, { timeout: 30_000 });
  return model;
}
async function rows(page) {
  const details = result(page).locator('details'); if (await details.count() && await details.getAttribute('open') === null) await details.locator('summary').click();
  return result(page).locator('[data-segment-index]').evaluateAll(nodes => nodes.map(node => ({ index: Number(node.dataset.segmentIndex), key: node.dataset.routeKey, project: node.dataset.projectState, model: node.dataset.modelState, drawable: node.dataset.drawable })));
}
async function settleCanvas(page, frame) {
  const after = await eventCount(page); await button(page, 'Zoom to route').click(); await next(page, 'ROUTE_ZOOMED', after, 30_000); const canvas = frame.locator('canvas').first();
  await page.mouse.move(1, 1); await page.waitForTimeout(2000);
  let previous, samples = 0;
  for (; samples < 24; samples++) { const current = sha(await canvas.screenshot()); if (previous === current) return { samples: samples + 1, stableConsecutiveCanvasFrames: 2 }; previous = current; await page.waitForTimeout(250); }
  throw Error('CAMERA_NOT_SETTLED');
}
const search = page => region(page).getByRole('textbox', { name:'Search cable tags',exact:true });
const cableList = page => region(page).getByRole('list',{name:'Project cables',exact:true});
const cableRow = (page, id) => cableList(page).locator(`button[data-cable-id="${id}"]`);
const cableState = (page, state) => page.waitForFunction(state => document.querySelector('[data-testid="routing-cables-status"]')?.getAttribute('data-state') === state,state);
async function modeTab(page,name) { await region(page).getByRole('tablist',{name:'Routing source',exact:true}).getByRole('tab',{name,exact:true}).click(); }
const loadedSnapshot = page => page.evaluate(()=>globalThis.__stage8Events.filter(v=>v.type==='MODEL_LOADED').at(-1));
async function waitResult(page, expected, previous=null) {
 await page.waitForFunction(({expected,previous})=>{const node=document.querySelector('[data-testid="routing-result"]');return node?.getAttribute('data-route-status')===expected && node.getAttribute('data-operation-id')!==previous;},{expected,previous},{timeout:30_000});
}
async function activate(page, cable, expected='complete', {keyboard=false}={}) {
 const before=await eventCount(page), previous=await result(page).getAttribute('data-operation-id').catch(()=>null), loaded=await loadedSnapshot(page);
 await cableRow(page,cable.id).scrollIntoViewIfNeeded();
 if(keyboard){await cableRow(page,cable.id).focus();await page.keyboard.press('Enter');}else await cableRow(page,cable.id).click();
 let event=null;
 if(!['empty','invalid'].includes(expected))event=await next(page,'ROUTE_RESULT',before,60_000,{...loaded,rawRouting:cable.routing??'',source:'cable',cableId:cable.id});
 await waitResult(page,expected,previous);assert.equal(await result(page).getAttribute('data-source'),'cable');assert.equal(await result(page).getAttribute('data-cable-id'),cable.id);
 assert.equal(await cableRow(page,cable.id).getAttribute('aria-pressed'),'true');
 return {event,operationId:await result(page).getAttribute('data-operation-id')};
}
async function refreshed(page) {await button(page,'Refresh cables').click();await cableState(page,'ready');}
async function runMode({ browser,state,composeArgs,base,mode,attempt }) {
 const editor=credentials(),accounts={reader:credentials(),technician:credentials(),readOnlyEngineer:credentials()};
 const facts=await control(state,composeArgs,{...editor,...accounts}), cables=facts.cables;
 const boundary=await createBrowserBoundary({allowedOrigins:[base]});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',proxy:{server:boundary.server,bypass:'<-loopback>'}});
 const traffic=await instrumentContext(context,[base]);await context.addInitScript(collector,{projectId:facts.projectId});
 const report={schemaVersion:1,mode,origin:base,startedAt:new Date().toISOString(),status:'RUNNING',facts,cases:[],screenshots:[],bridgeEvents:[],cableReads:[],trayReads:[],businessWrites:[],layout:[]};
 await context.exposeBinding('__stage8ObservedBridge',(_source,value)=>{report.bridgeEvents.push(value);});
 const page=await context.newPage(),details=`${base}/projects/${facts.projectId}`,target=details+'?tab=routings-viewer';
 const trayPattern=new RegExp(`/api/projects/${facts.projectId}/trays(?:\\?.*)?$`), cablePattern=new RegExp(`/api/projects/${facts.projectId}/cables(?:\\?.*)?$`);
 const eager=[],sessionCreates=[];
 context.on('request',request=>{
  const url=new URL(request.url()),path=url.pathname,method=request.method();
  if(path===`/api/projects/${facts.projectId}/cables`)report.cableReads.push({method,path,queryKeys:[...url.searchParams.keys()]});
  if(path===`/api/projects/${facts.projectId}/trays`)report.trayReads.push({method,path});
  if(/\/api\/projects\/[^/]+\/(?:cables|cable-types|tray-data)(?:\/|$)/.test(path)||path==='/api/cable-types'||path.startsWith('/api/materials/'))eager.push({path,method});
  if(method==='POST'&&/\/viewer-sessions$/.test(path))sessionCreates.push({path});
  if(!['GET','HEAD','OPTIONS'].includes(method)&&path.startsWith('/api/')&&!path.startsWith('/api/auth/')&&!/\/viewer-sessions(?:\/[a-f0-9-]+(?:\/renew)?)?$/.test(path))report.businessWrites.push({method,path});
 });
 const screenshot=async label=>{const filename=`stage8-${attempt}-${mode}-${label}.png`;await page.screenshot({path:path.join(state.evidenceDirectory,filename),fullPage:true});report.screenshots.push(filename);};
 const step=async(name,work)=>{const startedAt=new Date().toISOString();console.log(JSON.stringify({mode,case:name,status:'RUNNING'}));try{const evidence=await work();report.cases.push({name,status:'PASS',startedAt,finishedAt:new Date().toISOString(),...evidence});}catch(error){report.cases.push({name,status:'FAIL',startedAt,message:String(error.message).slice(0,1200)});throw error;}};
 let active;
 try{
  await login(page,base,editor);
  await step('Previous Cable list page/search does not scope Manual or the independent Viewer cable source',async()=>{
   await page.goto(details+'?tab=cable-list',{waitUntil:'domcontentloaded'});
   const table=page.getByRole('tabpanel',{name:'Cable list',exact:true});await table.getByRole('textbox',{name:'Filter cables',exact:true}).waitFor();
   const pagination=table.getByRole('combobox',{name:'Select cable list page',exact:true});await pagination.waitFor();
   await table.getByRole('button',{name:'Next',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="Select cable list page"]')?.textContent.includes('Page 2'));
   await table.getByRole('textbox',{name:'Filter cables',exact:true}).fill('STAGE8-no-table-matches');await table.getByText('No cables found',{exact:true}).waitFor();
   assert.equal(await page.locator('iframe[title="Protected 3D model"]').count(),0);
   eager.length=0;report.cableReads.length=0;report.trayReads.length=0;
   await page.getByRole('tablist',{name:'Project sections',exact:true}).getByRole('tab',{name:'Routings viewer',exact:true}).click();await region(page).waitFor();
   active=await modelReady(page,facts);assert.equal(eager.length,0);assert.equal(report.trayReads.length,0);
   assert.equal(await region(page).getByRole('tab',{name:'Manual routing',exact:true}).getAttribute('aria-selected'),'true');
   return{previousTablePage:2,previousTableFilter:'STAGE8-no-table-matches',manualEagerCableCatalogTrayReads:0,model:active.evidence};
  });
  await step('First Cables activation reads all87 records and renders only84 exact original tags with omissions and duplicates',async()=>{
   await modeTab(page,'Cables');await cableState(page,'ready');const buttons=cableList(page).getByRole('button');assert.equal(await buttons.count(),84);
   await region(page).getByText('3 cables without a tag are not shown.',{exact:true}).waitFor();
   for(const value of Object.values(cables).filter(v=>v.tag?.trim())){const row=cableRow(page,value.id);assert.equal(await row.count(),1);assert.equal(await row.textContent(),value.tag);assert.equal(await row.getAttribute('title'),null);}
   assert.equal(await cableList(page).getByRole('button',{name:'S8-DUPLICATE',exact:true}).count(),2);assert.equal(await cableRow(page,cables.outsideFirstPage.id).count(),1);
   assert.equal(await button(page,'Show route').count(),0);assert.equal(await page.locator('[data-testid="routings-model-host"] iframe').count(),1);
   return{apiCount:87,visibleTags:84,omitted:3,duplicateTagRows:2,outsideFirstTablePageUuid:cables.outsideFirstPage.id};
  });
  await step('Automatic NFKC/case/trim substring filtering is local and preserves the original displayed tag',async()=>{
   const before=report.cableReads.length;await search(page).fill('  s8-ca');await search(page).pressSequentially('se');
   await cableState(page,'ready');assert.equal(await cableList(page).getByRole('button').count(),1);assert.equal(await cableRow(page,cables.normalized.id).textContent(),cables.normalized.tag);
   await search(page).fill('not-present-tag');await cableState(page,'no-match');assert.equal(await cableList(page).getByRole('button').count(),0);
   await search(page).fill('');await cableState(page,'ready');assert.equal(report.cableReads.length,before);
   return{perKeystrokeRequests:0,normalizedSearch:'s8-case',originalTag:cables.normalized.tag};
  });
  await step('Native keyboard and direct cable clicks show both actual original routes through the common DB/model pipeline',async()=>{
   const results=[];for(const [index,key]of['routeA','routeB'].entries()){
    if(index===1)await active.frame.locator('canvas').first().click({position:{x:32,y:32}});
    const chosen=await activate(page,cables[key],'complete',{keyboard:index===0});assert.equal(chosen.event.payload.drawableCount,10);assert.equal(chosen.event.payload.lineCount,1);
    const observed=await rows(page);assert.equal(observed.length,10);assert.ok(observed.every(v=>v.project==='exists'&&v.model==='found'&&v.drawable==='true'));
    const camera=await settleCanvas(page,active.frame);await screenshot('cable-route-'+(index+1)+'-settled');results.push({uuid:cables[key].id,requestId:chosen.event.requestId,operationId:chosen.operationId,model:chosen.event.payload,rows:observed,camera});
   }return{results,actualIframeCanvasInteractionBeforeSecondCableClick:true};
  });
  await step('Duplicate tags, repeated same cable and equal text at different UUIDs retain distinct identities and fresh operations',async()=>{
   const choices=[];for(const key of['duplicateA','duplicateB','routeA','routeA','sameText']){const chosen=await activate(page,cables[key]);choices.push({key,cableId:cables[key].id,raw:cables[key].routing,requestId:chosen.event.requestId,operationId:chosen.operationId});}
   assert.equal(new Set(choices.map(v=>v.requestId)).size,choices.length);assert.equal(new Set(choices.map(v=>v.operationId)).size,choices.length);assert.notEqual(choices[0].cableId,choices[1].cableId);assert.notEqual(choices[0].raw,choices[1].raw);assert.equal(choices[2].raw,choices[4].raw);
   return{choices};
  });
  await step('Mode/filter changes preserve manual draft, selected UUID and displayed cable route without remount or automatic route',async()=>{
   const loaded=await loadedSnapshot(page),sessions=sessionCreates.length;
   await modeTab(page,'Manual routing');await region(page).getByRole('textbox',{name:'Manual routing',exact:true}).fill('/BC025/SECONDARY');
   await modeTab(page,'Cables');await cableState(page,'ready');const before=await eventCount(page),operation=await result(page).getAttribute('data-operation-id');
   await search(page).fill('route-b');await region(page).getByText('The selected cable is hidden by this filter.',{exact:true}).waitFor();
   assert.equal(await result(page).getAttribute('data-cable-id'),cables.sameText.id);await region(page).getByTestId('selected-routing-cable').waitFor();
   await modeTab(page,'Manual routing');assert.equal(await region(page).getByRole('textbox',{name:'Manual routing',exact:true}).inputValue(),'/BC025/SECONDARY');
   await modeTab(page,'Cables');await cableState(page,'ready');await search(page).fill('');
   assert.equal(await result(page).getAttribute('data-operation-id'),operation);assert.equal(await eventCount(page),before);assert.deepEqual(await loadedSnapshot(page),loaded);assert.equal(sessionCreates.length,sessions);
   return{manualDraftPreserved:true,selectedHiddenUuid:cables.sameText.id,operationId:operation,iframeRemounts:0,automaticRouteEvents:0};
  });
  await step('Null/empty/separator/SECONDARY/invalid/all-missing cable routes retire the preceding overlay and bounds',async()=>{
   const observed=[];for(const [key,status]of[['nullRouting','empty'],['emptyRouting','empty'],['separators','empty'],['marker','empty'],['invalid','invalid'],['missing','none']]){
    await activate(page,cables.routeA);const chosen=await activate(page,cables[key],status);assert.equal(await button(page,'Zoom to route').isDisabled(),true);
    if(status==='empty')await result(page).getByText('This cable has no drawable routing.',{exact:true}).waitFor();
    if(chosen.event)assert.equal(chosen.event.payload.drawableCount,0);observed.push({key,status,cableId:cables[key].id,operationId:chosen.operationId});
   }return{observed,noCableTypeRoutingFallback:true};
  });
  await step('A to B accepts a new click while pending and ignores A model/DB completions after winning B',async()=>{
   const gate=deferred(),reached=deferred();let first=true;
   await page.route(trayPattern,async route=>{if(first){first=false;const response=await route.fetch();reached.resolve();await gate.promise;await route.fulfill({response}).catch(()=>{});}else await route.continue();});
   try{await cableRow(page,cables.routeA.id).click();await reached.promise;const winner=await activate(page,cables.routeB);gate.resolve();await page.waitForTimeout(300);assert.equal(await result(page).getAttribute('data-operation-id'),winner.operationId);assert.equal(await result(page).getAttribute('data-cable-id'),cables.routeB.id);return{winningUuid:cables.routeB.id,winningOperation:winner.operationId,oldReplyReleased:true};}
   finally{gate.resolve();await page.unroute(trayPattern);}
  });
  await step('DB unavailable keeps cable model line and explicit Retry preserves current cable source/UUID/original route',async()=>{
   let failed=0;await page.route(trayPattern,route=>{failed++;return route.abort('failed');});
   const before=await activate(page,cables.routeA,'partial');assert.equal(before.event.payload.lineCount,1);assert.ok((await rows(page)).every(v=>v.project==='unavailable'));
   await page.unroute(trayPattern);const count=await eventCount(page),loaded=await loadedSnapshot(page);await button(page,'Retry route check').click();
   const retry=await next(page,'ROUTE_RESULT',count,600_000,{...loaded,rawRouting:cables.routeA.routing,source:'cable',cableId:cables.routeA.id});await waitResult(page,'complete',before.operationId);assert.notEqual(retry.requestId,before.event.requestId);
   return{faultBasis:'Browser-only tray transport failure, not authorization denial.',failedReads:failed,retryCableId:retry.payload.cableId,retrySource:retry.payload.source};
  });
  await step('Actual missing project tray remains independent of ten drawable cable-model segments',async()=>{
   await control(state,composeArgs,{action:'remove-model-tray',projectId:facts.projectId});try{const chosen=await activate(page,cables.routeB,'partial');const row=(await rows(page)).find(v=>v.key==='DFC003');assert.equal(row.project,'missing');assert.equal(row.model,'found');assert.equal(row.drawable,'true');assert.equal(chosen.event.payload.lineCount,1);await screenshot('cable-db-missing-model-drawable');return{row,modelLineCount:1};}finally{await control(state,composeArgs,{action:'restore-model-tray',projectId:facts.projectId});}
  });
  await step('Failed refresh stays stale, successful retag preserves UUID, and true reroute requires a new explicit click',async()=>{
   await activate(page,cables.routeA);const previous=await result(page).getAttribute('data-operation-id');
   await page.route(cablePattern,route=>route.abort('failed'));await button(page,'Refresh cables').click();await cableState(page,'stale');assert.equal(await result(page).getAttribute('data-operation-id'),previous);assert.equal(await cableRow(page,cables.routeA.id).getAttribute('aria-pressed'),'true');assert.equal(await cableRow(page,cables.routeA.id).isDisabled(),true);
   await page.unroute(cablePattern);await button(page,'Retry cables').click();await cableState(page,'ready');
   try{
    await control(state,composeArgs,{action:'change-cable',projectId:facts.projectId,key:'routeA',id:cables.routeA.id,change:'retag'});await refreshed(page);assert.equal(await cableRow(page,cables.routeA.id).textContent(),'S8-RENAMED-ORIGINAL');assert.equal(await result(page).getAttribute('data-operation-id'),previous);
    await control(state,composeArgs,{action:'change-cable',projectId:facts.projectId,key:'routeA',id:cables.routeA.id,change:'reroute'});await refreshed(page);assert.equal(await result(page).count(),0);assert.equal(await button(page,'Zoom to route').isDisabled(),true);
    const chosen=await activate(page,{...cables.routeA,routing:ROUTES[1]});assert.equal(chosen.event.payload.rawRouting,ROUTES[1]);return{staleDidNotDelete:true,retagSameUuid:true,rerouteAutoDisplayed:false,newExplicitRaw:chosen.event.payload.rawRouting};
   }finally{await control(state,composeArgs,{action:'change-cable',projectId:facts.projectId,key:'routeA',id:cables.routeA.id,change:'restore'});await refreshed(page);}
  });
  await step('True deletion/blank tag clears cable selection, and a delayed deletion refresh cannot clear a newer Manual route',async()=>{
   const faults=[];
   for(const action of['blank-tag','delete']){
    await activate(page,cables.routeA);try{await control(state,composeArgs,{action:'change-cable',projectId:facts.projectId,key:'routeA',id:cables.routeA.id,change:action});await refreshed(page);assert.equal(await page.getByTestId('selected-routing-cable').count(),0);assert.equal(await result(page).count(),0);assert.equal(await cableRow(page,cables.routeA.id).count(),0);faults.push(action);}finally{await control(state,composeArgs,{action:'change-cable',projectId:facts.projectId,key:'routeA',id:cables.routeA.id,change:'restore'});await refreshed(page);}
   }
   await activate(page,cables.routeA);await control(state,composeArgs,{action:'change-cable',projectId:facts.projectId,key:'routeA',id:cables.routeA.id,change:'delete'});
   const gate=deferred(),reached=deferred();await page.route(cablePattern,async route=>{const response=await route.fetch();reached.resolve();await gate.promise;await route.fulfill({response}).catch(()=>{});});
   try{await button(page,'Refresh cables').click();await reached.promise;await modeTab(page,'Manual routing');const manual=await show(page,ROUTES[1],'complete'),operation=await result(page).getAttribute('data-operation-id');gate.resolve();await page.waitForTimeout(300);assert.equal(await result(page).getAttribute('data-operation-id'),operation);assert.equal(await result(page).getAttribute('data-source'),'manual');assert.equal(await page.getByTestId('selected-routing-cable').count(),0);return{trueFixtureMutations:faults,newerManualRequest:manual.requestId,newerManualRetained:true};}
   finally{gate.resolve();await page.unroute(cablePattern);await control(state,composeArgs,{action:'change-cable',projectId:facts.projectId,key:'routeA',id:cables.routeA.id,change:'restore'});await modeTab(page,'Cables');await cableState(page,'ready');}
  });
  await step('Clear and entire-model actions cancel displayed cable attempts without erasing remembered choice or manual text',async()=>{
   for(const name of['Clear','Show entire model']){await activate(page,cables.routeB);await button(page,name).click();await page.waitForFunction(()=>!document.querySelector('[data-testid="routing-result"]'));assert.equal(await button(page,'Zoom to route').isDisabled(),true);await region(page).getByText('No route is displayed.',{exact:true}).waitFor();assert.equal(await cableRow(page,cables.routeB.id).getAttribute('aria-pressed'),'true');}
   await modeTab(page,'Manual routing');assert.equal(await region(page).getByRole('textbox',{name:'Manual routing',exact:true}).inputValue(),ROUTES[1]);await modeTab(page,'Cables');await cableState(page,'ready');return{clearAndEntireModel:true,selectionRememberedButNotDisplayed:true};
  });
  await step('Many rows, long original tags and keyboard scrolling retain320/280/stacked layout and light model under dark WFC',async()=>{
   await search(page).fill('');const layouts=[];
   for(const [width,height,left]of[[1440,900,320],[899,700,280],[639,760,null],[1440,480,320]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(200);await cableRow(page,cables.outsideFirstPage.id).focus();await cableRow(page,cables.outsideFirstPage.id).scrollIntoViewIfNeeded();
    const value=await page.getByTestId('routings-layout').evaluate(node=>{const frame=node.querySelector('iframe')?.getBoundingClientRect(), list=node.querySelector('ul[aria-label="Project cables"]');return{columns:getComputedStyle(node).gridTemplateColumns.split(' ').map(Number.parseFloat),viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,frameWidth:frame?.width,frameHeight:frame?.height,listScrollHeight:list?.scrollHeight,listClientHeight:list?.clientHeight};});
    assert.ok(value.scrollWidth<=value.viewport+1);assert.ok(value.frameWidth>40&&value.frameHeight>40);if(left)assert.ok(Math.abs(value.columns[0]-left)<2);else assert.equal(value.columns.length,1);assert.ok(value.listScrollHeight>value.listClientHeight);layouts.push({width,height,...value});
   }
   await cableList(page).getByRole('button').first().focus();let tabSteps=0;
   for(;tabSteps<84;tabSteps++){if(await cableRow(page,cables.outsideFirstPage.id).evaluate(node=>node===document.activeElement))break;await page.keyboard.press('Tab');}
   assert.ok(tabSteps>10&&tabSteps<84);const keyboardScroll=await cableRow(page,cables.outsideFirstPage.id).evaluate(node=>{const list=node.closest('ul'),box=node.getBoundingClientRect(),clip=list.getBoundingClientRect();return{active:node===document.activeElement,scrollTop:list.scrollTop,top:box.top,bottom:box.bottom,listTop:clip.top,listBottom:clip.bottom,viewport:innerHeight};});
   assert.equal(keyboardScroll.active,true);assert.ok(keyboardScroll.scrollTop>0);assert.ok(keyboardScroll.top>=keyboardScroll.listTop-1&&keyboardScroll.bottom<=Math.min(keyboardScroll.listBottom,keyboardScroll.viewport)+1);
   await page.setViewportSize({width:1440,height:1000});const theme=page.getByRole('switch',{name:'Toggle dark mode',exact:true});if(await theme.getAttribute('aria-checked')!=='true')await theme.click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');assert.equal(await page.getByTestId('routings-model-host').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(245, 245, 245)');await screenshot('cable-sidebar-dark-shell-light-model');await theme.click();report.layout.push(...layouts);return{layouts,keyboardNativeButtons:true,tabSteps,keyboardScroll};
  });
  await step('Real selection revision retires all cable results; explicit fresh load preserves safe scoped list behavior',async()=>{
   const old=await loadedSnapshot(page);await activate(page,cables.routeA);
   await control(state,composeArgs,{action:'set-selection',projectId:facts.projectId,selected:false});await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelectorAll('[data-testid="routings-model-host"] iframe').length===0,null,{timeout:30_000});assert.equal(await result(page).count(),0);
   await control(state,composeArgs,{action:'set-selection',projectId:facts.projectId,selected:true});const before=await eventCount(page);await button(page,'Retry').click();active=await modelReady(page,facts,before);assert.notEqual(active.value.loadId,old.loadId);await cableState(page,'ready');await activate(page,cables.routeB);return{oldLoadId:old.loadId,newLoadId:active.value.loadId,freshCableRoute:true};
  });
  await step('Browser-controlled empty/all-untagged/error states stay distinct from full confirmed cached data',async()=>{
   const payload={cables:Object.values(cables).map(({id,tag,routing})=>({id,projectId:facts.projectId,tag,routing}))};
   for(const [stateName,body]of[['empty',{cables:[]}],['untagged',{cables:payload.cables.filter(v=>!v.tag?.trim())}]]){await page.route(cablePattern,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)}));await button(page,'Refresh cables').click();await cableState(page,stateName);assert.equal(await cableList(page).getByRole('button').count(),0);await page.unroute(cablePattern);}
   await refreshed(page);await screenshot('confirmed-full-cable-list');return{basis:'Browser-controlled valid DTO snapshots for empty/all-untagged; real full source and omitted counts are separate cases.',states:['empty','untagged','ready']};
  });
  await page.goto(details+'?tab=details');await page.waitForFunction(()=>document.querySelectorAll('iframe[title="Protected 3D model"]').length===0);
  await step('Basic, technician and read-only engineer use Cables, and actual list read-access revocation retires the Viewer',async()=>{
   const roles=[];
   for(const name of['reader','technician','readOnlyEngineer']){
    const childContext=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',proxy:{server:boundary.server,bypass:'<-loopback>'}}),childTraffic=await instrumentContext(childContext,[base]);await childContext.addInitScript(collector,{projectId:facts.projectId});
    try{const child=await childContext.newPage();let created=0;child.on('response',r=>{if(r.request().method()==='POST'&&/\/viewer-sessions$/.test(new URL(r.url()).pathname)&&r.status()===201)created++;});await login(child,base,accounts[name]);await child.goto(target);await region(child).waitFor();await modeTab(child,'Cables');await cableState(child,'ready');assert.equal(await cableList(child).getByRole('button').count(),84);const deadline=Date.now()+30_000;while(!created&&Date.now()<deadline)await child.waitForTimeout(100);assert.ok(created>0);
     if(name==='reader'){await modelReady(child,facts);await activate(child,cables.routeA,'complete',{keyboard:true});const filename='stage8-'+attempt+'-'+mode+'-read-only-cable-route.png';await child.screenshot({path:path.join(state.evidenceDirectory,filename),fullPage:true});report.screenshots.push(filename);await control(state,composeArgs,{action:'revoke-reader',projectId:facts.projectId,userId:facts.actorIds.reader});await button(child,'Refresh cables').click();await child.waitForFunction(()=>document.querySelector('[data-testid="routings-viewer-status"]')?.getAttribute('data-phase')==='access-denied');assert.equal(await child.locator('iframe[title="Protected 3D model"]').count(),0);assert.equal(await cableList(child).getByRole('button').count(),0);}
     roles.push({role:name,actualListRows:84,resourceSessionsCreated:created,actualRevocation:name==='reader'});
    }finally{await childContext.close();for(const field of['observed','blocked','workers','csp'])traffic[field].push(...childTraffic[field]);}
   }return{roles,basis:'Actual public list plus protected session admission for all read roles; basic also completes real model load and keyboard cable route before actual ACL revocation.'};
  });
  await step('Initial cable-list failure is error rather than empty; explicit retry reads the real empty project and terminal401/403/404 retire scope',async()=>{
   const emptyTarget=`${base}/projects/${facts.emptyProjectId}?tab=routings-viewer`, pattern=new RegExp(`/api/projects/${facts.emptyProjectId}/cables(?:\\?.*)?$`);
   await page.route(pattern,route=>route.abort('failed'));await page.goto(emptyTarget);await region(page).waitFor();await modeTab(page,'Cables');await cableState(page,'error');
   assert.equal(await region(page).getByText('This project has no cables.',{exact:true}).count(),0);
   await page.unroute(pattern);await button(page,'Retry cables').click();await cableState(page,'empty');assert.equal(await cableList(page).getByRole('button').count(),0);
   const statuses=[];
   for(const status of[401,403,404]){
    await page.route(pattern,route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:'Controlled fixture cable access denial'})}));
    await page.reload();await region(page).waitFor();await modeTab(page,'Cables');const expected=status===401?'login-required':'access-denied';
    await page.waitForFunction(expected=>document.querySelector('[data-testid="routings-viewer-status"]')?.getAttribute('data-phase')===expected,expected);
    assert.equal(await page.locator('iframe[title="Protected 3D model"]').count(),0);assert.equal(await cableList(page).getByRole('button').count(),0);statuses.push({status,phase:expected});await page.unroute(pattern);
   }
   return{initialErrorNotEmpty:true,explicitRetryActualEmptyProject:true,statuses,basis:'Controlled browser cable status responses; real corresponding server status codes and ACL revocation proven separately.'};
  });
  assert.equal(report.businessWrites.length,0);assert.equal(traffic.blocked.length,0);assert.equal(boundary.denied.length,0);assert.equal(traffic.csp.length,0);report.status='PASS';
 }finally{
  report.finishedAt=new Date().toISOString();if(report.status!=='PASS'){report.status='FAIL';await screenshot('failure').catch(()=>{});}
  report.network={externalRequestsBlocked:traffic.blocked.length,boundaryDenials:boundary.denied.length,cspViolations:traffic.csp.length,origins:[...new Set(traffic.observed.map(v=>v.origin))],requests:boundary.requests,workerCount:traffic.workers.length};
  await context.close();await boundary.close();await fs.writeFile(path.join(state.evidenceDirectory,`stage8-browser-${attempt}-${mode}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 }return report;
}
export async function runBrowserAcceptance({ state, composeArgs, playwrightModule, browserExecutable }) {
  if (!playwrightModule || !browserExecutable) throw Error('Explicit local Playwright and browser paths are required; no downloads.');
  const { chromium } = await import(pathToFileURL(path.resolve(playwrightModule)).href);
  const browser = await chromium.launch({ executablePath: path.resolve(browserExecutable), headless: true,
    args: ['--disable-background-networking', '--disable-quic', '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const attempt = Date.now() + '-' + randomUUID().slice(0, 8);
  const report = { startedAt: new Date().toISOString(), status: 'RUNNING', browser: browser.version(), browserExecutableSha256: sha(await fs.readFile(browserExecutable)), modes: [] };
  try { for (const [mode, port] of [['docker', state.proxyPort], ['development', state.devPort]]) report.modes.push(await runMode({ browser, state, composeArgs, base: `http://127.0.0.1:${port}`, mode, attempt })); report.status = 'PASS'; }
  finally { report.finishedAt = new Date().toISOString(); if (report.status !== 'PASS') report.status = 'FAIL'; await browser.close(); await fs.writeFile(path.join(state.evidenceDirectory, `stage8-browser-${attempt}-summary.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
  console.log(JSON.stringify({ status: report.status, modes: report.modes.map(value => ({ mode: value.mode, cases: value.cases.length })) }));
}
