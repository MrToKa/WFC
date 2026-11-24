import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Button, Input, Spinner } from '@fluentui/react-components';
import { useAuth } from '@/context/AuthContext';
import { GVL_PILOT_ID } from './pilotId';
import { readPilotReport, type PilotReport } from './report';
import { label, scopeLabels } from './reportLabels';
import './review.css';

const pageSize = 25;
function DocumentRefs({items}: {items: {source:string;page:number|null}[]}) {
  return items.map((d,i)=><span className="pilot-line" key={i}>{d.source}{d.page!=null && ` · стр. ${d.page}`}</span>);
}
const tabs = ['Локации за преглед', 'Кабели за преглед', 'История на присвояванията'] as const;
type Section = (typeof tabs)[number];
type CableRef = {id:string; tag:string|null};
function CableLink({ project, cable }: {project: string; cable: CableRef}) {
  return <Link to={`/projects/${encodeURIComponent(project)}/cables/${encodeURIComponent(cable.id)}`}>{cable.tag || cable.id}</Link>;
}

export function ReviewWorkspace({ report }: {report: PilotReport}) {
  const [section, setSection] = useState<Section>(tabs[0]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const q = query.trim().toLowerCase();
  const matches = (...fields: (string | number | null)[]) => fields.some(s => String(s ?? '').toLowerCase().includes(q));
  const project = report.projectId;
  const summary = report.summary;
  const locations = report.unresolved.filter(item => matches(item.name, item.reason, label(item.reason), item.status,
    ...item.cables.map(c => c.tag || c.id), ...item.candidates.flatMap(c => [c.tag,...c.objectIds])));
  const blocked = report.routingBlocked.filter(c => matches(c.tag || c.id, c.from, c.to, c.reason));
  const audit = (report.audit ?? report.assigned).filter(i => matches(i.name, i.equipmentTag ?? null, i.status, i.evidence, i.receiptId, i.jobId, ...i.objectIds));
  const sets = { [tabs[0]]: locations, [tabs[1]]: blocked, [tabs[2]]: audit };
  const total = sets[section].length;
  const offset = page * pageSize;
  return <>
    <p className="pilot-scope"><strong>{scopeLabels[report.scopeStatus]}</strong> · {new Date(report.capturedAt).toLocaleString('bg-BG')}<br/>{report.modelLabel}</p>
    <dl className="pilot-summary">
      {([['Присвоени локации',summary.assigned],['Запазени локации',summary.preserved],
        ['Локации за преглед',summary.unresolved],['Кабели с маршрут',summary.routed],
        ['Кабели без маршрут',summary.unrouted],['Защитени ръчни маршрути',summary.manualProtected]] as const).map(([label,n]) =>
        <div key={label}><dt>{label}</dt><dd>{n.toLocaleString('bg-BG')}</dd></div>)}
    </dl>
    {(summary.otherReady ?? 0)>0 && <p>Други валидни присвоявания от WFC: {summary.otherReady}.</p>}
    <p>Общо {summary.locations} локации и {summary.cables} кабела. Променени тагове: {summary.changedTags}.</p>
    <details className="pilot-item">
      <summary><strong>Проверки и разходи за пилота</strong></summary>
      {report.quality ? <div>
        <p>Данни към {new Date(report.quality.capturedAt).toLocaleString('bg-BG')} · модел {report.quality.modelVersionId}</p>
        <dl className="pilot-audit">
          <div><dt>Анализирани страници</dt><dd>{report.quality.pagesAnalyzed} от {report.quality.pagesTotal}</dd></div>
          <div><dt>Проверени локации</dt><dd>{report.quality.locationsChecked}, от които {report.quality.verifiedBindings} потвърдени и {report.quality.reviewLocations} за преглед</dd></div>
          <div><dt>Успешни автоматични проверки</dt><dd>{report.quality.checksPassed} от {report.quality.checksTotal}</dd></div>
          <div><dt>Заявки към OpenAI</dt><dd>{report.quality.apiAttempts}</dd></div>
          <div><dt>Оценен разход</dt><dd>{report.quality.estimatedUsd.toLocaleString('bg-BG', {maximumFractionDigits: 4})} USD при бюджет {report.quality.ceilingUsd} USD</dd></div>
          <div><dt>Дял на кешираните резултати в отчетените анализи</dt><dd>{report.quality.cacheHitRate === null ? 'Няма данни' : report.quality.cacheHitRate.toLocaleString('bg-BG', {style: 'percent', maximumFractionDigits: 1})}</dd></div>
        </dl>
      </div> : <p>Липсва проверен отчет за качеството на този пилот.</p>}
    </details>
    <nav aria-label="Раздели на отчета" className="pilot-tabs">
      {tabs.map(tab => <Button key={tab} appearance={section===tab?'primary':'subtle'} aria-pressed={section===tab}
        onClick={()=>{setSection(tab);setPage(0);setQuery('');}}>{tab}</Button>)}
    </nav>
    <h2>{section}</h2>
    <div className="pilot-tools"><Input aria-label="Търсене в раздела" placeholder="Търсене в раздела" value={query}
      onChange={(_,d)=>{setQuery(d.value);setPage(0);}}/>
      <span role="status">{total ? `${offset+1}–${Math.min(total,offset+pageSize)} от ${total}` : '0 резултата'}</span></div>
    {total===0 && <p>{q ? 'Няма съвпадения при това търсене.' : 'Няма записи в този раздел.'}</p>}
    {section===tabs[0] && locations.slice(offset,offset+pageSize).map(item=><details className="pilot-item" key={item.locationId||item.name}>
      <summary><strong>{item.name}</strong><span>{label(item.reason)}</span></summary>
      <div><p><b>Следващо действие</b><br/>{item.nextAction}</p>
        <p><b>Кабели и край</b><br/>{item.cables.map(c=><span className="pilot-cable" key={c.id+c.side}><CableLink project={project} cable={c}/> ({c.side})</span>)}</p>
        {Boolean(item.conflictingCableLoops?.length) && <p><b>Конфликтни контури</b><br/>{item.conflictingCableLoops!.join(', ')}</p>}
        <p><b>Кандидати в модела</b><br/>{item.candidates.length ? item.candidates.map((c,i)=><span className="pilot-line" key={i}>{c.tag || 'Обект'}{c.objectIds.length>0 && ` · ID ${c.objectIds.join(', ')}`}</span>) : 'Няма потвърден кандидат.'}</p>
        <p><b>Документни доказателства</b><br/>{item.documents.length ? <DocumentRefs items={item.documents}/> : 'Няма посочен документ.'}</p>
      </div></details>)}
    {section===tabs[1] && total>0 && <div className="pilot-scroll"><table><thead><tr><th>Кабел</th><th>From</th><th>To</th><th>Причина</th></tr></thead><tbody>
      {blocked.slice(offset,offset+pageSize).map(c=><tr key={c.id}><td><CableLink project={project} cable={c}/></td><td>{c.from||'—'}</td><td>{c.to||'—'}</td><td>{c.reason}{c.latestJobId && <details><summary>Последна задача</summary><p>{c.latestJobMessage}</p><code>{c.latestJobStatus} · {c.latestJobId}</code></details>}</td></tr>)}
    </tbody></table></div>}
    {section===tabs[2] && audit.slice(offset,offset+pageSize).map(item=><details key={item.locationId} className="pilot-item">
      <summary><strong>{item.name}</strong><span>{label(item.status)}</span></summary><div><p>{label(item.evidence)}{item.equipmentTag && ` · ${item.equipmentTag}`}</p>
        {Boolean(item.documents?.length) && <p><DocumentRefs items={item.documents!}/></p>}
        <dl className="pilot-audit">{([['Обекти в модела',item.objectIds.join(', ')],['Присвояване',item.bindingId],
          ['Потвърждение',item.receiptId],['Засегнати кабели (ID)',item.impactId],['Автоматичен запис',item.dispatchStatus ?? 'Няма записан статус'],['Първоначална задача',item.jobStatus && item.jobId ? `${item.jobStatus} · ${item.jobId}` : item.jobId]] as const).map(([label,value])=>
          <div key={label}><dt>{label}</dt><dd>{value || 'Няма записан ID'}</dd></div>)}</dl></div></details>)}
    {total>pageSize && <div className="pilot-tools"><Button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Назад</Button>
      <Button disabled={offset+pageSize>=total} onClick={()=>setPage(p=>p+1)}>Напред</Button></div>}
  </>;
}

export function PilotPage({ projectId, token }: {projectId:string; token:string}) {
  const [report,setReport] = useState<PilotReport|null>(null);
  const [error,setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(()=>{
    const controller = new AbortController();
    setReport(null);setError('');setExportError('');
    readPilotReport(projectId,token,controller.signal).then(value=>{
      if (!controller.signal.aborted) setReport(value);
    }).catch(e=>{if(!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Грешка при зареждането.');});
    return ()=>controller.abort();
  },[projectId,token,revision]);

  async function exportReport(targetDocument: Document) {
    if (!report || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const { downloadPilotReport } = await import('./exportPilotReport');
      await downloadPilotReport(report, targetDocument);
    } catch (error) {
      console.error('Failed to export pilot report', error);
      setExportError('Отчетът не можа да се експортира. Опитайте отново.');
    } finally {
      setExporting(false);
    }
  }

  return <section className="pilot-review" aria-labelledby="pilot-title">
    <header><h2 id="pilot-title">Отчет на пилота</h2>
      <div className="pilot-tools">
        <Button disabled={(!report && !error) || exporting} onClick={()=>refresh(n=>n+1)}>Обнови отчета</Button>
        <Button appearance="primary" disabled={!report || exporting}
          onClick={(event) => void exportReport(event.currentTarget.ownerDocument)}>
          {exporting ? 'Подготвя се Excel файл…' : 'Експорт в Excel'}
        </Button>
      </div>
    </header>
    {exportError && <p role="alert">{exportError}</p>}
    {error ? <p role="alert">{error}</p> : report ? <ReviewWorkspace report={report}/> : <Spinner label="Зареждане на отчета…"/>}
  </section>;
}
export function GvlStage5() {
  const {projectId} = useParams();
  const {user,token} = useAuth();
  if(!projectId || projectId!==GVL_PILOT_ID || !user?.isAdmin || !token) return <p role="alert">Отчетът не е достъпен.</p>;
  return <Navigate replace to={`/projects/${projectId}?tab=locator&panel=pilot`} />;
}
