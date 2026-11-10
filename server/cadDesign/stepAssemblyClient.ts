import { getObjectStream, getProjectBucket } from '../services/objectStorageService.js';

type CadPlacement = {
  original_filename: string;
  source_object_key: string;
  x_mm: number; y_mm: number; z_mm: number;
  qx: number; qy: number; qz: number; qw: number;
};
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

async function readBoundedSource(key: string): Promise<Buffer> {
  const source = await getObjectStream(getProjectBucket(), key);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += part.byteLength;
    if (size > MAX_INPUT_BYTES) {
      source.destroy();
      throw new Error('STEP source exceeds assembly limit.');
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks, size);
}

export async function exportStepAssembly(parts: CadPlacement[]): Promise<Buffer> {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 32) {
    throw new Error('A STEP assembly must contain 1 to 32 placed components.');
  }
  const token = process.env.POC_CONVERTER_TOKEN;
  const rawUrl = process.env.WFC_CAD_CONVERTER_URL;
  if (!token || token.length < 32 || !rawUrl) throw new Error('CAD converter is not configured.');
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' || parsed.hostname !== 'cad-converter' ||
      parsed.port !== '8090' || parsed.pathname !== '/convert' ||
      parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Invalid isolated CAD converter endpoint.');
  }
  const requestParts: Array<{
    name: string; stepBase64: string; positionMm: [number,number,number]; rotation: [number,number,number,number];
  }> = [];
  let total = 0;
  for (const part of parts) {
    const bytes = await readBoundedSource(part.source_object_key);
    total += bytes.length;
    if (total > MAX_INPUT_BYTES) throw new Error('The STEP assembly source exceeds its limit.');
    requestParts.push({
      name: part.original_filename.slice(0, 120),
      stepBase64: bytes.toString('base64'),
      positionMm: [part.x_mm, part.y_mm, part.z_mm],
      rotation: [part.qx, part.qy, part.qz, part.qw],
    });
  }
  const payload = Buffer.from(JSON.stringify({ parts: requestParts }), 'utf8');
  if (payload.byteLength > 12 * 1024 * 1024) throw new Error('The STEP assembly request is too large.');
  const result = await fetch(new URL('/assemble', parsed), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: new Uint8Array(payload),
    signal: AbortSignal.timeout(180_000),
    redirect: 'error',
  });
  if (!result.ok || result.headers.get('content-type')?.split(';')[0] !== 'application/step') {
    void result.body?.cancel().catch(() => undefined);
    throw new Error('The CAD kernel rejected the requested STEP assembly.');
  }
  const expected = Number(result.headers.get('content-length'));
  if (!Number.isSafeInteger(expected) || expected < 100 || expected > MAX_OUTPUT_BYTES || !result.body) {
    void result.body?.cancel().catch(() => undefined);
    throw new Error('The CAD kernel output is missing or too large.');
  }
  const reader = result.body.getReader();
  const chunks: Uint8Array[] = []; let totalSize = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      totalSize += value.byteLength;
      if (totalSize > MAX_OUTPUT_BYTES) throw new Error('STEP output exceeded limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  if (totalSize !== expected) throw new Error('The STEP assembly response was incomplete.');
  const output = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), totalSize);
  if (!output.subarray(0, 128).toString('ascii').trimStart().startsWith('ISO-10303-21;')) {
    throw new Error('The converter did not return a STEP Part-21 file.');
  }
  return output;
}
