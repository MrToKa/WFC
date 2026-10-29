import type {
  PreparationContext,
  PreparationDiscovery,
  PreparationPlan,
  PreparationScope,
} from '../../../shared/pathfinderPreparation';

type Source = 'draft' | 'assignment' | 'plan' | 'candidate';
export type TrayDisplayTarget = { objectIds: number[]; source: Source | null; message: string | null };
type Input = {
  trayId: string;
  context: PreparationContext;
  plan: PreparationPlan | null;
  discovery: PreparationDiscovery | null;
  draftRoots?: string[];
};
type ModelScope = Pick<PreparationScope, 'modelVersionId' | 'contentFingerprint' | 'selectionRevision'>;
const sameModel = (saved: ModelScope, current: ModelScope) =>
  saved.modelVersionId === current.modelVersionId && saved.contentFingerprint === current.contentFingerprint
  && saved.selectionRevision === current.selectionRevision;
const unavailable = (source: Source | null, message: string): TrayDisplayTarget => ({ objectIds: [], source, message });

function fromRoots(roots: string[], source: Source): TrayDisplayTarget {
  if (!roots.length) return unavailable(source, source === 'draft'
    ? 'The draft has no model objects. Choose a model tray first.'
    : 'No model objects are recorded for this tray. Assign its model objects or discover candidates first.');
  if (roots.length > 512) return unavailable(source, 'This tray has more than 512 model objects. Choose a smaller group to show.');
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const root of roots) {
    const match = typeof root === 'string' ? /^dbid:([1-9][0-9]*)$/.exec(root) : null;
    const id = match && match[0] === root ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(id) || id > 2147483647 || seen.has(id))
      return unavailable(source, 'The tray has invalid model object identifiers. Select its model objects again.');
    ids.push(id);
    seen.add(id);
  }
  return { objectIds: ids, source, message: null };
}

/** Display evidence only. A same-model historical assignment may be inspected;
 * this never upgrades its routing permissions or preparation/write provenance. */
export function trayDisplayTarget({ trayId, context, plan, discovery, draftRoots }: Input): TrayDisplayTarget {
  if (!context.trays.some(tray => tray.projectTrayId === trayId))
    return unavailable(null, 'This tray is no longer in the current project. Refresh preparation status.');
  if (draftRoots !== undefined) return fromRoots(draftRoots, 'draft');
  const assignment = context.resolutions.find(resolution => resolution.projectTrayId === trayId
    && resolution.mode === 'roots' && sameModel(resolution.scope, context.scope));
  if (assignment) return fromRoots(assignment.rootObjectIds, 'assignment');
  if (plan && plan.projectId === context.projectId && sameModel(plan, context.scope)) {
    const tray = plan.requestedScope.trays.find(value => value.projectTrayId === trayId);
    if (tray) return fromRoots(tray.orderedRootObjectIds, 'plan');
  }
  if (discovery && sameModel(discovery, context.scope)) {
    const candidate = discovery.trays.find(tray => tray.projectTrayId === trayId);
    if (candidate?.candidateRootObjectIds.length) return fromRoots(candidate.candidateRootObjectIds, 'candidate');
  }
  return unavailable(null, 'No model objects for this tray are known in the current model. Discover candidates or assign its model objects first.');
}
