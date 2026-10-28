// Test-only preload. It is never imported by the application or deployment.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';
import dgram from 'node:dgram';
import cp from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';

const hash=v=>createHash('sha256').update(v).digest('hex');
const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
const inside=(root,file)=>{const rel=path.relative(root,path.resolve(file));return rel===''||!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
function safe(file,directory=false){for(let at=path.resolve(file);;at=path.dirname(at)){const s=fs.lstatSync(at);if(s.isSymbolicLink()||(samePath(at,file)&&!directory?!s.isFile()||s.nlink!==1:!s.isDirectory()))throw Error('BASELINE_CONTROL_PATH');if(path.dirname(at)===at)break;}
 if(!samePath(fs.realpathSync(file),file))throw Error('BASELINE_CONTROL_PATH');}
const pinnedEnv=Object.freeze(Object.fromEntries(['SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','PATH','NUMBER_OF_PROCESSORS','TEMP','TMP','TMPDIR','HOME','USERPROFILE','NODE_OPTIONS','PREPARER_BASELINE_CONTROL','PREPARER_BASELINE_CONTROL_SHA256','NODE_TEST_CONTEXT'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]])));
const controlFile=pinnedEnv.PREPARER_BASELINE_CONTROL;safe(controlFile);
const raw=fs.readFileSync(controlFile);if(raw.length>65536||hash(raw)!==pinnedEnv.PREPARER_BASELINE_CONTROL_SHA256)throw Error('BASELINE_CONTROL_HASH');
const control=Object.freeze(JSON.parse(raw));if(control.schemaVersion!=='wfc.preparer.baseline-control.v2'||control.retireKilledChildPorts!==true||!path.isAbsolute(control.work)||!inside(control.work,controlFile)||!inside(control.work,control.evidence)||!inside(control.work,control.ports)||!inside(control.work,control.edges)||!['guard','package','preparer'].includes(control.phase))throw Error('BASELINE_CONTROL_SCHEMA');
safe(control.work,true);safe(control.evidence,true);safe(control.ports,true);safe(control.edges,true);
const trustedPowerShellPin=control.powershellPin===null?null:Object.freeze({...control.powershellPin});
const executableFields=['schemaVersion','path','dev','ino','bytes','nlink','sha256'];
function executablePinShape(value){return value&&Object.keys(value).sort().join(',')===[...executableFields].sort().join(',')&&value.schemaVersion==='wfc.preparer.baseline-trusted-executable.v1'
 &&typeof value.path==='string'&&path.isAbsolute(value.path)&&['dev','ino','nlink'].every(key=>typeof value[key]==='string'&&/^(?:0|[1-9][0-9]{0,31})$/.test(value[key]))&&BigInt(value.ino)>0n&&BigInt(value.nlink)>0n
 &&Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=128*1024**2&&/^[a-f0-9]{64}$/.test(value.sha256??'');}
/** Test-visible verification only. A supplied candidate cannot replace the
 * immutable root-produced pin or select a different executable. */
