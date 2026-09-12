import { lockCompositionGraph } from './standardMaterialService.js';
import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import {
  beginVersionedMutation,
  readMutationHeaders,
  type MutationParameters,
} from './mutationService.js';

type ProjectMutation = Awaited<ReturnType<typeof beginVersionedMutation<Record<string, unknown>>>>;

export const beginProjectMaterialMutation = async (
  client: PoolClient,
  request: Request,
  response: Response,
): Promise<ProjectMutation | null> => {
  const parameters: MutationParameters = {
    actorId: request.userId ?? '',
    resourceType: 'project-materials',
    resourceId: request.params.projectId,
    ...readMutationHeaders(request),
    request: {
      method: request.method,
      path: request.route?.path,
      params: request.params,
      body: request.body,
      fileHash: request.file
        ? createHash('sha256').update(request.file.buffer).digest('hex')
        : undefined,
    },
  };
  const mutation = await beginVersionedMutation<Record<string, unknown>>(client, parameters);
  if (mutation.replay) {
    await client.query('COMMIT');
    response.json({ ...mutation.replay.value, mutationRevision: mutation.replay.revision });
    return null;
  }
  // Consistent order: project resource, then shared catalog graph.
  await lockCompositionGraph(client);
  if (parameters.expectedRevision === 0) {
    const baseline = await captureProjectMaterialState(client, parameters.resourceId);
    await client.query(
      'INSERT INTO mutation_history(resource_type,resource_id,revision,actor_id,snapshot) VALUES ($1,$2,0,$3,$4::jsonb) ON CONFLICT (resource_type,resource_id,revision) DO NOTHING',
      [
        parameters.resourceType,
        parameters.resourceId,
        parameters.actorId,
        JSON.stringify(baseline),
      ],
    );
  }
  return mutation;
};

export const captureProjectMaterialState = async (
  client: Pick<PoolClient, 'query'>,
  projectId: string,
) => {
  // A complete project material snapshot, rather than just the changed row,
  // keeps dependent type/default/cable states reconstructible together.
  const types = await client.query('SELECT * FROM cable_types WHERE project_id = $1 ORDER BY id', [
    projectId,
  ]);
  const defaults = await client.query(
    `SELECT dm.* FROM cable_type_default_materials dm
    JOIN cable_types ct ON ct.id = dm.cable_type_id WHERE ct.project_id = $1 ORDER BY dm.id`,
    [projectId],
  );
  const cables = await client.query('SELECT * FROM cables WHERE project_id = $1 ORDER BY id', [
    projectId,
  ]);
  const materials = await client.query(
    `SELECT cm.* FROM cable_materials cm
    JOIN cables c ON c.id = cm.cable_id WHERE c.project_id = $1 ORDER BY cm.id`,
    [projectId],
  );
  return {
    schemaVersion: 'project-materials.v1',
    cableTypes: types.rows,
    defaultMaterials: defaults.rows,
    cables: cables.rows,
    cableMaterials: materials.rows,
  };
};

export const completeProjectMaterialMutation = async (
  client: PoolClient,
  mutation: ProjectMutation,
  projectId: string,
  response: Response,
  value: Record<string, unknown>,
  status = 200,
): Promise<void> => {
  const result = await mutation.complete(
    value,
    await captureProjectMaterialState(client, projectId),
  );
  await client.query('COMMIT');
  response.status(status).json({ ...result.value, mutationRevision: result.revision });
};
