import { PROJECT_FILE_MAX_BYTES } from '../../shared/projectFileSize';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  Field,
  ProgressBar,
  Select,
  Textarea,
  Subtitle2,
  Spinner,
} from '@fluentui/react-components';
import { useAuth } from '@/context/AuthContext';
import { fetchProjects } from '@/api/projects';
import { request, downloadFile } from '@/api/http';
import { fetchLocationImpactProgress } from '@/api/pathfinderLocationImpacts';
import { canEditProject } from '@/utils/permissions';
import type { Project } from '@/api/types';
import { generateId } from '../../viewer-runtime/generate-id.mjs';
import type {
  AssistantJob,
  AssistantProposal,
  WorkspaceState,
} from '../../shared/projectAssistant';
import { assistantMaxJobFiles } from '../../shared/projectAssistant';
import { useRoutingsViewer } from './ProjectDetails/hooks/useRoutingsViewer';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Operation failed');
export function AssistantProjects() {
  const { user, token } = useAuth();
  const [selected, setSelected] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    fetchProjects()
      .then((r) => {
        if (live)
          setProjects(
            r.projects.filter((p) => user?.role === 'technician' || canEditProject(user, p)),
          );
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [user]);
  return (
    <section>
      <Field label="Project">
        <Select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose a project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.projectNumber} · {p.name}
            </option>
          ))}
        </Select>
      </Field>
      {token && projects.some(p => p.id === selected) && <AssistantWorkspace key={selected} projectId={selected} token={token}
        admin={Boolean(user?.isAdmin)} writable={canEditProject(user, projects.find(p => p.id === selected))} />}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
type Props = { projectId: string; token: string; admin: boolean; writable: boolean };
const jobLabels: Record<string, string> = {
  queued: 'Изчаква в опашката',
  running: 'Анализират се документи',
  review: 'Анализът приключи',
  failed: 'Задачата прекъсна с грешка',
};
const applyStage = 'Присвояват се потвърдените локации';
const workflowActive = (job: AssistantJob) => job.status === 'review' &&
  (job.workflow_state === 'pending' || job.workflow_state === 'running');
const isActiveJob = (job: AssistantJob) => job.status === 'queued' || job.status === 'running' || workflowActive(job);
const jobStage = (job: AssistantJob) =>
  workflowActive(job) ? 'Проверяват се 3D кандидатите и се присвояват локациите'
    : job.workflow_state === 'failed' ? 'Автоматичното присвояване прекъсна'
    : job.workflow_state === 'complete' ? 'Автоматичното присвояване приключи'
    : job.follow_up_mode === 'results' && job.status === 'running'
    ? 'Подготвя се отговор по запазените резултати'
    : job.follow_up_mode === 'results' && job.status === 'review'
      ? 'Отговорът е готов'
      : job.status === 'running' && job.progress >= job.total
    ? 'Съпоставят се локации с 3D модела'
    : jobLabels[job.status] ?? job.status;

type ApplyingLocations = { jobId: string; tag: string; saved: number; total: number };

function JobReport({ job }: { job: AssistantJob }) {
  const applicable = job.proposals.filter((proposal) => proposal.ref && !job.applied[proposal.id]).length;
  const applied = Object.keys(job.applied).length;
  const summary = job.workflow_summary;
  return (
    <>
      {job.follow_up_mode === 'results'
        ? <p>Използвани са запазените резултати.</p>
        : <p>{job.progress} от {job.total} документа са обработени.</p>}
      {summary && <p>Проверени {summary.checked} · Новоприсвоени {summary.assigned - summary.replaced} · Заменени {summary.replaced} · Запазени {summary.preserved} · За преглед {summary.review} · Грешки {summary.failed}</p>}
      {!job.automatic_assignment && job.status === 'review' && job.follow_up_mode !== 'results' && (
        <>
          <p>{job.proposals.length === 0 ? 'Няма предложения за локации.' : (
            `${job.proposals.length} предложения за локации · ${applicable} за потвърждение · ${job.proposals.filter(p => !p.ref && !job.applied[p.id]).length} за ръчна проверка · ${applied} приложени`
          )}</p>
          {applicable > 0 && <p>Избери и потвърди предложенията, които искаш да запишеш в WFC.</p>}
        </>
      )}
      {(job.status === 'failed' || job.workflow_state === 'failed') && (
        <p>{job.current_file && `${job.current_file} · `}{job.error || 'Причината за грешката е недостъпна.'}</p>
      )}
      <p>{job.tokens.toLocaleString('bg-BG')} токена · приблизително ${job.estimated_usd.toFixed(3)} USD</p>
    </>
  );
}

