import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createBrowserBoundary, instrumentContext } from './browser-policy.mjs';

const routes = [
  '/DFB018-1/DFB011/DFB012/DFB013/B002/B107-1/B107-2/B107-3/BC025/BC022-2/SECONDARY',
  '/DFBC002-2/DFC001/DFC002/DFC003/C002/C107-1/C107-2/C107-3/BC025/BC023-4/SECONDARY',
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function prepareBrowserUser(state, composeArgs, credentials, basename='browser-fixture.json') {
  const saved = path.join(state.runDirectory,basename);
  let prior; try { prior = JSON.parse(await fs.readFile(saved,'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const facts = await new Promise((resolve,reject) => {
    const child = spawn('docker',[...composeArgs,'--profile','tests','run','--rm','--no-deps','-T','tests','node','scripts/viewer-sessions/fixture-control.mjs'],{ cwd:state.projectRoot,windowsHide:true,stdio:['pipe','pipe','pipe'] });
    let stdout='',stderr=''; child.stdout.on('data',chunk => { stdout += chunk; }); child.stderr.on('data',chunk => { stderr += chunk; });
    child.once('error',reject); child.once('close',code => {
      if (code !== 0) { reject(Error('Isolated browser preparation failed; code='+code+'; '+stderr.slice(-1500))); return; }
      try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); } catch { reject(Error('Invalid isolated browser fixture response.')); }
    });
    child.stdin.end(JSON.stringify({ ...credentials,...(prior ? { projectId:prior.projectId } : {}) }));
  });
  if (!prior) await fs.writeFile(saved,JSON.stringify(facts,null,2)+'\n',{ flag:'wx' });
  return facts;
}

async function login(page, base, credentials, projectId) {
  await page.goto(base+'/login',{ waitUntil:'domcontentloaded' });
  await page.getByLabel(/^Email\s*\*?$/).fill(credentials.email);
  await page.getByLabel(/^Password\s*\*?$/).fill(credentials.password);
  await page.getByRole('button',{ name:'Sign in',exact:true }).click();
  await page.waitForURL(url => !url.pathname.includes('/login'),{ timeout:30_000 });
  await page.goto(`${base}/projects/${projectId}/viewer-harness`,{ waitUntil:'domcontentloaded' });
  await page.getByRole('button',{ name:'Load active model',exact:true }).waitFor();
}
async function nextEvent(page,type,after = 0,timeout = 120_000) {
  await page.waitForFunction(({ type,after }) => globalThis.__stage5Messages?.slice(after).some(value => value.type === type || value.type === 'ERROR'),{ type,after },{ timeout });
  const result=await page.evaluate(({ type,after }) => globalThis.__stage5Messages.slice(after).find(value => value.type === type || value.type === 'ERROR'),{ type,after });
  if(result.type==='ERROR'&&type!=='ERROR') throw Error('Viewer operation failed: '+result.payload.code);
  return result;
}
const eventCount = page => page.evaluate(() => globalThis.__stage5Messages.length);
const eventCollector = () => {
  globalThis.__stage5Messages = [];
  addEventListener('message',event => {
    const value = event.data;
    if (value?.channel === 'wfc-routings-viewer' && event.origin === location.origin && globalThis === top) {
      globalThis.__stage5Messages.push(JSON.parse(JSON.stringify(value)));
    }
  });
};

