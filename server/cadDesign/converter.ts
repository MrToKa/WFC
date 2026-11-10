import { z } from 'zod';

const MAX_MESH_BYTES = 16 * 1024 * 1024;
const MAX_TRIANGLES = 20_000;
const coordinate = z.number().finite().min(-1e9).max(1e9);
const vector = z.tuple([coordinate, coordinate, coordinate]);
const geometrySchema = z.object({
  schemaVersion: z.literal(1),
  units: z.literal('mm'),
  solidCount: z.number().int().min(1).max(100),
  triangleCount: z.number().int().min(1).max(MAX_TRIANGLES),
  positions: z.array(coordinate).max(MAX_TRIANGLES * 9),
  normals: z.array(z.number().finite().min(-1).max(1)).max(MAX_TRIANGLES * 9),
  indices: z.array(z.number().int().nonnegative()).max(MAX_TRIANGLES * 3),
  boundsMm: z.object({ min: vector, max: vector }).strict(),
}).strict();

export type CadMesh = z.infer<typeof geometrySchema>;

export function parseConvertedMesh(payload: unknown): CadMesh {
  const parsed = geometrySchema.parse(payload);
  const vertexCount = parsed.positions.length / 3;
  if (parsed.positions.length !== parsed.normals.length ||
      parsed.positions.length !== parsed.triangleCount * 9 ||
      parsed.indices.length !== parsed.triangleCount * 3 ||
      parsed.indices.some((id, index) => id !== index || id >= vertexCount) ||
      parsed.boundsMm.min.some((v, i) => v > parsed.boundsMm.max[i])) {
    throw new Error('Converter returned invalid or inconsistent mesh geometry.');
  }
  return parsed;
}

export async function convertStepToMesh(source: Buffer): Promise<{ bytes: Buffer; mesh: CadMesh }> {
  const endpoint = process.env.WFC_CAD_CONVERTER_URL;
  const token = process.env.POC_CONVERTER_TOKEN;
  if (!endpoint || !token || token.length < 32) {
    throw new Error('The isolated CAD conversion service has not been configured.');
  }
  const parsedEndpoint = new URL(endpoint);
  if (parsedEndpoint.protocol !== 'http:' || parsedEndpoint.hostname !== 'cad-converter' ||
      parsedEndpoint.port !== '8090' || parsedEndpoint.pathname !== '/convert' ||
      parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash) {
    throw new Error('The CAD converter URL does not match the isolated PoC service.');
  }
  const result = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/step',
    },
    body: new Uint8Array(source),
    signal: AbortSignal.timeout(120_000),
    redirect: 'error',
  });
  if (!result.ok || result.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    void result.body?.cancel().catch(() => undefined);
    throw new Error('The STEP geometry converter rejected this file.');
  }
  const statedLength = Number(result.headers.get('content-length'));
  if (!Number.isSafeInteger(statedLength) || statedLength < 1 || statedLength > MAX_MESH_BYTES) {
    void result.body?.cancel().catch(() => undefined);
    throw new Error('The geometry converter returned an excessive payload.');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!result.body) throw new Error('The geometry converter returned no body.');
  const reader = result.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MESH_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('The geometry converter exceeded its output budget.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== statedLength) throw new Error('The geometry converter response was incomplete.');
  const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size);
  return { bytes, mesh: parseConvertedMesh(JSON.parse(bytes.toString('utf8')) as unknown) };
}
