import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProducerProfile, assertProducerContainer, extendProducerSeccomp, PRODUCER_LIMITS } from './container-profile.mjs';

const base = JSON.stringify({ defaultAction: 'SCMP_ACT_ERRNO', defaultErrnoRet: 1,
  archMap: [{ architecture: 'SCMP_ARCH_X86_64', subArchitectures: ['SCMP_ARCH_X86'] }],
  syscalls: [{ names: ['read', 'write', 'close'], action: 'SCMP_ACT_ALLOW', args: [] }] });
const sha = value => createHash('sha256').update(value).digest('hex');
export function profileFixture(overrides = {}) {
  return createProducerProfile({ owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46', project: 'wfc-pathfinder-local-0cba87606e9b',
    attemptId: '11223344-5566-4788-9900-aabbccddeeff', image: 'sha256:' + 'a'.repeat(64), mode: 'probe',
    defaultSeccompBytes: base, defaultSeccompSha256: sha(base), ...overrides });
}
export function inspectFixture(profile, running = false) {
  return { Id: 'b'.repeat(64), Name: '/' + profile.name, Image: profile.image,
    Config: structuredClone(profile.config), HostConfig: structuredClone(profile.config.HostConfig),
    Mounts: [], NetworkSettings: { Networks: { none: {} }, Ports: {} },
    State: { Running: running, Pid: running ? 17 : 0, Restarting: false, Paused: false } };
}

test('profile is a frozen exact network-none browser boundary without arbitrary mounts or credentials', () => {
  const value = profileFixture();
  assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.config.HostConfig), true);
  assert.equal(value.config.Image, 'sha256:' + 'a'.repeat(64));
  assert.equal(value.config.User, '1000:1000'); assert.equal(value.config.HostConfig.NetworkMode, 'none');
  assert.equal(value.config.HostConfig.ReadonlyRootfs, true); assert.equal(value.config.HostConfig.Init, true);
  assert.equal(value.config.HostConfig.CgroupnsMode, 'private');
  assert.deepEqual(value.config.HostConfig.CapDrop, ['ALL']); assert.deepEqual(value.config.HostConfig.CapAdd, []);
  assert.ok(value.config.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
  assert.equal(value.config.HostConfig.Memory, 8 * 1024 ** 3); assert.equal(value.config.HostConfig.MemorySwap, 8 * 1024 ** 3);
  assert.equal(value.config.HostConfig.ShmSize, 512 * 1024 ** 2); assert.equal(value.config.HostConfig.PidsLimit, 256);
  assert.equal(value.config.HostConfig.NanoCpus, 4_000_000_000); assert.equal(PRODUCER_LIMITS.wallMilliseconds, 900000);
  assert.deepEqual(value.config.HostConfig.Mounts, []); assert.deepEqual(value.config.HostConfig.PortBindings, {});
  assert.equal(value.config.HostConfig.LogConfig.Type, 'none');
  assert.equal(assertProducerContainer(value, inspectFixture(value)), true);
});

test('seccomp retains all original fields and adds only namespace calls and sandbox chroot', () => {
  const value = extendProducerSeccomp(base, sha(base)), parsed = JSON.parse(value.json), original = JSON.parse(base);
  assert.deepEqual(parsed.syscalls.slice(0, -1), original.syscalls);
  assert.deepEqual(parsed.syscalls.at(-1), { names: ['clone', 'setns', 'unshare', 'chroot'], action: 'SCMP_ACT_ALLOW', args: [] });
  const { syscalls: _a, ...rest } = parsed, { syscalls: _b, ...oldRest } = original;
  assert.deepEqual(rest, oldRest); assert.equal(value.effectiveSha256, sha(value.json));
  assert.throws(() => extendProducerSeccomp(base, '0'.repeat(64)), { code: 'PRODUCER_SECCOMP_BASE_INTEGRITY' });
});