function JobAnswers({ job }: { job: AssistantJob }) {
  if (job.conversation_answer) {
    return <p style={{ whiteSpace: 'pre-wrap' }}>{job.conversation_answer}</p>;
  }
  return job.answers?.map((answer, index) => (
    <div key={index}>
      <strong>{answer.file} · стр. {answer.page}</strong>
      <p style={{ whiteSpace: 'pre-wrap' }}>{answer.text}</p>
    </div>
  ));
}

function JobStatus({ job, applying, onFollowUp }: {
  job: AssistantJob;
  applying?: ApplyingLocations;
  onFollowUp?: () => void;
}) {
  const running = job.status === 'running';
  const matching = running && job.progress >= job.total;
  return (
    <section style={{ border: '1px solid GrayText', borderRadius: 8, padding: 16 }}>
      <Subtitle2>{applying ? applyStage : jobStage(job)}</Subtitle2>
      <p>{new Date(job.created_at).toLocaleString('bg-BG')}</p>
      {applying ? (
        <>
          <Spinner size="small" label={`Записва се локация за ${applying.tag}`} />
          <ProgressBar aria-label="Присвоени локации" value={applying.saved} max={applying.total} />
          <p>{applying.saved} от {applying.total} избрани локации са записани.</p>
        </>
      ) : isActiveJob(job) ? (
        <>
          <Spinner size="small" label={running && !matching ? job.current_file ?? undefined : undefined} />
          {running && job.total > 0 && (
            <ProgressBar
              aria-label="Обработени документи"
              value={matching ? undefined : job.progress}
              max={job.total}
            />
          )}
          {job.follow_up_mode !== 'results' && <p>{job.progress} от {job.total} документа са обработени.</p>}
        </>
      ) : <>
        {job.follow_up_mode === 'results' && <JobAnswers job={job} />}
        <JobReport job={job} />
      </>}
      <Button onClick={() => {
        const entry = document.getElementById('assistant-job-' + job.id);
        if (entry instanceof HTMLDetailsElement) {
          entry.open = true;
          entry.querySelector('summary')?.focus();
        }
      }}>Подробности за задачата</Button>
      {onFollowUp && <Button onClick={onFollowUp}>Продължи разговора</Button>}
    </section>
  );
}

