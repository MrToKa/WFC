import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  ENGINE_IDENTITY_VERSION, ENGINE_IDENTITY_POLICY_VERSIONS,
  engineIdentitySchema, engineIdentityBodySchema, engineIdentityCanonicalBody,
  type EngineIdentity,
  BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS, barrierEngineIdentityBodySchema, barrierEngineIdentitySchema,
  barrierEngineIdentityCanonicalBody, type BarrierEngineIdentity, type CalculationEngineIdentity,
} from '../../shared/pathfinderEngineIdentity.js';
import { PathFinderError } from './errors.js';

const MODULES = ['PathFinder.ModelRunner.dll', 'PathFinder.Model.dll', 'PathFinder.Core.dll', 'PathFinder.Adapter.dll'] as const;
const BARRIER_MODULES = [...MODULES, 'PathFinder.Barriers.dll', 'PathFinder.BarrierVerifier.dll'] as const;
export const BARRIER_IDENTITY_PROJECTION_LIMIT = 64;
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
type IdentityReaderConfig = {
  dllPath: () => string | undefined;
  projectionFiles: () => ProjectionFile[];
};
type IdentityReader<T> = { read(options?: { force?: boolean }): Promise<T> };
export function createCalculationEngineIdentityReader(config: IdentityReaderConfig & { barriers: true }): IdentityReader<BarrierEngineIdentity>;
// eslint-disable-next-line no-redeclare -- TypeScript overloads retain each identity version's exact return type.
export function createCalculationEngineIdentityReader(config: IdentityReaderConfig & { barriers?: false }): IdentityReader<EngineIdentity>;
// eslint-disable-next-line no-redeclare -- Implementation of the two typed overloads above.
export function createCalculationEngineIdentityReader(config: IdentityReaderConfig & { barriers?: boolean }): IdentityReader<CalculationEngineIdentity> {
  const modules = config.barriers ? BARRIER_MODULES : MODULES;
  let cached: { signature: string; value: CalculationEngineIdentity } | undefined;
  let pending: Promise<CalculationEngineIdentity> | undefined;
  async function read(force: boolean): Promise<CalculationEngineIdentity> {
    const dll = config.dllPath();
    if (!dll || !path.isAbsolute(dll) || path.basename(dll) !== MODULES[0]) return fail();
    const projection = config.projectionFiles();
    if (!projection.length || projection.length > (config.barriers ? BARRIER_IDENTITY_PROJECTION_LIMIT : 32) || new Set(projection.map(x => x.name)).size !== projection.length
      || projection.some(x => /^[A-Za-z0-9_./-]{1,200}$/.exec(x.name)?.[0] !== x.name)) return fail('CALCULATION_ENGINE_PROJECTION');
    const files = [
      ...modules.map(name => ({ name, filename: path.join(path.dirname(dll), name), maximum: maximumModuleBytes })),
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
      if (n < modules.length) hashes.push(hash(bytes));
      else derivation.update(files[n].name + '\n' + bytes.length + '\n').update(bytes).update('\n');
    }
    for (let n = 0; n < files.length; n++) if ((await identify(files[n].filename, files[n].maximum)).signature !== before[n].signature)
      return fail('CALCULATION_ENGINE_CHANGED');
    const common = { version: ENGINE_IDENTITY_VERSION,
      runnerSha256: hashes[0], modelModuleSha256: hashes[1], coreModuleSha256: hashes[2], adapterModuleSha256: hashes[3],
      derivationSha256: derivation.digest('hex') };
    const value = config.barriers ? (() => {
      const body = barrierEngineIdentityBodySchema.parse({ ...common, schemaVersion: 'wfc.pf.engine-identity.v2',
        barriersModuleSha256: hashes[4], barrierVerifierModuleSha256: hashes[5], policyVersions: BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS });
      return barrierEngineIdentitySchema.parse({ ...body, contentSha256: hash(barrierEngineIdentityCanonicalBody(body)) });
    })() : (() => {
      const body = engineIdentityBodySchema.parse({ ...common, schemaVersion: 'wfc.pf.engine-identity.v1', policyVersions: ENGINE_IDENTITY_POLICY_VERSIONS });
      return engineIdentitySchema.parse({ ...body, contentSha256: hash(engineIdentityCanonicalBody(body)) });
    })();
    Object.freeze(value.policyVersions); Object.freeze(value);
    cached = { signature, value };
    return value;
  }
  return {
    async read({ force = false }: { force?: boolean } = {}): Promise<CalculationEngineIdentity> {
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
    'automaticEndpointCandidates', 'matching', 'policyJson', 'directSecondaryStrategy', 'contracts', 'preparationUnionTask'];
  return [
    ...names.map(name => ({ name: './' + name + '.js', filename: fileURLToPath(new URL('./' + name + extension, import.meta.url)) })),
    { name: '../../shared/pathfinderEngineIdentity.js', filename: fileURLToPath(new URL('../../shared/pathfinderEngineIdentity' + extension, import.meta.url)) },
    { name: '../../shared/pathfinderLengthLedger.js', filename: fileURLToPath(new URL('../../shared/pathfinderLengthLedger' + extension, import.meta.url)) },
    { name: '../../shared/pathfinderDirectSecondary.js', filename: fileURLToPath(new URL('../../shared/pathfinderDirectSecondary' + extension, import.meta.url)) },
    ...['pathfinderPurposePolicy','pathfinderPreparation','pathfinderCapacity','pathfinderGeometryTrace','pathfinderEndpointBindings','preparationMerge'].map(name=>({name:'../../shared/'+name+'.js',filename:fileURLToPath(new URL('../../shared/'+name+extension,import.meta.url))})),
    ...['equipment-names.mjs','display-visibility.mjs','preparation-input.mjs','pathfinder.mjs','model-capture.mjs'].map(name=>({name:'../../viewer-runtime/'+name,filename:fileURLToPath(new URL('../../viewer-runtime/'+name,import.meta.url))})),
  ];
}
const configured = createCalculationEngineIdentityReader({
  dllPath: () => process.env.PF_ENGINE_DLL ?? process.env.PF_MODEL_RUNNER_DLL,
  projectionFiles: calculationProjectionFiles,
});

/** Resolve once per bulk admission/slice; never hash four DLLs for every cable. */
export const calculationEngineIdentity = (options?: { force?: boolean }) => configured.read(options);

/** Explicitly expanded closure for v8 only. Geometry and Support are compiled into
 * Model/Core; there are no invented separate module names in this identity. */
export function barrierCalculationProjectionFiles(): ProjectionFile[] {
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  return [...calculationProjectionFiles(),
    ...['barrierCalculationScope', 'barrierScope', 'barrierStorage', 'barrierStrategy', 'barrierCurrentness'].map(name => ({ name: './' + name + '.js', filename: fileURLToPath(new URL('./' + name + extension, import.meta.url)) })),
    ...['pathfinderBarriers', 'pathfinderBarrierAdmission', 'pathfinderBarrierDecisions', 'pathfinderBarrierRuntime'].map(name => ({
      name: '../../shared/' + name + '.js', filename: fileURLToPath(new URL('../../shared/' + name + extension, import.meta.url)) })),
  ];
}
const barrierConfigured = createCalculationEngineIdentityReader({ barriers: true,
  dllPath: () => process.env.PF_ENGINE_DLL ?? process.env.PF_MODEL_RUNNER_DLL, projectionFiles: barrierCalculationProjectionFiles });
export const barrierCalculationEngineIdentity = (options?: { force?: boolean }) => barrierConfigured.read(options);
