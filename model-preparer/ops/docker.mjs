import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOTS, MODES, UUID, fail, parseJson, run } from './common.mjs';

export const docker = (args, options) => run('docker', args, options);
const json = async (id, format, image = false) => parseJson(Buffer.from(await docker([...(image ? ['image'] : []), 'inspect', id, '--format', `{{json ${format}}}`])));
export async function containerFacts(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)) fail('INVALID_CONTAINER');
  const [labels, mounts, state, containerId, imageId, hostname, ports, policy, networkMode] = await Promise.all([
    json(id, '.Config.Labels'), json(id, '.Mounts'), json(id, '.State'), json(id, '.Id'), json(id, '.Image'), json(id, '.Config.Hostname'), json(id, '.HostConfig.PortBindings'), json(id, '.HostConfig.RestartPolicy'), json(id, '.HostConfig.NetworkMode'),
  ]);
  const project = labels?.['com.docker.compose.project'], service = labels?.['com.docker.compose.service'], mode = labels?.['routings.preparer.mode'];
  const ownFixture = /^preparer-ops-(?:fixture|restore)-[a-f0-9]{12}$/.test(project ?? '') && UUID.test(labels?.['routings.preparer.ops.owner'] ?? '');
  if (project !== 'routings-preparer' && !ownFixture || service !== 'preparer' || !MODES.includes(mode) || hostname !== 'routings-preparer'
    || !UUID.test(labels?.['routings.preparer.instance'] ?? '') || !/^sha256:[a-f0-9]{64}$/.test(imageId)) fail('FOREIGN_CONTAINER');
  const roots = {};
  for (const mount of mounts) {
    const role = Object.keys(ROOTS).find(role => ROOTS[role] === mount.Destination); if (!role || roots[role]) fail('UNKNOWN_MOUNT');
    if (['data', 'work', 'outputs'].includes(role) && (mount.Type !== 'volume' || !mount.RW) || !['data', 'work', 'outputs'].includes(role) && (mount.Type !== 'bind' || mount.RW)) fail('UNKNOWN_MOUNT');
    roots[role] = { role, virtualRoot: ROOTS[role], type: mount.Type, source: mount.Type === 'volume' ? mount.Name : mount.Source };
  }
  if (['data', 'work', 'outputs'].some(role => !roots[role]) || new Set(Object.values(roots).map(root => root.source)).size !== Object.keys(roots).length) fail('UNKNOWN_MOUNT');
  for (const root of Object.values(roots).filter(root => root.type === 'volume')) {
    const volumeLabels = parseJson(Buffer.from(await docker(['volume', 'inspect', root.source, '--format', '{{json .Labels}}'])));
    if (volumeLabels?.['com.docker.compose.project'] !== project) fail('FOREIGN_VOLUME');
  }
  return { id: containerId, project, service, mode, owner: labels['routings.preparer.ops.owner'] ?? null, instanceId: labels['routings.preparer.instance'], imageId, hostname, roots, ports, networkMode, restartPolicy: policy,
    running: state.Running, pid: state.Pid, exitCode: state.ExitCode, oomKilled: state.OOMKilled, startedAt: state.StartedAt, finishedAt: state.FinishedAt };
}
export function sameRoots(actual, expected) {
  const normalized = roots => Object.fromEntries(Object.entries(roots).map(([role, root]) => {
    let source = root.source;
    if (process.platform === 'win32' && root.type === 'bind' && /^[A-Za-z]:\\/.test(source)) source = `/run/desktop/mnt/host/${source[0].toLowerCase()}/${source.slice(3).replaceAll('\\', '/')}`;
    return [role, { ...root, source }];
  }));
  return JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort())
    && Object.entries(normalized(actual)).every(([role, root]) => Object.entries(root).every(([key, value]) => normalized(expected)[role]?.[key] === value));
}
export async function assertStoppedExclusive(facts) {
  const latest = await containerFacts(facts.id);
  if (latest.running || latest.pid !== 0 || latest.imageId !== facts.imageId || latest.instanceId !== facts.instanceId) fail('NOT_STOPPED');
  const volumes = new Set(Object.values(facts.roots).filter(root => root.type === 'volume').map(root => root.source));
  const running = (await docker(['ps', '--format', '{{.ID}}'])).trim().split(/\r?\n/).filter(Boolean);
  for (const id of running) { const mounts = await json(id, '.Mounts'); if (mounts.some(mount => mount.Type === 'volume' && volumes.has(mount.Name))) fail('SHARED_VOLUME_WRITER'); }
  return latest;
}
export async function imageFacts(id) {
  const [actual, os, architecture, size] = await Promise.all([json(id, '.Id', true), json(id, '.Os', true), json(id, '.Architecture', true), json(id, '.Size', true)]);
  // Only names leave Docker. Credential values are never inspected or printed.
  const names = (await docker(['image', 'inspect', id, '--format', '{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}'])).trim().split(/\r?\n/);
  if (names.some(name => /^(?:APS_|FORGE_|AUTODESK_|PREPARER_PRICE_PROOF_|PREPARER_PRICE_SIGNING_KEY_)/.test(name))) fail('IMAGE_PRIVATE_CONFIGURATION');
  if (actual !== id || os !== 'linux') fail('WRONG_IMAGE'); return { id: actual, os, architecture, size };
}
export async function checkPlatform(image) {
  const [os, arch] = (await docker(['info', '--format', '{{.OSType}}|{{.Architecture}}'])).trim().split('|');
  if (os !== image.os || ({ x86_64: 'amd64', aarch64: 'arm64' }[arch] ?? arch) !== image.architecture) fail('WRONG_PLATFORM');
}
export function mountArgs(roots, writable = false) {
  return Object.values(roots).flatMap(root => ['--mount', `type=${root.type},source=${root.source},target=${root.virtualRoot}${writable ? '' : ',readonly'}`]);
}
export async function helper({ image, operatorRoot, bundle, roots, action, writable = false, label }) {
  if (!UUID.test(label)) fail('INVALID_HELPER_OWNER'); const name = `preparer-ops-helper-${randomUUID()}`;
  const args = ['run', '--rm', '--pull', 'never', '--name', name, '--network', 'none', '--read-only', '--user', '0:0', '--cap-drop', 'ALL', '--cap-add', writable ? 'DAC_OVERRIDE' : 'DAC_READ_SEARCH', ...(writable ? ['--cap-add', 'CHOWN', '--cap-add', 'FOWNER'] : []), '--security-opt', 'no-new-privileges:true', '--label', `routings.preparer.ops.helper=${label}`,
    '--mount', `type=bind,source=${operatorRoot},target=/ops,readonly`, '--mount', `type=bind,source=${bundle},target=/bundle${action === 'capture' ? '' : ',readonly'}`,
    ...mountArgs(roots, writable), '--entrypoint', 'node', image, '/ops/container.mjs', action, '/bundle'];
  try { return parseJson(Buffer.from(await docker(args, { timeoutMs: 1_800_000 }))); }
  catch (error) {
    // Killing a timed-out Docker CLI alone does not terminate its container.
    // Stop/remove only this invocation's exact UUID name, image and owner.
    const ids = (await docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.ID}}'])).trim();
    if (ids) {
      const labels = await json(ids, '.Config.Labels'), actualImage = await json(ids, '.Image');
      if (labels?.['routings.preparer.ops.helper'] !== label || actualImage !== image) fail('FOREIGN_HELPER');
      await docker(['rm', '--force', ids]);
    }
    throw error;
  }
}
export async function requireFreePort(port) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) fail('INVALID_PORT');
  await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', () => { try { fail('PORT_OCCUPIED'); } catch (error) { reject(error); } }); server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve)); });
}
export async function readiness(containerId, requestedMode, { requireClosed = false, deadlineMs = 45_000 } = {}) {
  const code = `const h=await fetch('http://127.0.0.1:8080/health');const c=await fetch('http://127.0.0.1:8080/api/config');if(!h.ok||!c.ok)process.exit(1);const health=await h.json(),config=await c.json();process.stdout.write(JSON.stringify({status:health.status,mode:health.mode,requestedMode:health.requestedMode,providerMode:config.providerMode,startupCloudCalls:config.startupCloudCalls}));`;
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const result = parseJson(Buffer.from(await docker(['exec', containerId, 'node', '--input-type=module', '--eval', code], { timeoutMs: 8_000 })));
      if (result.status !== 'ok' || result.requestedMode !== requestedMode || result.startupCloudCalls !== 0 || requireClosed && (result.mode !== 'closed' || result.providerMode !== 'closed')) fail('STARTUP_CAPABILITY_UNSAFE');
      return result;
    } catch (error) { if (error.code !== 'COMMAND_FAILED' && error.code !== 'COMMAND_TIMEOUT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  fail('STARTUP_NOT_READY');
}
