import path from 'node:path';
import { load, readSettings, ROOT, contained } from '../pathfinder-local/runtime-lib.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const SOURCE = Object.freeze({ runtime: 'pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600', owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46', project: 'wfc-pathfinder-local-0cba87606e9b', port: 5191, apiImage: 'sha256:dce12a1f5ab6311bbaf04defb7277ff0d50fee36e29e49d47234e5bf4ea405fe', webImage: 'sha256:561d51c3dd5ecb88459c17013890f9cd30089bb0760ccb9c5ff0ec3ade39f285', projectId: '1af0f807-7653-40ea-8391-7eea6c54e7d4', modelVersionId: 'a613151e-c370-45c5-80f3-42ae58603b9a', fingerprint: 'b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34' });
export const refuse = code => { throw Object.assign(Error(code), { code }); };
const requireThat = (ok, code) => { if (!ok) refuse(code); };
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const DATA_IMAGES = Object.freeze({ postgres: 'sha256:9a2e0383c38afd52cff14eeefe2b806fcde406b317002cd13ce513d309942751', minio: 'sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e' });
export function validateRecoveryProfile(state, { kind, owner, backupId } = {}) {
  requireThat(UUID.test(owner ?? '') && state.owner === owner, 'RECOVERY_OWNER');
  if (kind === 'source') requireThat(state.owner === SOURCE.owner && state.project === SOURCE.project && state.port === SOURCE.port && path.resolve(state.runtime) === path.join(ROOT, SOURCE.runtime), 'RECOVERY_SOURCE');
  else if (kind === 'target') requireThat(UUID.test(backupId ?? '') && state.owner !== SOURCE.owner && /^wfc-pathfinder-local-[a-f0-9]{12}$/.test(state.project ?? '') && state.project !== SOURCE.project && state.port === 5192 && contained(path.join(ROOT, 'pathfinder-engine/.scratch'), state.runtime) && /^copied-recovery-target-[a-f0-9-]{36}$/.test(path.basename(state.runtime)) && state.restore?.backupId === backupId && state.restore?.inventoriesEqual === true && state.restore?.jwtRotated === true && state.restore?.sessionsFenced === true, 'RECOVERY_TARGET');
  else refuse('RECOVERY_KIND');
  return state;
}
/** Read-only metadata binding. No lifecycle operation or application DB import. */
export async function bind(options) {
  const deadline = Date.now() + 60000, signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
  const command = async (args, json = true) => {
    requireThat(!signal.aborted && Date.now() < deadline, 'RECOVERY_BINDING_DEADLINE');
    let raw; try { raw = (await promisify(execFile)('docker', args, { windowsHide: true, timeout: Math.max(1, Math.min(15000, deadline - Date.now())), maxBuffer: 8 * 1024 ** 2, signal })).stdout; } catch { refuse('RECOVERY_DOCKER_METADATA_FAILED'); }
    try { return json ? JSON.parse(raw) : raw.trim(); } catch { refuse('RECOVERY_DOCKER_METADATA_INVALID'); }
  };
  const state = validateRecoveryProfile(await load(path.resolve(ROOT, options.runtime)), options);
  const context = await command(['context', 'inspect', '--format', '{{(index .Endpoints "docker").Host}}'], false);
  requireThat(context.startsWith('npipe:////./pipe/') || context.startsWith('unix://'), 'RECOVERY_LOCAL_DOCKER');
  const roles = ['api', 'web', 'postgres', 'minio', 'storage-ready'];
  const inspected = await command(['inspect', ...roles.map(role => state.project + '-' + role + '-1')]);
  const networks = await command(['network', 'inspect', state.project + '_backend', state.project + '_front']);
  const volumes = await command(['volume', 'inspect', ...['postgres', 'minio', 'staging', 'pathfinder'].map(role => state.project + '_' + role)]);
  const labelMatches = labels => labels?.['wfc.pathfinder.owner'] === state.owner && labels?.['wfc.pathfinder.project'] === state.project && labels?.['wfc.pathfinder.isolated'] === 'true' && labels?.['com.docker.compose.project'] === state.project;
  requireThat(Array.isArray(inspected) && inspected.length === 5 && Array.isArray(networks) && networks.length === 2 && Array.isArray(volumes) && volumes.length === 4, 'RECOVERY_RESOURCE_COUNT');
  for (const network of networks) {
    requireThat(['backend', 'front'].some(n => network.Name === state.project + '_' + n && network.Internal === (n === 'backend')) && labelMatches(network.Labels) && Object.keys(network.Containers ?? {}).every(id => inspected.some(c => c.Id === id)), 'RECOVERY_NETWORK_BINDING');
  }
  for (const volume of volumes) requireThat(['postgres', 'minio', 'staging', 'pathfinder'].some(n => volume.Name === state.project + '_' + n) && labelMatches(volume.Labels) && !Object.keys(volume.Options ?? {}).length, 'RECOVERY_VOLUME_BINDING');
  const expectedMounts = { api: [['staging', '/var/lib/wfc/model-imports'], ['pathfinder', '/var/lib/wfc/pathfinder']], web: [], postgres: [['postgres', '/var/lib/postgresql']], minio: [['minio', '/data']], 'storage-ready': [] };
  const settings = await readSettings(state), images = { api: SOURCE.apiImage, web: SOURCE.webImage, ...DATA_IMAGES, 'storage-ready': SOURCE.apiImage };
  for (const c of inspected) {
    const role = c.Config?.Labels?.['com.docker.compose.service'];
    requireThat(roles.includes(role) && c.Name === '/' + state.project + '-' + role + '-1' && labelMatches(c.Config.Labels) && c.Image === images[role] && (role === 'storage-ready' || c.State?.Running === true), 'RECOVERY_CONTAINER_BINDING');
    const expectedNetworks = role === 'web' ? ['backend', 'front'] : ['backend'];
    requireThat(Object.keys(c.NetworkSettings?.Networks ?? {}).sort().join() === expectedNetworks.map(n => state.project + '_' + n).sort().join() && expectedNetworks.every(n => c.NetworkSettings.Networks[state.project + '_' + n].NetworkID === networks.find(x => x.Name === state.project + '_' + n)?.Id), 'RECOVERY_CONTAINER_NETWORK');
    requireThat(c.Mounts?.length === expectedMounts[role].length && expectedMounts[role].every(([name, destination]) => c.Mounts.some(m => m.Type === 'volume' && m.Name === state.project + '_' + name && m.Destination === destination && m.RW === true)), 'RECOVERY_CONTAINER_MOUNTS');
    const ports = Object.values(c.HostConfig?.PortBindings ?? {}).flat();
    requireThat(role === 'web' ? ports.length === 1 && ports[0].HostIp === '127.0.0.1' && Number(ports[0].HostPort) === state.port : ports.length === 0, 'RECOVERY_CONTAINER_PORT');
    requireThat(!c.HostConfig?.Privileged && !c.HostConfig?.Devices?.length, 'RECOVERY_CONTAINER_PRIVILEGES');
    if (role === 'api') {
      const env = Object.fromEntries(c.Config.Env.map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
      requireThat(env.DATABASE_URL === 'postgresql://pf_local:' + settings.databasePassword + '@postgres:5432/wfc_pathfinder_local' && env.MINIO_ENDPOINT === 'minio' && env.MINIO_SECRET_KEY === settings.storagePassword && env.WFC_MODEL_BUCKET === 'pf-local-models' && env.PF_ROOT === '/var/lib/wfc/pathfinder' && env.PF_ENGINE_MODE === 'oneshot' && env.PF_ENGINE_DLL === '/opt/pathfinder/PathFinder.ModelRunner.dll', 'RECOVERY_ENDPOINT_BINDING');
    }
  }
  const resources = { containers: inspected.map(c => ({ role: c.Config.Labels['com.docker.compose.service'], id: c.Id, image: c.Image, name: c.Name.slice(1), running: c.State.Running, startedAt: c.State.StartedAt })), volumes: volumes.map(v => v.Name), networks: networks.map(n => ({ id: n.Id, name: n.Name })) };
  const api = resources.containers.find(r => r.role === 'api'), web = resources.containers.find(r => r.role === 'web'), pg = resources.containers.find(r => r.role === 'postgres'), minio = resources.containers.find(r => r.role === 'minio');
  const pgAddress = inspected.find(c => c.Id === pg.id).NetworkSettings.Networks[state.project + '_backend']?.IPAddress;
  requireThat(typeof pgAddress === 'string' && pgAddress.length > 0, 'RECOVERY_PG_ADDRESS');
  const after = await load(state.runtime); requireThat(after.owner === state.owner && after.envSha256 === state.envSha256 && !signal.aborted && Date.now() < deadline, 'RECOVERY_BINDING_CHANGED');
  return { state, resources, api, web, pg, minio, pgAddress, origin: 'http://127.0.0.1:' + state.port };
}
/** A restored source is also generically retire-able. Reject it explicitly. */
export function assertRetirementTarget(state, record) {
  validateRecoveryProfile(state, { kind: 'target', owner: record?.target?.owner, backupId: record?.backupId });
  requireThat(record?.source?.owner === SOURCE.owner && record.source.project === SOURCE.project && record.source.port === SOURCE.port && path.resolve(record.source.runtime) === path.join(ROOT, SOURCE.runtime), 'RECOVERY_RETIRE_SOURCE_RECORD');
  requireThat(state.owner !== record.source.owner && state.project !== record.source.project && state.port !== record.source.port && path.resolve(state.runtime) !== path.resolve(record.source.runtime), 'RECOVERY_RETIRE_SOURCE_REFUSED');
  requireThat(state.owner === record.target.owner && state.project === record.target.project && state.port === record.target.port && path.resolve(state.runtime) === path.resolve(record.target.runtime) && record.target.port === 5192 && record.target.verified === true, 'RECOVERY_RETIRE_TARGET_RECORD');
  return true;
}
