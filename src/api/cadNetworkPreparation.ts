import { z } from 'zod';
import { getApiBaseUrl } from './http';
import { PreparationApiError } from './pathfinderPreparation';
import { pathFinderRequestDeadline } from './pathfinderRequestDeadline';

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const designsSchema = z.object({ designs: z.array(z.object({
  id: uuid, modelVersionId: uuid, activeModel: z.boolean(), status: z.string(),
})) });
const receiptSchema = z.object({
  artifactId: uuid, snapshotSha256: sha256, publishedCount: z.number().int().nonnegative(),
  revalidatedCount: z.number().int().nonnegative(), routeCount: z.number().int().nonnegative(), duplicate: z.boolean(),
});

/** Publish assigned CAD routes only against the exact explicitly prepared base. */
export async function prepareAssignedCadNetwork(projectId: string, token: string, modelVersionId: string,
  artifactId: string, snapshotSha256: string, signal?: AbortSignal) {
  if (![projectId, modelVersionId, artifactId].every(value => uuid.safeParse(value).success)
    || !sha256.safeParse(snapshotSha256).success || !token || token.length > 16384)
    throw new PreparationApiError('INVALID_CAD_NETWORK_REQUEST', 400, 'Refresh the current project network before adding its CAD routes.', 'refused');
  const deadline = pathFinderRequestDeadline(signal, 180_000,
    () => new PreparationApiError('CAD_NETWORK_TIMEOUT', null, 'Preparing the saved CAD routes timed out. Check the current network before trying again.'));
  const read = async (path: string, body?: unknown): Promise<unknown> => deadline.wait(async () => {
    const response = await fetch(`${getApiBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/cad-design${path}`, {
      method: body ? 'POST' : 'GET', signal: deadline.signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ code: z.string(), message: z.string() }).safeParse(value);
      throw new PreparationApiError(error.success ? error.data.code : 'CAD_NETWORK_FAILED', response.status,
        error.success ? error.data.message : 'The saved CAD routes could not be added to the current network.',
        response.status >= 400 && response.status < 500 ? 'refused' : 'unknown');
    }
    return value;
  });
  try {
    const designs = designsSchema.safeParse(await read('/designs'));
    if (!designs.success) throw new PreparationApiError('CAD_NETWORK_RESPONSE_INVALID', null, 'The active CAD design could not be verified. Refresh the project.');
    const matches = designs.data.designs.filter(design => design.activeModel && design.modelVersionId === modelVersionId && design.status === 'proposed');
    if (matches.length !== 1) throw new PreparationApiError('CAD_NETWORK_DESIGN_UNAVAILABLE', 409, 'The saved CAD routes do not belong to the current active model. Refresh the project.', 'refused');
    const receipt = receiptSchema.safeParse(await read(`/designs/${encodeURIComponent(matches[0].id)}/prepare-network`, {
      expectedArtifactId: artifactId, expectedSnapshotSha256: snapshotSha256,
    }));
    if (!receipt.success || receipt.data.artifactId !== artifactId || receipt.data.snapshotSha256 !== snapshotSha256)
      throw new PreparationApiError('CAD_NETWORK_RESPONSE_INVALID', null, 'The saved CAD routes could not be confirmed against the prepared network. Refresh its status.');
    return receipt.data;
  } finally { deadline.dispose(); }
}
