// @vitest-environment node
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { PoolClient } from 'pg';
const seams=vi.hoisted(()=>({authority:vi.fn()}));
vi.mock('./recalculationRepository.js',()=>({readRecalculationJobAuthority:seams.authority,requireEnrollmentAuthority:vi.fn()}));
import { retireSupersededCableItem } from './worker.js';
const job={project_id:'project',id:'job',owner_token:'owned-lease'},cable='cable';
beforeEach(()=>vi.clearAllMocks());
describe('versioned worker partial-overlap retirement (mocked SQL/authority)',()=>{
  it.each([{enrolled:false},{enrolled:true,valid:true}])('does not change legacy or current work %j',async authority=>{
    seams.authority.mockResolvedValue(authority);const query=vi.fn();
    expect(await retireSupersededCableItem({query} as unknown as PoolClient,job,cable)).toBe(false);expect(query).not.toHaveBeenCalled();
  });
  it('retires exactly one superseded item without cancelling its siblings or writing a proposal',async()=>{
    seams.authority.mockResolvedValue({enrolled:true,valid:false,code:'LOCATION_IMPACT_TARGET_SUPERSEDED'});
    const query=vi.fn().mockResolvedValueOnce({rows:[{cable_id:cable}]}).mockResolvedValueOnce({rows:[]});
    expect(await retireSupersededCableItem({query} as unknown as PoolClient,job,cable)).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);expect(query.mock.calls[0][1]).toEqual(['project','job','cable']);
    expect(query.mock.calls[0][0]).toContain("state IN('waiting','running')");
    expect(query.mock.calls[1][1]).toEqual(['job','owned-lease']);
    expect(query.mock.calls.every(([sql])=>!String(sql).includes('pf_proposals')&&!String(sql).includes('cancel_requested'))).toBe(true);
  });
  it('does not increment completion twice after a lost acknowledgement',async()=>{
    seams.authority.mockResolvedValue({enrolled:true,valid:false,code:'LOCATION_IMPACT_TARGET_SUPERSEDED'});
    const query=vi.fn().mockResolvedValue({rows:[]});expect(await retireSupersededCableItem({query} as unknown as PoolClient,job,cable)).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each(['LOCATION_IMPACT_AUTHORITY_EXPIRED','LOCATION_IMPACT_RESTORE_FENCED','LOCATION_IMPACT_JOB_REVOKED'])('does not reinterpret %s as an innocuous sibling supersession',async code=>{
    seams.authority.mockResolvedValue({enrolled:true,valid:false,code});const query=vi.fn();
    await expect(retireSupersededCableItem({query} as unknown as PoolClient,job,cable)).rejects.toMatchObject({code});expect(query).not.toHaveBeenCalled();
  });
});