async function runMode({ browser,state,base,mode,credentials,facts,secondFacts,attempt }) {
  const boundary = await createBrowserBoundary({ allowedOrigins:[base] });
  const context = await browser.newContext({ viewport:{ width:1440,height:1000 },serviceWorkers:'block',proxy:{ server:boundary.server,bypass:'<-loopback>' },ignoreHTTPSErrors:false });
  const traffic = await instrumentContext(context,[base]);
  await context.addInitScript(eventCollector);
  const report = { mode,origin:base,startedAt:new Date().toISOString(),status:'RUNNING',cases:[],screenshots:[],freshContext:true,emptyStorageAtStart:(await context.cookies()).length===0,serviceWorkers:'blocked',browserWideProxy:true };
  const step = async (name,work) => { const at=new Date().toISOString(); console.log(JSON.stringify({ mode,case:name,status:'RUNNING',at })); try { const evidence = await work(); report.cases.push({ name,status:'PASS',startedAt:at,completedAt:new Date().toISOString(),...(evidence ?? {}) }); console.log(JSON.stringify({ mode,case:name,status:'PASS',at:new Date().toISOString() })); } catch (error) { report.cases.push({ name,status:'FAIL',startedAt:at,completedAt:new Date().toISOString(),message:String(error.message).slice(0,2000) }); throw error; } };
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled',{ cacheDisabled:true });
  try {
    await step('real login + protected imported active model, index and properties',async () => {
      await login(page,base,credentials,facts.projectId);
      await page.getByRole('button',{ name:'Load active model',exact:true }).click();
      const loaded = await nextEvent(page,'MODEL_LOADED',0,600_000);
      assert.equal(loaded.modelVersionId,facts.modelVersionId); assert.equal(loaded.payload.nodeIndexReady,true);
      const frame = page.frames().find(value => value.url().includes('/viewer-runtime/7.130.0/index.html')); assert.ok(frame);
      const evidence = await frame.locator('#runtime-evidence').evaluate(element => ({ ...element.dataset }));
      assert.equal(evidence.geometryLoaded,'true'); assert.equal(evidence.nodeIndexReady,'true');
      assert.ok(Number(evidence.fragmentCount)>600_000); assert.ok(Number(evidence.nodeCount)>400_000); assert.ok(Number(evidence.propertiesCount)>0);
      const cookies = await context.cookies(); const sessions=cookies.filter(cookie => cookie.name==='wfc_viewer_session');
      assert.ok(sessions.length>=1); assert.ok(sessions.every(cookie => cookie.httpOnly && cookie.sameSite==='Strict' && !cookie.secure && /\/viewer-sessions\/[a-f0-9-]+\/$/.test(cookie.path)));
      return { model: evidence,sessionCookieAttributes:sessions.map(({ httpOnly,sameSite,secure,path })=>({ httpOnly,sameSite,secure,path })) };
    });
    const frame = page.frames().find(value => value.url().includes('/viewer-runtime/7.130.0/index.html'));
    await step('two real project frames share a login but have independent native cookie paths',async () => {
      const other=await context.newPage();
      try {
        await other.goto(`${base}/projects/${secondFacts.projectId}/viewer-harness`);
        await other.getByRole('button',{ name:'Load active model',exact:true }).click();
        const loaded=await nextEvent(other,'MODEL_LOADED',0,600_000); assert.equal(loaded.projectId,secondFacts.projectId); assert.equal(loaded.modelVersionId,secondFacts.modelVersionId);
        const otherFrame=other.frames().find(value=>value.url().includes('/viewer-runtime/7.130.0/index.html')); assert.ok(otherFrame);
        const secondEvidence=await otherFrame.locator('#runtime-evidence').evaluate(element=>({ ...element.dataset })); assert.ok(Number(secondEvidence.propertiesCount)>0); assert.ok(Number(secondEvidence.fragmentCount)>600_000);
        const paths=(await context.cookies()).filter(cookie=>cookie.name==='wfc_viewer_session').map(cookie=>cookie.path);
        const firstPath=paths.find(value=>value.includes('/projects/'+facts.projectId+'/')),secondPath=paths.find(value=>value.includes('/projects/'+secondFacts.projectId+'/'));
        assert.ok(firstPath&&secondPath&&firstPath!==secondPath);
        const heap=[];
        for(const activePage of [page,other]) { const session=await context.newCDPSession(activePage); await session.send('Performance.enable'); const metrics=await session.send('Performance.getMetrics'); heap.push(Object.fromEntries(metrics.metrics.filter(value=>['JSHeapUsedSize','JSHeapTotalSize','Nodes','Documents'].includes(value.name)).map(value=>[value.name,value.value]))); await session.detach(); }
        await other.getByRole('button',{ name:'Close viewer',exact:true }).click(); await other.waitForFunction(()=>document.querySelectorAll('[data-testid="viewer-host"] iframe').length===0);
        const retained=await page.evaluate(async base=>{
          const descriptor=await fetch(base+'descriptor',{ cache:'no-store' }); const resource=await fetch(base+'resources/output/0/0.svf',{ method:'HEAD',cache:'no-store' }); return { descriptor:descriptor.status,resource:resource.status };
        },firstPath);
        assert.deepEqual(retained,{ descriptor:200,resource:200 }); assert.equal((await frame.locator('#runtime-evidence').getAttribute('data-properties-loaded')),'true');
        return { projectIds:[facts.projectId,secondFacts.projectId],cookiePaths:[firstPath,secondPath],secondModel:secondEvidence,retainedAfterOtherDispose:retained,rendererHeapSnapshots:heap };
      } finally { await other.close(); }
    });
    await step('two real route chains, SECONDARY ignored, zoom, empty clears',async () => {
      const results=[];
      for (let i=0;i<routes.length;i++) {
        await page.getByLabel('Test route',{ exact:true }).fill(routes[i]); const after=await eventCount(page);
        await page.getByRole('button',{ name:'Show',exact:true }).click(); const result=await nextEvent(page,'ROUTE_RESULT',after);
        assert.ok(Number(result.payload.drawableCount)>0); assert.ok(Number(result.payload.lineCount)>0);
        assert.equal(result.payload.rawRouting,routes[i]); assert.equal(JSON.stringify(result.payload).includes('"projectDB"'),false);
        const beforeZoom=await eventCount(page); await page.getByRole('button',{ name:'Zoom',exact:true }).click(); await nextEvent(page,'ROUTE_ZOOMED',beforeZoom);
        const filename=`browser-${attempt}-${mode}-route-${i+1}.png`; await page.screenshot({ path:path.join(state.evidenceDirectory,filename),fullPage:true }); report.screenshots.push(filename);
        results.push(result.payload);
      }
      await page.getByLabel('Test route',{ exact:true }).fill(''); const beforeEmpty=await eventCount(page);
      await page.getByRole('button',{ name:'Show',exact:true }).click(); const empty=await nextEvent(page,'ROUTE_RESULT',beforeEmpty);
      assert.equal(empty.payload.drawableCount,0); assert.equal(empty.payload.lineCount,0);
      return { results,empty:empty.payload };
    });
    await step('standard model tools, orbit, resize and hide/reveal',async () => {
      const canvas=frame.locator('canvas').first(); await canvas.waitFor(); const box=await canvas.boundingBox(); assert.ok(box);
      await page.mouse.move(1,1); const beforeOrbit=sha(await canvas.screenshot());
      await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5); await page.mouse.down(); await page.mouse.move(box.x+box.width*.65,box.y+box.height*.55,{ steps:12 }); await page.mouse.up();
      await page.mouse.move(1,1); await page.waitForTimeout(300); const afterOrbit=sha(await canvas.screenshot()); assert.notEqual(afterOrbit,beforeOrbit,'Orbit must change the rendered model view.');
      const tools={};
      const snapshotTool=async name=>{ const filename=`browser-${attempt}-${mode}-${name}.png`; await page.screenshot({ path:path.join(state.evidenceDirectory,filename),fullPage:true }); report.screenshots.push(filename); };
      // Entering native measurement mode replaces its original opener with a dedicated toolbar.
      await frame.locator('#toolbar-measurementSubmenuTool').click();
      await frame.locator('#measureTools').waitFor({ state:'visible' });
      const distance=frame.locator('#toolbar-measureTool-simple-distance');
      if(!await distance.evaluate(element=>element.classList.contains('active'))) await distance.click();
      await frame.waitForFunction(()=>document.querySelector('#toolbar-measureTool-simple-distance')?.classList.contains('active'));
      await frame.locator('#toolbar-measureTool-done').waitFor({ state:'visible' });
      tools.measurement={ nativeToolbarVisible:true,distanceToolActive:true,doneVisible:true }; await snapshotTool('measurement');
      await frame.locator('#toolbar-measureTool-done').click(); await frame.locator('#toolbar-measurementSubmenuTool').waitFor({ state:'visible' });
      const section=frame.locator('#toolbar-sectionTool'); await section.click();
      if(!await section.evaluate(element=>element.classList.contains('active'))) {
        const x=frame.locator('#toolbar-sectionTool-x'); await x.waitFor({ state:'visible' }); await x.click();
      }
      await frame.waitForFunction(()=>document.querySelector('#toolbar-sectionTool')?.classList.contains('active'));
      tools.section={ sectionPlaneActive:true,buttonClass:await section.getAttribute('class') }; await snapshotTool('section');
      await section.click(); await frame.waitForFunction(()=>!document.querySelector('#toolbar-sectionTool')?.classList.contains('active'));
      const properties=frame.locator('#toolbar-propertiesTool'); await properties.click();
      const propertiesPanel=frame.locator('#ViewerPropertyPanel'); await propertiesPanel.waitFor({ state:'visible' });
      tools.properties={ panelVisible:true,title:await propertiesPanel.locator('.docking-panel-title').textContent() }; await snapshotTool('properties');
      await properties.click(); await propertiesPanel.waitFor({ state:'hidden' });
      await page.setViewportSize({ width:1100,height:800 });
      await page.getByTestId('viewer-host').evaluate(element=>{ element.style.visibility='hidden'; });
      await page.waitForTimeout(200); await page.getByTestId('viewer-host').evaluate(element=>{ element.style.visibility='visible'; });
      await page.setViewportSize({ width:1440,height:1000 });
      const filename=`browser-${attempt}-${mode}-tools.png`; await page.screenshot({ path:path.join(state.evidenceDirectory,filename),fullPage:true }); report.screenshots.push(filename);
      return { tools,orbitPointerGesture:true,orbitCanvasBeforeSha256:beforeOrbit,orbitCanvasAfterSha256:afterOrbit,resize:true,hiddenRevealed:true };
    });
    await step('same-origin sibling and malformed bridge events do not alter accepted host state',async () => {
      const before=await page.getByTestId('viewer-event').textContent();
      const challenge=randomUUID();
      const forged=await page.evaluate(challenge => {
        const sibling=document.createElement('iframe'); sibling.id='stage5-sibling'; document.body.append(sibling);
        const current=globalThis.__stage5Messages.find(value=>value.type==='MODEL_LOADED');
        const forged={ ...current,type:'ERROR',payload:{ code:'RESOURCE_FAILED',message:challenge,retryable:false,operation:'LOAD_MODEL' } };
        globalThis.__stage5ForgedDelivery=null;
        const observe=event=>{ if(event.data?.payload?.message===challenge) { globalThis.__stage5ForgedDelivery={ originMatches:event.origin===location.origin,siblingSource:event.source===sibling.contentWindow,trusted:event.isTrusted }; removeEventListener('message',observe); } };
        addEventListener('message',observe);
        return forged;
      },challenge);
      const sibling=await page.locator('#stage5-sibling').elementHandle(); const siblingFrame=await sibling.contentFrame(); assert.ok(siblingFrame);
      await siblingFrame.evaluate(({ forged,origin })=>parent.postMessage(forged,origin),{ forged,origin:base });
      await page.waitForFunction(()=>globalThis.__stage5ForgedDelivery!==null);
      const delivery=await page.evaluate(()=>globalThis.__stage5ForgedDelivery); assert.deepEqual(delivery,{ originMatches:true,siblingSource:true,trusted:true });
      await page.evaluate(forged=>{
        const current=globalThis.__stage5Messages.find(value=>value.type==='MODEL_LOADED');
        const viewer=document.querySelector('[data-testid="viewer-host"] iframe').contentWindow;
        dispatchEvent(new MessageEvent('message',{ origin:'https://foreign.invalid',source:viewer,data:forged }));
        viewer.postMessage({ ...current,type:'SHOW_ROUTE',payload:{ rawRouting:'x'.repeat(70000),source:'manual',cableId:null } },location.origin);
        document.getElementById('stage5-sibling').remove();
      },forged);
      await page.waitForTimeout(300); assert.equal(await page.getByTestId('viewer-event').textContent(),before);
      return { siblingSourceRejected:true,actualSiblingDelivery:delivery,validCurrentLoadErrorEnvelope:true,foreignOriginRejected:true,oversizedCommandIgnored:true };
    });
    await step('dispose during load, repeated mount and final local teardown',async () => {
      await page.getByRole('button',{ name:'Close viewer',exact:true }).click(); await frame.waitForLoadState().catch(()=>{});
      await page.waitForFunction(()=>document.querySelectorAll('[data-testid="viewer-host"] iframe').length===0);
      for(let i=0;i<3;i++) {
        await page.getByRole('button',{ name:'Load active model',exact:true }).click();
        await page.waitForFunction(()=>document.querySelectorAll('[data-testid="viewer-host"] iframe').length===1);
        await page.getByRole('button',{ name:'Close viewer',exact:true }).click();
        await page.waitForFunction(()=>document.querySelectorAll('[data-testid="viewer-host"] iframe').length===0);
      }
      return { repeatedMountDispose:3,remainingFrames:await page.locator('[data-testid="viewer-host"] iframe').count() };
    });
    await step('actual cross-tab login logout, independent login and failed revoke',async () => {
      const createSession = async activePage => activePage.evaluate(async ({ projectId,modelVersionId }) => {
        const response=await fetch(`/api/projects/${projectId}/model-versions/${modelVersionId}/viewer-sessions`,{ method:'POST',headers:{ Authorization:'Bearer '+localStorage.getItem('wfc_auth_token'),'Content-Type':'application/json' },body:JSON.stringify({ loadId:crypto.randomUUID() }) });
        if(response.status!==201) throw Error('Browser session creation failed: '+response.status); return await response.json();
      },facts);
      const readDescriptor = (activePage,session) => activePage.evaluate(async ({ projectId,modelVersionId,sessionId }) => (await fetch(`/api/projects/${projectId}/model-versions/${modelVersionId}/viewer-sessions/${sessionId}/descriptor`,{ cache:'no-store' })).status,session);
      const first=await createSession(page),tab=await context.newPage();
      await tab.goto(`${base}/projects/${facts.projectId}/viewer-harness`); await tab.getByRole('button',{ name:'Load active model',exact:true }).waitFor();
      const separate=await browser.newContext({ viewport:{ width:1100,height:800 },serviceWorkers:'block',proxy:{ server:boundary.server,bypass:'<-loopback>' } });
      report.additionalContextTraffic=await instrumentContext(separate,[base]);
      try {
        const other=await separate.newPage(); await login(other,base,credentials,facts.projectId); const second=await createSession(other);
        await page.getByRole('button',{ name:'Load active model',exact:true }).click();
        await page.waitForFunction(()=>document.querySelectorAll('[data-testid="viewer-host"] iframe').length===1);
        const revoked=tab.waitForResponse(response=>new URL(response.url()).pathname==='/api/viewer-sessions/revoke-login'&&response.request().method()==='POST');
        await tab.getByRole('button',{ name:'Sign out',exact:true }).click(); assert.equal((await revoked).status(),204);
        await page.waitForFunction(()=>document.querySelectorAll('[data-testid="viewer-host"] iframe').length===0);
        assert.equal(await readDescriptor(page,first),410); assert.equal(await readDescriptor(other,second),200);
        await other.getByRole('button',{ name:'Load active model',exact:true }).click();
        await other.waitForFunction(()=>document.querySelectorAll('[data-testid="viewer-host"] iframe').length===1);
        await separate.route('**/api/viewer-sessions/revoke-login',route=>route.abort('failed'));
        await other.getByRole('button',{ name:'Sign out',exact:true }).click();
        await other.waitForFunction(()=>document.querySelectorAll('[data-testid="viewer-host"] iframe').length===0);
        assert.equal(await readDescriptor(other,second),200);
        assert.ok(new Date(second.expiresAt).getTime()-Date.now()<=300_000);
        return { sameLoginOtherTabDisposed:true,acknowledgedRevokeStatus:410,separateLoginStillReadable:true,failedRevokeLocallyDisposed:true,failedRevokeServerAcknowledged:false,unrenewedExpiryBoundMs:300_000 };
      } finally { await separate.close(); await tab.close(); }
    });
    const modelRequests=boundary.requests.filter(value=>value.pathname.includes('/viewer-sessions/')&&value.pathname.includes('/resources/'));
    assert.ok(modelRequests.length>0); assert.ok(traffic.workers.length>0,'Actual SDK workers must be observed.');
    assert.equal(boundary.denied.length,0,'Browser attempted non-fixture HTTP egress.'); assert.equal(traffic.blocked.length,0,'Page/worker attempted external fetch.');
    assert.equal(traffic.csp.length,0,'Unexplained enforced CSP violation.');
    assert.equal(report.additionalContextTraffic?.blocked.length??0,0); assert.equal(report.additionalContextTraffic?.csp.length??0,0);
    report.status='PASS';
  } catch(error) {
    report.status='FAIL'; report.failure=String(error.message).slice(0,2000);
    const filename=`browser-${attempt}-${mode}-failure.png`; await page.screenshot({ path:path.join(state.evidenceDirectory,filename),fullPage:true }).then(()=>report.screenshots.push(filename)).catch(()=>{});
    throw error;
  } finally {
    report.finishedAt=new Date().toISOString();
    report.network={ proxy:boundary.requests,denied:boundary.denied,...traffic };
    await context.close(); await boundary.close();
    const encoded=JSON.stringify(report,null,2)+'\n';
    await fs.writeFile(path.join(state.evidenceDirectory,`browser-${attempt}-${mode}.json`),encoded,{ flag:'wx' });
  }
  return report;
}

