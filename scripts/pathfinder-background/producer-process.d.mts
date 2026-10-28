import type { Buffer } from 'node:buffer';
import type { ProducerProfile, ProducerContainerConfig } from './container-profile.mjs';
export const PRODUCER_WIRE_VERSION: 'wfc.pf.producer-wire.v1';
export type ProducerMessageType = 'ready' | 'start' | 'request' | 'response' | 'progress' | 'done' | 'error' | 'cancel' | 'close';
export interface ProducerMessage {
  schemaVersion: typeof PRODUCER_WIRE_VERSION; attemptId: string; sequence: number;
  type: ProducerMessageType; requestId: string | null; payload: unknown;
}
export interface ProducerAttachCallbacks {
  stdout(bytes: Buffer): void; stderr(bytes: Buffer): void; closed(): void;
}
export interface ProducerDockerAdapter {
  create(name: string, config: Readonly<ProducerContainerConfig>): Promise<{ Id: string }>;
  start(id: string): Promise<void>;
  attach(id: string, callbacks: ProducerAttachCallbacks): Promise<void>;
  writeStdin(id: string, bytes: Buffer): Promise<void>;
  closeAttach(id: string): Promise<void>;
  stop(id: string, timeoutSeconds: number): Promise<void>;
  wait(id: string): Promise<{ StatusCode: number }>;
  inspect(id: string): Promise<unknown>;
  remove(id: string): Promise<void>;
}
export interface ProducerSnapshot {
  readonly state: 'idle' | 'creating' | 'starting' | 'running' | 'stopping' | 'joined' | 'quarantined';
  readonly containerId: string | null; readonly name: string; readonly image: string; readonly owner: string;
  readonly project: string; readonly attemptId: string; readonly faultCode: string | null; readonly quarantineCode: string | null;
  readonly exitCode: number | null; readonly stderrBytes: number; readonly removed: boolean;
}
export function validateProducerMessage(value: unknown): ProducerMessage;
export function encodeProducerFrame(message: ProducerMessage): Buffer;
export function createProducerFrameDecoder(onMessage: (message: ProducerMessage) => void): { push(bytes: Buffer): void; finish(): void };
export function createProducerProcess(adapter: ProducerDockerAdapter, profile: ProducerProfile, options?: {
  onMessage?: (message: ProducerMessage) => void | Promise<void>;
  observe?: (event: ProducerSnapshot & { type: string }) => void;
  signal?: AbortSignal;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}): {
  readonly snapshot: ProducerSnapshot;
  start(): Promise<ProducerSnapshot>;
  send(input: { type: 'start' | 'response' | 'cancel' | 'close'; requestId?: string | null; payload: unknown }): Promise<void>;
  completed(): Promise<{ process: ProducerSnapshot; message: ProducerMessage }>;
  stop(): Promise<ProducerSnapshot>;
  remove(): Promise<ProducerSnapshot>;
};
