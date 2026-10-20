/** External sampling for the container-only full-network runner. */
import fs from 'node:fs/promises';
import {measureProcess,publicMeasurement} from './process.mjs';
const mode=process.argv[2],reverse=process.argv[3];
if(!['union','publisher','cancel'].includes(mode)||reverse!==undefined&&reverse!=='reverse')throw Error('QUALIFICATION_SUPERVISOR_CONFIGURATION');
const measured=await measureProcess('node',['--max-old-space-size=1536','/qualification/qualify-runner.mjs','--mode='+mode,'--manifest=/inputs/manifest.json',...(reverse?['--reverse']:[])],{
  env:{PF_ROOT:'/work',PF_ENGINE_DLL:'/opt/pathfinder/PathFinder.ModelRunner.dll',PF_ENGINE_MODE:'oneshot'},
  timeoutMilliseconds:135000,maximumOutputBytes:65536,intervalMilliseconds:20,
});
let result;try{result=JSON.parse(measured.output);}catch{result={status:'FAIL',code:'QUALIFICATION_CHILD_RESULT_UNAVAILABLE'};}
const cgroup={};for(const [key,file]of Object.entries({memoryPeak:'/sys/fs/cgroup/memory.peak',memoryMax:'/sys/fs/cgroup/memory.max',memoryEvents:'/sys/fs/cgroup/memory.events',cpuMax:'/sys/fs/cgroup/cpu.max',pidsMax:'/sys/fs/cgroup/pids.max'})){
  try{cgroup[key]=(await fs.readFile(file,'utf8')).trim();}catch{cgroup[key]='NOT_MEASURED';}
}
const output={schemaVersion:'wfc.pf.full-network-supervision.v1',status:measured.status==='PASS'&&result.status==='PASS'?'PASS':'FAIL',measurement:publicMeasurement(measured),cgroup,result};
await fs.writeFile('/work/supervision.json',JSON.stringify(output),{flag:'wx',mode:0o600});
process.stdout.write(JSON.stringify(output)+'\n');process.exitCode=output.status==='PASS'?0:1;