export function assertTrustedPowerShellPin(candidate=trustedPowerShellPin){
 const refuse=()=>{throw Error('BASELINE_TRUSTED_EXECUTABLE_CHANGED');};
 if(process.platform!=='win32'||!executablePinShape(trustedPowerShellPin)||!executablePinShape(candidate)||!executableFields.every(key=>candidate[key]===trustedPowerShellPin[key]))return refuse();
 const file=path.resolve(pinnedEnv.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');if(!samePath(file,control.powershell)||!samePath(file,trustedPowerShellPin.path))return refuse();
 for(let at=file;;at=path.dirname(at)){const s=fs.lstatSync(at,{bigint:true});if(s.isSymbolicLink()||(samePath(at,file)?!s.isFile()||s.nlink<=0n:!s.isDirectory()))return refuse();if(path.dirname(at)===at)break;}
 if(!samePath(fs.realpathSync(file),file))return refuse();const before=fs.lstatSync(file,{bigint:true}),same=(a,b)=>a.isFile()&&!a.isSymbolicLink()&&a.dev===b.dev&&a.ino===b.ino&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
 if(String(before.dev)!==trustedPowerShellPin.dev||String(before.ino)!==trustedPowerShellPin.ino||String(before.nlink)!==trustedPowerShellPin.nlink||before.size!==BigInt(trustedPowerShellPin.bytes))return refuse();
 const handle=fs.openSync(file,'r');try{if(!same(fs.fstatSync(handle,{bigint:true}),before))return refuse();const bytes=fs.readFileSync(handle);
  if(bytes.length!==trustedPowerShellPin.bytes||hash(bytes)!==trustedPowerShellPin.sha256||!same(fs.fstatSync(handle,{bigint:true}),before)||!same(fs.lstatSync(file,{bigint:true}),before))return refuse();
 }finally{fs.closeSync(handle);}return true;
}
if(process.platform==='win32')assertTrustedPowerShellPin();else if(trustedPowerShellPin!==null||control.powershell!==null)throw Error('BASELINE_TRUSTED_EXECUTABLE_CHANGED');
const entrypoint=typeof process.argv[1]==='string'?path.resolve(process.argv[1]):null;
const ownSource=fileURLToPath(import.meta.url),began=performance.now(),denials=[],stages=new Map();let denialsDropped=0;
const elapsed=()=>Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.round(performance.now()-began)));
function callsite(stack){for(const line of stack?.split('\n').slice(1)??[]){const match=line.match(/(?:\(|\s)((?:file:\/\/\/|[A-Za-z]:[\\/]|\/).*):(\d+):(\d+)\)?$/);if(!match)continue;let file;try{file=match[1].startsWith('file:')?fileURLToPath(match[1]):match[1];}catch{continue;}if(!inside(control.work,file)||samePath(file,ownSource))continue;const relative=path.relative(control.work,file).split(path.sep).join('/');if(relative.length<=240&&/^(?:harness|model-preparer|routings-model-package|server\/vendor\/routings-model-package)\/[A-Za-z0-9._/-]+\.mjs$/.test(relative)&&Number(match[2])>0&&Number(match[2])<=10000000)return{file:relative,line:Number(match[2])};}return{file:null,line:null};}
const counts={fetch:0,connect:0,listen:0,children:0,denied:0},children=new Map(),closedChildren=[],ports=new Map();let edgeOrdinal=0;
export const isolationCounters=()=>Object.freeze({...counts});
export const isolationDiagnostics=()=>structuredClone({denials,denialsDropped,stages:[...stages.values()]});
const DENIAL_CODES=new Set(['FETCH_DESTINATION','SOCKET_DESTINATION','LISTEN_SCOPE','DNS_SCOPE','UDP_SCOPE','CHILD_ENVIRONMENT','CHILD_ARGUMENTS','CHILD_OPTIONS','CHILD_EXECUTABLE','CHILD_ACL_INPUT','CHILD_FORK','CHILD_SHELL']);
// Observation only: a killed worker may never emit its terminal guard report.
// Atomic replacement retains its last complete checkpoint without manufacturing
// an exit, child join or closed-port proof. No destination/error text is stored.
const diagnosticFile=path.join(control.evidence,'diagnostics-'+process.pid+'.json'),denialClasses=new Set();
let diagnosticSequence=0,diagnosticLastAt=-Infinity,diagnosticDirty=false,diagnosticTimer=null,diagnosticWriteFailures=0;
const diagnosticEntrypoint=entrypoint&&inside(control.work,entrypoint)?path.relative(control.work,entrypoint).split(path.sep).join('/'):null;
function diagnosticCheckpoint(checkpoint,immediate=false){
 diagnosticDirty=true;const now=performance.now();
 if(!immediate&&now-diagnosticLastAt<1000){if(diagnosticTimer===null){diagnosticTimer=setTimeout(()=>{diagnosticTimer=null;if(diagnosticDirty)diagnosticCheckpoint('CHANGED');},Math.max(1,Math.ceil(1000-(now-diagnosticLastAt))));diagnosticTimer.unref();}return;}
 if(diagnosticTimer!==null){clearTimeout(diagnosticTimer);diagnosticTimer=null;}diagnosticDirty=false;diagnosticLastAt=now;
 const sequence=++diagnosticSequence,value={schemaVersion:'wfc.preparer.baseline-diagnostics.v1',observationOnly:true,phase:control.phase,nonce:control.nonce,pid:process.pid,entrypoint:diagnosticEntrypoint,
  sequence,atMs:elapsed(),checkpoint,writeFailures:diagnosticWriteFailures,counts:{...counts},...isolationDiagnostics()},bytes=JSON.stringify(value)+'\n',temporary=path.join(control.evidence,'diagnostics-'+process.pid+'-'+sequence+'.tmp');
 try{if(Buffer.byteLength(bytes)>16384)throw Error('BASELINE_DIAGNOSTIC_LIMIT');fs.writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});fs.renameSync(temporary,diagnosticFile);}catch{diagnosticWriteFailures++;}
}
function deny(operation){if(!DENIAL_CODES.has(operation))operation='CHILD_ARGUMENTS';counts.denied++;if(denials.length<32){const holder={};Error.captureStackTrace(holder,deny);denials.push({operation,atMs:elapsed(),...callsite(holder.stack)});}else denialsDropped++;const first=!denialClasses.has(operation);denialClasses.add(operation);diagnosticCheckpoint(first?'DENIAL_CLASS':'CHANGED',first);throw Object.assign(Error('BASELINE_EXTERNAL_OPERATION_REFUSED'),{code:'BASELINE_EXTERNAL_OPERATION_REFUSED'});}
const literal=host=>['127.0.0.1','::1','[::1]'].includes(host);
const parentGrant=process.env.PREPARER_BASELINE_PARENT_GRANT??null,parentGrantPid=process.env.PREPARER_BASELINE_PARENT_PID??null;
if(parentGrant!==null&&(!/^[a-f0-9-]{36}$/.test(parentGrant)||!/^[1-9][0-9]*$/.test(parentGrantPid??'')||Number(parentGrantPid)!==process.ppid)||parentGrant===null&&parentGrantPid!==null)throw Error('BASELINE_PARENT_GRANT');
function portGrant(value){return value&&Object.keys(value).sort().join(',')==='grantId,host,nonce,parentPid,pid,port,schemaVersion'&&value.schemaVersion==='wfc.preparer.baseline-port.v2'&&value.nonce===control.nonce&&literal(value.host)&&Number.isInteger(value.port)&&value.port>=49152&&value.port<=65535&&Number.isSafeInteger(value.pid)&&value.pid>0&&Number.isSafeInteger(value.parentPid)&&value.parentPid>0&&(value.grantId===null||/^[a-f0-9-]{36}$/.test(value.grantId));}
function registered(host,port){if(!literal(host)||!Number.isInteger(Number(port))||Number(port)<49152||Number(port)>65535)return false;
 try{const file=path.join(control.ports,'port-'+port+'.json');safe(file);const bytes=fs.readFileSync(file);if(bytes.length>1024)return false;const value=JSON.parse(bytes.toString('utf8'));return portGrant(value)&&value.port===Number(port);}catch{return false;}}
