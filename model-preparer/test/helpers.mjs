import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelPreparer, createFakeProvider, createFakeCostProvider } from '../index.mjs';

export const packageModulePath = fileURLToPath(new URL('../../routings-model-package/index.mjs', import.meta.url));
export function fakeClock(initial = Date.now()) {
  let at = initial;
  return { now: () => at, advance: ms => { at += ms; }, sleep: async (ms, signal) => { if (signal?.aborted) throw signal.reason; at += ms; } };
}
export async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'routings-preparer-core-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const sourcePath = path.join(root, 'input', 'fixture.nwd');
  await mkdir(path.dirname(sourcePath));
  await writeFile(sourcePath, 'immutable NWD fixture bytes');
  const clock = options.clock || fakeClock();
  const provider = options.provider || createFakeProvider({ clock, ...options.providerOptions });
  const costProvider = options.costProvider || createFakeCostProvider({ clock, ...options.costOptions });
  const dataDirectory = path.join(root, 'data'), workDirectory = path.join(root, 'work');
  const core = await createModelPreparer({ dataDirectory, workDirectory, packageModulePath, provider, costProvider, clock, ...options.coreOptions });
  const spec = { sourcePath, namespace: { account: 'fixture-account', application: 'fixture-app' }, region: 'EMEA', destination: { bucket: 'fixture-bucket', objectKey: 'immutable.nwd' }, conversion: { format: 'svf', views: ['3d'], xAdsForce: false }, supportProfile: 'svf-local-7.130.0-v1', label: 'Fixture version', output: path.join(root, 'result.zip') };
  return { root, sourcePath, dataDirectory, workDirectory, clock, provider, costProvider, core, spec };
}
export function receipt(context) { return { objectId: context.objectId, bytes: context.source.bytes, sha256: context.source.sha256 }; }
export function manifest(context, status = 'not-found') { return { status, objectId: context.objectId, urn: context.urn, submissionIdentity: context.submissionIdentity, roots: status === 'success' ? [{ rootId: 'root-one', format: 'svf', supportProfile: context.supportProfile }] : [] }; }
export function mutations(provider) { return provider.calls.filter(call => ['createStorage', 'upload', 'submit'].includes(call.operation)); }
