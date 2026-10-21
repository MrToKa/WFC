import { writeFile } from 'node:fs/promises';
import { createModelPreparer, createClosedProvider } from '../index.mjs';
import { validateLocalPath, safeError } from '../lib/contracts.mjs';

const [packageModulePath, packagePath, dataDirectory, workDirectory, reportPath] = process.argv.slice(2);
try {
  for (const value of [packageModulePath, packagePath, dataDirectory, workDirectory, reportPath]) validateLocalPath(value);
  const startedAt = new Date().toISOString();
  const provider = createClosedProvider();
  const core = await createModelPreparer({ dataDirectory, workDirectory, packageModulePath, provider });
  const job = await core.registerPackage({ packagePath });
  const readback = await core.readJob(job.jobId);
  const list = await core.listJobs();
  const report = { reportSchemaVersion: 1, toolVersion: '1.0.0', nodeVersion: process.version, operation: 'register-existing-package-offline', status: 'PASS', startedAt, finishedAt: new Date().toISOString(), providerMode: provider.mode, providerCalls: provider.calls.length, realCloudActionsPerformed: false, packageModulePath, package: job.package, jobId: job.jobId, jobKind: readback.kind, jobState: readback.status, jobsListed: list.length, remoteSubmissionHistory: readback.submission, limitations: ['Local verified package registration does not invent capture or provider history.', 'No upload, conversion, SDK/browser or live cost verification.'] };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ status: 'PASS', jobId: job.jobId, providerCalls: provider.calls.length, reportPath }) + '\n');
} catch (error) { process.stderr.write(JSON.stringify(safeError(error)) + '\n'); process.exitCode = 1; }