test('rejects a default-allow/unconfined or listener profile even if its bytes were pinned', () => {
  for (const changed of [{ ...JSON.parse(base), defaultAction: 'SCMP_ACT_ALLOW' }, { ...JSON.parse(base), listenerPath: '/tmp/notify' }]) {
    const bytes = JSON.stringify(changed);
    assert.throws(() => extendProducerSeccomp(bytes, sha(bytes)), { code: 'PRODUCER_SECCOMP_BASE_INVALID' });
  }
});

for (const override of [{ image: 'mcr.microsoft.com/playwright:latest' }, { mode: 'shell' }, { project: 'wfc-app' },
  { owner: 'not-an-owner' }, { attemptId: '11223344-5566-4788-9900-aabbccddeeff\n' },
  { mounts: ['/var/run/docker.sock'] }, { args: ['--no-sandbox'] }, { env: ['TOKEN=private'] }]) {
  test('rejects an unpinned or arbitrary profile input: ' + Object.keys(override).join(','), () => {
    assert.throws(() => profileFixture(override), { code: 'PRODUCER_PROFILE_INVALID' });
  });
}

test('factory provenance cannot be replaced by a reserialized caller-supplied configuration', () => {
  const value = profileFixture();
  assert.throws(() => assertProducerContainer(structuredClone(value), inspectFixture(value)), { code: 'PRODUCER_PROFILE_FACTORY_REQUIRED' });
});

for (const mutate of [
  value => { value.Config.Labels['wfc.pathfinder.owner'] = '00000000-0000-4000-8000-000000000000'; },
  value => { value.Image = 'sha256:' + 'c'.repeat(64); },
  value => { value.HostConfig.NetworkMode = 'host'; },
  value => { value.NetworkSettings.Networks.backend = {}; },
  value => { value.HostConfig.Privileged = true; },
  value => { value.HostConfig.CapAdd = ['SYS_ADMIN']; },
  value => { value.HostConfig.SecurityOpt = ['seccomp=unconfined']; },
  value => { value.HostConfig.IpcMode = 'host'; },
  value => { value.HostConfig.PidMode = 'host'; },
  value => { value.HostConfig.CgroupnsMode = 'host'; },
  value => { value.HostConfig.ReadonlyRootfs = false; },
  value => { value.HostConfig.Memory += 1; },
  value => { value.HostConfig.PidsLimit += 1; },
  value => { value.HostConfig.PortBindings = { '80/tcp': [{ HostPort: '5191' }] }; },
  value => { value.Mounts = [{ Type: 'bind', Source: '/var/run/docker.sock', Destination: '/docker.sock' }]; },
  value => { value.Config.Env.push('DATABASE_URL=private'); },
  value => { value.Config.Env.push('HTTP_PROXY=http://proxy'); },
  value => { value.Config.Env.push('HOME=/host/profile'); },
]) {
  test('refuses changed actual ownership/isolation: ' + mutate.toString().slice(11, 85), () => {
    const profile = profileFixture(), value = inspectFixture(profile); mutate(value);
    assert.throws(() => assertProducerContainer(profile, value), error => /^PRODUCER_(OWNERSHIP|ISOLATION|ENVIRONMENT)_/.test(error.code));
  });
}

test('Docker JSON object key order is irrelevant while array content remains exact', () => {
  const profile = profileFixture(), value = inspectFixture(profile);
  value.HostConfig.Ulimits = [{ Hard: 4096, Soft: 4096, Name: 'nofile' }];
  value.HostConfig.SecurityOpt.reverse();
  assert.equal(assertProducerContainer(profile, value), true);
  value.HostConfig.Ulimits[0].Hard = 8192;
  assert.throws(() => assertProducerContainer(profile, value), { code: 'PRODUCER_ISOLATION_CHANGED' });
});

test('run mode has exactly one fixed managed entry point without caller-provided argv', () => {
  const profile = profileFixture({ mode: 'run' });
  assert.deepEqual(profile.config.Entrypoint, ['node']);
  assert.deepEqual(profile.config.Cmd, ['/opt/wfc-producer/managed-runner.mjs']);
});
