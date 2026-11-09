import type { z } from 'zod';
import { modelLocationMatchCandidateSchema } from '../../shared/pathfinderModelLocationMatch.js';
import { endpointModelMatchObjectGroupSchema, normalizeEndpointLocation } from '../../shared/pathfinderEndpointBindings.js';

type Candidate = z.infer<typeof modelLocationMatchCandidateSchema>;
export type ModelLocationMatchCandidateGroup = Pick<Candidate, 'objectId' | 'name' | 'bounds' | 'bottomCentre'> & {
  objectGroup?: z.infer<typeof endpointModelMatchObjectGroupSchema>;
};

/** Count source items, preserving every raw presentation in the saved command.
 * Incomplete identities and root zero remain separate candidates. Missing
 * bounds cannot turn a duplicate source item into a falsely available point. */
export function groupModelLocationMatchCandidates(candidates: Candidate[], logicalName: string): ModelLocationMatchCandidateGroup[] {
  const key = normalizeEndpointLocation(logicalName), groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    if (!candidate.matchedNames.some(name => normalizeEndpointLocation(name) === key)) continue;
    const identity = candidate.objectId > 0 ? candidate.objectIdentity : undefined;
    const groupKey = identity ? JSON.stringify(['source', identity.guid, identity.sourceFile]) : JSON.stringify(['object', candidate.objectId]);
    const members = groups.get(groupKey) ?? []; members.push(candidate); groups.set(groupKey, members);
  }
  return [...groups.values()].map(members => {
    members.sort((left, right) => left.objectId - right.objectId);
    const representative = members[0];
    if (members.length === 1) return { objectId: representative.objectId, name: representative.name,
      bounds: representative.bounds, bottomCentre: representative.bottomCentre };
    const objectGroup = endpointModelMatchObjectGroupSchema.parse({ ...representative.objectIdentity, objectIds: members.map(member => member.objectId) });
    const available = members.every(member => member.bounds !== null && member.bottomCentre !== null);
    const bounds = available ? {
      minimum: [0, 1, 2].map(axis => Math.min(...members.map(member => member.bounds!.minimum[axis]))) as [number, number, number],
      maximum: [0, 1, 2].map(axis => Math.max(...members.map(member => member.bounds!.maximum[axis]))) as [number, number, number],
    } : null;
    const bottomCentre: [number, number, number] | null = bounds
      ? [(bounds.minimum[0] + bounds.maximum[0]) / 2, (bounds.minimum[1] + bounds.maximum[1]) / 2, bounds.minimum[2]] : null;
    return { objectId: representative.objectId, name: representative.name, bounds, bottomCentre, objectGroup };
  }).sort((left, right) => left.objectId - right.objectId);
}
