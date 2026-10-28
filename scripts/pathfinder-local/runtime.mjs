import { parseArgs } from 'node:util';
import * as runtime from './runtime-lib.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { runtime: { type: 'string' }, project: { type: 'string' }, port: { type: 'string' }, zip: { type: 'string' }, backup: { type: 'string' }, 'private-config': { type: 'string' } } });
const [action] = positionals;
try {
  let result;
  if (positionals.length !== 1) runtime.fail('PF_COMMAND_REQUIRED');
  if (action === 'init') { const state = await runtime.init(values); result = { status: 'PASS', runtime: state.runtime, project: state.project, origin: `http://127.0.0.1:${state.port}` }; }
  else if (action === 'verify-backup') { const verified = await runtime.verifyBackup(values.backup); result = { status: verified.status, directory: verified.directory, backupId: verified.manifest.backupId }; }
  else if (action === 'restore') result = await runtime.restore({ backup: values.backup, privateConfig: values['private-config'], runtime: values.runtime, port: values.port });
  else {
    const state = await runtime.load(values.runtime);
    if (['configuration', 'build', 'start', 'stop', 'info', 'bootstrap', 'retire'].includes(action)) result = await runtime[action](state);
    else if (action === 'import-model') result = await runtime.importModel(state, values.zip);
    else if (action === 'backup') { if (!values.backup || !values['private-config']) runtime.fail('PF_BACKUP_ARGUMENT_REQUIRED'); const verified = await runtime.backup(state, values.backup, values['private-config']); result = { status: verified.status, directory: verified.directory, backupId: verified.manifest.backupId }; }
    else runtime.fail('PF_COMMAND_INVALID');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(JSON.stringify({ status: 'FAIL', code: /^PF_[A-Z_]+$/.test(error.code ?? error.message) ? error.code ?? error.message : 'PF_RUNTIME_FAILED' })); process.exitCode = 1; }
