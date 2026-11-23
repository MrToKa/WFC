import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  endpointCurrentScopeSchema,
  type EndpointCurrentScope,
} from '../../shared/pathfinderEndpointBindings.js';

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const bounds = z
  .object({ minimum: vector, maximum: vector })
  .refine((box) => box.minimum.every((lo, axis) => lo <= box.maximum[axis]));
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const entry = z
  .object({
    tag: z.string().min(1),
    target: z.string().min(1),
    dbId: z.number().int().positive(),
    point: vector,
    bounds,
    rackBounds: bounds,
    modelName: z.string().min(1),
    rackName: z.string().min(1),
    rackDbId: z.number().int().positive(),
    visibilityScopeSha256: sha256,
    verifiedDocumentPair: z.boolean().optional(),
    alternatives: z
      .array(
        z.object({
          objectId: z.number().int().positive(),
          modelName: z.string(),
          hierarchy: z.array(z.string()),
          visible: z.boolean(),
          intersectsRack: z.boolean(),
          role: z.string(),
        }),
      )
      .max(16)
      .optional(),
  })
  .refine(
    (item) =>
      item.dbId !== item.rackDbId &&
      item.bounds.minimum.every(
        (lo, axis) =>
          lo <= item.rackBounds.maximum[axis] &&
          item.rackBounds.minimum[axis] <= item.bounds.maximum[axis],
      ),
  )
  .refine((item) =>
    item.point.every((coordinate, axis) => {
      const expected =
        axis === 2
          ? item.bounds.minimum[axis]
          : (item.bounds.minimum[axis] + item.bounds.maximum[axis]) / 2;
      return Math.abs(coordinate - expected) < 1e-7;
    }),
  );
const manifest = z.object({
  schemaVersion: z.literal('wfc.local-rack-model-evidence.v1'),
  projectId: z.string().uuid(),
  jobId: z.string().uuid(),
  current: endpointCurrentScopeSchema,
  visibilityScopeSha256: sha256,
  entries: z.array(entry).max(100000),
});
type Proof = z.infer<typeof entry>;
function pairKey(tag: string, target: string) {
  return JSON.stringify([tag.trim().toUpperCase(), target.trim().toUpperCase()]);
}

// Only the local server-side model verifier publishes manifests in this directory.
let cached:
  | { path: string; stamp: string; current: EndpointCurrentScope; byTag: Map<string, Proof | null> }
  | undefined;
export async function assistantLocalModelEvidence(
  _client: PoolClient,
  projectId: string,
  current: EndpointCurrentScope,
  tag: string,
  target: string,
  jobId: string,
) {
  const pid = z.string().uuid().parse(projectId);
  const job = z.string().uuid().parse(jobId);
  const model = endpointCurrentScopeSchema.parse(current);
  const path = join(
    process.env.PF_ROOT || '/var/lib/wfc/pathfinder',
    'assistant-model-evidence',
    pid,
    model.modelVersionId,
    job + '.json',
  );
  let meta;
  try {
    meta = await stat(path, { bigint: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  if (!meta.isFile() || meta.size > 64n * 1024n * 1024n)
    throw Error('Invalid local model evidence');
  const stamp = [meta.ino, meta.mtimeNs, meta.size].join('/');
  if (!cached || cached.path !== path || cached.stamp !== stamp) {
    const input = manifest.parse(JSON.parse(await readFile(path, 'utf8')));
    if (input.projectId !== pid || input.jobId !== job || !isDeepStrictEqual(input.current, model))
      return null;
    const byTag = new Map<string, Proof | null>();
    for (const item of input.entries) {
      if (item.visibilityScopeSha256 !== input.visibilityScopeSha256)
        throw Error('Inconsistent model visibility evidence');
      const id = pairKey(item.tag, item.target);
      byTag.set(id, byTag.has(id) ? null : item);
    }
    cached = { path, stamp, current: input.current, byTag };
  }
  if (!isDeepStrictEqual(cached.current, model)) return null;
  return cached.byTag.get(pairKey(tag, target)) ?? null;
}
