import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Field, Input, Select, Spinner } from '@fluentui/react-components';
import { Link } from 'react-router-dom';
import { request } from '@/api/http';
import type { Cable } from '@/api/types';
import type { WorkspaceState, AssistantProposal } from '../../shared/projectAssistant';

type Props = {
  projectId: string; token: string; writable: boolean; admin: boolean;
  cables: Cable[]; cableError: string | null; cablesLoading: boolean;
};
type RecheckResult = {
  checked: number; assigned: number; replaced?: number; preserved: number; review: number; failed: number;
  errors?: {id: string; code: string}[];
  proposals: AssistantProposal[];
  requestUsage: { tokens: number; estimatedUsd: number };
};

const normalize = (name: string) => name.normalize('NFC').trim().toUpperCase();
const changedObject = (p: AssistantProposal) =>
  p.existingModelObjectId != null && p.localModel != null && p.existingModelObjectId !== p.localModel.dbId;
const usd = new Intl.NumberFormat('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const pageSize = 30;
const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'Неуспешна проверка.';

export function ProjectLocationReview({ projectId, token, writable, admin, cables, cableError, cablesLoading }: Props) {
  const base = '/api/projects/' + projectId + '/assistant';
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [jobId, selectJob] = useState('');
  const [tag, setTag] = useState('');
  const [replaceConflicting, setReplaceConflicting] = useState(false);
  const [providerReview, setProviderReview] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RecheckResult | null>(null);
  const reload = useCallback(() => request<WorkspaceState>(base, { token }), [base, token]);
  useEffect(() => {
    let live = true;
    reload().then(data => { if (live) setWorkspace(data); })
      .catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [reload]);

  const jobs = workspace?.jobs.filter(j => j.status === 'review' && j.follow_up_mode !== 'results' && j.proposals.length) ?? [];
  const job = jobs.find(j => j.id === jobId) ?? jobs[0];
  const inventory = useMemo(() => {
    const groups = new Map<string, { name: string; cables: Set<string> }>();
    for (const cable of cables) {
      if (cable.projectId !== projectId) continue;
      for (const endpoint of [cable.fromLocation, cable.toLocation]) {
        if (!endpoint?.trim()) continue;
        const key = normalize(endpoint);
        const group = groups.get(key) ?? { name: endpoint, cables: new Set<string>() };
        group.cables.add(cable.tag || String(cable.cableId));
        groups.set(key, group);
      }
    }
    return groups;
  }, [cables, projectId]);
  const query = normalize(tag);
  const proposals = job?.proposals ?? [];
  const selected = query ? proposals.filter(p => normalize(p.tag) === query) : proposals;
  const visible = proposals.filter(p => !query || normalize(p.tag).includes(query) || normalize(p.target).includes(query));
  const canCheck = Boolean(writable && job && workspace?.modelVersionId && selected.length && !busy);
  const useOpenAI = admin && providerReview;
  const lastPage = Math.max(0, Math.ceil(visible.length / pageSize) - 1);
  const index = Math.min(page, lastPage);
  async function recheck(autoApply: boolean) {
    if (!canCheck || !job || (autoApply && !admin)) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const receipt = await request<RecheckResult>(base + '/jobs/' + job.id + '/recheck', {
        token, method: 'POST', body: {
          autoApply,
          ...(query && { tag: selected[0].logicalTag ?? selected[0].tag }),
          ...(useOpenAI && { providerReview: true }),
          ...(autoApply && admin && replaceConflicting && { replaceConflicting: true }),
        },
      });
      setResult(receipt);
      if (autoApply) { setReplaceConflicting(false); setProviderReview(false); }
      setWorkspace(await reload());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return <section aria-label="Преглед на локациите" style={{ display: 'grid', gap: 12, paddingBlock: 16, maxWidth: 1100 }}>
    <h2>Преглед на локациите</h2>
    {error && <p role="alert">{error}</p>}
    <details>
      <summary>From/To локации в кабелния лист ({inventory.size})</summary>
      {cablesLoading && <Spinner size="small" label="Зареждане на кабелите" />}
      {cableError && <p role="alert">{cableError}</p>}
      <ul>{[...inventory.values()].filter(v => !query || normalize(v.name).includes(query)).map(v =>
        <li key={v.name}><b>{v.name}</b> · {[...v.cables].join(', ')}</li>)}</ul>
    </details>
    {!workspace && !error && <Spinner label="Зареждане на запазените анализи" />}
    {workspace && !job && <p>Няма завършен анализ с предложения. <Link to={'/projects/' + projectId + '?tab=locator&assistant=open#project-assistant'}>Към документите и анализите на проекта</Link></p>}
    {job && <>
      <Field label="Запазен анализ"><Select value={job.id} disabled={busy} onChange={(_,d) => {
        selectJob(d.value); setPage(0); setTag(''); setReplaceConflicting(false); setProviderReview(false); setResult(null); setError('');
      }}>{jobs.map(j => <option key={j.id} value={j.id}>
        {new Date(j.created_at).toLocaleString('bg-BG')} · {j.proposals.length} предложения
      </option>)}</Select></Field>
      <p>Общ разход за избрания анализ · приблизително {usd.format(job.estimated_usd)} USD</p>
      <Field label="Таг на локация" hint="Попълни точния таг за проверка на една локация или остави полето празно за всички предложения.">
        <Input value={tag} maxLength={500} disabled={busy} onChange={(_,d) => { setTag(d.value); setReplaceConflicting(false); setProviderReview(false); setPage(0); setResult(null); }} />
      </Field>
      {workspace && !workspace.modelVersionId && <p>Избери активен 3D модел за проекта.</p>}
      {writable && admin && <Checkbox checked={providerReview} disabled={!canCheck}
        onChange={(_,d) => setProviderReview(d.checked === true)}
        label="Изпрати данни за локацията и кандидатите от 3D модела към OpenAI за избор на обект" />}
      {writable && admin && <Checkbox checked={replaceConflicting} disabled={!canCheck}
        onChange={(_,d) => setReplaceConflicting(d.checked === true)}
        label="При присвояване замени съществуваща връзка, ако проверката докаже друг 3D обект" />}
      {writable && <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
        <Button disabled={!canCheck} onClick={() => void recheck(false)}>{useOpenAI ? 'Провери чрез OpenAI' : 'Провери локално'} ({selected.length})</Button>
        {admin && <Button appearance="primary" disabled={!canCheck} onClick={() => void recheck(true)}>
          {useOpenAI ? 'Провери чрез OpenAI и присвои потвърдените' : 'Провери и присвои еднозначните'} ({selected.length})
        </Button>}
      </div>}
      {busy && <Spinner size="small" label={useOpenAI ? 'Проверка чрез OpenAI' : 'Проверка в текущия модел'} />}
      {result && <div role="status">
        Проверени {result.checked} · Новоприсвоени {result.assigned - (result.replaced ?? 0)} · Заменени {result.replaced ?? 0} · Запазени {result.preserved} · Готови {Math.max(0,result.checked-result.assigned-result.preserved-result.review-result.failed)} · За преглед {result.review} · Грешки {result.failed}
        {result.requestUsage && <p>OpenAI за тази проверка · {result.requestUsage.tokens.toLocaleString('bg-BG')} токена · приблизително {usd.format(result.requestUsage.estimatedUsd)} USD</p>}
        {result.proposals.some(changedObject) && <p>Проверени локации с различен предишен и предложен обект: {result.proposals.filter(changedObject).length}</p>}
        {!!result.errors?.length && <ul aria-label="Грешки при присвояване">{result.errors.map(e =>
          <li key={e.id}>{result.proposals.find(p => p.id === e.id)?.tag ?? e.id} · {e.code}</li>)}</ul>}
      </div>}
      <p>{visible.length} предложения · {Object.keys(job.applied).length} записани за задачата</p>
      {visible.slice(index*pageSize,(index+1)*pageSize).map(p => {
        const current = result?.proposals?.find(row => row.id === p.id) ?? p;
        const assigned = Boolean(job.applied[current.id]);
        const conflict = changedObject(current);
        const failure = result?.errors?.find(e => e.id === current.id);
        return <details key={p.id}>
          <summary><b>{p.tag}</b> → {current.target} · {failure ? 'Грешка при присвояване · ' + failure.code : conflict
            ? (assigned && current.reason !== 'Existing assignment preserved' ? 'Връзката е заменена' : 'Конфликт със съществуващата връзка')
            : (assigned ? 'Присвоено' : current.reason)}</summary>
          {conflict && <p><b>Предишен обект ID {current.existingModelObjectId} → Предложен обект ID {current.localModel?.dbId}</b></p>}
          {current.providerDecision && <p><b>{current.providerDecision.objectId == null
            ? 'OpenAI остави локацията за преглед'
            : 'OpenAI избра обект ID ' + current.providerDecision.objectId}</b> · {current.providerDecision.reason}</p>}
          <p>{current.evidence} · {current.file}, стр. {current.page}</p>
          {current.localModel && <p>{current.localModel.modelName} · ID {current.localModel.dbId}
            {' · Рак '}{current.localModel.rackName} · ID {current.localModel.rackDbId}</p>}
          {current.candidates.length > 0 && <p>Кандидати в модела: {current.candidates.join(', ')}</p>}
          {current.dbId != null && <p>Обект в модела: {current.dbId}</p>}
          {current.point && <p>Позиция (m): {current.point.join(', ')}</p>}
        </details>;
      })}
      {lastPage>0 && <div><Button disabled={index===0} onClick={() => setPage(index-1)}>Назад</Button>
        {' '}{index+1} / {lastPage+1}{' '}
        <Button disabled={index===lastPage} onClick={() => setPage(index+1)}>Напред</Button></div>}
    </>}
  </section>;
}
