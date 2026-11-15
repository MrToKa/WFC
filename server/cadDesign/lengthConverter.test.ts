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
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].stepBase64).toBe(source.toString('base64'));
    expect(body.parts[0].sourceId).toBe(body.sources[0].id);
    expect(body.parts[1].sourceId).toBe(body.sources[0].id);
    expect(body.parts[0]).not.toHaveProperty('stepBase64');
    expect(storage.getObjectStream).toHaveBeenCalledOnce();
    expect(storage.getObjectStream).toHaveBeenCalledWith('bucket','immutable/source.step');
  });
  it('sends 128 placements of a representative-size repeated source once within the unchanged byte budget',async()=>{
    const source=Buffer.alloc(823845,32);source.write('ISO-10303-21;');
    storage.getObjectStream.mockImplementation(async()=>Readable.from([source]));
    const output='ISO-10303-21;\n'+' '.repeat(120);
    fetchMock.mockResolvedValue(new Response(output,{headers:{'Content-Type':'application/step','Content-Length':String(output.length)}}));
    const common={original_filename:'stock.step',source_object_key:'immutable/source.step',x_mm:0,y_mm:0,z_mm:0,qx:0,qy:0,qz:0,qw:1};
    await exportStepAssembly(Array.from({length:128},(_,index)=>({...common,x_mm:index*1000})));
    const body=JSON.parse(Buffer.from(fetchMock.mock.calls[0][1].body).toString('utf8'));
    expect(body.parts).toHaveLength(128);expect(body.sources).toHaveLength(1);expect(storage.getObjectStream).toHaveBeenCalledOnce();
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(2*1024*1024);
    expect(body.parts[127].positionMm).toEqual([127000,0,0]);
  });
  it('preserves distinct occurrence metadata and route identity while deduplicating geometry',async()=>{
    const source=Buffer.from('original STEP');storage.getObjectStream.mockImplementation(async()=>Readable.from([source]));
    const output='ISO-10303-21;\n'+' '.repeat(120);
    fetchMock.mockResolvedValue(new Response(output,{headers:{'Content-Type':'application/step','Content-Length':String(output.length)}}));
    const common={original_filename:'source.step',source_object_key:'immutable/source.step',x_mm:0,y_mm:0,z_mm:0,qx:0,qy:0,qz:0,qw:1};
    const route={id:'00000000-0000-4000-8000-000000000001',name:'BC182',purpose:'LV'};
    const metadata={instanceId:'00000000-0000-4000-8000-000000000002',name:'First section',actualLengthMm:1500,widthMm:300,heightMm:60,
      partNumber:'KL60.303F',manufacturer:'Niedax',purpose:'LV',componentKind:'straight',cadAssetId:null,cadRevision:null};
    const unknown={...metadata,instanceId:'00000000-0000-4000-8000-000000000003',name:'Second section',actualLengthMm:null,widthMm:null,heightMm:null,purpose:null};
    await exportStepAssembly([{...common,metadata,route},{...common,metadata:unknown,route:{id:null,name:'Unassigned components',purpose:null}}]);
    const body=JSON.parse(Buffer.from(fetchMock.mock.calls[0][1].body).toString('utf8'));
    expect(body.sources).toHaveLength(1);expect(storage.getObjectStream).toHaveBeenCalledOnce();
    expect(body.parts[0]).toMatchObject({name:metadata.name,metadata,route});
    expect(body.parts[1].metadata).toEqual(unknown);expect(body.parts[1].route).toEqual({id:null,name:'Unassigned components',purpose:null});
    expect(body.parts[0].sourceId).toBe(body.parts[1].sourceId);
  });
  it('rejects 129 assembly placements before source reads or network access',async()=>{
    const common={original_filename:'stock.step',source_object_key:'immutable/source.step',x_mm:0,y_mm:0,z_mm:0,qx:0,qy:0,qz:0,qw:1};
    await expect(exportStepAssembly(Array.from({length:129},()=>({...common})))).rejects.toThrow('1 to 128');
    expect(storage.getObjectStream).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();
  });
  it('deduplicates identical bytes across different pinned object keys',async()=>{
    const source=Buffer.from('ISO-10303-21;'+' '.repeat(100));storage.getObjectStream.mockImplementation(async()=>Readable.from([source]));
    const output='ISO-10303-21;'+' '.repeat(120);fetchMock.mockResolvedValue(new Response(output,{headers:{'Content-Type':'application/step','Content-Length':String(output.length)}}));
    const common={original_filename:'stock.step',source_object_key:'source-a',x_mm:0,y_mm:0,z_mm:0,qx:0,qy:0,qz:0,qw:1};
    await exportStepAssembly([common,{...common,source_object_key:'source-b'}]);
    const body=JSON.parse(Buffer.from(fetchMock.mock.calls[0][1].body).toString('utf8'));
    expect(body.sources).toHaveLength(1);expect(body.parts[0].sourceId).toBe(body.parts[1].sourceId);expect(storage.getObjectStream).toHaveBeenCalledTimes(2);
  });
  it('keeps the unique-source 8 MiB cap and rejects a mismatched pinned source hash',async()=>{
    const common={original_filename:'stock.step',source_object_key:'source-a',x_mm:0,y_mm:0,z_mm:0,qx:0,qy:0,qz:0,qw:1};
    storage.getObjectStream.mockImplementation(async(_bucket:string,key:string)=>Readable.from([Buffer.alloc(4*1024*1024+1,key==='source-a'?65:66)]));
    await expect(exportStepAssembly([common,{...common,source_object_key:'source-b'}])).rejects.toThrow('unique source');
    expect(fetchMock).not.toHaveBeenCalled();
    storage.getObjectStream.mockImplementation(async()=>Readable.from([Buffer.from('original bytes')]));
    await expect(exportStepAssembly([{...common,source_sha256:'0'.repeat(64)}])).rejects.toThrow('pinned STEP source hash');expect(fetchMock).not.toHaveBeenCalled();
  });
});
