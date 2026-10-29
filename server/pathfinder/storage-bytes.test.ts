// @vitest-environment node
import path from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({files:new Map<string,Buffer>(),dirs:new Set<string>(),syncs:[] as string[],failSync:false}));
vi.mock('node:fs/promises',()=>({default:{
  mkdir:async(p:string)=>{const fresh=!state.dirs.has(p);state.dirs.add(p);return fresh?p:undefined;},
  realpath:async(p:string)=>p,
  lstat:async(p:string)=>({isFile:()=>state.files.has(p),isSymbolicLink:()=>false,nlink:1,size:state.files.get(p)?.length??0}),
  open:async(p:string,mode:string)=>{if(mode==='wx'&&state.files.has(p))throw Object.assign(Error('exists'),{code:'EEXIST'});return{writeFile:async(bytes:Buffer)=>{state.files.set(p,Buffer.from(bytes));},sync:async()=>{state.syncs.push(p);if(state.failSync&&mode==='wx')throw Error('uncertain fsync');},close:async()=>{}};},
  link:async(source:string,target:string)=>{if(state.files.has(target))throw Object.assign(Error('exists'),{code:'EEXIST'});state.files.set(target,Buffer.from(state.files.get(source)!));},
  unlink:async(p:string)=>{state.files.delete(p);},readFile:async(p:string)=>Buffer.from(state.files.get(p)!),
}}));
import {storeSnapshot,storeSnapshotBytes,readSnapshot} from './storage.js';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
beforeEach(()=>{state.files.clear();state.dirs.clear();state.syncs=[];state.failSync=false;vi.stubEnv('PF_ROOT',path.resolve('owned-snapshot-byte-fixture'));});
afterEach(()=>vi.unstubAllEnvs());
describe('exact immutable prepared snapshot cache bytes',()=>{
  it('preserves exact bytes and freezes the caller buffer before awaiting filesystem work',async()=>{
    const source=Buffer.from('{"a":1.000,"z":"\\u0041"}\n'),expected=Buffer.from(source),pending=storeSnapshotBytes(id(1),source);source.fill(0);
    const receipt=await pending;expect(receipt).toEqual({sha256:createHash('sha256').update(expected).digest('hex'),bytes:expected.length});
    expect(await readSnapshot(id(1),receipt.sha256)).toEqual(expected);
    expect(state.syncs).toContain(path.join(path.resolve('owned-snapshot-byte-fixture'),'snapshots'));
    expect([...state.files.keys()].every(name=>!name.endsWith('.tmp'))).toBe(true);
  });
  it('uses the same independent-file publication and hashes as the existing object writer',async()=>{
    const value={a:[-0,1e-7,'é'],z:true},object=await storeSnapshot(id(1),value),bytes=await storeSnapshotBytes(id(2),Buffer.from(JSON.stringify(value)));
    expect(bytes).toEqual(object);expect(await readSnapshot(id(1),object.sha256)).toEqual(await readSnapshot(id(2),bytes.sha256));
    expect(state.files.size).toBe(2);
  });
  it('refuses a duplicate UUID without replacing existing immutable cache content',async()=>{
    const receipt=await storeSnapshotBytes(id(1),Buffer.from('{"a":1}'));
    await expect(storeSnapshotBytes(id(1),Buffer.from('{"a":2}'))).rejects.toMatchObject({code:'EEXIST'});
    expect((await readSnapshot(id(1),receipt.sha256)).toString()).toBe('{"a":1}');
  });
  it('does not acknowledge uncertain file durability and retains recoverable temporary bytes',async()=>{
    state.failSync=true;await expect(storeSnapshotBytes(id(1),Buffer.from('{}'))).rejects.toThrow('uncertain fsync');
    expect([...state.files.keys()].some(name=>name.endsWith('.tmp'))).toBe(true);
    expect([...state.files.keys()].some(name=>name.endsWith(id(1)+'.json'))).toBe(false);
  });
  it('checks type, empty input, size and UUID before writing a cache file',async()=>{
    const oversized=Buffer.from('{}');Object.defineProperty(oversized,'length',{value:256*1024**2+1});
    for(const value of [null,Buffer.alloc(0),oversized])await expect(storeSnapshotBytes(id(1),value as Buffer)).rejects.toMatchObject({code:'SNAPSHOT_BUDGET'});
    await expect(storeSnapshotBytes('../foreign',Buffer.from('{}'))).rejects.toBeDefined();expect(state.files.size).toBe(0);
  });
});
