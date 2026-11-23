import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const execute = promisify(execFile);
const projectJobId = z.string().uuid();
let previous: Promise<void> = Promise.resolve();
const pending = new Map<string, Promise<void>>();

/**
 * Prepare local rack evidence without holding a project write transaction.
 * Serialize the memory-intensive full package reads and share concurrent requests for a job.
 * Projects without a qualifying package continue with the existing prepared-model matcher.
 */
export function prepareLocalRackIndex(project: string, job: string): Promise<void> {
  const args = [projectJobId.parse(project), projectJobId.parse(job)];
  const key = args.join('/');
  const running = pending.get(key);
  if (running) return running;
  const task = previous
    .then(async () => {
      try {
        await execute(
          process.execPath,
          [resolve('scripts/project-rack-model-index.mjs'), ...args, '--install'],
          { maxBuffer: 256 * 1024, windowsHide: true },
        );
      } catch {
        // The regular verifier can still resolve exact names. Never substitute a point for a missing proof.
        console.warn('Local instrument-rack model proof unavailable for project/job', project, job);
      }
    })
    .finally(() => {
      pending.delete(key);
    });
  previous = task.catch(() => {});
  pending.set(key, task);
  return task;
}