function Preview({
  projectId,
  token,
  model,
  proposal,
}: {
  projectId: string;
  token: string;
  model: string;
  proposal: AssistantProposal;
}) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRoutingsViewer({ projectId, loadedProjectId: projectId, token, container });
  const [error, setError] = useState('');
  return (
    <section aria-label="3D preview">
      <p>
        {proposal.tag} · {viewer.message}
      </p>
      <Button
        disabled={!viewer.canShow || !proposal.dbId}
        onClick={() =>
          viewer
            .showAssistantSelection(model, proposal.dbId!, null)
            .catch((e) => setError(message(e)))
        }
      >
        Show object
      </Button>
      <Button
        disabled={!viewer.canShow || !proposal.point}
        onClick={() =>
          viewer
            .showAssistantSelection(model, null, proposal.point)
            .catch((e) => setError(message(e)))
        }
      >
        Show proposed point
      </Button>
      {error && <p role="alert">{error}</p>}
      <div ref={container} style={{ height: '55vh' }} />
    </section>
  );
}
export function AssistantWorkspace({ projectId, token, admin, writable }: Props) {
  const { user } = useAuth();
  const base = '/api/projects/' + projectId + '/assistant';
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [rules, setRules] = useState(''),
    [revision, setRevision] = useState(0),
    [instructions, setInstructions] = useState('');
  const [attachments, setAttachments] = useState<{ id: string; file: File }[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<string[]>([]),
    [preview, setPreview] = useState<{ model: string; p: AssistantProposal } | null>(null);
  const [progress, setProgress] = useState('');
  const [pollError, setPollError] = useState(false);
  // Before opening a new chat, show the latest job's status as a shortcut to history.
  const [focusedJobId, setFocusedJobId] = useState<string | null>();
  const [recheckDocuments, setRecheckDocuments] = useState(false);
  const [autoAssign, setAutoAssign] = useState(false);
  const [replaceConflicting, setReplaceConflicting] = useState(false);
  const [conversationTipId, setConversationTipId] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [applying, setApplying] = useState<ApplyingLocations | undefined>();
  const command = useRef<{ key: string; id: string } | null>(null);
  const refresh = useCallback(() => request<WorkspaceState>(base, { token }), [base, token]);
  useEffect(() => {
    let live = true;
    refresh()
      .then((s) => {
        if (live) {
          setState(s);
          setRules(s.rules);
          setRevision(s.revision);
        }
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [refresh]);
  const activeJobs = state?.jobs.filter(isActiveJob) ?? [];
  const pickedCount = attachments.length;
  const completedJobs = state?.jobs.filter((job) => job.status === 'review' && !workflowActive(job)) ?? [];
  const conversationTip = state?.jobs.find((job) => job.id === conversationTipId);
  const previousJob = completedJobs.find((job) => job.id === conversationTipId);
  const thread: AssistantJob[] = [];
  let turn = conversationTip;
  while (turn && !thread.some((job) => job.id === turn?.id)) {
    thread.unshift(turn);
    turn = state?.jobs.find((job) => job.id === turn?.previous_job_id);
  }
  const fromResults = Boolean(previousJob && pickedCount === 0 && !recheckDocuments);
  const fullWorkflow = writable && admin && !previousJob && autoAssign;
  const taskModelId = fromResults ? previousJob?.model_id : state?.modelVersionId;
  const startBlockers = [
    ...(busy ? ['Изчакай текущата операция в този прозорец.'] : []),
    ...(!state ? ['Настройките на задачата още не са заредени.'] : []),
    ...(state && !fromResults && !state.modelVersionId ? ['Избери активен 3D модел за проекта.'] : []),
    ...(state && !fromResults && rules !== state.rules ? ['Запази постоянните указания за проекта.'] : []),
    ...(pickedCount === 0 && !previousJob ? ['Прикачи поне един документ за първия анализ.'] : []),
    ...(previousJob && !instructions.trim() ? ['Напиши какво да се провери или поправи в предишния анализ.'] : []),
    ...(conversationTipId && (!conversationTip || isActiveJob(conversationTip))
      ? ['Изчакай отговора на последното съобщение в този разговор.']
      : []),
    ...(pickedCount > assistantMaxJobFiles
      ? [`Избери до ${assistantMaxJobFiles} документа за една задача.`]
      : []),
  ];
  const active = activeJobs.length > 0;
  const awaitingJob = typeof focusedJobId === 'string' && !state?.jobs.some((job) => job.id === focusedJobId);
  const focusedJob = focusedJobId === undefined ? state?.jobs[0] : state?.jobs.find((job) => job.id === focusedJobId);
  const visibleJobs = focusedJob && !isActiveJob(focusedJob)
    ? [...activeJobs, focusedJob]
    : activeJobs;
  useEffect(() => {
    if ((!active && !awaitingJob) || busy) return;
    let live = true;
    let pending = false;
    const t = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const s = await refresh();
        if (live) {
          setState(s);
          setPollError(false);
        }
      } catch {
        if (live) setPollError(true);
      } finally {
        pending = false;
      }
    }, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [active, awaitingJob, busy, refresh]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setState(await refresh());
      setPollError(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  async function run() {
    if (!taskModelId || !state) return;
    const body = {
      instructions,
      rulesRevision: fromResults ? state.revision : revision,
      modelVersionId: taskModelId,
      ...(fullWorkflow && { automaticAssignment: { replaceConflicting } }),
      ...(previousJob && { previousJobId: previousJob.id, followUpMode: fromResults ? 'results' : 'documents' }),
      files: attachments.map(({ id }) => ({ id, versionId: null })),
    };
    const key = JSON.stringify(body);
    if (command.current?.key !== key) command.current = { key, id: generateId() };
    const job = { ...body, id: command.current.id };
    const form = new FormData();
    if (attachments.length) {
      form.append('job', JSON.stringify(job));
      for (const { file } of attachments) form.append('documents', file);
    }
    await request(base + '/jobs', {
      token,
      method: 'POST',
      body: attachments.length ? form : job,
    });
    setFocusedJobId(command.current.id);
    setConversationTipId(command.current.id);
    setAttachments([]);
    setRecheckDocuments(false);
    setAutoAssign(false);
    setReplaceConflicting(false);
    command.current = null;
    setInstructions('');
  }
  function followUp(job: AssistantJob) {
    setAutoAssign(false);
    setReplaceConflicting(false);
    setRecheckDocuments(false);
    setConversationTipId(job.id);
    composerRef.current?.focus();
  }
  function startNewChat() {
    setConversationTipId(null);
    setFocusedJobId(null);
    setInstructions('');
    setAttachments([]);
    setRecheckDocuments(false);
    setAutoAssign(false);
    setReplaceConflicting(false);
    setError('');
    command.current = null;
    composerRef.current?.focus();
  }
  async function applyLocations(job: AssistantJob) {
    const selected = job.proposals.filter((proposal) =>
      proposal.ref && checks.includes(proposal.id) && !job.applied[proposal.id],
    );
    setFocusedJobId(job.id);
    try {
      for (const [saved, proposal] of selected.entries()) {
        setApplying({ jobId: job.id, tag: proposal.tag, saved, total: selected.length });
        const receipt = await request<{ impact: string }>(base + '/jobs/' + job.id + '/apply', {
          token,
          method: 'POST',
          body: { id: proposal.id },
        });
        setChecks((prev) => prev.filter((id) => id !== proposal.id));
        setState((prev) => prev && ({
          ...prev,
          jobs: prev.jobs.map((item) => item.id === job.id
            ? { ...item, applied: { ...item.applied, [proposal.id]: receipt.impact } }
            : item),
        }));
      }
    } finally {
      setApplying(undefined);
    }
  }
  async function source(j: AssistantJob, p: AssistantProposal) {
    const { blob } = await downloadFile(
      base + '/jobs/' + j.id + '/source/' + p.sourceIndex,
      token,
      'Source unavailable',
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = p.file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return (
    <section style={{ display: 'grid', gap: 16, maxWidth: 1120, paddingBlock: 16 }}>
      <details>
        <summary>Постоянни указания за проекта</summary>
      <Field label="Постоянни указания за проекта">
        <Textarea
          readOnly={!writable}
          rows={4}
          maxLength={12000}
          value={rules}
          onChange={(_, d) => setRules(d.value)}
        />
      </Field>
      <div>
        <Button
          disabled={!writable || !state || busy || rules === state.rules}
          onClick={() =>
            action(async () => {
              const r = await request<{ revision: number }>(base + '/rules', {
                token,
                method: 'PUT',
                body: { rules, revision },
              });
              setRules(rules.trim());
              setRevision(r.revision);
            })
          }
        >
          Запази указанията
        </Button>
      </div>
      </details>
      {error && <p role="alert">{error}</p>}
      {writable && (
        <>
          <span>Активен 3D модел · {state?.modelVersionId ?? 'Няма избрана версия'}</span>
          <div><Button disabled={busy} onClick={startNewChat}>Нов чат</Button></div>
          {thread.length > 0 && (
            <section aria-label="Разговор с AI Assistant" style={{ display: 'grid', gap: 12 }}>
              <Subtitle2>Разговор с AI Assistant</Subtitle2>
              {thread.map((job) => (
                <article key={job.id} style={{ borderInlineStart: '2px solid GrayText', paddingInline: 12 }}>
                  <strong>Ти</strong>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{job.instructions || 'Анализирай избраните документи.'}</p>
                  <strong>AI Assistant</strong>
                  <p>{jobStage(job)}</p>
                  <JobAnswers job={job} />
                  {!isActiveJob(job) && <JobReport job={job} />}
                </article>
              ))}
            </section>
          )}
          <Field label="Допълнителни указания за тази задача">
            <Textarea
              disabled={busy}
              textarea={{ ref: composerRef }}
              placeholder={previousJob ? 'Напиши следващата команда или въпрос…' : 'Напиши указания за новата задача…'}
              rows={4}
              value={instructions}
              maxLength={12000}
              onChange={(_, d) => setInstructions(d.value)}
            />
          </Field>
          <Field label="Файлове за текущата задача" hint={`До ${assistantMaxJobFiles} файла, до 50 MB на файл.`}>
            <input type="file" aria-label="Upload files" multiple accept=".pdf,.png,.jpg,.jpeg,.csv" disabled={busy}
              onChange={e => {
                const batch = Array.from(e.target.files ?? []);
                e.target.value = '';
                const invalid = batch.find(f => f.size > PROJECT_FILE_MAX_BYTES || !/\.(pdf|png|jpe?g|csv)$/i.test(f.name));
                if (invalid || batch.length + attachments.length > assistantMaxJobFiles) {
                  setError(invalid ? `Неподдържан формат или файл над 50 MB: ${invalid.name}` : `Избери до ${assistantMaxJobFiles} файла.`);
                  return;
                }
                setError('');
                setAttachments(current => [...current, ...batch.map(file => ({ id: generateId(), file }))]);
              }} />
          </Field>
          {attachments.map(({ id, file }) => <div key={id}>{file.name}{' '}
            <Button size="small" disabled={busy} aria-label={`Премахни ${file.name}`}
              onClick={() => setAttachments(current => current.filter(item => item.id !== id))}>Премахни</Button>
          </div>)}
          {completedJobs.length > 0 && (
            <Field label="Предишен анализ" hint="Избери анализ, за да продължиш по запазените му резултати.">
              <Select disabled={busy} value={previousJob?.id ?? ''} onChange={(e) => {
                const job = completedJobs.find((item) => item.id === e.target.value);
                if (job) followUp(job);
              }}>
                <option value="" disabled>Избери анализ за продължение</option>
                {completedJobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {new Date(job.created_at).toLocaleString('bg-BG')} · {job.follow_up_mode === 'results' ? 'Отговор по резултатите' : `${job.total} документа`}
                    {job.instructions && ' · ' + job.instructions.slice(0, 80)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {previousJob && pickedCount === 0 && (
            <Checkbox label="Провери документите отново" checked={recheckDocuments}
              onChange={(_, data) => { setRecheckDocuments(data.checked === true); setAutoAssign(false); setReplaceConflicting(false); }} />
          )}
          {admin && !previousJob && <>
            <Checkbox label="Анализирай документите, изпрати 3D кандидатите към OpenAI за избор и присвои проверените локации"
              checked={autoAssign} disabled={busy} onChange={(_,data) => {
                setAutoAssign(data.checked === true); setReplaceConflicting(false);
              }} />
            {fullWorkflow && <Checkbox label="Замени и съществуващите връзки, когато проверката докаже друг 3D обект"
              checked={replaceConflicting} disabled={busy} onChange={(_,data) => setReplaceConflicting(data.checked === true)} />}
          </>}
          <div>
            <Button
              appearance="primary"
              disabled={startBlockers.length > 0}
              aria-describedby="assistant-start-status"
              onClick={() => action(run)}
            >
              {fullWorkflow ? 'Стартирай анализа и присвояването' : fromResults ? 'Изпрати съобщение' : previousJob ? (pickedCount > 0 ? 'Изпрати с документи' : 'Стартирай повторен анализ') : 'Стартирай задача'}
            </Button>
            <div id="assistant-start-status" role="status">
              <p>{fromResults ? 'Режим: запазени резултати' : previousJob && pickedCount === 0 ? 'Режим: повторен анализ на документите' : `Избрани документи: ${pickedCount}`}</p>
              {previousJob && pickedCount > 0 && <p>Ще анализира само избраните файлове в този разговор.</p>}
              {startBlockers.map((reason) => <p key={reason}>{reason}</p>)}
            </div>
          </div>
        </>
      )}
      {busy && !applying && <Spinner size="tiny" />}
      {(active || awaitingJob) && pollError && (
        <p role="alert">Показаният напредък е от последното обновяване. Връзката се проверява отново.</p>
      )}
      <div aria-live="polite" style={{ display: 'grid', gap: 12 }}>
        {awaitingJob && <Spinner size="small" label="Задачата е изпратена. Зарежда се статусът." />}
        {visibleJobs.map((job) => (
          <JobStatus key={job.id} job={job}
            applying={applying?.jobId === job.id ? applying : undefined}
            onFollowUp={writable && !busy && job.status === 'review' && !workflowActive(job) ? () => followUp(job) : undefined}
          />
        ))}
      </div>
      <Subtitle2>История на задачите</Subtitle2>
      {state?.jobs.map((j) => (
        <details key={j.id} id={'assistant-job-' + j.id}>
          <summary>
            {j.previous_job_id && 'Последваща задача · '}
            {new Date(j.created_at).toLocaleString('bg-BG')} · {applying?.jobId === j.id ? applyStage : jobStage(j)}
            {j.follow_up_mode !== 'results' && ` · ${j.progress}/${j.total} документа`}
            {' · '}{j.tokens} токена · ${j.estimated_usd.toFixed(3)} USD
          </summary>
          {!isActiveJob(j) && <JobReport job={j} />}
          <JobAnswers job={j} />
          {writable && j.status === 'review' && !workflowActive(j) && (
            <Button disabled={busy} onClick={() => followUp(j)}>Продължи разговора</Button>
          )}
          {writable && (j.status === 'failed' || j.workflow_state === 'failed') && (!j.automatic_assignment || admin) && j.author === user?.id && (
            <Button
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await request(base + '/jobs/' + j.id + '/resume', { token, method: 'POST' });
                  setFocusedJobId(j.id);
                })
              }
            >
              Възобнови задачата
            </Button>
          )}
          <details>
            <summary>Указания при стартиране</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>
              {j.rules}
              {'\n'}
              {j.instructions}
            </pre>
          </details>
          {j.proposals.map((p) => (
            <div key={p.id} style={{ borderBottom: '1px solid GrayText', paddingBlock: 8 }}>
              <Checkbox
                label={p.tag + ' → ' + p.target}
                disabled={!admin || j.automatic_assignment || !p.ref || !!j.applied[p.id]}
                checked={checks.includes(p.id)}
                onChange={(_, d) =>
                  setChecks((prev) =>
                    d.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                  )
                }
              />
              <span>{j.applied[p.id] ? 'Applied' : p.reason}</span>
              <p>
                {p.evidence} · {p.file}, стр. {p.page}
              </p>
              {p.candidates.length > 0 && <p>{p.candidates.join(', ')}</p>}
              <Button disabled={busy} onClick={() => action(() => source(j, p))}>
                Отвори източника
              </Button>
              {p.ref && (
                <Button onClick={() => setPreview({ model: j.model_id, p })}>Покажи в 3D</Button>
              )}
              {j.applied[p.id] && user && (
                <Button
                  onClick={() =>
                    action(async () => {
                      const r = await fetchLocationImpactProgress(
                        projectId,
                        token,
                        user.id,
                        j.applied[p.id],
                      );
                      setProgress(
                        p.tag +
                          ' · ' +
                          r.impact.status +
                          ' · ' +
                          r.impact.completed +
                          '/' +
                          r.impact.total,
                      );
                    })
                  }
                >
                  Маршрутизация
                </Button>
              )}
            </div>
          ))}
          {admin && !j.automatic_assignment && j.proposals.some((p) => p.ref && checks.includes(p.id) && !j.applied[p.id]) && (
            <Button
              disabled={busy}
              onClick={() => action(() => applyLocations(j))}
            >
              Приложи избраните локации
            </Button>
          )}
        </details>
      ))}
      {progress && <p role="status">{progress}</p>}
      {preview && (
        <>
          <Button onClick={() => setPreview(null)}>Затвори 3D прегледа</Button>
          <Preview
            key={preview.p.id}
            projectId={projectId}
            token={token}
            model={preview.model}
            proposal={preview.p}
          />
        </>
      )}
    </section>
  );
}
