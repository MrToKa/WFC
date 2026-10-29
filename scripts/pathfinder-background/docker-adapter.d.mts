import type { Buffer } from 'node:buffer';
import type { Duplex } from 'node:stream';
import type { ProducerProfile } from './container-profile.mjs';
import type { ProducerAttachCallbacks, ProducerDockerAdapter } from './producer-process.mjs';
export const DOCKER_PRODUCER_STREAM_LIMITS: Readonly<{ frameBytes: number; chunkBytes: number; headerBytes: 8 }>;
export function createDockerStdioDemultiplexer(callbacks: ProducerAttachCallbacks): { push(bytes: Buffer): void; finish(): void };
export function createDockerAttachChannel(socket: Duplex, callbacks: ProducerAttachCallbacks, head?: Buffer): {
  readonly closed: boolean; readonly faultCode: string | null; write(bytes: Buffer): Promise<void>; close(): Promise<void>;
};
export function localDockerSocketPath(context: string): string;
export function assertDockerProducerUpgrade(response: { statusCode?: number; headers?: Record<string, string | string[] | undefined> }): true;
export function createDockerProducerAdapter(profile: ProducerProfile): Promise<ProducerDockerAdapter>;
