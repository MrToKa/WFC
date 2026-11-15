// @vitest-environment node
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {saveTrayMatches,type PreparationTrayMatchesWrite} from './pathfinderPreparation';
import {preparationFixture,preparationIds as ids} from '../test/preparationFixtures';
import {canonicalPurposeJson} from '../../shared/pathfinderPurposePolicy';
const hash=(value:unknown)=>createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const command=():PreparationTrayMatchesWrite=>({schemaVersion:'wfc.pf.preparation-tray-matches.write.v1',expected:preparationFixture().context.scope,
  idempotencyKey:ids.actor,matchingPolicyVersion:'wfc.pf.project-exact-candidates.v3',complete:true,matches:[{projectTrayId:ids.tray,rootObjectIds:['dbid:1']}]});
function receipt(input:PreparationTrayMatchesWrite){return{schemaVersion:'wfc.pf.preparation-tray-matches-receipt.v1',idempotencyKey:input.idempotencyKey,commandSha256:hash(input),
  resolutionRevision:'1',results:[{projectTrayId:ids.tray,status:'assigned',rootObjectIds:['dbid:1']}],counts:{assigned:1,kept:0,missing:0,ambiguous:0},duplicate:false};}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('independent persisted tray discovery transport',()=>{
  it('posts one bounded batch to the exact assignment path and verifies its command identity',async()=>{
    const input=command(),result=receipt(input),fetch=vi.fn().mockResolvedValue(Response.json(result));vi.stubGlobal('fetch',fetch);
    await expect(saveTrayMatches(ids.project,'login',input)).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0][0]).toMatch(new RegExp(`/api/projects/${ids.project}/pathfinder/preparations/tray-matches$`));
    expect(fetch.mock.calls[0][1]).toMatchObject({method:'POST',body:JSON.stringify(input)});
  });
  it.each(['key','hash','tray','roots','counts'] as const)('rejects a response with mismatched %s before publishing assignment success',async field=>{
    const input=command(),result=receipt(input);if(field==='key')result.idempotencyKey=ids.model;if(field==='hash')result.commandSha256='f'.repeat(64);
    if(field==='tray')result.results[0].projectTrayId=ids.model;if(field==='roots')result.results[0].rootObjectIds=['dbid:99'];if(field==='counts')result.counts.assigned=0;
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(result)));await expect(saveTrayMatches(ids.project,'login',input)).rejects.toThrow();
  });
  it('refuses an incomplete batch without making any request',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await expect(saveTrayMatches(ids.project,'login',{...command(),complete:false} as never)).rejects.toMatchObject({outcome:'refused'});
    expect(fetch).not.toHaveBeenCalled();
  });
});
