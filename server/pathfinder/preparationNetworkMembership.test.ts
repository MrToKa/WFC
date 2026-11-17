// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
const mocks = vi.hoisted(() => ({routing: vi.fn()}));
vi.mock('./routingScope.js', () => ({requirePreparedRoutingScope: mocks.routing}));
import { readPreparationNetworkTrayIds } from './preparationPlans.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace } from './geometryTraceBuilder.js';
import { PathFinderError } from './errors.js';
import { encodeCadOverlay } from './cadOverlay.js';
const id = (n:number) => 'd1000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixture() {
  const input = geometryTraceFixture(), trace = buildGeometryTrace(input).manifest;
  const query = vi.fn(async (sql:string) => {
    if (sql.startsWith('/* preparation-network-trace */')) return {rows:[{id:trace.id,manifest:trace}]};
    if (sql.startsWith('/* preparation-network-members */')) return {rows:[{project_tray_id:id(10)}]};
    if (sql.startsWith('/* preparation-network-cad-members */')) return {rows:[{project_tray_id:id(11)}]};
    throw Error('Unexpected SQL');
  });
  return {input,trace,query,read:()=>readPreparationNetworkTrayIds({query} as unknown as PoolClient,input.aggregate.projectId,input.aggregate,input.aggregate,false)};
}
beforeEach(()=>{vi.clearAllMocks();mocks.routing.mockResolvedValue({});});
describe('actual usable preparation network membership',()=>{
  it('includes fitted trace ownership and excludes assigned trays without fitted geometry',async()=>{
    const f=fixture();expect([...await f.read()]).toEqual([id(10)]);
    expect(mocks.routing).toHaveBeenCalledWith(expect.anything(),f.input.aggregate.projectId,f.input.aggregate.artifactId,{lock:false});
    expect(f.query.mock.calls[1][0]).toContain("record->'geometry'->>'role'='routing-leaf'");
    expect(f.query.mock.calls[1][0]).toContain("record->'geometry'->'fitted'<>'null'::jsonb");
  });
  it('adds only exact groups admitted by the validated CAD overlay',async()=>{
    const f=fixture();mocks.routing.mockResolvedValue({cadOverlay:encodeCadOverlay({schemaVersion:'wfc.pf.cad-overlay-payload.v3',projectId:f.input.aggregate.projectId,modelVersionId:f.input.aggregate.modelVersionId,baseSnapshotSha256:f.input.aggregate.projection.sha256,segments:[{id:'cad:'+id(70),name:'/BC901',allowedCategoryMask:7,pointsMetres:[[0,0,0],[1,0,0]],ports:[{pointMetres:[0,0,0],outward:[-1,0,0],u:[0,1,0],v:[0,0,1],widthMetres:.3,heightMetres:.06}]}]})});
    expect([...await f.read()]).toEqual([id(10),id(11)]);
  });
  it.each(['ROUTING_PREPARATION_REQUIRED','CAD_ROUTE_BASE_CHANGED','CAD_ROUTE_CATALOG_CHANGED'])('clears membership for %s',async code=>{
    const f=fixture();mocks.routing.mockRejectedValue(new PathFinderError(code,409));expect([...await f.read()]).toEqual([]);expect(f.query).not.toHaveBeenCalled();
  });
  it('does not hide database failures',async()=>{
    const f=fixture();mocks.routing.mockRejectedValue(Error('database unavailable'));await expect(f.read()).rejects.toThrow('database unavailable');
  });
  it('refuses a mismatched trace instead of using its tray ids',async()=>{
    const f=fixture();f.trace.captureFrameId=id(99);expect([...await f.read()]).toEqual([]);expect(f.query).toHaveBeenCalledTimes(1);
  });
  it('requires a current model and saved assignment revision',async()=>{
    const f=fixture();expect([...await readPreparationNetworkTrayIds({query:f.query} as unknown as PoolClient,f.input.aggregate.projectId,{...f.input.aggregate,resolutionRevision:'99'},f.input.aggregate,false)]).toEqual([]);expect(mocks.routing).not.toHaveBeenCalled();
  });
});
