// Test-only preload. It is never imported by the application or deployment.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';
import dgram from 'node:dgram';
import cp from 'node:child_process';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {syncBuiltinESMExports} from 'node:module';

const hash=v=>createHash('sha256').update(v).digest('hex');
const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
const inside=(root,file)=>{const rel=path.relative(root,path.resolve(file));return rel===''||!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
function safe(file,directory=false){for(let at=path.resolve(file);;at=path.dirname(at)){const s=fs.lstatSync(at);if(s.isSymbolicLink()||(samePath(at,file)&&!directory?!s.isFile()||s.nlink!==1:!s.isDirectory()))throw Error('BASELINE_CONTROL_PATH');if(path.dirname(at)===at)break;}
 if(!samePath(fs.realpathSync(file),file))throw Error('BASELINE_CONTROL_PATH');}
const pinnedEnv=Object.freeze(Object.fromEntries(['SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','PATH','NUMBER_OF_PROCESSORS','TEMP','TMP','TMPDIR','HOME','USERPROFILE','NODE_OPTIONS','PREPARER_BASELINE_CONTROL','PREPARER_BASELINE_CONTROL_SHA256','NODE_TEST_CONTEXT'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]])));
const controlFile=pinnedEnv.PREPARER_BASELINE_CONTROL;safe(controlFile);
const raw=fs.readFileSync(controlFile);if(raw.length>65536||hash(raw)!==pinnedEnv.PREPARER_BASELINE_CONTROL_SHA256)throw Error('BASELINE_CONTROL_HASH');
const control=Object.freeze(JSON.parse(raw));if(control.schemaVersion!=='wfc.preparer.baseline-control.v1'||!path.isAbsolute(control.work)||!inside(control.work,controlFile)||!inside(control.work,control.evidence)||!inside(control.work,control.ports)||!inside(control.work,control.edges)||!['guard','package','preparer'].includes(control.phase))throw Error('BASELINE_CONTROL_SCHEMA');
safe(control.work,true);safe(control.evidence,true);safe(control.ports,true);safe(control.edges,true);
const entrypoint=typeof process.argv[1]==='string'?path.resolve(process.argv[1]):null;
const counts={fetch:0,connect:0,listen:0,children:0,denied:0},children=new Map(),closedChildren=[],ports=new Map();let edgeOrdinal=0;
export const isolationCounters=()=>Object.freeze({...counts});
const deny=()=>{counts.denied++;throw Object.assign(Error('BASELINE_EXTERNAL_OPERATION_REFUSED'),{code:'BASELINE_EXTERNAL_OPERATION_REFUSED'});};
const literal=host=>['127.0.0.1','::1','[::1]'].includes(host);
function registered(host,port){if(!literal(host)||!Number.isInteger(Number(port))||Number(port)<49152||Number(port)>65535)return false;
 try{const file=path.join(control.ports,'port-'+port+'.json');safe(file);const value=JSON.parse(fs.readFileSync(file,'utf8'));return value.nonce===control.nonce&&value.port===Number(port)&&literal(value.host)&&Number.isInteger(value.pid)&&value.pid>0;}catch{return false;}}
const originalFetch=globalThis.fetch;
globalThis.fetch=async function(input,...args){const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.protocol!=='http:'||url.username||url.password||!registered(url.hostname,url.port))return deny();counts.fetch++;return originalFetch.call(this,input,...args);};
const originalConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const values=Array.isArray(args[0])?args[0]:args,first=values[0],options=first&&typeof first==='object'?first:{port:first,host:typeof values[1]==='string'?values[1]:undefined};
 if(options.path||!registered(options.host??options.hostname,options.port))return deny();counts.connect++;return originalConnect.apply(this,args);};
