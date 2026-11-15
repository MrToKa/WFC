// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertCadConfiguration, cadDesignEnabled, readCadConverterConfiguration } from './configuration.js';
import { assertCadPocIsolation } from './isolation.js';

const configured = { WFC_CAD_CONVERTER_URL: 'http://cad-converter:8090/convert', WFC_CAD_CONVERTER_TOKEN: 't'.repeat(40) };
describe('ordinary application CAD configuration', () => {
  it('enables CAD by default and retains an explicit off switch without requiring a converter', () => {
    expect(cadDesignEnabled({})).toBe(true);
    expect(() => assertCadConfiguration({ WFC_CAD_DESIGN_ENABLED: 'false' })).not.toThrow();
    expect(() => assertCadConfiguration({})).toThrow('WFC_CAD_CONVERTER_TOKEN');
    expect(() => cadDesignEnabled({ WFC_CAD_DESIGN_ENABLED: '0' })).toThrow();
  });
  it.each(['wfc', 'wfc_test', 'another_application_database'])('allows the existing %s database and normal storage buckets', database => {
    const env = { ...configured, DATABASE_URL: `postgresql://application:example@database.internal:5434/${database}`,
      MINIO_ENDPOINT: 'storage.internal', MINIO_PORT: '9000', MINIO_BUCKET_PROJECTS: 'wfc-project-files',
      MINIO_BUCKET_TEMPLATES: 'wfc-template-files', WFC_MODEL_BUCKET: 'wfc-models' };
    expect(() => assertCadConfiguration(env)).not.toThrow();
    expect(() => assertCadPocIsolation(env)).not.toThrow();
  });
  it('uses the canonical token and retains legacy converter compatibility', () => {
    expect(readCadConverterConfiguration(configured)).toEqual({ convertUrl: configured.WFC_CAD_CONVERTER_URL,
      assembleUrl: 'http://cad-converter:8090/assemble', token: configured.WFC_CAD_CONVERTER_TOKEN });
    expect(readCadConverterConfiguration({ WFC_CAD_CONVERTER_URL: configured.WFC_CAD_CONVERTER_URL, POC_CONVERTER_TOKEN: 'legacy'.repeat(8) }).token).toBe('legacy'.repeat(8));
    expect(readCadConverterConfiguration({ ...configured, POC_CONVERTER_TOKEN: 'legacy'.repeat(8) }).token).toBe(configured.WFC_CAD_CONVERTER_TOKEN);
    expect(() => readCadConverterConfiguration({ ...configured, WFC_CAD_CONVERTER_TOKEN: '', POC_CONVERTER_TOKEN: 'legacy'.repeat(8) })).toThrow();
  });
  it.each(['http://localhost:8090/convert', 'http://169.254.169.254/convert', 'http://cad-converter:8090/assemble',
    'http://user:pass@cad-converter:8090/convert', 'http://cad-converter:8090/convert?target=elsewhere',
    'http://cad-converter:8090/convert#fragment', 'http://cad-converter:8091/convert', 'file:///convert', 'not a URL'])
  ('rejects a destination outside the fixed private converter boundary: %s', endpoint => {
    expect(() => readCadConverterConfiguration({ ...configured, WFC_CAD_CONVERTER_URL: endpoint })).toThrow();
  });
  it.each(['short', ' '.repeat(40), 'a'.repeat(32) + '\r\nheader', 'x'.repeat(4097)])('rejects an invalid token without disclosing it', token => {
    expect(() => readCadConverterConfiguration({ ...configured, WFC_CAD_CONVERTER_TOKEN: token })).toThrow(/^WFC_CAD_CONVERTER_TOKEN must/);
  });
});
