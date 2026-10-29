import type { Buffer } from 'node:buffer';
import type { ManagedResourceRequest, ManagedResourceResponse } from './managed-runner.mjs';
export const RESOURCE_BROKER_LIMITS: Readonly<{ handles: number; requests: number; bytes: number; chunkBytes: number;
  upstreamChunkBytes: number; inactivityMilliseconds: number; operationMilliseconds: number; closeMilliseconds: number }>;
export type ResourceBrokerIdentity = Readonly<{ projectId: string; modelVersionId: string; sessionId: string }>;
export type ResourceBrokerSource = { status: number; headers: Record<string, string>; totalBytes: number } & (
  { body?: Buffer; close?(): void | Promise<void> } |
  { body: AsyncIterable<Uint8Array> & { destroy?(): unknown }; close(): void | Promise<void> }
);
export interface ResourceBrokerSnapshot { readonly disposed: boolean; readonly handles: number; readonly requests: number; readonly bytes: number; readonly quarantined: number }
export function mapManagedResourcePath(raw: string, identity: ResourceBrokerIdentity, helperOrigin: string, sourceOrigin?: 'http://127.0.0.1:5191'): string;
export function sanitizeManagedResourceHeaders(input: unknown): Record<string, string>;
export function createManagedResourceBroker(options: {
  identity: ResourceBrokerIdentity; helperOrigin: string; sourceOrigin: 'http://127.0.0.1:5191'; signal?: AbortSignal;
  authorize(identity: ResourceBrokerIdentity, signal: AbortSignal): void | Promise<void>;
  readResource(request: { path: string; method: 'GET' | 'HEAD'; range: string | null; signal: AbortSignal }): Promise<ResourceBrokerSource>;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  now?: () => number;
}): { readonly snapshot: ResourceBrokerSnapshot; request(requestId: string, payload: ManagedResourceRequest): Promise<ManagedResourceResponse>;
  cancel(requestId: string): Promise<ResourceBrokerSnapshot>; dispose(): Promise<ResourceBrokerSnapshot> };
