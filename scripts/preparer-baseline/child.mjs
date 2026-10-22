// Actual owned child fixtures. Listener mode uses only a registered loopback port.
import http from 'node:http';
import {isolationDiagnostics} from './isolation.mjs';
if(process.argv[2]==='guard-state'){process.stdout.write(process.env.NODE_OPTIONS?.includes('--import ')&&process.env.PREPARER_BASELINE_CONTROL&&/^[a-f0-9]{64}$/.test(process.env.PREPARER_BASELINE_CONTROL_SHA256??'')?'guard-active':'guard-missing');}
else if(process.argv[2]==='denial-cap'){for(let n=0;n<40;n++)try{await fetch('https://private-user:private-password@example.invalid/private-path?private-query=1');}catch{}process.stdout.write(JSON.stringify(isolationDiagnostics()));}
else if(process.argv[2]==='listen'){const server=http.createServer((_req,res)=>res.end('owned-child'));server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({port:server.address().port})+'\n'));setTimeout(()=>{process.exitCode=93;server.close();},10000).unref();}
else if(process.argv[2]==='diagnostic-hang'){
 const server=http.createServer(()=>{});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const pending=fetch('http://127.0.0.1:'+server.address().port+'/api/generations');
 process.stdout.write('diagnostic-pending\n');await pending;
}
else if(process.argv[2]==='fail'){process.stdout.write('fixture-out');process.stderr.write('fixture-error');process.exitCode=7;}
else{process.stdout.write('fixture-out');process.stderr.write('fixture-error');}
