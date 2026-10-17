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
const credentials = () => ({ email: `stage9-${randomUUID()}@fixture.invalid`, password: randomBytes(32).toString('base64url') });
const region = page => page.getByRole('region', { name: 'Routings viewer', exact: true });
const result = page => page.getByTestId('routing-result');
const button = (page, name) => region(page).getByRole('button', { name, exact: true });
async function control(state, composeArgs, spec) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...composeArgs, '--profile', 'tests', 'run', '--rm', '--no-deps', '-T', 'tests', 'node', 'scripts/routings-viewer-stage9/fixture-control.mjs'], { cwd: state.projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
  globalThis.__stage9Events = [];
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== document.querySelector('[data-testid="routings-model-host"] iframe')?.contentWindow) return;
    const value = event.data;
    if (value?.channel !== 'wfc-routings-viewer' || value.projectId !== projectId || !['MODEL_LOADED', 'ROUTE_RESULT', 'ROUTE_ZOOMED', 'ROUTE_CLEARED', 'ERROR', 'REQUEST_CANCELLED'].includes(value.type)) return;
    // Only public protocol data from this exact frame; never URLs, headers,
    // cookies, credentials or private SDK/controller objects.
    const snapshot = { type: value.type, instanceId: value.instanceId, projectId: value.projectId,
      modelVersionId: value.modelVersionId, loadId: value.loadId, requestId: value.requestId, payload: value.payload };
    globalThis.__stage9Events.push(snapshot);
    globalThis.__stage9ObservedBridge?.(snapshot).catch(() => {});
  });
};
const eventCount = page => page.evaluate(() => globalThis.__stage9Events.length);
async function next(page, type, after = 0, timeout = 600_000, expected = null) {
  const matches = (value, type, expected) => value.type === type && (!expected ||
    ['instanceId', 'projectId', 'modelVersionId', 'loadId'].every(key => value[key] === expected[key]) &&
    value.payload.rawRouting === expected.rawRouting && value.payload.source === expected.source && value.payload.cableId === expected.cableId);
  await page.waitForFunction(({ type, after, expected }) => {
    const matches = value => value.type === type && (!expected ||
      ['instanceId', 'projectId', 'modelVersionId', 'loadId'].every(key => value[key] === expected[key]) &&
      value.payload.rawRouting === expected.rawRouting && value.payload.source === expected.source && value.payload.cableId === expected.cableId);
    const terminalPhase = document.querySelector('[data-testid="routings-viewer-status"]')?.getAttribute('data-phase');
    return globalThis.__stage9Events.slice(after).some(value => matches(value) || !expected && value.type === 'ERROR') || expected && ['error', 'login-required', 'access-denied', 'unavailable'].includes(terminalPhase);
  }, { type, after, expected }, { timeout });
  const events = await page.evaluate(after => globalThis.__stage9Events.slice(after), after);
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
  const loaded = await page.evaluate(() => globalThis.__stage9Events.filter(value => value.type === 'MODEL_LOADED').at(-1)); assert.ok(loaded);
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
const loadedSnapshot = page => page.evaluate(()=>globalThis.__stage9Events.filter(v=>v.type==='MODEL_LOADED').at(-1));
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

const panel = page => page.getByRole('dialog');
const infoButton = (page,name) => panel(page).getByRole('button',{name,exact:true});
const field = (page,name) => panel(page).getByRole('textbox',{name,exact:true});
const copyText = cable => `From: ${cable.fromLocation??''}\nTo: ${cable.toLocation??''}\nRouting: ${cable.routing??''}`;
const routeState = async page => ({operationId:await result(page).getAttribute('data-operation-id').catch(()=>null),source:await result(page).getAttribute('data-source').catch(()=>null),cableId:await result(page).getAttribute('data-cable-id').catch(()=>null),load:await loadedSnapshot(page),frames:await page.locator('[data-testid="routings-model-host"] iframe').count(),routeEvents:await page.evaluate(()=>globalThis.__stage9Events.filter(value=>['ROUTE_RESULT','ROUTE_CLEARED'].includes(value.type)).length)});
async function unchangedRoute(page,before){assert.deepEqual(await routeState(page),before);}
async function closeInfo(page){if(await panel(page).count())await infoButton(page,'Close').click();await page.waitForFunction(()=>document.querySelector('[role="dialog"][data-cable-id]')===null);}
async function openInfo(page,cable){await closeInfo(page);await page.mouse.move(1,1);await cableRow(page,cable.id).focus();await page.keyboard.press('Alt+Enter');await panel(page).waitFor();assert.equal(await panel(page).getAttribute('data-cable-id'),cable.id);assert.equal(await panel(page).getAttribute('aria-modal'),'false');}
async function exactFields(page,cable){for(const[label,key]of[['From','fromLocation'],['To','toLocation'],['Routing','routing']]){assert.equal(await field(page,label).inputValue(),cable[key]??'');assert.equal(await field(page,label).getAttribute('readonly'),'');}assert.equal(await panel(page).getByRole('heading',{name:cable.tag.trim(),exact:true}).count(),1);}
async function nativePaste(page){await page.evaluate(()=>{const target=document.createElement('textarea');target.id='stage9-paste-target';target.setAttribute('aria-label','Stage9 own clipboard verification target');Object.assign(target.style,{position:'fixed',left:'8px',top:'8px',width:'260px',height:'80px',zIndex:'2147483647'});document.body.append(target);});const target=page.locator('#stage9-paste-target');try{await target.focus();await page.keyboard.press('Control+V');return await target.inputValue();}finally{await target.evaluate(node=>node.remove());}}
async function exactNativeCopy(page,expected){await page.waitForFunction(expected=>navigator.clipboard.readText().then(actual=>actual.replaceAll('\r\n','\n')===expected),expected);assert.equal(await nativePaste(page),expected);return{exactNativePaste:true,apiReadBasis:'Observed Windows native Clipboard CRLF conversion; exact restored textarea paste and exact unit writeText arguments are separate checks.'};}
async function manualCopy(page,label,expected){const target=field(page,label);await target.focus();await page.keyboard.press('Control+A');await page.keyboard.press('Control+C');assert.equal(await nativePaste(page),expected);}
async function clipboardPermission(context,page,base,setting){const cdp=await context.newCDPSession(page);try{const {targetInfo}=await cdp.send('Target.getTargetInfo');assert.ok(targetInfo.browserContextId);for(const allowWithoutSanitization of[true,false])await cdp.send('Browser.setPermission',{permission:{name:'clipboard-write',allowWithoutSanitization},setting,origin:base,browserContextId:targetInfo.browserContextId});return await page.evaluate(async()=>({secureContext:isSecureContext,writeState:(await navigator.permissions.query({name:'clipboard-write'})).state,clipboardAvailable:typeof navigator.clipboard?.writeText==='function'}));}finally{await cdp.detach();}}
async function simulateClipboard(page,kind){await page.evaluate(kind=>{globalThis.__stage9ClipboardOwn=Object.getOwnPropertyDescriptor(navigator,'clipboard');Object.defineProperty(navigator,'clipboard',{configurable:true,value:kind==='unavailable'?undefined:{writeText:text=>kind==='failed'?Promise.reject(Error('Controlled fixture clipboard failure')):new Promise(resolve=>{globalThis.__stage9ClipboardGate={text,resolve};})}});},kind);}
async function restoreClipboard(page){await page.evaluate(()=>{if(globalThis.__stage9ClipboardOwn)Object.defineProperty(navigator,'clipboard',globalThis.__stage9ClipboardOwn);else delete navigator.clipboard;delete globalThis.__stage9ClipboardOwn;});}
const panelMonitor = () => {
 globalThis.__stage9PanelTrace=[];const trace=value=>globalThis.__stage9PanelTrace.push({at:performance.now(),...value});
 addEventListener('pointerover',event=>{const row=event.target.closest?.('button[data-cable-id]');if(!row||event.relatedTarget instanceof Node&&row.contains(event.relatedTarget))return;trace({kind:'row-enter',cableId:row.dataset.cableId});setTimeout(()=>trace({kind:'early-dwell-sample',cableId:row.dataset.cableId,panelOpen:!!document.querySelector('[role="dialog"][data-cable-id]')}),800);},true);
 const start=()=>{let previous=null;new MutationObserver(()=>{const node=document.querySelector('[role="dialog"][data-cable-id]'),identity=node?.dataset.cableId??null;if(identity!==previous){if(identity)trace({kind:'panel-open',cableId:identity,portalOutsideRow:!node.closest('li'),focusedElement:document.activeElement?.getAttribute('aria-label')??document.activeElement?.tagName});else trace({kind:'panel-close',cableId:previous});previous=identity;}}).observe(document.documentElement,{childList:true,subtree:true});};
 if(document.documentElement)start();else addEventListener('DOMContentLoaded',start,{once:true});
};

async function runMode({browser,state,composeArgs,base,mode,attempt}){
 const editor=credentials(),accounts={reader:credentials(),technician:credentials(),readOnlyEngineer:credentials()};
 const facts=await control(state,composeArgs,{...editor,...accounts}),cables=facts.cables;
 const boundary=await createBrowserBoundary({allowedOrigins:[base]});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',proxy:{server:boundary.server,bypass:'<-loopback>'}});
 const traffic=await instrumentContext(context,[base]);await context.addInitScript(collector,{projectId:facts.projectId});await context.addInitScript(panelMonitor);
 const report={schemaVersion:1,mode,origin:base,startedAt:new Date().toISOString(),status:'RUNNING',facts,cases:[],screenshots:[],bridgeEvents:[],panelTrace:[],clipboard:[],layout:[],businessWrites:[]};
 await context.exposeBinding('__stage9ObservedBridge',(_source,value)=>report.bridgeEvents.push(value));
 const page=await context.newPage(),target=`${base}/projects/${facts.projectId}?tab=routings-viewer`,cablePattern=new RegExp(`/api/projects/${facts.projectId}/cables(?:\\?.*)?$`);
 const requests=[];context.on('request',request=>{const url=new URL(request.url());requests.push({method:request.method(),path:url.pathname});});
 const screenshot=async label=>{const name=`stage9-${attempt}-${mode}-${label}.png`;await page.screenshot({path:path.join(state.evidenceDirectory,name),fullPage:true});report.screenshots.push(name);};
 const step=async(name,work)=>{const startedAt=new Date().toISOString();console.log(JSON.stringify({mode,case:name,status:'RUNNING'}));try{const value=await work();report.cases.push({name,status:'PASS',startedAt,finishedAt:new Date().toISOString(),...value});}catch(error){report.cases.push({name,status:'FAIL',startedAt,message:String(error.message).slice(0,1200)});throw error;}};
 const mutate=(key,change,projectId=facts.projectId,id=cables[key].id)=>control(state,composeArgs,{action:'change-panel-cable',projectId,key,id,change});
 const feedback=()=>page.getByTestId('cable-information-copy-status');
 let active,baseline;
 try{
  await login(page,base,editor);await page.goto(target,{waitUntil:'domcontentloaded'});await region(page).waitFor();active=await modelReady(page,facts);
  await modeTab(page,'Cables');await cableState(page,'ready');
  await step('Real Aalborg and existing cable routes/manual state remain intact with information wiring',async()=>{
   const outputs=[];for(const key of['routeA','routeB']){const route=await activate(page,cables[key]);assert.equal(route.event.payload.drawableCount,10);assert.equal(route.event.payload.lineCount,1);const camera=await settleCanvas(page,active.frame);await closeInfo(page);await screenshot('real-'+key+'-settled');outputs.push({cableId:cables[key].id,operationId:route.operationId,model:route.event.payload,camera});}
   await modeTab(page,'Manual routing');await region(page).getByRole('textbox',{name:'Manual routing',exact:true}).fill('/BC025/SECONDARY');await modeTab(page,'Cables');await cableState(page,'ready');await activate(page,cables.routeA);await closeInfo(page);await search(page).focus();baseline=await routeState(page);
   assert.equal(await cableList(page).getByRole('button').count(),84);for(const value of Object.values(cables).filter(v=>v.tag?.trim()))assert.equal(await cableRow(page,value.id).textContent(),value.tag);
   return{model:active.evidence,outputs,oneIframe:true,manualDraft:'/BC025/SECONDARY'};
  });
  await step('Actual delayed hover opens only after1000ms on an unselected UUID without autofocus/detail fetch or routing',async()=>{
   await page.mouse.move(1,1);await search(page).focus();const before=await page.evaluate(()=>globalThis.__stage9PanelTrace.length),readCount=requests.length;
   await cableRow(page,cables.routeB.id).hover();await panel(page).waitFor({timeout:10_000});assert.equal(await panel(page).getAttribute('data-cable-id'),cables.routeB.id);await exactFields(page,cables.routeB);
   const events=await page.evaluate(after=>globalThis.__stage9PanelTrace.slice(after),before),entered=events.find(v=>v.kind==='row-enter'&&v.cableId===cables.routeB.id),opened=events.find(v=>v.kind==='panel-open'&&v.cableId===cables.routeB.id);assert.ok(entered&&opened);assert.ok(opened.at-entered.at>=999.5);assert.equal(opened.portalOutsideRow,true);
   assert.equal(await search(page).evaluate(node=>node===document.activeElement),true);assert.equal(await cableRow(page,cables.routeB.id).getAttribute('aria-pressed'),'false');await unchangedRoute(page,baseline);
   assert.equal(requests.slice(readCount).filter(v=>/\/cables\/[^/]+\/details/.test(v.path)).length,0);
   return{cableId:cables.routeB.id,elapsedMs:opened.at-entered.at,earlySample:events.find(v=>v.kind==='early-dwell-sample'),exact999BoundaryBasis:'Separate fake-timer unit test; actual browser scheduler timestamps establish delayed opening, not exact scheduling.',hoverAutofocus:false,hoverDetailRequests:0};
  });
  await step('Early leave and A to B hover cancel old intent; a stale timer never opens a different UUID',async()=>{
   await closeInfo(page);await search(page).focus();await page.mouse.move(1,1);await cableRow(page,cables.duplicateA.id).hover();await page.waitForTimeout(300);await page.mouse.move(1,1);await page.waitForTimeout(850);assert.equal(await panel(page).count(),0);
   await cableRow(page,cables.duplicateA.id).hover();await page.waitForTimeout(400);await cableRow(page,cables.duplicateB.id).hover();await panel(page).waitFor({timeout:10_000});assert.equal(await panel(page).getAttribute('data-cable-id'),cables.duplicateB.id);await exactFields(page,cables.duplicateB);await unchangedRoute(page,baseline);
   return{earlyLeaveOpened:false,winningCableId:cables.duplicateB.id,duplicateTagIdentityPreserved:true};
  });
  await step('Row-gap-panel pointer travel and focus/selectable fields preserve one nonmodal dialog',async()=>{
   const row=cableRow(page,cables.duplicateB.id),rowBox=await row.boundingBox(),box=await panel(page).boundingBox();assert.ok(rowBox&&box);
   const y=Math.max(box.y+12,Math.min(rowBox.y+rowBox.height/2,box.y+box.height-12));
   await page.mouse.move(rowBox.x+rowBox.width+4,rowBox.y+rowBox.height/2);await page.waitForTimeout(50);await page.mouse.move(box.x+12,y);await page.waitForTimeout(200);assert.equal(await panel(page).getAttribute('data-cable-id'),cables.duplicateB.id);
   await field(page,'From').focus();await page.keyboard.press('Control+A');await page.mouse.move(1,1);await page.waitForTimeout(250);assert.equal(await panel(page).count(),1);const selected=await field(page,'From').evaluate(node=>({start:node.selectionStart,end:node.selectionEnd,length:node.value.length}));assert.equal(selected.end-selected.start,selected.length);
   await unchangedRoute(page,baseline);return{gapDelayMs:50,nonmodal:true,fieldSelection:selected};
  });
  await step('Pin binds an unselected UUID through hover/filter/scroll and removed DOM anchor without route changes',async()=>{
   await infoButton(page,'Pin').click();assert.equal(await panel(page).getAttribute('data-pinned'),'true');await cableRow(page,cables.routeA.id).hover();await page.waitForTimeout(1100);assert.equal(await panel(page).getAttribute('data-cable-id'),cables.duplicateB.id);
   await search(page).fill('ROUTE-A');assert.equal(await cableRow(page,cables.duplicateB.id).count(),0);await exactFields(page,cables.duplicateB);await panel(page).evaluate(node=>node.scrollTop=node.scrollHeight);await cableList(page).evaluate(node=>node.scrollTop=node.scrollHeight);assert.equal(await panel(page).getAttribute('data-cable-id'),cables.duplicateB.id);await unchangedRoute(page,baseline);
   await screenshot('pinned-filtered-unselected');await search(page).fill('');return{pinnedCableId:cables.duplicateB.id,selectedRouteCableId:cables.routeA.id,filteredAnchorRemoved:true};
  });
  await step('AltEnter opens information only; Escape and Close restore exact row/search focus without a reopen loop',async()=>{
   await closeInfo(page);await openInfo(page,cables.routeB);await unchangedRoute(page,baseline);await page.keyboard.press('Escape');assert.equal(await cableRow(page,cables.routeB.id).evaluate(node=>node===document.activeElement),true);await page.waitForTimeout(1150);assert.equal(await panel(page).count(),0);
   await openInfo(page,cables.routeB);await infoButton(page,'Pin').click();await search(page).fill('ROUTE-A');await infoButton(page,'Close').click();assert.equal(await search(page).evaluate(node=>node===document.activeElement),true);await page.waitForTimeout(1150);assert.equal(await panel(page).count(),0);await search(page).fill('');await unchangedRoute(page,baseline);return{altEnterRouteCommands:0,escapeReturnsExactUuid:true,filteredCloseReturnsSearch:true,reopenLoop:false};
  });
  await step('Native Enter and Space each route exactly once; selecting another UUID closes its predecessor panel',async()=>{
   const outputs=[];for(const[key,keyPress]of[['routeB','Enter'],['routeA','Space']]){
    await openInfo(page,cables[key==='routeA'?'routeB':'routeA']);await cableRow(page,cables[key].id).focus();const before=await eventCount(page),loaded=await loadedSnapshot(page),prior=await result(page).getAttribute('data-operation-id');
    await page.keyboard.press(keyPress);const event=await next(page,'ROUTE_RESULT',before,60_000,{...loaded,rawRouting:cables[key].routing,source:'cable',cableId:cables[key].id});await waitResult(page,'complete',prior);await page.waitForTimeout(200);
    const matches=await page.evaluate(({before,id})=>globalThis.__stage9Events.slice(before).filter(v=>v.type==='ROUTE_RESULT'&&v.payload.cableId===id).length,{before,id:cables[key].id});assert.equal(matches,1);assert.equal(await panel(page).count(),0);outputs.push({key:keyPress,cableId:cables[key].id,routeResults:matches,requestId:event.requestId});
   }baseline=await routeState(page);return{outputs};
  });
  await step('Original nullable Unicode multiline markup-looking information is text, without connected-date or type fallback',async()=>{
   for(const key of['routeA','routeB','nullRouting','emptyRouting','separators','missing']){await openInfo(page,cables[key]);await exactFields(page,cables[key]);assert.equal(await page.locator('[data-stage9-markup="literal"]').count(),0);if(key==='nullRouting'){for(const label of['From','To','Routing'])assert.equal(await field(page,label).getAttribute('placeholder'),'No value');}}
   await unchangedRoute(page,baseline);return{checkedKeys:['routeA','routeB','nullRouting','emptyRouting','separators','missing'],connectionDatesAreNotLocations:true,markupInserted:false};
  });
  await step('Clipboard success copies exact fields/all and never copies automatically on hover or pin',async()=>{
   await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await page.evaluate(()=>navigator.clipboard.writeText('Stage9 controlled fixture sentinel'));
   await openInfo(page,cables.routeB);await infoButton(page,'Pin').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'Stage9 controlled fixture sentinel');
   const copies=[];for(const[name,value]of[['Copy From',cables.routeB.fromLocation],['Copy To',cables.routeB.toLocation],['Copy Routing',cables.routeB.routing],['Copy all',copyText(cables.routeB)]]){
    await infoButton(page,name).click();await feedback().getByText('Copied.',{exact:true}).waitFor();const native=await exactNativeCopy(page,value);copies.push({field:name,exact:true,characters:value.length,...native});
   }
   await openInfo(page,cables.nullRouting);await infoButton(page,'Pin').click();await infoButton(page,'Copy From').click();await feedback().getByText('Copied.',{exact:true}).waitFor();await exactNativeCopy(page,'');await unchangedRoute(page,baseline);report.clipboard.push({kind:'native-success',exactCopies:copies,nullCopiedAsEmpty:true});return{copies,nullCopiedAsEmpty:true,placeholderCopied:false,clipboardReads:'Test observer reads only controlled fixture text after explicit test seeding/copy; application never reads clipboard.'};
  });
  await step('Actual Chromium clipboard permission denial shows no false Copied and native CtrlC/paste remains available',async()=>{
   await openInfo(page,cables.routeA);await infoButton(page,'Pin').click();const permission=await clipboardPermission(context,page,base,'denied');assert.equal(permission.clipboardAvailable,true);assert.equal(permission.writeState,'denied');
   await infoButton(page,'Copy From').click();await feedback().getByText('Select the text and press Ctrl+C.',{exact:true}).waitFor();assert.notEqual(await feedback().textContent(),'Copied.');await manualCopy(page,'From',cables.routeA.fromLocation);
   await infoButton(page,'Copy all').click();await field(page,'Copy all text').waitFor();assert.equal(await field(page,'Copy all text').inputValue(),copyText(cables.routeA));await manualCopy(page,'Copy all text',copyText(cables.routeA));await unchangedRoute(page,baseline);
   const evidence={kind:'native-browser-permission-denial',permission,manualFieldAndAllPasteExact:true,basis:'Actual Chromium permission state denied through CDP in this incognito context; original native Clipboard API rejects. Not a simulated JS rejection or a user-prompt claim.'};report.clipboard.push(evidence);await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});return evidence;
  });
  await step('Simulated unavailable Clipboard API has selectable original values and working manual copy/paste',async()=>{
   await openInfo(page,cables.routeB);await simulateClipboard(page,'unavailable');try{await infoButton(page,'Copy To').click();await feedback().getByText('Select the text and press Ctrl+C.',{exact:true}).waitFor();assert.notEqual(await feedback().textContent(),'Copied.');await manualCopy(page,'To',cables.routeB.toLocation);await unchangedRoute(page,baseline);return{kind:'simulated-api-unavailable',nativeManualPasteExact:true};}finally{await restoreClipboard(page);}
  });
  await step('Simulated failed and late Clipboard promises cannot claim success for closed or replaced panel identity',async()=>{
   await openInfo(page,cables.routeB);await infoButton(page,'Pin').click();await simulateClipboard(page,'failed');try{await infoButton(page,'Copy From').click();await feedback().getByText('Select the text and press Ctrl+C.',{exact:true}).waitFor();assert.notEqual(await feedback().textContent(),'Copied.');await manualCopy(page,'From',cables.routeB.fromLocation);}finally{await restoreClipboard(page);}
   await simulateClipboard(page,'pending');try{await infoButton(page,'Copy all').click();assert.equal(await page.evaluate(expected=>globalThis.__stage9ClipboardGate.text===expected,copyText(cables.routeB)),true);await closeInfo(page);await openInfo(page,cables.routeA);await page.evaluate(()=>globalThis.__stage9ClipboardGate.resolve());await page.waitForTimeout(150);assert.equal(await panel(page).getAttribute('data-cable-id'),cables.routeA.id);assert.notEqual(await feedback().textContent(),'Copied.');await unchangedRoute(page,baseline);return{failedKind:'simulated-rejected-promise',lateKind:'controlled-deferred-promise',replacementCableId:cables.routeA.id,staleFeedback:false};}finally{await restoreClipboard(page);}
  });
  await step('Full snapshot refresh updates unselected pinned From/To/tag independently of selected routing',async()=>{
   await openInfo(page,cables.routeB);await infoButton(page,'Pin').click();
   const gate=deferred(),reached=deferred();
   try{
    await mutate('routeB','from-only');await page.route(cablePattern,async route=>{const response=await route.fetch();reached.resolve();await gate.promise;await route.fulfill({response}).catch(()=>{});});
    await button(page,'Refresh cables').click();await reached.promise;await page.getByTestId('cable-information-status').getByText('Refreshing cables. These are previously confirmed values.',{exact:true}).waitFor();await exactFields(page,cables.routeB);
    gate.resolve();await cableState(page,'ready');await page.waitForFunction(()=>document.querySelector('textarea[aria-label="From"]')?.value==='From-only update Ω\nNo Routing change');await page.unroute(cablePattern);
    assert.equal(await field(page,'To').inputValue(),cables.routeB.toLocation);assert.equal(await field(page,'Routing').inputValue(),cables.routeB.routing);await page.getByTestId('cable-information-status').getByText('Cable information was updated.',{exact:true}).waitFor();
    await mutate('routeB','fields');await refreshed(page);assert.equal(await field(page,'From').inputValue(),'Updated From Ω\nSecond snapshot');assert.equal(await field(page,'To').inputValue(),'Updated To / β\nSecond snapshot');
    await mutate('routeB','retag');await refreshed(page);assert.equal(await panel(page).getAttribute('data-cable-id'),cables.routeB.id);assert.equal(await panel(page).getAttribute('data-pinned'),'true');await panel(page).getByRole('heading',{name:'S9-RENAMED-ORIGINAL',exact:true}).waitFor();assert.equal(await field(page,'Routing').inputValue(),cables.routeB.routing);await unchangedRoute(page,baseline);
    return{unselectedCableId:cables.routeB.id,selectedRouteCableId:cables.routeA.id,fromOnlyDetected:true,bothLocationsUpdated:true,retagSameUuid:true,refreshCaptionBeforeConfirmation:true};
   }finally{gate.resolve();await page.unroute(cablePattern);await mutate('routeB','restore');await refreshed(page);await closeInfo(page);}
  });
  await step('True deletion/blank tag of an unselected panel closes it; failed refresh remains explicitly stale',async()=>{
   const changes=[];
   try{
    for(const change of['delete','blank-tag']){
     await openInfo(page,cables.routeB);if(change==='blank-tag')await infoButton(page,'Pin').click();await mutate('routeB',change);await refreshed(page);await page.waitForFunction(()=>!document.querySelector('[role="dialog"][data-cable-id]'));await unchangedRoute(page,baseline);changes.push({change,pinned:change==='blank-tag',unselected:true});await mutate('routeB','restore');await refreshed(page);
    }
    await openInfo(page,cables.routeB);await infoButton(page,'Pin').click();await page.route(cablePattern,route=>route.abort('failed'));await button(page,'Refresh cables').click();await cableState(page,'stale');assert.equal(await panel(page).getAttribute('data-cable-id'),cables.routeB.id);await page.getByTestId('cable-information-status').getByText('These cached values may be out of date. Refresh cables to confirm them.',{exact:true}).waitFor();await exactFields(page,cables.routeB);await unchangedRoute(page,baseline);
    await page.unroute(cablePattern);await button(page,'Retry cables').click();await cableState(page,'ready');await mutate('routeB','delete');await refreshed(page);assert.equal(await panel(page).count(),0);await unchangedRoute(page,baseline);return{changes,staleIsNotDeletion:true,retryConfirmedDeletion:true};
   }finally{await page.unroute(cablePattern);await mutate('routeB','restore');await refreshed(page);await closeInfo(page);}
  });
  await step('Manual/Cables mode changes cancel panel intent without remounting the frame or editing manual text',async()=>{
   await openInfo(page,cables.routeB);await infoButton(page,'Pin').click();const before=await routeState(page);await modeTab(page,'Manual routing');assert.equal(await panel(page).count(),0);assert.equal(await region(page).getByRole('textbox',{name:'Manual routing',exact:true}).inputValue(),'/BC025/SECONDARY');await unchangedRoute(page,before);
   await modeTab(page,'Cables');await cableState(page,'ready');await page.mouse.move(1,1);await search(page).focus();await cableRow(page,cables.routeB.id).hover();await page.waitForTimeout(300);await modeTab(page,'Manual routing');await page.waitForTimeout(1100);assert.equal(await panel(page).count(),0);await modeTab(page,'Cables');await cableState(page,'ready');await unchangedRoute(page,before);return{sameLoadId:before.load.loadId,modeSwitchClosedPinned:true,pendingDwellCancelled:true,manualDraftPreserved:true};
  });
  await step('Portal stays above the light model and inside320/280/stacked small viewports with original long fields',async()=>{
   await openInfo(page,cables.long);await infoButton(page,'Pin').click();const layouts=[];
   for(const[width,height,left]of[[1440,900,320],[899,700,280],[639,760,null],[1440,480,320],[360,480,null]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(200);await field(page,'From').scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>{const node=document.querySelector('[role="dialog"][data-cable-id]');if(!node)return false;const r=node.getBoundingClientRect();return r.left>=7&&r.top>=7&&r.right<=innerWidth-7&&r.bottom<=innerHeight-7;});
    const measured=await panel(page).evaluate(node=>{const r=node.getBoundingClientRect(),layout=document.querySelector('[data-testid="routings-layout"]'),field=node.querySelector('textarea[aria-label="From"]'),point=document.elementFromPoint(r.left+Math.min(r.width/2,40),r.top+10);return{left:r.left,top:r.top,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,documentWidth:document.documentElement.scrollWidth,columns:getComputedStyle(layout).gridTemplateColumns.split(' ').map(Number.parseFloat),panelOverflow:node.scrollHeight>node.clientHeight,fieldOverflow:field.scrollHeight>field.clientHeight,portalOutsideGrid:!node.closest('[data-testid="routings-layout"]'),topHitInsidePanel:node.contains(point)};});
    assert.ok(measured.documentWidth<=width+1);assert.equal(measured.portalOutsideGrid,true);assert.equal(measured.topHitInsidePanel,true);assert.equal(measured.fieldOverflow,true);if(left)assert.ok(Math.abs(measured.columns[0]-left)<2);else assert.equal(measured.columns.length,1);assert.equal(await field(page,'From').inputValue(),cables.long.fromLocation);await infoButton(page,'Close').scrollIntoViewIfNeeded();assert.equal(await infoButton(page,'Close').isVisible(),true);layouts.push({width,height,...measured});
   }
   await page.setViewportSize({width:1440,height:1000});const theme=page.getByRole('switch',{name:'Toggle dark mode',exact:true});if(await theme.getAttribute('aria-checked')!=='true')await theme.click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');assert.equal(await page.getByTestId('routings-model-host').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(245, 245, 245)');await screenshot('dark-information-light-model');await theme.click();await unchangedRoute(page,baseline);report.layout.push(...layouts);await closeInfo(page);return{layouts,themeAdapted:true,modelRemainsLight:true,browserZoomRepeated:false};
  });
  await step('Basic/technician/unassigned engineer read original information without an active model; ACL denial masks cached fields',async()=>{
   const roles=[],infoTarget=`${base}/projects/${facts.infoOnlyProjectId}?tab=routings-viewer`;
   for(const name of['reader','technician','readOnlyEngineer']){
    const childContext=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',proxy:{server:boundary.server,bypass:'<-loopback>'}}),childTraffic=await instrumentContext(childContext,[base]);await childContext.addInitScript(collector,{projectId:facts.infoOnlyProjectId});
    try{
     const child=await childContext.newPage();await login(child,base,accounts[name]);await child.goto(infoTarget,{waitUntil:'domcontentloaded'});await region(child).waitFor();await modeTab(child,'Cables');await cableState(child,'ready');assert.equal(await cableList(child).getByRole('button').count(),84);assert.equal(await child.locator('[data-testid="routings-model-host"] iframe').count(),0);
     const cable=facts.infoOnlyCables.routeB;assert.equal(await cableRow(child,cable.id).getAttribute('aria-disabled'),'true');assert.equal(await cableRow(child,cable.id).evaluate(node=>node.disabled),false);await openInfo(child,cable);await exactFields(child,cable);await infoButton(child,'Pin').click();assert.equal(await eventCount(child),0);
     if(name==='reader'){
      await childContext.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await infoButton(child,'Copy From').click();await child.getByTestId('cable-information-copy-status').getByText('Copied.',{exact:true}).waitFor();await exactNativeCopy(child,cable.fromLocation);const filename=`stage9-${attempt}-${mode}-basic-information-without-model.png`;await child.screenshot({path:path.join(state.evidenceDirectory,filename),fullPage:true});report.screenshots.push(filename);
      await control(state,composeArgs,{action:'revoke-reader',projectId:facts.infoOnlyProjectId,userId:facts.actorIds.reader});await button(child,'Refresh cables').click();await child.waitForFunction(()=>document.querySelector('[data-testid="routings-viewer-status"]')?.getAttribute('data-phase')==='access-denied');assert.equal(await panel(child).count(),0);assert.equal(await cableList(child).getByRole('button').count(),0);
     }
     roles.push({role:name,rows:84,informationWhileModelNotReady:true,copyAllowed:name==='reader',actualAclRevocation:name==='reader'});
    }finally{await childContext.close();for(const key of['observed','blocked','workers','csp'])traffic[key].push(...childTraffic[key]);}
   }
   await unchangedRoute(page,baseline);return{roles,basis:'Actual read-role API/metadata authorization; no active model exists in this owned project and no resource session/frame is created.'};
  });
  await step('Actual selection revision and project unmount close panels and cancel pending dwell without stale reopening',async()=>{
   await openInfo(page,cables.routeB);await infoButton(page,'Pin').click();assert.equal(await panel(page).getAttribute('data-pinned'),'true');assert.equal(await panel(page).getAttribute('data-cable-id'),cables.routeB.id);
   await control(state,composeArgs,{action:'set-selection',projectId:facts.projectId,selected:false});await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.mouse.move(1,1);await page.waitForFunction(()=>document.querySelectorAll('[data-testid="routings-model-host"] iframe').length===0,null,{timeout:30_000});await search(page).focus();await page.waitForTimeout(1100);assert.equal(await panel(page).count(),0);assert.equal(await result(page).count(),0);
   await page.goto(`${base}/projects/${facts.infoOnlyProjectId}?tab=routings-viewer`,{waitUntil:'domcontentloaded'});await region(page).waitFor();await modeTab(page,'Cables');await cableState(page,'ready');await openInfo(page,facts.infoOnlyCables.routeA);await infoButton(page,'Pin').click();
   const projectTabs=()=>page.getByRole('tablist',{name:'Project sections',exact:true});await projectTabs().getByRole('tab',{name:'Details',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-testid="routings-viewer-tab"]'));await page.waitForTimeout(1100);assert.equal(await panel(page).count(),0);assert.equal(await page.locator('iframe[title="Protected 3D model"]').count(),0);
   await projectTabs().getByRole('tab',{name:'Routings viewer',exact:true}).click();await region(page).waitFor();await modeTab(page,'Cables');await cableState(page,'ready');await page.mouse.move(1,1);await search(page).focus();await cableRow(page,facts.infoOnlyCables.routeB.id).hover();await page.waitForTimeout(300);assert.equal(await panel(page).count(),0);
   await projectTabs().getByRole('tab',{name:'Details',exact:true}).evaluate(node=>node.click());await page.waitForFunction(()=>!document.querySelector('[data-testid="routings-viewer-tab"]'));await page.waitForTimeout(1100);assert.equal(await panel(page).count(),0);assert.equal(await page.locator('iframe[title="Protected 3D model"]').count(),0);
   return{oldLoadId:baseline.load.loadId,pinnedCableBeforeSelection:cables.routeB.id,selectionNullFenced:true,neutralPointerAfterRefresh:true,projectTabUnmountClosedPinned:true,pendingDwellStartedMs:300,pendingDwellUnmountActivation:'Programmatic click on the actual Details tab and real React unmount, retaining the pointer over B so pointer-leave cancellation cannot substitute for unmount cleanup.',staleTimersReopened:false,extraModelLoads:0};
  });
  report.businessWrites=boundary.requests.filter(value=>!['GET','HEAD','OPTIONS','CONNECT','UPGRADE'].includes(value.method)&&!(value.method==='POST'&&/^\/api\/auth\/login\/?$/.test(value.pathname))&&!(value.method==='POST'&&/^\/api\/projects\/[0-9a-f-]+\/model-versions\/[0-9a-f-]+\/viewer-sessions(?:\/[0-9a-f-]+\/renew)?\/?$/.test(value.pathname))&&!(value.method==='DELETE'&&/^\/api\/projects\/[0-9a-f-]+\/model-versions\/[0-9a-f-]+\/viewer-sessions\/[0-9a-f-]+\/?$/.test(value.pathname)));
  assert.equal(report.cases.length,18);assert.equal(report.businessWrites.length,0);assert.equal(traffic.blocked.length,0);assert.equal(boundary.denied.length,0);assert.equal(traffic.csp.length,0);report.status='PASS';
 }finally{
  report.finishedAt=new Date().toISOString();if(report.status!=='PASS'){report.status='FAIL';await screenshot('failure').catch(()=>{});}report.panelTrace=await page.evaluate(()=>globalThis.__stage9PanelTrace??[]).catch(()=>[]);
  report.network={externalRequestsBlocked:traffic.blocked.length,boundaryDenials:boundary.denied.length,cspViolations:traffic.csp.length,origins:[...new Set(traffic.observed.map(value=>value.origin))],requests:boundary.requests,workerCount:traffic.workers.length};
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base}).catch(()=>{});await restoreClipboard(page).catch(()=>{});await page.evaluate(()=>navigator.clipboard?.writeText('')).catch(()=>{});
  await context.close();await boundary.close();await fs.writeFile(path.join(state.evidenceDirectory,`stage9-browser-${attempt}-${mode}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
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
  finally { report.finishedAt = new Date().toISOString(); if (report.status !== 'PASS') report.status = 'FAIL'; await browser.close(); await fs.writeFile(path.join(state.evidenceDirectory, `stage9-browser-${attempt}-summary.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
  console.log(JSON.stringify({ status: report.status, modes: report.modes.map(value => ({ mode: value.mode, cases: value.cases.length })) }));
}