function stageCode(url,method){const route=url.pathname;if(route==='/api/session'||route.startsWith('/api/session/'))return'WORKSPACE_SESSION';if(route==='/api/settings')return'WORKSPACE_SETTINGS';if(route==='/api/autodesk/check')return'WORKSPACE_AUTODESK_CHECK';if(route==='/api/uploads')return'UPLOAD';if(route==='/api/generations')return method==='GET'?'GENERATION_READ':'GENERATION_START';if(/^\/api\/generations\/[a-f0-9-]{36}\/resume$/.test(route))return'GENERATION_RESUME';if(/^\/api\/generations\/[a-f0-9-]{36}\/package$/.test(route))return'GENERATION_PACKAGE';if(route==='/api/config')return'INNER_CONFIG';if(/^\/api\/operations\/[a-f0-9-]{36}$/.test(route))return'INNER_OPERATION_READ';if(/^\/api\/jobs\/[a-f0-9-]{36}$/.test(route))return'INNER_JOB_READ';if(route==='/api/jobs/capture'||route==='/api/jobs/capture-known')return'INNER_CAPTURE';if(/^\/api\/jobs\/[a-f0-9-]{36}\/actions$/.test(route))return'INNER_ACTION';if(/^\/api\/artifacts\/[a-f0-9-]{36}\/(?:package|report)$/.test(route))return'INNER_ARTIFACT';return'OTHER_LOCAL';}
function beginStage(code){const first=!stages.has(code),atMs=elapsed(),row=stages.get(code)??{code,count:0,completed:0,pending:0,firstAtMs:atMs,lastAtMs:atMs,totalMs:0,maxMs:0,lastOutcome:'PENDING'};row.count++;row.pending++;row.lastAtMs=atMs;stages.set(code,row);diagnosticCheckpoint(first?'NEW_STAGE':'CHANGED',first);}
function observeStage(code,started,outcome){const durationMs=Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,Math.round(performance.now()-started))),row=stages.get(code),first=row.completed===0;row.pending--;row.completed++;row.lastAtMs=elapsed();row.totalMs=Math.min(Number.MAX_SAFE_INTEGER,row.totalMs+durationMs);row.maxMs=Math.max(row.maxMs,durationMs);row.lastOutcome=outcome;diagnosticCheckpoint(first?'FIRST_STAGE_OUTCOME':'CHANGED',first);}
const originalFetch=globalThis.fetch;
globalThis.fetch=async function(input,...args){const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.protocol!=='http:'||url.username||url.password||!registered(url.hostname,url.port))return deny('FETCH_DESTINATION');counts.fetch++;const code=stageCode(url,String(args[0]?.method??input?.method??'GET').toUpperCase()),started=performance.now();beginStage(code);try{const response=await originalFetch.call(this,input,...args);observeStage(code,started,response.ok?'HTTP_OK':'HTTP_REFUSED');return response;}catch(error){observeStage(code,started,'TRANSPORT_ERROR');throw error;}};
const originalConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const values=Array.isArray(args[0])?args[0]:args,first=values[0],options=first&&typeof first==='object'?first:{port:first,host:typeof values[1]==='string'?values[1]:undefined};
 if(options.path||!registered(options.host??options.hostname,options.port))return deny('SOCKET_DESTINATION');counts.connect++;diagnosticCheckpoint('CHANGED');return originalConnect.apply(this,args);};
