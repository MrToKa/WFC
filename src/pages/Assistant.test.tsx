import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, vi, expect } from 'vitest';
const api = vi.hoisted(() => ({ request: vi.fn(), files: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'engineer' } }) }));
vi.mock('@/api/http', () => ({
  request: api.request,
  downloadFile: vi.fn(),
  getApiBaseUrl: () => '',
}));
vi.mock('@/api/projectFiles', () => ({
  fetchProjectFiles: api.files,
}));
vi.mock('./ProjectDetails/hooks/useRoutingsViewer', () => ({ useRoutingsViewer: vi.fn() }));
import { AssistantWorkspace } from './Assistant';
function attachFiles(...names: string[]) {
  fireEvent.change(screen.getByLabelText('Upload files'), { target: { files: names.map(name => new File(['test'], name)) } });
}
function submitted() {
  const post = [...api.request.mock.calls].reverse().find(([path, opts]) => path.endsWith('/jobs') && opts.method === 'POST');
  expect(post).toBeDefined();
  const body = post![1].body;
  return body instanceof FormData
    ? { job: JSON.parse(String(body.get('job'))), names: body.getAll('documents').map(f => (f as File).name) }
    : { job: body, names: [] };
}
describe('assistant task form', () => {
  it.each([false,true])('launches a single workflow from uploaded documents, replacement %s', async replaceConflicting => {
    const state={rules:'',revision:1,modelVersionId:'current-model',jobs:[]};
    api.request.mockImplementation(async (_path,opts)=>opts.method==='POST' ? {id:'new-job'} : state);
    api.files.mockResolvedValue({files:[]});
    render(<AssistantWorkspace projectId="another-project" token="session" admin writable />);
    fireEvent.change(screen.getByLabelText('Upload files'),{target:{files:[new File(['draw'],'Rack.pdf')]}});
    await screen.findByRole('button', {name:'Премахни Rack.pdf'});
    await screen.findByText(/current-model/);
    const auto=screen.getByRole('checkbox',{name:/изпрати 3D кандидатите/});
    expect(auto).not.toBeChecked();
    fireEvent.click(auto);
    const replace=screen.getByRole('checkbox',{name:/Замени и съществуващите/});
    expect(replace).not.toBeChecked();
    if (replaceConflicting) fireEvent.click(replace);
    fireEvent.click(screen.getByRole('button',{name:'Стартирай анализа и присвояването'}));
    await waitFor(() => expect(submitted()).toMatchObject({
      job: {automaticAssignment: {replaceConflicting}, files: [{id: expect.any(String), versionId: null}]},
      names: ['Rack.pdf'],
    }));
  });
  it('keeps polling after document review and presents distinct new and replaced counts',async()=>{
    const base={rules:'',revision:1,modelVersionId:'model'};
    const job={id:'workflow',status:'review',automatic_assignment:true,workflow_state:'running',created_at:'2026-11-21T12:00:00Z',
      progress:1,total:1,tokens:17,estimated_usd:0.01,proposals:[],applied:{}};
    api.request.mockResolvedValueOnce({...base,jobs:[job]}).mockResolvedValue({...base,jobs:[{
      ...job,workflow_state:'complete',workflow_summary:{checked:8,assigned:5,replaced:3,preserved:1,review:2,failed:0},
    }]});
    api.files.mockResolvedValue({files:[]});
    render(<AssistantWorkspace projectId="another" token="session" admin writable />);
    await screen.findByText('Проверяват се 3D кандидатите и се присвояват локациите');
    const title=await screen.findByText('Автоматичното присвояване приключи',{selector:':not(summary)'},{timeout:5000});
    expect(title.closest('section')).toHaveTextContent('Новоприсвоени 2 · Заменени 3');
  },8000);
  it.each([false, true])('keeps the previous analysis when attaching files: %s', async (attach) => {
    const latest = {
      id: 'latest-job', status: 'review', model_id: 'model', created_at: '2026-11-20T00:00:00.000Z',
      progress: 3, total: 3, tokens: 100, estimated_usd: 0.018,
      proposals: [], applied: {}, instructions: 'Check the pump',
    };
    const older = { ...latest, id: 'older-job', instructions: 'Check the electrical cabinet' };
    api.request.mockImplementation(async (_path, opts) =>
      opts.method === 'POST' ? { id: 'new-job' } :
        { rules: '', revision: 1, modelVersionId: 'model', jobs: [latest, older] },
    );
    const drawing = { id: 'added', fileName: 'new.pdf', uploadedAt: '2026-11-21T00:00:00.000Z' };
    api.files.mockResolvedValue({ files: [drawing] });
    render(<AssistantWorkspace projectId="aalborg" token="session" admin={false} writable />);
    const previous = await screen.findByRole('combobox', { name: 'Предишен анализ' });
    const start = screen.getByRole('button', { name: 'Изпрати съобщение' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Продължи разговора' })[0]);
    expect(screen.getByRole('region', { name: 'Разговор с AI Assistant' })).toHaveTextContent('Check the pump');
    expect(screen.getByLabelText('Допълнителни указания за тази задача')).toHaveFocus();
    expect(previous).toHaveValue(latest.id);
    expect(start).toBeDisabled();
    expect(screen.queryByRole('checkbox',{name:/изпрати 3D кандидатите/})).toBeNull();
    fireEvent.change(previous, { target: { value: older.id } });
    fireEvent.change(screen.getByLabelText('Допълнителни указания за тази задача'), {
      target: { value: 'Check the evidence for the tags requiring manual review' },
    });
    const recheck = screen.getByRole('checkbox', { name: 'Провери документите отново' });
    fireEvent.click(recheck);
    expect(screen.getByRole('button', { name: 'Стартирай повторен анализ' })).toBeEnabled();
    fireEvent.click(recheck);
    expect(start).toBeEnabled();
    if (attach) {
      attachFiles('new.pdf');
      expect(previous).toHaveValue(older.id);
      expect(screen.getByRole('region', { name: 'Разговор с AI Assistant' })).toHaveTextContent('Check the electrical cabinet');
      fireEvent.click(screen.getByRole('button', { name: 'Изпрати с документи' }));
    } else {
      fireEvent.click(start);
    }
    await waitFor(() => expect(submitted()).toMatchObject({
      job: {instructions: 'Check the evidence for the tags requiring manual review', previousJobId: older.id,
        followUpMode: attach ? 'documents' : 'results', files: attach ? [{id:expect.any(String), versionId:null}] : []},
      names: attach ? ['new.pdf'] : [],
    }));
  });
  it('shows document analysis, 3D matching and the completion report as polling progresses', async () => {
    const job = {
      id: 'job', status: 'running', created_at: '2026-11-20T00:00:00.000Z',
      progress: 1, total: 3, current_file: 'drawing.pdf',
      tokens: 100, estimated_usd: 0.018, proposals: [], applied: {},
    };
    const workspace = { rules: '', revision: 1, modelVersionId: 'model' };
    api.request
      .mockResolvedValueOnce({ ...workspace, jobs: [job] })
      .mockResolvedValueOnce({ ...workspace, jobs: [{ ...job, progress: 3, current_file: null }] })
      .mockResolvedValue({
        ...workspace, jobs: [{ ...job, status: 'review', progress: 3, current_file: null }],
      });
    api.files.mockResolvedValue({ files: [] });
    render(<AssistantWorkspace projectId="aalborg" token="session" admin={false} writable />);
    await screen.findByText('drawing.pdf');
    expect(screen.getByText('Анализират се документи')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Обработени документи' })).toHaveAttribute('aria-valuenow', '1');
    await screen.findByText('Съпоставят се локации с 3D модела', {}, { timeout: 5000 });
    const done = await screen.findByText('Анализът приключи', { selector: ':not(summary)' }, { timeout: 5000 });
    const card = within(done.closest('section')!);
    expect(card.getByText('3 от 3 документа са обработени.')).toBeInTheDocument();
    expect(card.getByText('Няма предложения за локации.')).toBeInTheDocument();
    expect(card.queryByRole('progressbar')).toBeNull();
    fireEvent.click(card.getByRole('button', { name: 'Подробности за задачата' }));
    expect(document.getElementById('assistant-job-job')).toHaveAttribute('open');
  }, 10000);
  it('shows which confirmed location is being saved until WFC returns the receipt', async () => {
    const proposal = {
      id: 'proposal', tag: 'P-101', target: 'Pump', candidates: [],
      ref: { traceId: 'trace', objectRevisionId: 'object', recordSha256: 'hash' },
    };
    const job = {
      id: 'review-job', status: 'review', created_at: '2026-11-20T00:00:00.000Z',
      progress: 1, total: 1, tokens: 100, estimated_usd: 0.018,
      proposals: [proposal], applied: {},
    };
    const workspace = { rules: '', revision: 1, modelVersionId: 'model' };
    let finishSave!: () => void;
    const saved = new Promise<void>((resolve) => { finishSave = resolve; });
    let applied = {};
    api.request.mockImplementation(async (path: string) => {
      if (path.endsWith('/apply')) {
        await saved;
        applied = { proposal: 'impact' };
        return { impact: 'impact' };
      }
      return { ...workspace, jobs: [{ ...job, applied }] };
    });
    api.files.mockResolvedValue({ files: [] });
    render(<AssistantWorkspace projectId="aalborg" token="session" admin writable />);
    fireEvent.click(await screen.findByRole('button', { name: 'Подробности за задачата' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /P-101/ }));
    fireEvent.click(screen.getByRole('button', { name: /избраните локации/i }));
    expect(await screen.findByText('Записва се локация за P-101')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Присвоени локации' })).toHaveAttribute('aria-valuenow', '0');
    finishSave();
    const title = await screen.findByText('Анализът приключи', { selector: ':not(summary)' });
    expect(within(title.closest('section')!).getByText(/1 приложени/)).toBeInTheDocument();
  });
  it('reports how far a failed job got and identifies the failed document', async () => {
    api.request.mockResolvedValue({
      rules: '', revision: 1, modelVersionId: 'model',
      jobs: [{
        id: 'failed-job', status: 'failed', author: 'engineer',
        created_at: '2026-11-20T00:00:00.000Z', progress: 1, total: 3,
        current_file: 'locked.pdf', error: 'PDF is encrypted',
        tokens: 100, estimated_usd: 0.018, proposals: [], applied: {},
      }],
    });
    api.files.mockResolvedValue({ files: [] });
    render(<AssistantWorkspace projectId="aalborg" token="session" admin={false} writable />);
    const title = await screen.findByText('Задачата прекъсна с грешка');
    const card = within(title.closest('section')!);
    expect(card.getByText('1 от 3 документа са обработени.')).toBeInTheDocument();
    expect(card.getByText(/locked.pdf.*PDF is encrypted/)).toBeInTheDocument();
    expect(card.queryByRole('progressbar')).toBeNull();
  });
  it('attaches only the current task files and clears them after submission', async () => {
    api.request.mockImplementation(async (_path, opts) => opts.method === 'POST' ? {} : {
      jobs: [], rules: '', revision: 3, modelVersionId: 'model',
    });
    render(<AssistantWorkspace projectId="aalborg" token="session" admin={false} writable />);
    await screen.findByText('Активен 3D модел · model');
    expect(api.files).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Upload files')).toHaveAttribute('multiple');
    const start = screen.getByRole('button', {name:'Стартирай задача'});
    expect(start).toBeDisabled();
    attachFiles('drawing.pdf', 'notes.csv');
    attachFiles('pump.png');
    fireEvent.click(screen.getByRole('button', {name:'Премахни notes.csv'}));
    const task = screen.getByLabelText('Допълнителни указания за тази задача');
    fireEvent.change(task, {target: {value:'Use the pump branch'}});
    fireEvent.click(start);
    await waitFor(() => expect(submitted()).toMatchObject({
      job: {instructions:'Use the pump branch',rulesRevision:3,files:[
        {id:expect.any(String),versionId:null},{id:expect.any(String),versionId:null}]}, names:['drawing.pdf','pump.png'],
    }));
    await waitFor(() => expect(task).toHaveValue(''));
    expect(screen.queryByRole('button', {name:'Премахни drawing.pdf'})).toBeNull();
  });
});
