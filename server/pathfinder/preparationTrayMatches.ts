import { PathFinderError } from './errors.js';
import type { PreparationContext } from '../../shared/pathfinderPreparation.js';
import type { PreparationTrayMatchesWrite, PreparationTrayMatchesReceipt } from '../../shared/pathfinderTrayMatches.js';

/** Discovery assigns catalog records; it neither freezes a geometry plan nor
 * replaces any existing operator decision, even one retained from an old model. */
export function planPreparationTrayMatches(context: PreparationContext, input: PreparationTrayMatchesWrite): PreparationTrayMatchesReceipt['results'] {
  const trayIds = new Set(context.trays.map(tray => tray.projectTrayId));
  const cadTrayIds = new Set(context.trays.filter(tray => tray.geometrySource).map(tray => tray.projectTrayId));
  if (input.matches.length !== trayIds.size || input.matches.some(match => !trayIds.has(match.projectTrayId)))
    throw new PathFinderError('PREPARATION_DISCOVERY_TRAYS',409,'Discover all current project trays before saving their model assignments.');
  const matches = new Map(input.matches.map(match => [match.projectTrayId, match]));
  const saved = new Map(context.resolutions.map(resolution => [resolution.projectTrayId, resolution]));
  const owners = new Map<string, Set<string>>();
  const own = (root: string, trayId: string) => { const values=owners.get(root)??new Set<string>();values.add(trayId);owners.set(root,values); };
  for (const resolution of context.resolutions) if (trayIds.has(resolution.projectTrayId) && !cadTrayIds.has(resolution.projectTrayId)
    && resolution.scope.modelVersionId === context.scope.modelVersionId && resolution.scope.contentFingerprint === context.scope.contentFingerprint)
    for (const root of resolution.rootObjectIds) own(root,resolution.projectTrayId);
  const logicalCount=(match:PreparationTrayMatchesWrite['matches'][number])=>match.candidateRootGroups?.length??match.rootObjectIds.length;
  for (const match of input.matches) if (!cadTrayIds.has(match.projectTrayId) && !saved.has(match.projectTrayId) && logicalCount(match) === 1)
    for(const root of match.rootObjectIds)own(root,match.projectTrayId);
  return context.trays.map(tray => {
    if (cadTrayIds.has(tray.projectTrayId)) return { projectTrayId: tray.projectTrayId, status: 'kept' as const, rootObjectIds: [] };
    const prior = saved.get(tray.projectTrayId), match=matches.get(tray.projectTrayId)!,rootObjectIds = match.rootObjectIds;
    if (prior) return { projectTrayId:tray.projectTrayId,status:'kept' as const,rootObjectIds:[...prior.rootObjectIds] };
    return { projectTrayId:tray.projectTrayId,rootObjectIds:[...rootObjectIds],status:rootObjectIds.length === 0 ? 'missing' as const
      : logicalCount(match) === 1 && rootObjectIds.every(root=>owners.get(root)?.size===1) ? 'assigned' as const : 'ambiguous' as const };
  });
}