const originalListen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){const values=Array.isArray(args[0])?args[0]:args,first=values[0],options=first&&typeof first==='object'?first:{port:first,host:typeof values[1]==='string'?values[1]:undefined};
 if(options.path||Number(options.port)!==0||!literal(options.host))return deny('LISTEN_SCOPE');counts.listen++;diagnosticCheckpoint('CHANGED');
 let ownedMarker;
 this.once('listening',()=>{const address=this.address();if(!address||typeof address==='string'||address.port<49152||address.port>65535)throw Error('BASELINE_NON_EPHEMERAL_PORT');
  const file=path.join(control.ports,'port-'+address.port+'.json'),value={schemaVersion:'wfc.preparer.baseline-port.v2',nonce:control.nonce,pid:process.pid,port:address.port,host:options.host,parentPid:process.ppid,grantId:parentGrant};fs.writeFileSync(file,JSON.stringify(value),{flag:'wx',mode:0o600});ports.set(file,value);ownedMarker={file,value};});
 this.once('close',()=>{if(ownedMarker){const{file,value}=ownedMarker;try{if(fs.readFileSync(file,'utf8')===JSON.stringify(value))fs.unlinkSync(file);}catch{}ports.delete(file);}});
 return originalListen.apply(this,args);};
// Node's listen path calls lookup even for numeric addresses. Native lookup of
// these literal loopback IPs performs no external name resolution.
const originalLookup=dns.lookup,originalPromiseLookup=dns.promises.lookup;
dns.lookup=function(host,...args){if(!literal(host))return deny('DNS_SCOPE');return originalLookup.call(this,host==='[::1]'?'::1':host,...args);};
dns.promises.lookup=async function(host,...args){if(!literal(host))return deny('DNS_SCOPE');return originalPromiseLookup.call(this,host==='[::1]'?'::1':host,...args);};
for(const name of ['resolve','resolve4','resolve6','resolveAny','resolveCaa','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse']){if(typeof dns[name]==='function')dns[name]=()=>deny('DNS_SCOPE');if(typeof dns.promises[name]==='function')dns.promises[name]=async()=>deny('DNS_SCOPE');}
dns.Resolver=function(){return deny('DNS_SCOPE');};dns.promises.Resolver=function(){return deny('DNS_SCOPE');};dgram.createSocket=()=>deny('UDP_SCOPE');
const safeEnv=()=>({...pinnedEnv});
function environment(input){const result=safeEnv();if(input!==undefined){if(!input||Object.getPrototypeOf(input)!==Object.prototype)return deny('CHILD_ENVIRONMENT');for(const[key,value]of Object.entries(input)){
  if(key==='NODE_TEST_CONTEXT'&&value==='child-v8'){result[key]=value;continue;}if(!Object.hasOwn(result,key)||typeof value!=='string'||value!==result[key])return deny('CHILD_ENVIRONMENT');}}
 return result;}
