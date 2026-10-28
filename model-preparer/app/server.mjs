import { createPreparerService } from './service.mjs';
import { readConfiguration } from './config.mjs';
import { safeError } from './errors.mjs';

try {
  const config = readConfiguration();
  const service = config.wfcOrigin
    ? await (await import('./workspace-service.mjs')).createWorkspaceService({ config })
    : await createPreparerService({ configuration: config });
  await service.listen();
  process.stdout.write(JSON.stringify({ status: 'listening', mode: service.mode }) + '\n');
  let stopping = false;
  for (const event of ['SIGINT', 'SIGTERM']) process.on(event, async () => {
    if (stopping) return; stopping = true;
    try { await service.close(); process.exitCode = 0; }
    catch { process.exitCode = 1; }
  });
} catch (error) {
  process.stderr.write(JSON.stringify({ error: safeError(error) }) + '\n'); process.exitCode = 1;
}
