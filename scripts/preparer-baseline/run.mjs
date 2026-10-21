// Fresh source-copy baseline only. No application, SQL, Docker or APS startup.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';

const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.resolve(HERE,'../..');
const RETAINED='C:/Users/todor.chankov/.codex/.chatgpt-projects/g-p-6ad0a317833c8191bf8e4e8c824a1056/work/simplified-preparer-20261020-baseline/routings-model-package';
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
const inside=(root,file)=>{const relative=path.relative(root,path.resolve(file));return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
const need=(value,code)=>{if(!value)throw Object.assign(Error(code),{code});};
async function safe(file,directory=false){need(path.isAbsolute(file),'BASELINE_PATH');for(let at=path.resolve(file);;at=path.dirname(at)){const stat=await fs.lstat(at);need(!stat.isSymbolicLink()&&(samePath(at,file)&&!directory?stat.isFile()&&stat.nlink===1:stat.isDirectory()),'BASELINE_PATH');if(path.dirname(at)===at)break;}
 need(samePath(await fs.realpath(file),file),'BASELINE_PATH');}
async function read(file,maxBytes=8*1024**2){await safe(file);const before=await fs.stat(file);need(before.size<=maxBytes,'BASELINE_FILE_LIMIT');const bytes=await fs.readFile(file),after=await fs.stat(file);
 need(before.ino===after.ino&&before.size===bytes.length&&after.size===bytes.length&&before.mtimeMs===after.mtimeMs,'BASELINE_SOURCE_CHANGED');return bytes;}
const pin=async(file,maxBytes)=>{const bytes=await read(file,maxBytes);return{path:file,bytes:bytes.length,sha256:hash(bytes)};};
async function write(file,value){await fs.writeFile(file,canonical(value)+'\n',{flag:'wx',mode:0o600});return pin(file);}
async function list(root){const result=[];async function walk(dir,prefix=''){for(const entry of(await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
 const relative=prefix+entry.name;need(!entry.isSymbolicLink()&&!/^(?:\.env(?:\.|$)|node_modules$|\.git$)/i.test(entry.name),'BASELINE_SOURCE_ENTRY');
 if(entry.isDirectory())await walk(path.join(dir,entry.name),relative+'/');else{need(entry.isFile()&&!/\.(?:nwd|zip|svf|db|pf|pack|gz|key|enc|private\.json)$/i.test(relative),'BASELINE_SOURCE_ENTRY');result.push(relative);need(result.length<=2000,'BASELINE_SOURCE_COUNT');}}}
 await safe(root,true);await walk(root);return result;}
async function copy(root,destination,relative,inventory){const source=path.join(root,...relative.split('/')),bytes=await read(source),file=path.join(destination,...relative.split('/'));
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});inventory.push({source,path:source,bytes:bytes.length,sha256:hash(bytes),destination:file,copiedSha256:hash(bytes)});}
export function terminalTotals(tap){const result={};for(const key of ['tests','pass','fail','cancelled','skipped','todo']){const values=[...tap.matchAll(new RegExp('^# '+key+' (\\d+)\\r?$','gm'))];result[key]=values.length?Number(values.at(-1)[1]):null;}return result;}
export function terminalPass(result){return result.exitCode===0&&result.signal===null&&!result.killed&&!result.spawnFailure&&result.joined===true&&['tests','pass','fail','cancelled','skipped','todo'].every(key=>Number.isSafeInteger(result[key])&&result[key]>=0)&&result.tests>0&&result.pass===result.tests&&result.fail===0&&result.cancelled===0&&result.skipped===0&&result.todo===0;}
export function workerEntriesJoined(reports,expected){
 if(!Array.isArray(expected)||expected.length===0||expected.some(file=>typeof file!=='string'||!path.isAbsolute(file)))return false;
 const normalized=expected.map(file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file));if(new Set(normalized).size!==expected.length)return false;
 return expected.every(file=>{const found=reports.filter(row=>typeof row.entrypoint==='string'&&path.isAbsolute(row.entrypoint)&&samePath(row.entrypoint,file));return found.length===1&&found[0].exitCode===0;});
}
export function childEdgesJoined(starts,closes,reports,phase){
 const key=row=>row.parentPid+'-'+row.ordinal,closed=new Map(closes.map(row=>[key(row),row])),seen=new Set(),reported=new Set(reports.map(row=>row.pid));
 if(closed.size!==closes.length||starts.length!==closes.length)return false;
 for(const row of starts){const id=key(row),end=closed.get(id);if(seen.has(id)||row.schemaVersion!=='wfc.preparer.baseline-edge.v1'||row.phase!==phase||!Number.isSafeInteger(row.parentPid)||row.parentPid<=0||!Number.isSafeInteger(row.childPid)||row.childPid<=0||!Number.isSafeInteger(row.ordinal)||row.ordinal<=0||!['node','acl'].includes(row.kind)||!end)return false;seen.add(id);
  if(Object.keys(row).sort().join(',')!=='childPid,kind,ordinal,parentPid,phase,schemaVersion'||Object.keys(end).sort().join(',')!=='childPid,code,kind,ordinal,parentPid,phase,schemaVersion,signal'||canonical(row)!==canonical(Object.fromEntries(Object.entries(end).filter(([field])=>field!=='code'&&field!=='signal'))))return false;
  if(end.code!==null&&!Number.isInteger(end.code)||end.signal!==null&&typeof end.signal!=='string'||end.code===null&&end.signal===null)return false;
  // A deliberately killed fixture need not run an exit handler. Its parent must
  // still positively observe close; an unclosed descendant edge always fails.
  if(row.kind==='node'&&end.signal===null&&!reported.has(row.childPid))return false;
 }
 return true;
}
function childEnvironment(controlFile,controlHash,scratch,preload){const env={};for(const name of ['SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','PATH','NUMBER_OF_PROCESSORS'])if(process.env[name]!==undefined)env[name]=process.env[name];
 Object.assign(env,{TEMP:scratch,TMP:scratch,TMPDIR:scratch,HOME:path.join(scratch,'home'),USERPROFILE:path.join(scratch,'home'),PREPARER_BASELINE_CONTROL:controlFile,PREPARER_BASELINE_CONTROL_SHA256:controlHash,
 NODE_OPTIONS:'--max-old-space-size=1024 --import '+pathToFileURL(preload).href});return env;}