const nodeFlags=new Set(['--test','--test-concurrency=1','--test-reporter=tap','--test-timeout=120000','--test-isolation=process']);
function nodeArgs(args,cwd){if(!Array.isArray(args)||args.length>128||args.some(v=>typeof v!=='string')||args.reduce((n,v)=>n+Buffer.byteLength(v),0)>65536)return deny('CHILD_ARGUMENTS');
 let index=0;while(index<args.length&&args[index].startsWith('-')){if(!nodeFlags.has(args[index]))return deny('CHILD_ARGUMENTS');index++;}
 const file=args[index],resolved=typeof file==='string'?path.resolve(cwd,file):'';if(!file||!inside(control.work,resolved)||!file.endsWith('.mjs'))return deny('CHILD_ARGUMENTS');safe(resolved);
 // Test-runner invocations list module paths; ordinary fixture arguments remain data.
 const result=[...args];result[index]=resolved;if(args.includes('--test'))for(let n=index+1;n<result.length;n++){const testFile=path.resolve(cwd,result[n]);if(!result[n].endsWith('.mjs')||!inside(control.work,testFile))return deny('CHILD_ARGUMENTS');safe(testFile);result[n]=testFile;}return result;}
function options(value){if(value===undefined)value={};if(!value||Object.getPrototypeOf(value)!==Object.prototype||value.shell)return deny('CHILD_OPTIONS');const cwd=value.cwd===undefined?process.cwd():value.cwd;if(typeof cwd!=='string'||!inside(control.work,cwd))return deny('CHILD_OPTIONS');safe(path.resolve(cwd),true);return{...value,cwd:path.resolve(cwd),env:environment(value.env)};}
function prepared(command,args,method,cwd){if(samePath(command,process.execPath))return{command:process.execPath,args:nodeArgs(args,cwd),powershell:false};
 if(process.platform==='win32'&&method==='spawn'&&(command==='powershell.exe'||samePath(command,control.powershell))&&Array.isArray(args)&&args.length===4&&args[0]==='-NoProfile'&&args[1]==='-NonInteractive'&&args[2]==='-EncodedCommand'&&hash(args[3])===control.aclEncodedSha256){assertTrustedPowerShellPin();return{command:control.powershell,powershell:true};}
 return deny('CHILD_EXECUTABLE');}
function launchGrant(opts){const grantId=randomUUID();opts.env={...opts.env,PREPARER_BASELINE_PARENT_GRANT:grantId,PREPARER_BASELINE_PARENT_PID:String(process.pid)};return grantId;}
function edgeStart(pid,kind,grantId){counts.children++;diagnosticCheckpoint('CHANGED');const ordinal=++edgeOrdinal,base=path.join(control.edges,'edge-'+process.pid+'-'+ordinal),record={schemaVersion:'wfc.preparer.baseline-edge.v2',phase:control.phase,parentPid:process.pid,childPid:pid,ordinal,kind,grantId};fs.writeFileSync(base+'.start.json',JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});return{base,record};}
export function portGrantMatchesClose(value,edge,signal){return control.retireKilledChildPorts===true&&signal==='SIGKILL'&&edge?.kind==='node'&&edge.parentPid===process.pid&&portGrant(value)&&value.parentPid===edge.parentPid&&value.pid===edge.childPid&&value.grantId===edge.grantId;}
function retireChildPorts(edge,signal){const retired=[];if(signal!=='SIGKILL'||edge.record.kind!=='node')return retired;const names=fs.readdirSync(control.ports);if(names.length>256)throw Error('BASELINE_PORT_COUNT');for(const name of names){if(!/^port-[0-9]+\.json$/.test(name))throw Error('BASELINE_PORT_FILE');const file=path.join(control.ports,name);safe(file);const before=fs.statSync(file),bytes=fs.readFileSync(file);if(bytes.length>1024)throw Error('BASELINE_PORT_FILE');let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{throw Error('BASELINE_PORT_FILE');}if(!portGrantMatchesClose(value,edge.record,signal))continue;if(name!=='port-'+value.port+'.json')throw Error('BASELINE_PORT_FILE');safe(file);const after=fs.statSync(file);if(before.dev!==after.dev||before.ino!==after.ino||before.size!==bytes.length||after.size!==bytes.length||before.mtimeMs!==after.mtimeMs||!fs.readFileSync(file).equals(bytes))throw Error('BASELINE_PORT_CHANGED');fs.unlinkSync(file);retired.push({name,sha256:hash(bytes),grant:value});}return retired;}
function edgeClose(edge,code,signal){const retiredPorts=retireChildPorts(edge,signal);fs.writeFileSync(edge.base+'.close.json',JSON.stringify({...edge.record,code,signal,retiredPorts})+'\n',{flag:'wx',mode:0o600});}
function track(child,kind,grantId){if(child?.pid){const edge=edgeStart(child.pid,kind,grantId);children.set(child.pid,child);child.once('close',(code,signal)=>{children.delete(child.pid);closedChildren.push({pid:child.pid,code,signal});edgeClose(edge,code,signal);});}return child;}
function protectAclInput(child){if(!child.stdin)return deny('CHILD_ACL_INPUT');const originalEnd=child.stdin.end.bind(child.stdin),pieces=[];let bytes=0;
 child.stdin.write=function(value,encoding,callback){const part=Buffer.isBuffer(value)?value:Buffer.from(value,typeof encoding==='string'?encoding:undefined);bytes+=part.length;if(bytes>4096)return deny('CHILD_ACL_INPUT');pieces.push(part);if(typeof encoding==='function')encoding();else if(typeof callback==='function')callback();return true;};
 child.stdin.end=function(value,encoding,callback){if(value!==undefined&&value!==null)this.write(value,encoding);const input=Buffer.concat(pieces).toString('utf8');if(!path.isAbsolute(input)||!inside(path.join(control.work,'scratch'),input)||/[\0\r\n]/.test(input)){child.kill();return deny('CHILD_ACL_INPUT');}safe(input,true);return originalEnd(input,typeof encoding==='function'?encoding:callback);};
 return child;}
