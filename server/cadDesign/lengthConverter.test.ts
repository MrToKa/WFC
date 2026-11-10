// @vitest-environment node
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ getObjectStream: vi.fn(), getProjectBucket: vi.fn(() => 'bucket') }));
vi.mock('../services/objectStorageService.js', () => storage);
import { convertStepToMesh } from './converter.js';
import { exportStepAssembly } from './stepAssemblyClient.js';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('WFC_CAD_CONVERTER_URL','http://cad-converter:8090/convert');
  vi.stubEnv('POC_CONVERTER_TOKEN','t'.repeat(40));
  vi.stubGlobal('fetch',fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const mesh = {
  schemaVersion: 1, units: 'mm', solidCount: 1, triangleCount: 1,
  positions: [0,0,0, 1,0,0, 0,1,0], normals: [0,0,1, 0,0,1, 0,0,1], indices: [0,1,2],
  boundsMm: { min: [0,0,0], max: [1,1,0] },
};
const meshResponse = () => {
  const bytes = JSON.stringify(mesh);
  return new Response(bytes, { headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(bytes)) } });
};

describe('isolated CAD converter length contracts', () => {
  it('passes a cut as a converter header and keeps source bytes intact', async () => {
    fetchMock.mockResolvedValue(meshResponse());
    const bytes = Buffer.from('original STEP');
    await convertStepToMesh(bytes, { lengthMm: 2500 });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('http://cad-converter:8090/convert');
    expect(request.headers['X-WFC-Cut-Length-Mm']).toBe('2500');
    expect(Buffer.from(request.body)).toEqual(bytes);
  });
  it('leaves original conversion requests without a cut header', async () => {
    fetchMock.mockResolvedValue(meshResponse());
    await convertStepToMesh(Buffer.from('original STEP'));
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-WFC-Cut-Length-Mm');
  });
  it.each([0, -1, 6001, NaN, Infinity])('rejects invalid cut %s before network access', async lengthMm => {
    await expect(convertStepToMesh(Buffer.from('original STEP'),{ lengthMm })).rejects.toThrow('Cut length');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('exports independent cut parameters per instance of the same pinned source', async () => {
    const source = Buffer.from('original STEP');
    storage.getObjectStream.mockImplementation(async () => Readable.from([source]));
    const output = 'ISO-10303-21;\n' + ' '.repeat(120);
    fetchMock.mockResolvedValue(new Response(output, { headers: { 'Content-Type': 'application/step', 'Content-Length': String(output.length) } }));
    const common = { original_filename: 'straight.step', source_object_key: 'immutable/source.step', x_mm: 0, y_mm: 0, z_mm: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
    await exportStepAssembly([{ ...common, cut_length_mm: 2500 }, { ...common, cut_length_mm: null }]);
    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://cad-converter:8090/assemble');
    const body = JSON.parse(Buffer.from(request.body).toString('utf8'));
    expect(body.parts[0].cutLengthMm).toBe(2500);
    expect(body.parts[1]).not.toHaveProperty('cutLengthMm');
    expect(body.parts[0].stepBase64).toBe(source.toString('base64'));
    expect(body.parts[1].stepBase64).toBe(source.toString('base64'));
    expect(storage.getObjectStream).toHaveBeenCalledWith('bucket','immutable/source.step');
  });
});