async function runSuite({name,cwd,files,work,preload,aclEncodedSha256,powershell}){
 const evidence=path.join(work,'evidence',name),ports=path.join(work,'ports',name),edges=path.join(evidence,'edges'),scratch=path.join(work,'scratch');await fs.mkdir(evidence,{recursive:true,mode:0o700});await fs.mkdir(ports,{recursive:true,mode:0o700});await fs.mkdir(edges,{mode:0o700});
 const control={schemaVersion:'wfc.preparer.baseline-control.v1',work,evidence,ports,edges,phase:name,nonce:randomUUID(),aclEncodedSha256,powershell};
 const controlFile=path.join(evidence,'control.json'),controlPin=await write(controlFile,control),env=childEnvironment(controlFile,controlPin.sha256,scratch,preload);
 const args=['--test','--test-concurrency=1','--test-reporter=tap','--test-timeout=120000',...files],deadlineMs=name==='guard'?60000:name==='package'?300000:480000;
 await write(path.join(evidence,'command.json'),{schemaVersion:'wfc.preparer.baseline-command.v2',cwd,executable:process.execPath,node:process.version,args,deadlineMs,control:controlPin,
  environmentPolicy:'Named OS runtime keys only; fresh owned TEMP/HOME, pinned guard; credentials never forwarded.',networkPolicy:'Only registered owned literal-loopback ephemeral listeners; external DNS/UDP/subprocess shells refused.'});
 const stdout=await fs.open(path.join(evidence,'tests.tap'),'wx',0o600),stderr=await fs.open(path.join(evidence,'stderr.log'),'wx',0o600);
 const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']}),began=Date.now();let killed=false,total=0,spawnFailure=null,writing=Promise.resolve(),writeFailed=false,killerJoin,joinTimer,closed=false,capturing=true,resolveUnconfirmed;
 const unconfirmed=new Promise(resolve=>{resolveUnconfirmed=resolve;});
 function stop(){if(killed||closed)return;killed=true;
  if(child.exitCode===null&&child.signalCode===null&&child.pid){
   if(process.platform==='win32'){const killer=spawn(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killerJoin=new Promise(resolve=>{let done=false;const finish=joined=>{if(done)return;done=true;clearTimeout(bound);if(!joined){killer.kill();killer.unref();}resolve(joined);};const bound=setTimeout(()=>finish(false),10000);killer.once('error',()=>finish(false));killer.once('close',()=>finish(true));});}
   else child.kill('SIGKILL');
  }
  joinTimer=setTimeout(()=>resolveUnconfirmed({exitCode:child.exitCode,signal:child.signalCode,joined:false}),10000);
 }
 const timer=setTimeout(stop,deadlineMs);child.once('error',error=>{spawnFailure=error.code??'SPAWN_FAILED';});
 function append(handle,bytes){if(!capturing)return;total+=bytes.length;if(total>16*1024**2){stop();return;}writing=writing.then(()=>handle.write(bytes)).catch(()=>{writeFailed=true;stop();});}
 child.stdout.on('data',bytes=>append(stdout,bytes));child.stderr.on('data',bytes=>append(stderr,bytes));
 const ended=await Promise.race([new Promise(resolve=>child.once('close',(exitCode,signal)=>{closed=true;resolve({exitCode,signal,joined:true});})),unconfirmed]);clearTimeout(timer);clearTimeout(joinTimer);capturing=false;
 if(!ended.joined){child.stdout.destroy();child.stderr.destroy();child.unref();}await writing;const killerJoined=killerJoin===undefined?null:await killerJoin;await stdout.close();await stderr.close();
 const tap=await fs.readFile(path.join(evidence,'tests.tap'),'utf8'),reports=[];for(const file of(await fs.readdir(evidence)).filter(file=>/^guard-[0-9]+\.json$/.test(file))){const record=JSON.parse((await read(path.join(evidence,file))).toString('utf8'));need(record.schemaVersion==='wfc.preparer.baseline-isolation.v2'&&record.phase===name&&Number.isSafeInteger(record.pid)&&record.pid>0&&typeof record.entrypoint==='string'&&path.isAbsolute(record.entrypoint)&&inside(work,record.entrypoint)&&Number.isSafeInteger(record.exitCode)&&['fetch','connect','listen','children','denied'].every(key=>Number.isSafeInteger(record.counts?.[key])&&record.counts[key]>=0),'BASELINE_GUARD_REPORT');reports.push(record);}
 const starts=[],closes=[];for(const file of await fs.readdir(edges)){need(/^edge-[0-9]+-[0-9]+\.(?:start|close)\.json$/.test(file),'BASELINE_EDGE_FILE');(file.endsWith('.start.json')?starts:closes).push(JSON.parse((await read(path.join(edges,file))).toString('utf8')));}
 const expectedWorkers=files.map(file=>path.resolve(cwd,file)),workersJoined=workerEntriesJoined(reports,expectedWorkers),denied=reports.reduce((sum,row)=>sum+row.counts.denied,0),childrenJoined=workersJoined&&reports.every(row=>Array.isArray(row.activeChildren)&&row.activeChildren.length===0)&&childEdgesJoined(starts,closes,reports,name),portsClosed=(await fs.readdir(ports)).length===0;
 const result={schemaVersion:'wfc.preparer.baseline-suite.v2',name,...ended,spawnFailure,killed,killerJoined,childrenJoined,portsClosed,writeFailed,durationMs:Date.now()-began,outputBytes:total,...terminalTotals(tap),
  guard:{reports:reports.length,edges:starts.length,expectedWorkers,workersJoined,denied,expectedDenied:name==='guard'?8:0},tap:await pin(path.join(evidence,'tests.tap'),16*1024**2),stderr:await pin(path.join(evidence,'stderr.log'),16*1024**2)};
 result.status=terminalPass(result)&&childrenJoined&&portsClosed&&!writeFailed&&killerJoined!==false&&denied===result.guard.expectedDenied?'PASS':'FAIL';if(!ended.joined)result.inspectRequired={pid:child.pid,reason:'CHILD_TREE_JOIN_UNCONFIRMED'};await write(path.join(evidence,'result.json'),result);return result;
}
export async function main(){const args=process.argv.slice(2);need(args.length===4&&args[0]==='--work'&&args[2]==='--suite'&&['guard','package','preparer','all'].includes(args[3]),'BASELINE_ARGUMENTS');
 need(process.versions.node.split('.')[0]==='24','BASELINE_NODE24_REQUIRED');const work=path.resolve(args[1]),parent=path.dirname(work);need(path.isAbsolute(args[1])&&inside(path.join(ROOT,'.preparer-work'),work)&&!samePath(work,path.join(ROOT,'.preparer-work')),'BASELINE_WORK_BOUNDARY');
 await safe(parent,true);await fs.mkdir(work,{recursive:false,mode:0o700});await safe(work,true);await fs.mkdir(path.join(work,'evidence'),{mode:0o700});await fs.mkdir(path.join(work,'scratch','home'),{recursive:true,mode:0o700});
 const inventory=[],packageCopy=path.join(work,'routings-model-package'),preparerCopy=path.join(work,'model-preparer'),vendorCopy=path.join(work,'server/vendor/routings-model-package'),harnessCopy=path.join(work,'harness');
 for(const dir of [packageCopy,preparerCopy,vendorCopy,harnessCopy])await fs.mkdir(dir,{recursive:true,mode:0o700});
 for(const relative of await list(RETAINED))await copy(RETAINED,packageCopy,relative,inventory);
 for(const relative of await list(path.join(ROOT,'model-preparer')))await copy(path.join(ROOT,'model-preparer'),preparerCopy,relative,inventory);
 const vendor=path.join(ROOT,'server/vendor/routings-model-package'),provenancePin=await pin(path.join(vendor,'provenance.json')),provenance=JSON.parse((await read(provenancePin.path)).toString('utf8'));need(provenance.fileCount===12&&Array.isArray(provenance.files)&&provenance.files.length===12,'BASELINE_VENDOR_INVENTORY');
 for(const record of provenance.files){need(record.path==='index.mjs'||record.path==='package.json'||/^lib\/[A-Za-z0-9._-]+\.mjs$/.test(record.path),'BASELINE_VENDOR_PATH');const bytes=await read(path.join(vendor,record.path));
  // Raw checkout bytes are the current consumer authority; historical provenance
  // may have LF-normalized hashes. Never rewrite the vendored source to match it.
  const destination=path.join(packageCopy,record.path),source=path.join(vendor,record.path);need(inventory.some(item=>samePath(item.destination,destination)),'BASELINE_OVERLAY_TARGET');await safe(destination);await fs.writeFile(destination,bytes,{flag:'w',mode:0o600});inventory.push({source,path:source,bytes:bytes.length,sha256:hash(bytes),destination,copiedSha256:hash(bytes),role:'current-vendor-overlay'});
  await copy(vendor,vendorCopy,record.path,inventory);}
 for(const relative of ['isolation.mjs','guard.test.mjs','child.mjs','run.test.mjs','run.mjs'])await copy(HERE,harnessCopy,relative,inventory);
 const policySource=(await read(path.join(ROOT,'model-preparer/ops/common.mjs'))).toString('utf8'),matches=[...policySource.matchAll(/const script = `([^`]+)`;/g)];need(matches.length===1&&!matches[0][1].includes('${'),'BASELINE_ACL_POLICY');
 const aclEncodedSha256=hash(Buffer.from(matches[0][1],'utf16le').toString('base64')),powershell=process.platform==='win32'?await fs.realpath(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')):null;
 const supervisor=await pin(fileURLToPath(import.meta.url)),copiedFiles=[];for(const destination of new Set(inventory.map(row=>row.destination)))copiedFiles.push(await pin(destination));
 const sourceInputs=await write(path.join(work,'evidence','source-inputs.json'),{schemaVersion:'wfc.preparer.baseline-inputs.v2',entries:inventory,copiedFiles,supervisor,vendorProvenance:provenancePin,historicalEvidence:'Read-only; no old logs or source snapshots overwritten.'});
 const phases=args[3]==='all'?['guard','package','preparer']:args[3]==='guard'?['guard']:['guard',args[3]],results=[];
 for(const name of phases){const cwd=name==='guard'?harnessCopy:name==='package'?packageCopy:preparerCopy,files=[];for(const folder of name==='guard'?['']:name==='package'?['test']:['test','app-test'])for(const file of(await fs.readdir(path.join(cwd,folder))).sort())if(file.endsWith('.test.mjs'))files.push(path.join(folder,file));need(files.length>0,'BASELINE_TEST_FILES');
  const result=await runSuite({name,cwd,files,work,preload:path.join(harnessCopy,'isolation.mjs'),aclEncodedSha256,powershell});results.push(result);process.stdout.write(JSON.stringify({suite:name,status:result.status,tests:result.tests,pass:result.pass,fail:result.fail,cancelled:result.cancelled})+'\n');if(result.status!=='PASS')break;}
 let unchanged=true,copiesUnchanged=true;for(const record of [...inventory.map(row=>({...row,path:row.source})),supervisor,provenancePin]){const actual=await pin(record.path);if(actual.bytes!==record.bytes||actual.sha256!==record.sha256)unchanged=false;}for(const record of copiedFiles){const actual=await pin(record.path);if(actual.bytes!==record.bytes||actual.sha256!==record.sha256)copiesUnchanged=false;}
 const summary={schemaVersion:'wfc.preparer.baseline-summary.v2',status:results.length===phases.length&&results.every(r=>r.status==='PASS')&&unchanged&&copiesUnchanged?'PASS':'FAIL',node:process.version,sourceInputs,sourceInputsUnchanged:unchanged,copiedInputsUnchanged:copiesUnchanged,results,
  scope:'Local copied-source tests and guard controls only; real WFC/DB/Docker/APS/browser acceptance NOT_RUN.',finishedAt:new Date().toISOString()};await write(path.join(work,'evidence','summary.json'),summary);return summary.status==='PASS'?0:1;
}
if(process.argv[1]&&samePath(process.argv[1],fileURLToPath(import.meta.url)))main().then(code=>{process.exitCode=code;},error=>{process.stderr.write(JSON.stringify({status:'FAIL',code:/^[A-Z][A-Z0-9_]+$/.test(error?.code??'')?error.code:'BASELINE_SUPERVISOR_FAILED',inspectRequired:true})+'\n');process.exitCode=1;});