for(const name of ['spawn','spawnSync','execFile','execFileSync']){const original=cp[name];const wrapper=function(command,...rest){
  const args=Array.isArray(rest[0])?rest[0]:[],at=Array.isArray(rest[0])?1:0,opts=options(typeof rest[at]==='function'?undefined:rest[at]),selected=prepared(command,args,name,opts.cwd),grantId=launchGrant(opts);
  if(Array.isArray(rest[0]))rest[0]=selected.args??args;
  if(typeof rest[at]==='function'||rest[at]===undefined)rest.splice(at,0,opts);else rest[at]=opts;
  const result=original.call(this,selected.command,...rest);if(name.endsWith('Sync')){if(result?.pid){const edge=edgeStart(result.pid,'node',grantId);edgeClose(edge,result.status,result.signal);}return result;}
  track(result,selected.powershell?'acl':'node',grantId);return selected.powershell?protectAclInput(result):result;};
 if(name==='execFile')Object.defineProperty(wrapper,promisify.custom,{value:function(...args){let child;const promise=new Promise((resolve,reject)=>{child=wrapper.call(this,...args,(error,stdout,stderr)=>{if(error){error.stdout=stdout;error.stderr=stderr;reject(error);}else resolve({stdout,stderr});});});promise.child=child;return promise;}});
 cp[name]=wrapper;
}
const originalFork=cp.fork;cp.fork=function(modulePath,args=[],opts){if(!Array.isArray(args)){opts=args;args=[];}const selected=options(opts),checked=nodeArgs([modulePath,...args],selected.cwd);if(selected.execPath&&!samePath(selected.execPath,process.execPath))return deny('CHILD_FORK');if(selected.execArgv!==undefined&&(!Array.isArray(selected.execArgv)||selected.execArgv.some(arg=>!nodeFlags.has(arg))))return deny('CHILD_FORK');const grantId=launchGrant(selected);return track(originalFork.call(this,checked[0],args,{...selected,execPath:process.execPath,execArgv:selected.execArgv??[]}), 'node',grantId);};
cp.exec=()=>deny('CHILD_SHELL');cp.execSync=()=>deny('CHILD_SHELL');syncBuiltinESMExports();
diagnosticCheckpoint('PRELOAD_READY',true);
process.once('exit',exitCode=>{for(const[file,value]of ports){try{if(fs.readFileSync(file,'utf8')===JSON.stringify(value))fs.unlinkSync(file);}catch{}}
 diagnosticCheckpoint('EXIT_OBSERVED',true);
 try{fs.writeFileSync(path.join(control.evidence,'guard-'+process.pid+'.json'),JSON.stringify({schemaVersion:'wfc.preparer.baseline-isolation.v3',phase:control.phase,pid:process.pid,entrypoint,exitCode,counts,denials,denialsDropped,stages:[...stages.values()],activeChildren:[...children.keys()],closedChildren})+'\n',{flag:'wx',mode:0o600});}catch{process.exitCode=process.exitCode||91;}});
