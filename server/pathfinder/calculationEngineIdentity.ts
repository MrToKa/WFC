import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  ENGINE_IDENTITY_VERSION, ENGINE_IDENTITY_POLICY_VERSIONS,
  engineIdentitySchema, engineIdentityBodySchema, engineIdentityCanonicalBody,
  type EngineIdentity,
} from '../../shared/pathfinderEngineIdentity.js';
import { PathFinderError } from './errors.js';

const MODULES = ['PathFinder.ModelRunner.dll', 'PathFinder.Model.dll', 'PathFinder.Core.dll', 'PathFinder.Adapter.dll'] as const;
const maximumModuleBytes = 64 * 1024 ** 2, maximumProjectionBytes = 4 * 1024 ** 2;
type ProjectionFile = { name: string; filename: string };
type FileIdentity = { filename: string; signature: string; bytes: number };
const fail = (code = 'CALCULATION_ENGINE_UNAVAILABLE'): never => {
  throw new PathFinderError(code, 503, 'The calculation implementation is unavailable or changed. Retain historical results and prepare a fresh calculation with the current implementation.');
};
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

/** Canonical regular modules only; file replacement must not redefine an admitted implementation. */
async function identify(filename: string, maximum: number): Promise<FileIdentity> {
  if (!path.isAbsolute(filename)) return fail('CALCULATION_ENGINE_PATH');
  const absolute = path.resolve(filename);
  for (let current = path.dirname(absolute); ; current = path.dirname(current)) {
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(await fs.realpath(current)) !== current) return fail('CALCULATION_ENGINE_PATH');
    if (path.dirname(current) === current) break;
  }
  const stat = await fs.lstat(absolute, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size < 1n || stat.size > BigInt(maximum) || path.resolve(await fs.realpath(absolute)) !== absolute)
    return fail('CALCULATION_ENGINE_PATH');
  return { filename: absolute, bytes: Number(stat.size), signature: [absolute, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode, stat.nlink].join(':') };
}

/** Factories allow isolated filesystem controls; production always uses the fixed allowlist below. */
export function createCalculationEngineIdentityReader(config: {
  dllPath: () => string | undefined;
  projectionFiles: () => ProjectionFile[];
}) {
  let cached: { signature: string; value: EngineIdentity } | undefined;
  let pending: Promise<EngineIdentity> | undefined;
  async function read(force: boolean): Promise<EngineIdentity> {
    const dll = config.dllPath();
    if (!dll || !path.isAbsolute(dll) || path.basename(dll) !== MODULES[0]) return fail();
    const projection = config.projectionFiles();
    if (!projection.length || projection.length > 32 || new Set(projection.map(x => x.name)).size !== projection.length
      || projection.some(x => /^[A-Za-z0-9_./-]{1,200}$/.exec(x.name)?.[0] !== x.name)) return fail('CALCULATION_ENGINE_PROJECTION');
    const files = [
      ...MODULES.map(name => ({ name, filename: path.join(path.dirname(dll), name), maximum: maximumModuleBytes })),
      ...projection.map(x => ({ ...x, maximum: maximumProjectionBytes })),
    ];
    const before: FileIdentity[] = [];
    for (const file of files) before.push(await identify(file.filename, file.maximum));
    const signature = before.map(x => x.signature).join('\n');
    if (!force && cached?.signature === signature) return cached.value;
    const hashes: string[] = [], derivation = createHash('sha256');
    for (let n = 0; n < files.length; n++) {
      const bytes = await fs.readFile(before[n].filename);
      if (bytes.length !== before[n].bytes) return fail('CALCULATION_ENGINE_CHANGED');
      if (n < MODULES.length) hashes.push(hash(bytes));
      else derivation.update(files[n].name + '\n' + bytes.length + '\n').update(bytes).update('\n');
    }
    for (let n = 0; n < files.length; n++) if ((await identify(files[n].filename, files[n].maximum)).signature !== before[n].signature)
      return fail('CALCULATION_ENGINE_CHANGED');
    const body = engineIdentityBodySchema.parse({
      schemaVersion: 'wfc.pf.engine-identity.v1', version: ENGINE_IDENTITY_VERSION,
      runnerSha256: hashes[0], modelModuleSha256: hashes[1], coreModuleSha256: hashes[2], adapterModuleSha256: hashes[3],
      derivationSha256: derivation.digest('hex'), policyVersions: ENGINE_IDENTITY_POLICY_VERSIONS,
    });
    const value = engineIdentitySchema.parse({ ...body, contentSha256: hash(engineIdentityCanonicalBody(body)) });
    Object.freeze(value.policyVersions); Object.freeze(value);
    cached = { signature, value };
    return value;
  }
  return {
    async read({ force = false }: { force?: boolean } = {}): Promise<EngineIdentity> {
      // A forced boundary cannot inherit a weaker in-flight cache lookup.
      if (force) { if (pending) await pending; return read(true); }
      if (pending) return pending;
      const current = read(false); pending = current;
      try { return await current; } finally { if (pending === current) pending = undefined; }
    },
  };
}

export function calculationProjectionFiles(): ProjectionFile[] {
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const names = ['calculationEngineIdentity', 'dependencies', 'dependencyBatch', 'settings', 'jobContracts',
    'endpointCalculationProvenance', 'comparisonCalculationProvenance', 'routingScope', 'worker', 'previews', 'engineSession', 'lengthLedger',
    'automaticEndpointCandidates', 'matching'];
  return [
    ...names.map(name => ({ name: './' + name + '.js', filename: fileURLToPath(new URL('./' + name + extension, import.meta.url)) })),
    { name: '../../shared/pathfinderEngineIdentity.js', filename: fileURLToPath(new URL('../../shared/pathfinderEngineIdentity' + extension, import.meta.url)) },
    { name: '../../shared/pathfinderLengthLedger.js', filename: fileURLToPath(new URL('../../shared/pathfinderLengthLedger' + extension, import.meta.url)) },
    ...['pathfinderPurposePolicy','pathfinderPreparation','pathfinderGeometryTrace','pathfinderEndpointBindings'].map(name=>({name:'../../shared/'+name+'.js',filename:fileURLToPath(new URL('../../shared/'+name+extension,import.meta.url))})),
    {name:'../../viewer-runtime/equipment-names.mjs',filename:fileURLToPath(new URL('../../viewer-runtime/equipment-names.mjs',import.meta.url))},
  ];
}
const configured = createCalculationEngineIdentityReader({
  dllPath: () => process.env.PF_ENGINE_DLL ?? process.env.PF_MODEL_RUNNER_DLL,
  projectionFiles: calculationProjectionFiles,
});

/** Resolve once per bulk admission/slice; never hash four DLLs for every cable. */
export const calculationEngineIdentity = (options?: { force?: boolean }) => configured.read(options);
