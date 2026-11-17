import { useEffect, useRef, useState } from 'react';
import { Link } from '@fluentui/react-components';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import type { BarrierModelScope } from '../../../shared/pathfinderBarriers';
import { createObstacleNavigation } from '@/pages/ProjectDetails/pathFinderObstacleNavigation';
import { fetchCableObstacleLinks } from '@/api/cableObstacleLinks';
import { fetchPathFinderProposal } from '@/api/pathfinder';
import { useAuth } from '@/context/AuthContext';

type Part = { text: string; dbId?: number };
/** Only managed Remarks lines contain saved-route obstacle references. */
export function obstacleTextParts(text: string, managedOnly = false): Part[] {
  const parts: Part[] = [];
  const pattern = /#(0|[1-9][0-9]*)\b/g;
  let previous = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index!, dbId = Number(match[1]);
    const lineStart = text.lastIndexOf('\n', at) + 1;
    if (dbId < 1 || dbId > 2147483647 || managedOnly && !text.slice(lineStart, at).startsWith('[PathFinder obstacles] ')) continue;
    if (at > previous) parts.push({ text: text.slice(previous, at) });
    parts.push({ text: match[0], dbId }); previous = at + match[0].length;
  }
  if (previous < text.length) parts.push({ text: text.slice(previous) });
  return parts;
}

function RoutedObstacleNumber({ dbId, scope }: { dbId: number; scope: BarrierModelScope }) {
  const navigate = useNavigate();
  return <Link as="button" type="button" aria-label={`Show obstacle #${dbId} in 3D`} onClick={() => {
    const target = createObstacleNavigation(scope, dbId); navigate(target.to, { state: target.state });
  }}>#{dbId}</Link>;
}

/** The recorded scope travels with the number, including from detached windows. */
export function ObstacleModelLink(props: { dbId: number; scope: BarrierModelScope }) {
  const routed = useInRouterContext();
  return routed && props.dbId > 0 ? <RoutedObstacleNumber {...props} /> : <>#{props.dbId}</>;
}

function InteractiveObstacleText({ text, parts, contextKey, resolve }: {
  text: string; parts: Part[]; contextKey: string; resolve: (dbId: number, signal: AbortSignal) => Promise<BarrierModelScope>;
}) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<number | null>(null), [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null), live = useRef<string | null>(contextKey);
  live.current = contextKey;
  useEffect(() => {
    live.current = contextKey; setPending(null); setError(null);
    return () => { live.current = null; controller.current?.abort(); controller.current = null; };
  }, [contextKey]);
  const show = async (dbId: number) => {
    if (controller.current) return;
    const key = contextKey, run = new AbortController(); controller.current = run;
    setPending(dbId); setError(null);
    try {
      const scope = await resolve(dbId, run.signal);
      if (run.signal.aborted || live.current !== key || controller.current !== run) return;
      const target = createObstacleNavigation(scope, dbId); navigate(target.to, { state: target.state });
    } catch (failure) {
      if (!run.signal.aborted && live.current === key) setError(failure instanceof Error ? failure.message : 'The obstacle could not be shown. Try again.');
    } finally {
      if (controller.current === run) { controller.current = null; if (live.current === key) setPending(null); }
    }
  };
  return <span style={{ whiteSpace: 'pre-wrap' }} aria-busy={pending !== null}>
    {parts.map((part, index) => part.dbId === undefined ? part.text : <Link as="button" type="button" key={index}
      aria-label={`Show obstacle #${part.dbId} in 3D`} disabled={pending !== null} onClick={() => void show(part.dbId!)}>{part.text}</Link>)}
    {pending !== null ? <span role="status" style={{ display: 'block' }}>Opening obstacle #{pending}…</span> : null}
    {error ? <span role="alert" style={{ display: 'block' }}>{error}</span> : null}
    {!parts.length ? text : null}
  </span>;
}

export function CableObstacleRemarks({ projectId, cableId, remarks, numbersOnly = false }: {
  projectId: string; cableId: string; remarks?: string | null; numbersOnly?: boolean;
}) {
  const { token, user } = useAuth(), routed = useInRouterContext();
  const text = remarks ?? '-', allParts = obstacleTextParts(text, true);
  const numbers = allParts.filter(part => part.dbId !== undefined);
  const parts = numbersOnly ? numbers.flatMap((part, index) => index ? [{ text: ', ' }, part] : [part]) : allParts;
  if (!numbers.length || !routed || !token || !user?.isAdmin) return <span title={numbers.length && token && !user?.isAdmin ? 'Showing obstacles in the 3D Path Finder view requires administrator access.' : undefined}>{numbersOnly ? numbers.map(part => part.text).join(', ') : text}</span>;
  return <InteractiveObstacleText text={text} parts={parts} contextKey={JSON.stringify([projectId, cableId, remarks, token])}
    resolve={async (dbId, signal) => {
      const value = await fetchCableObstacleLinks(projectId, cableId, token, signal);
      if (value.remarks !== remarks) throw new Error('The cable Remarks changed. Refresh the cable and try again.');
      if (value.status !== 'recorded' || !value.scope || !value.obstacles.some(parent => parent.dbId === dbId))
        throw new Error('This obstacle cannot be matched to the saved route. Refresh the cable and try again.');
      return value.scope;
    }} />;
}

/** Failed calculations carry an exact proposal id, never a current-registry guess. */
export function CalculationObstacleText({ text, projectId, cableId, jobId, proposalId, token }: {
  text: string; projectId: string; cableId: string; jobId: string; proposalId?: string | null; token: string | null;
}) {
  const routed = useInRouterContext(), parts = obstacleTextParts(text);
  if (!routed || !token || !proposalId || !parts.some(part => part.dbId !== undefined)) return <>{text}</>;
  return <InteractiveObstacleText text={text} parts={parts} contextKey={JSON.stringify([projectId, cableId, jobId, proposalId, text, token])}
    resolve={async (dbId, signal) => {
      const proposal = await fetchPathFinderProposal(projectId, token, proposalId, signal);
      const evidence = proposal.barriers, report = evidence?.obstacleReport;
      if (proposal.jobId !== jobId || proposal.cableId !== cableId || !report
        || !report.selectedParents.some(parent => parent.dbId === dbId && [...report.blockingParentSelectionIds, ...report.crossedParentSelectionIds].includes(parent.selectionId)))
        throw new Error('The obstacle does not belong to this calculation. Refresh its result and try again.');
      return evidence!.context.binding.scope;
    }} />;
}