const originalListen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){const values=Array.isArray(args[0])?args[0]:args,first=values[0],options=first&&typeof first==='object'?first:{port:first,host:typeof values[1]==='string'?values[1]:undefined};
 if(options.path||Number(options.port)!==0||!literal(options.host))return deny();counts.listen++;
 let ownedMarker;
 this.once('listening',()=>{const address=this.address();if(!address||typeof address==='string'||address.port<49152||address.port>65535)throw Error('BASELINE_NON_EPHEMERAL_PORT');
  const file=path.join(control.ports,'port-'+address.port+'.json'),value={nonce:control.nonce,pid:process.pid,port:address.port,host:options.host};fs.writeFileSync(file,JSON.stringify(value),{flag:'wx',mode:0o600});ports.set(file,value);ownedMarker={file,value};});
 this.once('close',()=>{if(ownedMarker){const{file,value}=ownedMarker;try{if(fs.readFileSync(file,'utf8')===JSON.stringify(value))fs.unlinkSync(file);}catch{}ports.delete(file);}});
 return originalListen.apply(this,args);};
// Node's listen path calls lookup even for numeric addresses. Native lookup of
// these literal loopback IPs performs no external name resolution.
const originalLookup=dns.lookup,originalPromiseLookup=dns.promises.lookup;
dns.lookup=function(host,...args){if(!literal(host))return deny();return originalLookup.call(this,host==='[::1]'?'::1':host,...args);};
dns.promises.lookup=async function(host,...args){if(!literal(host))return deny();return originalPromiseLookup.call(this,host==='[::1]'?'::1':host,...args);};
for(const name of ['resolve','resolve4','resolve6','resolveAny','resolveCaa','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse']){if(typeof dns[name]==='function')dns[name]=deny;if(typeof dns.promises[name]==='function')dns.promises[name]=async()=>deny();}
dns.Resolver=deny;dns.promises.Resolver=deny;dgram.createSocket=deny;
const safeEnv=()=>({...pinnedEnv});
function environment(input){const result=safeEnv();if(input!==undefined){if(!input||Object.getPrototypeOf(input)!==Object.prototype)return deny();for(const[key,value]of Object.entries(input)){
  if(key==='NODE_TEST_CONTEXT'&&value==='child-v8'){result[key]=value;continue;}if(!Object.hasOwn(result,key)||typeof value!=='string'||value!==result[key])return deny();}}
 return result;}
const nodeFlags=new Set(['--test','--test-concurrency=1','--test-reporter=tap','--test-timeout=120000','--test-isolation=process']);
function nodeArgs(args,cwd){if(!Array.isArray(args)||args.length>128||args.some(v=>typeof v!=='string')||args.reduce((n,v)=>n+Buffer.byteLength(v),0)>65536)return deny();
 let index=0;while(index<args.length&&args[index].startsWith('-')){if(!nodeFlags.has(args[index]))return deny();index++;}
 const file=args[index],resolved=typeof file==='string'?path.resolve(cwd,file):'';if(!file||!inside(control.work,resolved)||!file.endsWith('.mjs'))return deny();safe(resolved);
 // Test-runner invocations list module paths; ordinary fixture arguments remain data.
 const result=[...args];result[index]=resolved;if(args.includes('--test'))for(let n=index+1;n<result.length;n++){const testFile=path.resolve(cwd,result[n]);if(!result[n].endsWith('.mjs')||!inside(control.work,testFile))return deny();safe(testFile);result[n]=testFile;}return result;}
function options(value){if(value===undefined)value={};if(!value||Object.getPrototypeOf(value)!==Object.prototype||value.shell)return deny();const cwd=value.cwd===undefined?process.cwd():value.cwd;if(typeof cwd!=='string'||!inside(control.work,cwd))return deny();safe(path.resolve(cwd),true);return{...value,cwd:path.resolve(cwd),env:environment(value.env)};}
function prepared(command,args,method,cwd){if(samePath(command,process.execPath))return{command:process.execPath,args:nodeArgs(args,cwd),powershell:false};
 if(process.platform==='win32'&&method==='spawn'&&(command==='powershell.exe'||samePath(command,control.powershell))&&Array.isArray(args)&&args.length===4&&args[0]==='-NoProfile'&&args[1]==='-NonInteractive'&&args[2]==='-EncodedCommand'&&hash(args[3])===control.aclEncodedSha256){safe(control.powershell);return{command:control.powershell,powershell:true};}
 return deny();}
