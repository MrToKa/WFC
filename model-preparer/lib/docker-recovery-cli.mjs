import { captureStoppedContainerSnapshot, recoverStoppedContainer } from './docker-recovery.mjs';
import { parsePersistentJson } from './store.mjs';
import { canonical, fail } from './contracts.mjs';

const [action, mode, instanceId] = process.argv.slice(2);
try {
  if (action === 'snapshot' || action === 'snapshot-base64') {
    const snapshot = await captureStoppedContainerSnapshot({ dataDirectory: '/var/lib/preparer/data', workDirectory: '/var/lib/preparer/work', mode, instanceId });
    process.stdout.write((action === 'snapshot-base64' ? JSON.stringify({ snapshotBase64: Buffer.from(canonical(snapshot)).toString('base64') }) : canonical(snapshot)) + '\n');
  } else if (action === 'recover') {
    const chunks = []; let bytes = 0;
    for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 32 * 1024 ** 2) fail('PACKAGE_LIMIT_EXCEEDED'); chunks.push(chunk); }
    const input = parsePersistentJson(Buffer.concat(chunks, bytes));
    let snapshot;
    if (Object.keys(input).sort().join(',') === 'attestation,snapshot') snapshot = input.snapshot;
    else if (Object.keys(input).sort().join(',') === 'attestation,snapshotBase64' && typeof input.snapshotBase64 === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(input.snapshotBase64)) snapshot = parsePersistentJson(Buffer.from(input.snapshotBase64, 'base64'));
    else fail('CONFIGURATION_INVALID');
    const result = await recoverStoppedContainer({ dataDirectory: '/var/lib/preparer/data', workDirectory: '/var/lib/preparer/work', snapshot, attestation: input.attestation });
    process.stdout.write(canonical(result) + '\n');
  } else fail('CONFIGURATION_INVALID');
} catch (error) {
  process.stderr.write(JSON.stringify({ code: /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'RECOVERY_FAILED' }) + '\n');
  process.exitCode = 2;
}
