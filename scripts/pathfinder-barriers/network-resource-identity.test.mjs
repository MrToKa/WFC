import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNetworkResource, sortCanonicalRecords} from './network-resource-identity.mjs';

function network() { return {Name:'owned_front',Id:'f'.repeat(64),Created:'2026-10-18T15:55:45.94435491Z',Scope:'local',Driver:'bridge',EnableIPv4:true,EnableIPv6:false,
  IPAM:{Driver:'default',Options:null,Config:[{Subnet:'172.30.0.0/16',Gateway:'172.30.0.1'}]},Internal:false,Attachable:false,Ingress:false,
  ConfigFrom:{Network:''},ConfigOnly:false,Options:{'com.docker.network.enable_ipv4':'true','com.docker.network.enable_ipv6':'false'},
  Labels:{'wfc.pathfinder.owner':'owner','wfc.pathfinder.project':'owned','wfc.pathfinder.isolated':'true'},
  Status:{IPAM:{Subnets:{'172.30.0.0/16':{IPsInUse:4,DynamicIPsAvailable:65532}}}}}; }
const copy = value => structuredClone(value);
test('exact observed own endpoint stop changes only allocation observation', () => {
  const before = network(), retained = copy(before), stopped = copy(before);
  stopped.Status.IPAM.Subnets['172.30.0.0/16'] = {IPsInUse:3,DynamicIPsAvailable:65533};
  const a = projectNetworkResource(before), b = projectNetworkResource(stopped);
  assert.deepEqual(a.identity,b.identity); assert.notDeepEqual(a.allocation,b.allocation); assert.deepEqual(before,retained);
  assert.deepEqual(a.identity.Status,{IPAM:{Subnets:{'172.30.0.0/16':{}}}});
  assert.deepEqual(a.allocation.status,before.Status);
});
test('multiple configured subnets bind exactly and preserve their identity structure', () => {
  const value = network(); value.IPAM.Config.push({Subnet:'172.31.0.0/16',Gateway:'172.31.0.1'});
  value.Status.IPAM.Subnets['172.31.0.0/16']={IPsInUse:2,DynamicIPsAvailable:65534};
  const projected = projectNetworkResource(value);
  assert.deepEqual(Object.keys(projected.identity.Status.IPAM.Subnets).sort(),['172.30.0.0/16','172.31.0.0/16']);
});
for (const [name, mutate] of [
  ['missing status',n=>delete n.Status],['unknown status',n=>n.Status.extra=true],['unknown IPAM status',n=>n.Status.IPAM.extra=true],
  ['unknown subnet field',n=>n.Status.IPAM.Subnets['172.30.0.0/16'].extra=true],['missing usage field',n=>delete n.Status.IPAM.Subnets['172.30.0.0/16'].IPsInUse],
  ['unconfigured subnet',n=>n.Status.IPAM.Subnets['172.31.0.0/16']={IPsInUse:0,DynamicIPsAvailable:65536}],
  ['missing configured subnet',n=>n.IPAM.Config.push({Subnet:'172.31.0.0/16',Gateway:'172.31.0.1'})],
  ['duplicate configured subnet',n=>n.IPAM.Config.push(copy(n.IPAM.Config[0]))],['unknown status shape',n=>n.Status.IPAM.Subnets=[]],
]) test('rejects '+name,()=>{const value=network();mutate(value);assert.throws(()=>projectNetworkResource(value),/B9_NETWORK_RESOURCE_STATUS_INVALID/);});
for (const value of [-1,0.5,'4',null,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])
  test('rejects nonbounded integer usage '+String(value),()=>{const n=network();n.Status.IPAM.Subnets['172.30.0.0/16'].IPsInUse=value;assert.throws(()=>projectNetworkResource(n));});
test('rejects a safe-integer pair whose sum is unsafe',()=>{const n=network();n.Status.IPAM.Subnets['172.30.0.0/16']={IPsInUse:Number.MAX_SAFE_INTEGER,DynamicIPsAvailable:1};assert.throws(()=>projectNetworkResource(n));});
for (const [name, mutate] of [
  ['ID',n=>n.Id='e'.repeat(64)],['name',n=>n.Name='other'],['creation',n=>n.Created='2026-10-19T00:00:00Z'],['driver',n=>n.Driver='overlay'],
  ['scope',n=>n.Scope='swarm'],['subnet',n=>{n.IPAM.Config[0].Subnet='172.31.0.0/16';n.Status.IPAM.Subnets={'172.31.0.0/16':{IPsInUse:4,DynamicIPsAvailable:65532}};}],
  ['gateway',n=>n.IPAM.Config[0].Gateway='172.30.0.2'],['IPAM options',n=>n.IPAM.Options={arbitrary:'true'}],['network options',n=>n.Options.extra='true'],
  ['ownership',n=>n.Labels['wfc.pathfinder.owner']='foreign'],['project',n=>n.Labels['wfc.pathfinder.project']='foreign'],['isolation',n=>n.Labels['wfc.pathfinder.isolated']='false'],
  ['internal',n=>n.Internal=true],['attachable',n=>n.Attachable=true],['ingress',n=>n.Ingress=true],['IPv6',n=>n.EnableIPv6=true],
  ['config source',n=>n.ConfigFrom.Network='foreign'],['config-only',n=>n.ConfigOnly=true],['future identity field',n=>n.NewField='retained'],
]) test('retains '+name+' differences in equality projection',()=>{const a=network(),b=copy(a);mutate(b);assert.notDeepEqual(projectNetworkResource(a).identity,projectNetworkResource(b).identity);});
test('canonical record sorting ignores JSON property insertion order and preserves every value',()=>{
  const a=[{Name:'b',Labels:{owner:'1',project:'2'}},{Name:'a',Labels:{owner:'1',project:'2'}}];
  const b=[{Labels:{project:'2',owner:'1'},Name:'a'},{Labels:{project:'2',owner:'1'},Name:'b'}];
  assert.deepEqual(sortCanonicalRecords(a),sortCanonicalRecords(b));assert.notEqual(sortCanonicalRecords(a),a);
  const changed=copy(b);changed[0].Labels.owner='foreign';assert.notDeepEqual(sortCanonicalRecords(a),sortCanonicalRecords(changed));
});
