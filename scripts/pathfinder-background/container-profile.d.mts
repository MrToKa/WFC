import type { Buffer } from 'node:buffer';
export const PRODUCER_PROFILE_VERSION: 'wfc.pf.managed-producer-isolation.v1';
export const PRODUCER_LIMITS: Readonly<{
  memoryBytes: number; temporaryBytes: number; sharedMemoryBytes: number; pids: 256; nanoCpus: 2000000000;
  wallMilliseconds: 900000; startupMilliseconds: 45000; joinMilliseconds: 15000; controlMilliseconds: 5000;
  frameBytes: number; queuedMessages: 16; stderrBytes: number; user: '1000:1000';
}>;
export interface ProducerContainerConfig {
  Image: string; User: '1000:1000'; WorkingDir: string; Entrypoint: readonly string[]; Cmd: readonly string[];
  Env: readonly string[]; Labels: Readonly<Record<string, string>>; Tty: false; OpenStdin: true; StdinOnce: true;
  AttachStdin: true; AttachStdout: true; AttachStderr: true; StopTimeout: 5; ExposedPorts: Readonly<Record<string, never>>;
  HostConfig: Readonly<Record<string, unknown>>;
}
export interface ProducerProfile {
  readonly schemaVersion: typeof PRODUCER_PROFILE_VERSION;
  readonly owner: string; readonly project: string; readonly attemptId: string; readonly image: string;
  readonly name: string; readonly mode: 'probe' | 'run';
  readonly seccomp: Readonly<{ baselineSha256: string; effectiveSha256: string }>;
  readonly config: Readonly<ProducerContainerConfig>;
}
export function extendProducerSeccomp(defaultBytes: string | Buffer, expectedSha256: string): Readonly<{ baselineSha256: string; effectiveSha256: string; json: string }>;
export function createProducerProfile(input: {
  owner: string; project: string; attemptId: string; image: string; mode: 'probe' | 'run';
  defaultSeccompBytes: string | Buffer; defaultSeccompSha256: string;
}): ProducerProfile;
export function assertProducerProfile(profile: unknown): true;
export function assertProducerContainer(profile: ProducerProfile, actual: unknown): true;
