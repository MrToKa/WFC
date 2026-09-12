import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { StandardMaterialOwnerCategory } from '../models/standardMaterial.js';
import { deleteCatalogOwner } from '../services/catalogCompositionService.js';
import { readMutationHeaders, respondToMutationError } from '../services/mutationService.js';
import { readCatalogSnapshot } from '../services/catalogCompositionService.js';
import { MATERIAL_CAPABILITIES } from '../services/materialCapabilities.js';

export const catalogObsoleteListHandler: RequestHandler = async (_request, response) => {
  try {
    const snapshot = await readCatalogSnapshot((client) => client.query(
      Object.values(MATERIAL_CAPABILITIES).map((capability) =>
        `SELECT id, '${capability.category}'::text AS category,
          ${capability.ownerNameColumn} AS name, obsolete_at AS "obsoleteAt"
         FROM ${capability.ownerTable} WHERE obsolete_at IS NOT NULL`
      ).join(' UNION ALL ') + ' ORDER BY "obsoleteAt" DESC, id'));
    response.json({ materials: snapshot.value.rows, mutationRevision: snapshot.mutationRevision });
  } catch (error) {
    console.error('Read obsolete materials failed', error);
    response.status(500).json({ error: 'Failed to load obsolete materials' });
  }
};

export const catalogOwnerDeleteHandler = (
  category: StandardMaterialOwnerCategory,
  idParameter: string,
): RequestHandler => async (request, response) => {
  const ownerId = request.params[idParameter];
  if (!z.string().uuid().safeParse(ownerId).success) {
    response.status(400).json({ error: `Invalid ${idParameter}` });
    return;
  }
  try {
    const result = await deleteCatalogOwner({
      actorId: request.userId ?? '', ...readMutationHeaders(request),
    }, category, ownerId);
    response.setHeader('ETag', `"${result.revision}"`);
    response.json({ obsolete: true, mutationRevision: result.revision });
  } catch (error) {
    if (respondToMutationError(error, response)) return;
    if (typeof error === 'object' && error !== null && 'code' in error &&
      (error.code === '23503' || error.code === '23001')) {
      response.status(409).json({ error: 'The material could not be marked obsolete. Reload and try again; its references are preserved.' });
      return;
    }
    console.error('Delete catalog material error', error);
    response.status(500).json({ error: 'Failed to delete catalog material' });
  }
};
