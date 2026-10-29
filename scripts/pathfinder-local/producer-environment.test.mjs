import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCER_ENVIRONMENT_KEYS, assertProducerEnvironment } from './producer-environment.mjs';

const producer = () => ({ key: 'a'.repeat(64), owner: 'da800000-0000-4000-8000-000000000001', project: 'wfc-pathfinder-local-abcdef123456',
  image: 'sha256:' + 'b'.repeat(64), runtimeInventorySha256: 'c'.repeat(64), expectedSha256: 'd'.repeat(64), qualifyProject: 'da800000-0000-4000-8000-000000000002' });
const fields = ['key', 'owner', 'project', 'image', 'runtimeInventorySha256', 'expectedSha256', 'qualifyProject'];
const environment = p => Object.fromEntries(PRODUCER_ENVIRONMENT_KEYS.map((key, index) => [key, p?.[fields[index]] ?? '']));
const asArray = env => Object.entries(env).map(([key, value]) => key + '=' + value);
for (const kind of ['compose-object', 'container-array']) {
  const input = value => kind === 'compose-object' ? value : asArray(value);
  test(kind + ' accepts only the exact configured seven producer values and emits no secrets', () => {
    const p = producer(), actual = { ...environment(p), NODE_ENV: 'production', PF_ROOT: '/var/lib/wfc/pathfinder' };
    const result = assertProducerEnvironment(input(actual), p);
    assert.deepEqual(result, { status: 'PASS', configured: true, variablesChecked: 7 }); assert.ok(Object.isFrozen(result));
    assert.ok(!JSON.stringify(result).includes(p.key));
  });
  test(kind + ' requires seven explicit blanks for an unconfigured restored installation', () => {
    assert.deepEqual(assertProducerEnvironment(input(environment()), undefined), { status: 'PASS', configured: false, variablesChecked: 7 });
    assert.deepEqual(assertProducerEnvironment(input(environment()), null), { status: 'PASS', configured: false, variablesChecked: 7 });
    assert.throws(() => assertProducerEnvironment(input(environment(producer())), undefined), { code: 'PF_PRODUCER_ENVIRONMENT_CHANGED' });
  });
  test(kind + ' accepts omitted optional qualification settings only as explicit blank variables', () => {
    const p = producer(); delete p.expectedSha256; delete p.qualifyProject;
    assert.equal(assertProducerEnvironment(input(environment(p)), p).configured, true);
  });
  for (const key of PRODUCER_ENVIRONMENT_KEYS) {
    test(kind + ' refuses a changed or ambient override of ' + key, () => {
      const p = producer(), actual = environment(p); actual[key] = 'changed-private-value';
      assert.throws(() => assertProducerEnvironment(input(actual), p), error => error.code === 'PF_PRODUCER_ENVIRONMENT_CHANGED' &&
        error.message === 'PF_PRODUCER_ENVIRONMENT_CHANGED' && !error.message.includes(p.key) && !error.message.includes(actual[key]));
      const disabled = environment(); disabled[key] = environment(p)[key];
      assert.throws(() => assertProducerEnvironment(input(disabled)), { code: 'PF_PRODUCER_ENVIRONMENT_CHANGED' });
    });
    test(kind + ' refuses missing ' + key + ' even when unconfigured', () => {
      const actual = environment(); delete actual[key];
      assert.throws(() => assertProducerEnvironment(input(actual)), { code: 'PF_PRODUCER_ENVIRONMENT_CHANGED' });
    });
  }
  test(kind + ' refuses unrecognized producer configuration variables, including empty ones', () => {
    for (const key of ['PF_PRODUCER', 'PF_PRODUCER_ARBITRARY_URL', 'PF_PRODUCER_CONTROL_KEY_OLD']) {
      assert.throws(() => assertProducerEnvironment(input({ ...environment(), [key]: '' })), { code: 'PF_PRODUCER_ENVIRONMENT_CHANGED' });
    }
  });
}
test('actual container arrays cannot conceal duplicate producer keys by last-wins conversion', () => {
  const values = asArray(environment());
  for (const extra of ['PF_PRODUCER_CONTROL_KEY=', 'PF_PRODUCER_CONTROL_KEY=' + producer().key]) {
    assert.throws(() => assertProducerEnvironment([...values, extra]), { code: 'PF_PRODUCER_ENVIRONMENT_CHANGED' });
  }
});
test('producer settings reject unknown fields and malformed configured identities without printing values', () => {
  for (const p of [{ ...producer(), arbitraryUrl: 'https://invalid.example' }, { ...producer(), key: 'bad' }, { ...producer(), owner: 'bad' },
    { ...producer(), project: 'wfc-app' }, { ...producer(), image: 'latest' }, { ...producer(), runtimeInventorySha256: 'bad' },
    { ...producer(), expectedSha256: '' }, { ...producer(), qualifyProject: 'bad' }]) {
    assert.throws(() => assertProducerEnvironment(environment(p), p), { code: 'PF_PRODUCER_CONFIG_INVALID' });
  }
});
test('environment input limits and malformed values fail closed', () => {
  for (const value of [null, undefined, 'PF_PRODUCER_CONTROL_KEY=', [], ['missing-equals'], [...asArray(environment()), 123],
    [...asArray(environment()), 'LARGE=' + 'x'.repeat(16384)], Array.from({ length: 1025 }, () => 'A=B'),
    { ...environment(), PF_PRODUCER_CONTROL_KEY: false }, { ...environment(), PF_PRODUCER_CONTROL_KEY: null }]) {
    assert.throws(() => assertProducerEnvironment(value), { code: 'PF_PRODUCER_ENVIRONMENT_CHANGED' });
  }
});
