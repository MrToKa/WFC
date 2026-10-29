import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJobControlTarget } from './job-controls.mjs';
const target = () => ({
  port: 5191,
  project: 'wfc-pathfinder-local-123456abcdef',
  owner: '11111111-1111-4111-8111-111111111111',
  restore: { inventoriesEqual: true },
  status: 'running',
  syntheticDemo: {
    projectId: '22222222-2222-4222-8222-222222222222',
    actorId: '33333333-3333-4333-8333-333333333333',
  },
});
test('accepts only an extra verified restored synthetic target', () =>
  assert.doesNotThrow(() => validateJobControlTarget(target())));
for (const [name, mutate] of [
  [
    'source5190',
    (v) => {
      v.port = 5190;
      v.project = 'wfc-pathfinder-local';
    },
  ],
  [
    'unverified restore',
    (v) => {
      v.restore.inventoriesEqual = false;
    },
  ],
  [
    'copied real project',
    (v) => {
      v.syntheticDemo.projectId = '105913f0-7ee4-45f2-bfd8-2c01f9be9f2a';
    },
  ],
  [
    'not running',
    (v) => {
      v.status = 'built';
    },
  ],
  [
    'invalid owner',
    (v) => {
      v.owner = 'foreign';
    },
  ],
])
  test('refuses ' + name + ' before any operation', () => {
    const value = target();
    mutate(value);
    assert.throws(() => validateJobControlTarget(value));
  });
