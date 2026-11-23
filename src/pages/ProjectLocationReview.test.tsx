import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { request } from '@/api/http';
import { ProjectLocationReview } from './ProjectLocationReview';

vi.mock('@/api/http', () => ({ request: vi.fn() }));
const tag = '=H2=HA1=BTA2';
const proposal = { id:'one', tag,target:'=H2=UBA5',reason:'review',candidates:[],file:'Rack.pdf',page:17 };
const workspace = { modelVersionId:'current', jobs:[{id:'job',created_at:'2026-11-21T13:00:00Z',status:'review',estimated_usd:0.866,
  proposals:[proposal,{...proposal,id:'two',tag:'another'}],applied:{}}] };

function review(admin:boolean,writable:boolean) {
  render(<MemoryRouter><ProjectLocationReview projectId="aalborg" token="session" admin={admin} writable={writable}
    cables={[]} cableError={null} cablesLoading={false}/></MemoryRouter>);
}
describe('local project location review',()=>{
  it('rechecks a single exact tag, then applies the selected saved analysis through the local endpoint',async()=>{
    vi.mocked(request).mockImplementation(async (path) => path.endsWith('/recheck')
      ? {checked:1,assigned:0,preserved:0,review:1,failed:0,proposals:[proposal]} : workspace);
    review(true,true);
    const field=await screen.findByRole('textbox',{name:'Таг на локация'});
    fireEvent.change(field,{target:{value:tag.slice(0,6)}});
    expect(screen.getByRole('button',{name:'Провери локално (0)'})).toBeDisabled();
    fireEvent.change(field,{target:{value:tag}});
    fireEvent.click(screen.getByRole('button',{name:'Провери локално (1)'}));
    await screen.findByRole('status');
    expect(request).toHaveBeenCalledWith('/api/projects/aalborg/assistant/jobs/job/recheck',
      {token:'session',method:'POST',body:{autoApply:false,tag}});
    await waitFor(()=>expect(field).toBeEnabled());
    fireEvent.change(field,{target:{value:''}});
    fireEvent.click(screen.getByRole('button',{name:'Провери и присвои еднозначните (2)'}));
    await waitFor(()=>expect(request).toHaveBeenCalledWith('/api/projects/aalborg/assistant/jobs/job/recheck',
      {token:'session',method:'POST',body:{autoApply:true}}));
    expect(vi.mocked(request).mock.calls.every(([path])=>!path.endsWith('/jobs'))).toBe(true);
  });
  it('allows read-only access to saved reasons without exposing mutations', async()=>{
    vi.mocked(request).mockResolvedValue(workspace);
    review(false,false);
    await screen.findByText(tag);
    expect(screen.queryByRole('button',{name:/Провери/})).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('shows the failed location tag with the returned error code',async()=>{
    vi.mocked(request).mockImplementation(async path => path.endsWith('/recheck')
      ? {checked:1,assigned:0,preserved:0,review:0,failed:1,errors:[{id:'one',code:'MODEL_CHANGED'}],proposals:[proposal]} : workspace);
    review(true,true);
    fireEvent.click(await screen.findByRole('button',{name:'Провери и присвои еднозначните (2)'}));
    expect(await screen.findByRole('list',{name:'Грешки при присвояване'})).toHaveTextContent(tag + ' · MODEL_CHANGED');
    expect(screen.getByText(/Грешка при присвояване · MODEL_CHANGED/)).toBeInTheDocument();
  });
  it('shows the object change and sends replacement permission only on explicit apply',async()=>{
    const conflict={...proposal,existingModelObjectId:11,localModel:{dbId:22,modelName:'Transmitter',rackName:'UBA5',rackDbId:3}};
    const receipt={checked:1,assigned:0,replaced:0,preserved:1,review:0,failed:0,proposals:[conflict]};
    vi.mocked(request).mockImplementation(async (path, options) => {
      if (!path.endsWith('/recheck')) return workspace;
      return (options?.body as {autoApply?:boolean})?.autoApply
        ? {...receipt,assigned:1,preserved:0,replaced:1} : receipt;
    });
    review(true,true);
    const option=await screen.findByRole('checkbox',{name:/При присвояване замени/});
    expect(option).not.toBeChecked();
    const field=screen.getByRole('textbox',{name:'Таг на локация'});
    fireEvent.change(field,{target:{value:tag}});
    fireEvent.click(option);
    fireEvent.click(screen.getByRole('button',{name:'Провери локално (1)'}));
    const endpoint='/api/projects/aalborg/assistant/jobs/job/recheck';
    await waitFor(()=>expect(request).toHaveBeenCalledWith(endpoint,{token:'session',method:'POST',body:{autoApply:false,tag}}));
    expect(await screen.findByText(/Предишен обект ID 11 → Предложен обект ID 22/)).toBeInTheDocument();
    await waitFor(()=>expect(field).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Провери и присвои еднозначните (1)'}));
    await waitFor(()=>expect(request).toHaveBeenCalledWith(endpoint,{token:'session',method:'POST',body:{autoApply:true,tag,replaceConflicting:true}}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Новоприсвоени 0 · Заменени 1'));
    expect(option).not.toBeChecked();
  });
  it('hides replacement from a project editor without administrative access',async()=>{
    vi.mocked(request).mockResolvedValue(workspace);
    review(false,true);
    await screen.findByRole('button',{name:/Провери локално/});
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button',{name:/присвои/i})).toBeNull();
  });
  it('sends provider review only when selected and displays each decision',async()=>{
    const decisions=[
      {...proposal,providerDecision:{objectId:22,reason:'Инструментът съвпада с рака.'}},
      {...proposal,id:'two',tag:'another',providerDecision:{objectId:null,reason:'Има два кандидата.'}},
    ];
    vi.mocked(request).mockImplementation(async path => path.endsWith('/recheck')
      ? {checked:2,assigned:0,preserved:0,review:1,failed:0,requestUsage:{tokens:612,estimatedUsd:0.0033},proposals:decisions} : workspace);
    review(true,true);
    const option=await screen.findByRole('checkbox',{name:/към OpenAI/});
    expect(option).not.toBeChecked();
    fireEvent.click(option);
    fireEvent.click(screen.getByRole('button',{name:'Провери чрез OpenAI (2)'}));
    const endpoint='/api/projects/aalborg/assistant/jobs/job/recheck';
    await waitFor(()=>expect(request).toHaveBeenCalledWith(endpoint,{token:'session',method:'POST',body:{autoApply:false,providerReview:true}}));
    expect(await screen.findByText('OpenAI избра обект ID 22')).toBeInTheDocument();
    expect(screen.getByText('OpenAI остави локацията за преглед')).toBeInTheDocument();
    expect(screen.getByText(/Общ разход за избрания анализ.*0,866 USD/)).toBeInTheDocument();
    expect(screen.getByText(/OpenAI за тази проверка.*612 токена.*0,0033 USD/)).toBeInTheDocument();
    expect(screen.getByText(/Има два кандидата/)).toBeInTheDocument();
    const apply=screen.getByRole('button',{name:'Провери чрез OpenAI и присвои потвърдените (2)'});
    await waitFor(()=>expect(apply).toBeEnabled());
    fireEvent.click(apply);
    await waitFor(()=>expect(request).toHaveBeenCalledWith(endpoint,{token:'session',method:'POST',body:{autoApply:true,providerReview:true}}));
    await waitFor(()=>expect(option).not.toBeChecked());
  });
});
