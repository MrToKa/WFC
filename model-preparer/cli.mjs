import { pathToFileURL } from 'node:url';
import { createModelPreparer } from './index.mjs';
import { safeError } from './lib/contracts.mjs';

const HELP = `Model Preparer core — local explicit operations, Node.js 24

node cli.mjs list --data-dir ABS --work-dir ABS --package-module ABS/index.mjs
node cli.mjs read --job-id UUID --data-dir ABS --work-dir ABS --package-module ABS/index.mjs
node cli.mjs register --package ABS.zip --data-dir ABS --work-dir ABS --package-module ABS/index.mjs [--job-id UUID]

The CLI never uploads, submits, polls or downloads from a cloud provider.
The public API supports those explicit operations through factory-branded fakes.
No .env, credentials, online legacy state, service, UI or Docker operation is loaded.
`;
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(HELP); return 0; }
  const command = args[0], flags = {}, allowed = new Set(['--data-dir', '--work-dir', '--package-module', '--job-id', '--package']);
  if (!['list', 'read', 'register'].includes(command)) { process.stderr.write(HELP); return 2; }
  for (let n = 1; n < args.length; n += 2) {
    if (!allowed.has(args[n]) || Object.hasOwn(flags, args[n]) || !args[n + 1] || args[n + 1].startsWith('--')) { process.stderr.write('Invalid explicit arguments.\n'); return 2; }
    flags[args[n]] = args[n + 1];
  }
  if (!flags['--data-dir'] || !flags['--work-dir'] || !flags['--package-module'] || command === 'read' && !flags['--job-id'] || command === 'register' && !flags['--package'] || command !== 'register' && flags['--package'] || command === 'list' && flags['--job-id']) { process.stderr.write('Required explicit paths/identity are missing or inappropriate.\n'); return 2; }
  if (Number(process.versions.node.split('.')[0]) !== 24) { process.stderr.write('Node.js 24 is required.\n'); return 2; }
  try {
    const core = await createModelPreparer({ dataDirectory: flags['--data-dir'], workDirectory: flags['--work-dir'], packageModulePath: flags['--package-module'] });
    const result = command === 'list' ? await core.listJobs() : command === 'read' ? await core.readJob(flags['--job-id']) : await core.registerPackage({ packagePath: flags['--package'], ...(flags['--job-id'] ? { jobId: flags['--job-id'] } : {}) });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return 0;
  } catch (error) { const safe = safeError(error); process.stderr.write(JSON.stringify(safe) + '\n'); return safe.code === 'LOCAL_ABORTED' ? 130 : 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
