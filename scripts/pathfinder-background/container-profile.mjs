import { createHash } from 'node:crypto';

export const PRODUCER_PROFILE_VERSION = 'wfc.pf.managed-producer-isolation.v1';
export const PRODUCER_LIMITS = Object.freeze({
  memoryBytes: 8 * 1024 ** 3,
  temporaryBytes: 512 * 1024 ** 2,
  sharedMemoryBytes: 512 * 1024 ** 2,
  pids: 256,
  nanoCpus: 4_000_000_000,
  wallMilliseconds: 15 * 60_000,
  startupMilliseconds: 45_000,
  joinMilliseconds: 15_000,
  controlMilliseconds: 5_000,
  frameBytes: 96 * 1024,
  queuedMessages: 16,
  stderrBytes: 256 * 1024,
  user: '1000:1000',
});

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$(?![\s\S])/;
const IMAGE = /^sha256:[a-f0-9]{64}$(?![\s\S])/;
const HASH = /^[a-f0-9]{64}$(?![\s\S])/;
const PROJECT = /^wfc-pathfinder-local(?:-[a-f0-9]{12})?$(?![\s\S])/;
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const refuse = code => { throw Object.assign(new Error(code), { code }); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const clone = value => JSON.parse(JSON.stringify(value));
const profiles = new WeakSet();
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const empty = value => value === undefined || value === null || Array.isArray(value) && value.length === 0 || plain(value) && Object.keys(value).length === 0;

/** Preserve the pinned Docker default. Chromium's user namespace sandbox also
 * chroots to its safe empty proc directory. Permit that syscall without adding
 * a container capability; no unconfined/default-allow policy is built. */
export function extendProducerSeccomp(defaultBytes, expectedSha256) {
  if (!HASH.test(expectedSha256 ?? '')) refuse('PRODUCER_SECCOMP_BASE_HASH_REQUIRED');
  if (typeof defaultBytes !== 'string' && !Buffer.isBuffer(defaultBytes)) refuse('PRODUCER_SECCOMP_BASE_REQUIRED');
  const bytes = Buffer.from(defaultBytes);
  if (bytes.length < 64 || bytes.length > 512 * 1024 || hash(bytes) !== expectedSha256) refuse('PRODUCER_SECCOMP_BASE_INTEGRITY');
  let baseline;
  try { baseline = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { refuse('PRODUCER_SECCOMP_BASE_INVALID'); }
  if (!plain(baseline) || baseline.defaultAction !== 'SCMP_ACT_ERRNO' || !Array.isArray(baseline.syscalls) || !baseline.syscalls.length ||
      baseline.syscalls.some(rule => !plain(rule) || !Array.isArray(rule.names) || !rule.names.length ||
        rule.names.some(name => typeof name !== 'string' || !/^[a-z0-9_]+$(?![\s\S])/.test(name)) ||
        !['SCMP_ACT_ALLOW', 'SCMP_ACT_ERRNO', 'SCMP_ACT_KILL', 'SCMP_ACT_KILL_PROCESS', 'SCMP_ACT_KILL_THREAD', 'SCMP_ACT_TRAP'].includes(rule.action)) ||
      ['listenerPath', 'listenerMetadata'].some(key => Object.hasOwn(baseline, key))) refuse('PRODUCER_SECCOMP_BASE_INVALID');
  const policy = clone(baseline);
  policy.syscalls.push({ names: ['clone', 'setns', 'unshare', 'chroot'], action: 'SCMP_ACT_ALLOW', args: [] });
  const json = JSON.stringify(policy);
  return freeze({ baselineSha256: expectedSha256, effectiveSha256: hash(json), json });
}

/** No tag, host path, environment override, port, mount or network is accepted. */
export function createProducerProfile(input) {
  if (!plain(input) || Object.keys(input).some(key => !['owner', 'project', 'attemptId', 'image', 'mode', 'defaultSeccompBytes', 'defaultSeccompSha256'].includes(key)) ||
      !UUID.test(input.owner ?? '') || !UUID.test(input.attemptId ?? '') || !PROJECT.test(input.project ?? '') || !IMAGE.test(input.image ?? '') ||
      !['probe', 'run'].includes(input.mode)) refuse('PRODUCER_PROFILE_INVALID');
  const seccomp = extendProducerSeccomp(input.defaultSeccompBytes, input.defaultSeccompSha256);
  const name = `wfc-pf-producer-${input.owner.replaceAll('-', '').slice(0, 12)}-${input.attemptId.replaceAll('-', '').slice(0, 12)}`;
  const labels = {
    'wfc.pathfinder.owner': input.owner,
    'wfc.pathfinder.project': input.project,
    'wfc.pathfinder.isolated': 'true',
    'wfc.pathfinder.role': 'managed-producer',
    'wfc.pathfinder.producer.attempt': input.attemptId,
    'wfc.pathfinder.producer.profile': PRODUCER_PROFILE_VERSION,
    'wfc.pathfinder.producer.seccomp': seccomp.effectiveSha256,
  };
  const config = {
    Image: input.image,
    User: PRODUCER_LIMITS.user,
    WorkingDir: '/opt/wfc-producer',
    Entrypoint: ['node'],
    Cmd: [input.mode === 'probe' ? '/opt/wfc-producer/sandbox-probe.mjs' : '/opt/wfc-producer/managed-runner.mjs'],
    Env: ['NODE_ENV=production', 'NODE_OPTIONS=--max-old-space-size=512', 'HOME=/tmp/home', 'TMPDIR=/tmp',
      'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1', `WFC_PRODUCER_ATTEMPT_ID=${input.attemptId}`],
    Labels: labels,
    Tty: false,
    OpenStdin: true,
    StdinOnce: true,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    StopTimeout: 5,
    ExposedPorts: {},
    HostConfig: {
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      Privileged: false,
      CapDrop: ['ALL'],
      CapAdd: [],
      SecurityOpt: ['no-new-privileges:true', `seccomp=${seccomp.json}`],
      Memory: PRODUCER_LIMITS.memoryBytes,
      MemorySwap: PRODUCER_LIMITS.memoryBytes,
      PidsLimit: PRODUCER_LIMITS.pids,
      NanoCpus: PRODUCER_LIMITS.nanoCpus,
      ShmSize: PRODUCER_LIMITS.sharedMemoryBytes,
      IpcMode: 'private',
      PidMode: '',
      UTSMode: '',
      CgroupnsMode: 'private',
      Init: true,
      AutoRemove: false,
      PublishAllPorts: false,
      PortBindings: {},
      Binds: [],
      Mounts: [],
      Devices: [],
      DeviceRequests: [],
      Tmpfs: { '/tmp': 'rw,nosuid,nodev,noexec,size=536870912,mode=1777' },
      Ulimits: [{ Name: 'nofile', Soft: 4096, Hard: 4096 }],
      RestartPolicy: { Name: 'no', MaximumRetryCount: 0 },
      LogConfig: { Type: 'none', Config: {} },
    },
  };
  const result = freeze({ schemaVersion: PRODUCER_PROFILE_VERSION, owner: input.owner, project: input.project,
    attemptId: input.attemptId, image: input.image, name, mode: input.mode,
    seccomp: { baselineSha256: seccomp.baselineSha256, effectiveSha256: seccomp.effectiveSha256 }, config });
  profiles.add(result);
  return result;
}

export function assertProducerProfile(profile) {
  if (!profile || !profiles.has(profile)) refuse('PRODUCER_PROFILE_FACTORY_REQUIRED');
  return true;
}

/** Exact control-plane facts are checked before start, stop, join and removal.
 * Docker's harmless additional image environment is pinned by the image ID, but
 * credentials/proxies and changes to our own fixed environment are refused. */
export function assertProducerContainer(profile, actual) {
  assertProducerProfile(profile);
  if (!profile || profile.schemaVersion !== PRODUCER_PROFILE_VERSION || !actual || !/^[a-f0-9]{64}$/.test(actual.Id ?? '') ||
      actual.Name !== '/' + profile.name || actual.Image !== profile.image || actual.Config?.Image !== profile.image) refuse('PRODUCER_OWNERSHIP_LOST');
  const expected = profile.config, config = actual.Config ?? {}, host = actual.HostConfig ?? {};
  for (const [key, value] of Object.entries(expected.Labels)) if (config.Labels?.[key] !== value) refuse('PRODUCER_OWNERSHIP_LOST');
  for (const key of ['User', 'WorkingDir', 'Entrypoint', 'Cmd', 'Tty', 'OpenStdin', 'StdinOnce',
    'AttachStdin', 'AttachStdout', 'AttachStderr', 'StopTimeout']) {
    if (!equal(config[key], expected[key])) refuse('PRODUCER_CONFIGURATION_CHANGED');
  }
  if (!Array.isArray(config.Env)) refuse('PRODUCER_ENVIRONMENT_CHANGED');
  const environment = new Map();
  for (const entry of config.Env) {
    if (typeof entry !== 'string' || entry.indexOf('=') < 1) refuse('PRODUCER_ENVIRONMENT_CHANGED');
    const key = entry.slice(0, entry.indexOf('='));
    if (environment.has(key) || /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|PROXY|DATABASE|MINIO)/i.test(key)) refuse('PRODUCER_ENVIRONMENT_CHANGED');
    environment.set(key, entry.slice(entry.indexOf('=') + 1));
  }
  for (const entry of expected.Env) {
    const at = entry.indexOf('=');
    if (environment.get(entry.slice(0, at)) !== entry.slice(at + 1)) refuse('PRODUCER_ENVIRONMENT_CHANGED');
  }
  for (const key of ['NetworkMode', 'ReadonlyRootfs', 'Privileged', 'Memory', 'MemorySwap', 'PidsLimit', 'NanoCpus',
    'ShmSize', 'IpcMode', 'PidMode', 'UTSMode', 'CgroupnsMode', 'Init', 'AutoRemove', 'PublishAllPorts']) {
    if (!equal(host[key], expected.HostConfig[key])) refuse('PRODUCER_ISOLATION_CHANGED');
  }
  for (const key of ['SecurityOpt', 'CapDrop']) {
    if (!Array.isArray(host[key]) || !equal([...host[key]].sort(), [...expected.HostConfig[key]].sort())) refuse('PRODUCER_ISOLATION_CHANGED');
  }
  for (const key of ['Tmpfs', 'RestartPolicy', 'Ulimits', 'LogConfig']) {
    if (!equal(host[key], expected.HostConfig[key])) refuse('PRODUCER_ISOLATION_CHANGED');
  }
  for (const key of ['CapAdd', 'PortBindings', 'Binds', 'Mounts', 'Devices', 'DeviceRequests', 'ExtraHosts', 'Links', 'VolumesFrom', 'Sysctls']) {
    if (!empty(host[key])) refuse('PRODUCER_ISOLATION_CHANGED');
  }
  if (!empty(actual.Mounts) || !empty(config.Volumes) || !empty(config.ExposedPorts) || !empty(actual.NetworkSettings?.Ports) ||
      host.CgroupnsMode === 'host' || host.UsernsMode === 'host' || host.CgroupParent) refuse('PRODUCER_ISOLATION_CHANGED');
  const networks = Object.keys(actual.NetworkSettings?.Networks ?? {});
  if (networks.some(name => name !== 'none')) refuse('PRODUCER_ISOLATION_CHANGED');
  return true;
}
