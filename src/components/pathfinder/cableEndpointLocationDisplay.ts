import type { CableEndpointPairSelectionAccess, useCableEndpointPairSelection } from '@/hooks/useCableEndpointPairSelection';
import { cableEndpointConfirmedDisplaySelectionSchema, canReadSavedCableEndpointDisplay } from '../../../shared/pathfinderCableEndpoints';
import { endpointPointSchema } from '../../../shared/pathfinderEndpointBindings';
import type { CanonicalPoint } from '../../../viewer-runtime/protocol.mjs';

type Endpoint = ReturnType<typeof useCableEndpointPairSelection>['from'];

/** Display uses live model identities only; retained labels never target a new model. */
export function locationObjects(state: Pick<Endpoint, 'context' | 'enabled' | 'draft'>, model: CableEndpointPairSelectionAccess['model']): { sdkObjectId: number; sdkObjectIds?: number[] } | null {
  const current = state.context?.current;
  if (!state.enabled || !model || !current || current.modelVersionId !== model.modelVersionId
    || current.selectionRevision !== model.selectionRevision || current.contentFingerprint !== model.contentFingerprint) return null;
  const reopened = state.context?.reopenedObject;
  if (!state.draft && reopened) return { sdkObjectId: reopened.sdkObjectId, sdkObjectIds: reopened.sdkObjectIds };
  const id = state.draft ? state.draft.mode === 'object-derived' ? state.draft.sdkObjectId : state.draft.displaySdkObjectId
    : state.context?.automaticSelection?.sdkObjectId ?? state.context?.confirmedSelection?.sdkObjectId ?? state.context?.confirmedDisplaySelection?.sdkObjectId;
  if (!Number.isSafeInteger(id) || Number(id) <= 0 || Number(id) > 2147483647) return null;
  if (!state.draft && !state.context?.automaticSelection && !state.context?.confirmedSelection) {
    const display = cableEndpointConfirmedDisplaySelectionSchema.safeParse(state.context?.confirmedDisplaySelection);
    if (!display.success) return null;
    return { sdkObjectId: Number(id), ...(display.data.sdkObjectIds ? { sdkObjectIds: [...display.data.sdkObjectIds] } : {}) };
  }
  return { sdkObjectId: Number(id) };
}
/** A saved coordinate can be displayed without claiming any object identity. */
export function locationPoint(state: Pick<Endpoint, 'context' | 'enabled' | 'draft' | 'error'>, model: CableEndpointPairSelectionAccess['model']) {
  const context = state.context, current = context?.current, head = context?.head;
  if (!state.enabled || state.draft || state.error || !context || !canReadSavedCableEndpointDisplay(context) || !model || !current || !head || !context.location
    || head.status !== 'confirmed' || head.mode !== 'fixed-world' || head.sourceObject !== null || head.attachment !== null
    || head.locationRevision !== context.location.revision || head.modelVersionId !== current.modelVersionId
    || head.artifactId !== current.artifactId || head.aggregateId !== current.aggregateId || head.projectionSha256 !== current.projectionSha256
    || head.captureFrameId !== current.captureFrameId || current.modelVersionId !== model.modelVersionId
    || current.selectionRevision !== model.selectionRevision || current.contentFingerprint !== model.contentFingerprint
    || !endpointPointSchema.safeParse(head.pointProjectMetres).success) return null;
  return { pointProjectMetres: [...head.pointProjectMetres] as CanonicalPoint, current: { ...current } };
}
