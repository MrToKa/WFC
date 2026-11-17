import { obstacleReportSchema } from '../../shared/pathfinderObstacleReport.js';
import { PathFinderError } from './errors.js';

const prefix = '[PathFinder obstacles] ';
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function clearRouteObstacleRemarks(before: unknown): string | null | undefined {
  if (typeof before !== 'string') return before as null | undefined;
  const next = before.replace(/(?:^|\r?\n)\[PathFinder obstacles\] [^\r\n]*(?=\r?\n|$)/g, '');
  return next === before ? before : next || null;
}

/** Only a saved exact route updates this managed line. Unrelated user text is
 * preserved verbatim; legacy calculations without observations preserve it all. */
export function routeObstacleRemarks(before: unknown, rawResult: unknown): string | null | undefined {
  const result = object(rawResult), barriers = object(result?.barriers);
  if (barriers?.obstacleReport === undefined) return before as string | null | undefined;
  const report = obstacleReportSchema.parse(barriers.obstacleReport);
  if (result?.status !== 'calculated' || object(result.route)?.success !== true) return before as string | null | undefined;
  const userText = clearRouteObstacleRemarks(before) ?? '';
  const parents = new Map(report.selectedParents.map(parent => [parent.selectionId, parent]));
  const numbers = [...new Set(report.crossedParentSelectionIds.map(id => parents.get(id)!.dbId))].sort((a, b) => a - b);
  const text = [numbers.length ? `Crosses obstacles: ${numbers.map(id => `#${id}`).join(', ')}.` : '',
    report.status !== 'complete' ? 'Crossing check incomplete; additional obstacles may be present.' : ''].filter(Boolean).join(' ');
  let next = userText;
  if (text) next += `${next ? '\n' : ''}${prefix}${text}`;
  if (next.length > 32767) throw new PathFinderError('CABLE_OBSTACLE_REMARKS_LIMIT', 409, 'Obstacle notes and existing Remarks exceed the 32767 character limit. Shorten the cable Remarks before saving this route.');
  return next || (before === undefined ? undefined : null);
}

export function exactObstacleRemarksTransition(before: Record<string, unknown>, after: Record<string, unknown>, result?: unknown): boolean {
  try { return Object.is(after.remarks, result === undefined ? before.remarks : routeObstacleRemarks(before.remarks, result)); }
  catch { return false; }
}
