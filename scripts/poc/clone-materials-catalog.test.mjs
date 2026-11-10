import test from 'node:test';
import assert from 'node:assert/strict';
import { assertContainerIdentity, assertTargetEnvironment, snapshotDigest, columns, TARGET } from './clone-materials-catalog.mjs';

const isolated = {
  DATABASE_URL: 'postgresql://wfc_poc:synthetic-test-only@postgres:5432/wfc_poc',
  WFC_CAD_DESIGN_ENABLED: 'true', WFC_CAD_ISOLATED_STACK: 'true',
  MINIO_ENDPOINT: 'minio', MINIO_PORT: '9000', MINIO_BUCKET_TEMPLATES: 'wfc-poc-template-files',
  MINIO_BUCKET_PROJECTS: 'wfc-poc-project-files', WFC_MODEL_BUCKET: 'wfc-poc-models',
};
test('writes require exact PoC container identity and environment', () => {
  assert.doesNotThrow(() => assertContainerIdentity({ name: '/' + TARGET, labels: {
    'com.docker.compose.project': 'wfc-aalborg-poc', 'com.docker.compose.service': 'api',
  } }, TARGET, 'wfc-aalborg-poc', 'api'));
  assert.throws(() => assertContainerIdentity({ name: '/wfc-app-backend-1', labels: {
    'com.docker.compose.project': 'wfc-aalborg-poc', 'com.docker.compose.service': 'api',
  } }, TARGET, 'wfc-aalborg-poc', 'api'));
  assert.doesNotThrow(() => assertTargetEnvironment(isolated));
  for (const [key, value] of Object.entries({ DATABASE_URL: 'postgresql://postgres:test@wfc_app:5432/postgres',
    WFC_CAD_DESIGN_ENABLED: 'false', WFC_CAD_ISOLATED_STACK: 'false', MINIO_ENDPOINT: 'wfc-minio',
    MINIO_PORT: '9001', MINIO_BUCKET_TEMPLATES: 'wfc-template-files', MINIO_BUCKET_PROJECTS: 'wfc-project-files',
    WFC_MODEL_BUCKET: 'wfc-models' })) assert.throws(() => assertTargetEnvironment({ ...isolated, [key]: value }));
});
test('snapshot identity binds business rows and image byte identities', () => {
  const snapshot = { tables: { material_trays: [{ id: 'test', tray_type: 'Straight SKU' }] },
    images: [{ id: 'image-id', bytes: 3, sha256: 'a'.repeat(64), base64: 'YWJj' }] };
  assert.equal(snapshotDigest(snapshot).length, 64);
  assert.equal(snapshotDigest(snapshot), snapshotDigest(structuredClone(snapshot)));
  const changedRow = structuredClone(snapshot); changedRow.tables.material_trays[0].tray_type = 'Different SKU';
  assert.notEqual(snapshotDigest(snapshot), snapshotDigest(changedRow));
  const changedImage = structuredClone(snapshot); changedImage.images[0].sha256 = 'b'.repeat(64);
  assert.notEqual(snapshotDigest(snapshot), snapshotDigest(changedImage));
});
test('clone whitelist contains no accounts, sessions or project records', () => {
  assert.deepEqual(Object.keys(columns), ['material_trays', 'material_load_curves', 'material_load_curve_points', 'template_files']);
  assert.ok(!Object.values(columns).flat().includes('uploaded_by'));
});
