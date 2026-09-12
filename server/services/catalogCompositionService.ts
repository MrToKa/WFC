import type { PoolClient } from 'pg';
import type { StandardMaterialOwnerCategory } from '../models/standardMaterial.js';
import { withTransaction } from '../utils/transaction.js';
import { getMaterialCapability } from './materialCapabilities.js';
import {
  getMutationRevision, MutationError, withVersionedMutation, type MutationParameters,
} from './mutationService.js';
import { captureStandardMaterialGraph, STANDARD_MATERIAL_MUTATION_SCOPE } from './standardMaterialService.js';

/** The displayed rows and their graph revision must come from one read snapshot. */
export const readCatalogSnapshot = async <T>(read: (client: PoolClient) => Promise<T>) =>
  withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const value = await read(client);
    const mutationRevision = await getMutationRevision(client,
      STANDARD_MATERIAL_MUTATION_SCOPE.resourceType, STANDARD_MATERIAL_MUTATION_SCOPE.resourceId);
    return { value, mutationRevision };
  });

type DeletionParameters = Pick<MutationParameters, 'actorId' | 'idempotencyKey' | 'expectedRevision'>;

/** Retire the owner without deleting its row, incoming/outgoing edges or project references. */
export const deleteCatalogOwner = async (
  parameters: DeletionParameters,
  category: StandardMaterialOwnerCategory,
  ownerId: string,
) => {
  let before: Awaited<ReturnType<typeof captureStandardMaterialGraph>> | undefined;
  return withVersionedMutation({
    ...parameters,
    ...STANDARD_MATERIAL_MUTATION_SCOPE,
    request: { method: 'DELETE', category, ownerId },
  }, async (client) => {
    const capability = getMaterialCapability(category);
    // Lock only the owner row after the graph lock. Do not acquire project
    // advisory locks: project mutations use the opposite resource ordering.
    const owner = await client.query(
      `SELECT id, obsolete_at FROM ${capability.ownerTable} WHERE id = $1 FOR UPDATE`, [ownerId]);
    if (!owner.rows.length) throw new MutationError(404, 'OWNER_NOT_FOUND', `${capability.label} not found.`);
    before = await captureStandardMaterialGraph(client);
    if (!owner.rows[0].obsolete_at) await client.query(
      `UPDATE ${capability.ownerTable} SET obsolete_at = NOW(), obsolete_by = $2, updated_at = NOW() WHERE id = $1`,
      [ownerId, parameters.actorId]);
    return { obsolete: true };
  }, async (client) => ({
    schemaVersion: 'standard-material-owner-retirement.v1',
    category,
    ownerId,
    before,
    after: await captureStandardMaterialGraph(client),
  }));
};
