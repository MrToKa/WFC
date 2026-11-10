// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertCadPocIsolation } from './isolation.js';

const isolated = {
  WFC_CAD_DESIGN_ENABLED: 'true', WFC_CAD_ISOLATED_STACK: 'true',
  DATABASE_URL: 'postgresql://wfc_poc:test@postgres:5432/wfc_poc',
  MINIO_ENDPOINT: 'minio', MINIO_PORT: '9000',
  MINIO_BUCKET_PROJECTS: 'wfc-poc-project-files',
  MINIO_BUCKET_TEMPLATES: 'wfc-poc-template-files', WFC_MODEL_BUCKET: 'wfc-poc-models',
};
describe('CAD PoC startup isolation', () => {
  it('leaves ordinary WFC startup unchanged while CAD is disabled', () => {
    expect(() => assertCadPocIsolation({})).not.toThrow();
  });
  it('accepts only the dedicated compose storage profile', () => {
    expect(() => assertCadPocIsolation(isolated)).not.toThrow();
  });
  it.each([
    ['DATABASE_URL', 'postgresql://wfc_poc:test@postgres:5432/wfc'],
    ['DATABASE_URL', 'postgresql://wfc_poc:test@127.0.0.1:5434/wfc_poc'],
    ['DATABASE_URL', 'postgresql://wfc_poc:test@postgres:5432/%77fc_poc'],
    ['MINIO_BUCKET_PROJECTS', 'wfc-project-files'],
    ['MINIO_BUCKET_TEMPLATES', 'wfc-template-files'],
    ['WFC_MODEL_BUCKET', 'wfc-models'],
    ['MINIO_ENDPOINT', 'localhost'], ['WFC_CAD_ISOLATED_STACK', 'false'],
  ])('refuses unsafe %s before initialization', (name, value) => {
    expect(() => assertCadPocIsolation({ ...isolated, [name]: value })).toThrow();
  });
});
