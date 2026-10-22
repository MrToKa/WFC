import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { RUNTIME_FILES, SERVER_RUNTIME_FILES, validateRuntimeModuleClosure } from './module-closure.mjs';

test('the actual deployed first-party graph includes every transitive module', async () => {
  const source = new URL('../../viewer-runtime/', import.meta.url);
  const result = await validateRuntimeModuleClosure(RUNTIME_FILES, name => fs.readFile(new URL(name, source), 'utf8'));
  assert.ok(RUNTIME_FILES.includes('preparation-input.mjs'));
  assert.ok(RUNTIME_FILES.includes('display-visibility.mjs'));
  assert.ok(RUNTIME_FILES.includes('barrier-capture-errors.mjs'));
  for (const name of ['barrier-plan.mjs', 'barrier-multipart-protocol.mjs', 'barrier-multipart-transport.mjs', 'barrier-producer.mjs', 'barrier-packed-geometry.mjs', 'barrier-multipart-runtime.mjs']) {
    assert.ok(RUNTIME_FILES.includes(name));
    await assert.rejects(validateRuntimeModuleClosure(RUNTIME_FILES.filter(item => item !== name), module => fs.readFile(new URL(module, source), 'utf8')), /VIEWER_RUNTIME_MODULE_MISSING/);
  }
  assert.equal(result.moduleCount, RUNTIME_FILES.filter(name => name.endsWith('.mjs')).length);
  assert.ok(result.localImportCount > 10);
  await assert.rejects(validateRuntimeModuleClosure(RUNTIME_FILES.filter(name => name !== 'preparation-input.mjs'), name => fs.readFile(new URL(name, source), 'utf8')), /VIEWER_RUNTIME_MODULE_MISSING/);
  await assert.rejects(validateRuntimeModuleClosure(RUNTIME_FILES.filter(name => name !== 'display-visibility.mjs'), name => fs.readFile(new URL(name, source), 'utf8')), /VIEWER_RUNTIME_MODULE_MISSING/);
  await assert.rejects(validateRuntimeModuleClosure(RUNTIME_FILES.filter(name => name !== 'barrier-capture-errors.mjs'), name => fs.readFile(new URL(name, source), 'utf8')), /VIEWER_RUNTIME_MODULE_MISSING/);
});

test('the separately copied server contract graph includes the barrier error dependency', async () => {
  const source = new URL('../../viewer-runtime/', import.meta.url), read = name => fs.readFile(new URL(name, source), 'utf8');
  const result = await validateRuntimeModuleClosure(SERVER_RUNTIME_FILES, read);
  assert.equal(result.moduleCount, SERVER_RUNTIME_FILES.length);
  for (const name of ['barrier-plan.mjs', 'barrier-multipart-protocol.mjs']) {
    assert.ok(SERVER_RUNTIME_FILES.includes(name));
    await assert.rejects(validateRuntimeModuleClosure(SERVER_RUNTIME_FILES.filter(item => item !== name), read), /VIEWER_RUNTIME_MODULE_MISSING/);
  }
  await assert.rejects(validateRuntimeModuleClosure(SERVER_RUNTIME_FILES.filter(name => name !== 'barrier-capture-errors.mjs'), read), /VIEWER_RUNTIME_MODULE_MISSING/);
});

test('AST closure follows static imports, re-exports and literal dynamic imports without reading comments or strings as code', async () => {
  const sources = {
    'entry.mjs': `import './static.mjs'; export * from './exported.mjs'; export { value } from './named.mjs'; const next=()=>import('./dynamic.mjs'); const template=()=>import(\`./template.mjs\`); // import './not-a-module.mjs';\nconst text="import('./also-not-a-module.mjs')";`,
    'static.mjs': 'export const x=1;', 'exported.mjs': 'export const y=2;', 'named.mjs': 'export const value=3;', 'dynamic.mjs': 'export default 4;', 'template.mjs': 'export default 5;',
  };
  const read = async name => { assert.ok(Object.hasOwn(sources, name)); return sources[name]; };
  assert.deepEqual(await validateRuntimeModuleClosure(Object.keys(sources), read), { moduleCount: 6, localImportCount: 5 });
  for (const missing of ['static.mjs', 'exported.mjs', 'named.mjs', 'dynamic.mjs', 'template.mjs']) await assert.rejects(validateRuntimeModuleClosure(Object.keys(sources).filter(name => name !== missing), read), /VIEWER_RUNTIME_MODULE_MISSING/);
});

test('computed or external imports, path escapes and malformed modules refuse before deployment', async () => {
  for (const source of [`import(value);`, `import(\`./\${value}.mjs\`);`, `import 'https://example.invalid/external.mjs';`, `import 'bare-package';`, `import '../outside.mjs';`, `import './target.mjs?alternate';`, `export * from './%74arget.mjs';`]) await assert.rejects(validateRuntimeModuleClosure(['entry.mjs','target.mjs'], async name => name === 'entry.mjs' ? source : ''), /VIEWER_RUNTIME_(?:NON_LITERAL_IMPORT|UNSAFE_MODULE_IMPORT|MODULE_MISSING)/);
  await assert.rejects(validateRuntimeModuleClosure(['entry.mjs'], async () => 'import {'), /VIEWER_RUNTIME_MODULE_PARSE_FAILED/);
  await assert.rejects(validateRuntimeModuleClosure(['entry.mjs','entry.mjs'], async () => ''), /VIEWER_RUNTIME_INVALID_MODULE_INVENTORY/);
  await assert.rejects(validateRuntimeModuleClosure(['entry.mjs\n'], async () => ''), /VIEWER_RUNTIME_INVALID_MODULE_INVENTORY/);
});
