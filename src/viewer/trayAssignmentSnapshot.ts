import type { PreparationContext, PreparationScope } from '../../shared/pathfinderPreparation';
import { validateTrayAssignments, type ViewerTrayAssignment } from '../../viewer-runtime/protocol.mjs';

type ModelScope = Pick<PreparationScope, 'modelVersionId' | 'contentFingerprint' | 'selectionRevision'>;
export const sameTrayAssignmentModel = (left: ModelScope, right: ModelScope) =>
  left.modelVersionId === right.modelVersionId && left.contentFingerprint === right.contentFingerprint
    && left.selectionRevision === right.selectionRevision;

/** Confirmed, model-local assignments only; never upgrade discovered candidates. */
export function trayAssignmentSnapshot(context: PreparationContext, expected: ModelScope): ViewerTrayAssignment[] {
  if (!sameTrayAssignmentModel(context.scope, expected)) return [];
  const trays = new Map(context.trays.filter(tray => !tray.geometrySource).map(tray => [tray.projectTrayId, tray.rawName]));
  const assignments = context.resolutions.filter(resolution => resolution.mode === 'roots'
    && resolution.rootObjectIds.length > 0 && trays.has(resolution.projectTrayId)
    && sameTrayAssignmentModel(resolution.scope, expected)).map(resolution => ({
      name: trays.get(resolution.projectTrayId)!,
      objectIds: resolution.rootObjectIds.map(root => /^dbid:[1-9][0-9]*$/.test(root) ? Number(root.slice(5)) : NaN),
    }));
  if (!validateTrayAssignments(assignments)) throw new Error('Tray assignments exceed the Properties display limit.');
  return assignments;
}
