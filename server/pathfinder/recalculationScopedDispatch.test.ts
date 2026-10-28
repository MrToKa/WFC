// @vitest-environment node
import type {PoolClient} from 'pg';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const seams=vi.hoisted(()=>({scoped:vi.fn(),grant:vi.fn()}));
vi.mock('./locationImpactRepository.js',()=>({readLocationImpactJobAuthority:seams.scoped}));
vi.mock('./grantJobAuthority.js',()=>({readGrantJobAuthority:seams.grant}));
import {readRecalculationJobAuthority,requireEnrollmentAuthority} from './recalculationRepository.js';
beforeEach(()=>vi.clearAllMocks());
describe('scoped authority dispatch before legacy/global/grant authority',()=>{
  it.each([true,false])('never falls back after a known scoped result valid=%s',async valid=>{
    const result={enrolled:true as const,valid,code:valid?'LOCATION_IMPACT_AUTHORITY_CURRENT':'LOCATION_IMPACT_TARGET_SUPERSEDED',generation:'7',authorityEpoch:'2',scope:'location-impact'};
    seams.scoped.mockResolvedValue(result);const query=vi.fn(),client={query} as unknown as PoolClient,input={projectId:'project',jobId:'job',cableId:'cable',lock:true};
    expect(await readRecalculationJobAuthority(client,input)).toBe(result);expect(seams.scoped).toHaveBeenCalledExactlyOnceWith(client,input);expect(seams.grant).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
    if(valid)await expect(requireEnrollmentAuthority(client,input)).resolves.toBeUndefined();else await expect(requireEnrollmentAuthority(client,input)).rejects.toMatchObject({code:result.code});
  });
  it('keeps existing grant behavior only when no scoped enrollment exists',async()=>{
    seams.scoped.mockResolvedValue(null);const grant={enrolled:true,valid:true,code:'GRANT_CURRENT',generation:'1',authorityEpoch:'1'};seams.grant.mockResolvedValue(grant);
    const client={query:vi.fn()} as unknown as PoolClient;expect(await readRecalculationJobAuthority(client,{projectId:'project',jobId:'job'})).toBe(grant);
    expect(seams.grant).toHaveBeenCalledOnce();
  });
  it('does not turn failed scoped evidence reads into legacy authorization',async()=>{
    seams.scoped.mockRejectedValue(Error('scoped integrity failure'));const client={query:vi.fn()} as unknown as PoolClient;
    await expect(readRecalculationJobAuthority(client,{projectId:'project',jobId:'job'})).rejects.toThrow('scoped integrity failure');expect(seams.grant).not.toHaveBeenCalled();
  });
});