function edgeStart(pid,kind){counts.children++;const ordinal=++edgeOrdinal,base=path.join(control.edges,'edge-'+process.pid+'-'+ordinal),record={schemaVersion:'wfc.preparer.baseline-edge.v1',phase:control.phase,parentPid:process.pid,childPid:pid,ordinal,kind};fs.writeFileSync(base+'.start.json',JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});return{base,record};}
function edgeClose(edge,code,signal){fs.writeFileSync(edge.base+'.close.json',JSON.stringify({...edge.record,code,signal})+'\n',{flag:'wx',mode:0o600});}
function track(child,kind){if(child?.pid){const edge=edgeStart(child.pid,kind);children.set(child.pid,child);child.once('close',(code,signal)=>{children.delete(child.pid);closedChildren.push({pid:child.pid,code,signal});edgeClose(edge,code,signal);});}return child;}
function protectAclInput(child){if(!child.stdin)return deny();const originalEnd=child.stdin.end.bind(child.stdin),pieces=[];let bytes=0;
 child.stdin.write=function(value,encoding,callback){const part=Buffer.isBuffer(value)?value:Buffer.from(value,typeof encoding==='string'?encoding:undefined);bytes+=part.length;if(bytes>4096)return deny();pieces.push(part);if(typeof encoding==='function')encoding();else if(typeof callback==='function')callback();return true;};
 child.stdin.end=function(value,encoding,callback){if(value!==undefined&&value!==null)this.write(value,encoding);const input=Buffer.concat(pieces).toString('utf8');if(!path.isAbsolute(input)||!inside(path.join(control.work,'scratch'),input)||/[\0\r\n]/.test(input)){child.kill();return deny();}safe(input,true);return originalEnd(input,typeof encoding==='function'?encoding:callback);};
 return child;}
for(const name of ['spawn','spawnSync','execFile','execFileSync']){const original=cp[name];const wrapper=function(command,...rest){
  const args=Array.isArray(rest[0])?rest[0]:[],at=Array.isArray(rest[0])?1:0,opts=options(typeof rest[at]==='function'?undefined:rest[at]),selected=prepared(command,args,name,opts.cwd);
  if(Array.isArray(rest[0]))rest[0]=selected.args??args;
  if(typeof rest[at]==='function'||rest[at]===undefined)rest.splice(at,0,opts);else rest[at]=opts;
  const result=original.call(this,selected.command,...rest);if(name.endsWith('Sync')){if(result?.pid){const edge=edgeStart(result.pid,'node');edgeClose(edge,result.status,result.signal);}return result;}
  track(result,selected.powershell?'acl':'node');return selected.powershell?protectAclInput(result):result;};
 if(name==='execFile')Object.defineProperty(wrapper,promisify.custom,{value:function(...args){let child;const promise=new Promise((resolve,reject)=>{child=wrapper.call(this,...args,(error,stdout,stderr)=>{if(error){error.stdout=stdout;error.stderr=stderr;reject(error);}else resolve({stdout,stderr});});});promise.child=child;return promise;}});
 cp[name]=wrapper;
}
const originalFork=cp.fork;cp.fork=function(modulePath,args=[],opts){if(!Array.isArray(args)){opts=args;args=[];}const selected=options(opts),checked=nodeArgs([modulePath,...args],selected.cwd);if(selected.execPath&&!samePath(selected.execPath,process.execPath))return deny();if(selected.execArgv!==undefined&&(!Array.isArray(selected.execArgv)||selected.execArgv.some(arg=>!nodeFlags.has(arg))))return deny();return track(originalFork.call(this,checked[0],args,{...selected,execPath:process.execPath,execArgv:selected.execArgv??[]}), 'node');};
cp.exec=deny;cp.execSync=deny;syncBuiltinESMExports();
process.once('exit',exitCode=>{for(const[file,value]of ports){try{if(fs.readFileSync(file,'utf8')===JSON.stringify(value))fs.unlinkSync(file);}catch{}}
 try{fs.writeFileSync(path.join(control.evidence,'guard-'+process.pid+'.json'),JSON.stringify({schemaVersion:'wfc.preparer.baseline-isolation.v2',phase:control.phase,pid:process.pid,entrypoint,exitCode,counts,activeChildren:[...children.keys()],closedChildren})+'\n',{flag:'wx',mode:0o600});}catch{process.exitCode=process.exitCode||91;}});