export async function runBrowserAcceptance({ state,composeArgs,playwrightModule,browserExecutable }) {
  if (!playwrightModule || !browserExecutable) throw Error('Browser acceptance requires explicit local --playwright-module and --browser-executable (no download).');
  const { chromium } = await import(pathToFileURL(path.resolve(playwrightModule)).href);
  const credentials={ email:`stage5-${randomUUID()}@fixture.invalid`,password:randomBytes(32).toString('base64url') };
  const facts=await prepareBrowserUser(state,composeArgs,credentials),attempt=Date.now()+'-'+randomUUID().slice(0,8);
  const secondFacts=await prepareBrowserUser(state,composeArgs,{ email:`stage5-${randomUUID()}@fixture.invalid`,password:randomBytes(32).toString('base64url') },'browser-fixture-second.json');
  const browser=await chromium.launch({ executablePath:path.resolve(browserExecutable),headless:true,args:['--disable-background-networking','--disable-quic','--no-first-run','--no-default-browser-check','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const summary={ schemaVersion:1,attempt,startedAt:new Date().toISOString(),browser:browser.version(),browserExecutableSha256:sha(await fs.readFile(browserExecutable)),projectId:facts.projectId,modelVersionId:facts.modelVersionId,modes:[],status:'RUNNING' };
  try {
    for(const [mode,port] of [['docker',state.proxyPort],['development',state.devPort]]) summary.modes.push(await runMode({ browser,state,base:`http://127.0.0.1:${port}`,mode,credentials,facts,secondFacts,attempt }));
    summary.status='PASS';
  } catch(error) { summary.status='FAIL'; throw error; }
  finally { await browser.close(); summary.completedAt=new Date().toISOString(); await fs.writeFile(path.join(state.evidenceDirectory,`browser-${attempt}-summary.json`),JSON.stringify(summary,null,2)+'\n',{ flag:'wx' }); }
  console.log(JSON.stringify({ status:summary.status,attempt,browser:summary.browser,modes:summary.modes.map(value=>({ mode:value.mode,status:value.status,cases:value.cases.length })) }));
}
