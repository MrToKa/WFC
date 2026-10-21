import { z } from 'zod';
import { getApiBaseUrl } from './http';
import { barrierCaptureCommandSchema, barrierRegistryCommandSchema, barrierRegistrySchema,
  barrierSnapshotReferenceSchema, type BarrierRegistry } from '../../shared/pathfinderBarriers';

const publication = z.object({ schemaVersion: z.literal('wfc.pf.barrier-publication-receipt.v1'), snapshot: barrierSnapshotReferenceSchema, duplicate: z.boolean() }).strict();
const intent = z.object({ id: z.string().uuid(), snapshotId: z.string().uuid(), captureBlobId: z.string().uuid(), manifestBlobId: z.string().uuid(),
  command: barrierCaptureCommandSchema, createdBy: z.string().uuid(), loginId: z.string().uuid() }).strict();
const intentReceipt = z.object({ schemaVersion: z.literal('wfc.pf.barrier-intent-receipt.v1'), intent, state: z.enum(['pending', 'complete']), duplicate: z.boolean() }).strict();
async function request(projectId: string, token: string, suffix: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  z.string().uuid().parse(projectId);
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/barriers${suffix}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) { let code = 'BARRIER_REQUEST_FAILED'; try { const value = await response.json(); if (typeof value.code === 'string') code = value.code; } catch { /* Keep bounded public error. */ }
    throw Object.assign(new Error(code), { code, status: response.status }); }
  return response.json();
}
export async function getBarrierRegistry(projectId: string, token: string, signal?: AbortSignal): Promise<BarrierRegistry> {
  return barrierRegistrySchema.parse(await request(projectId, token, '', undefined, signal));
}
export async function beginBarrierCapture(projectId: string, token: string, command: z.input<typeof barrierCaptureCommandSchema>, signal?: AbortSignal) {
  return intentReceipt.parse(await request(projectId, token, '/intents', barrierCaptureCommandSchema.parse(command), signal));
}
export async function changeBarrierRegistry(projectId: string, token: string, command: z.input<typeof barrierRegistryCommandSchema>, signal?: AbortSignal) {
  return publication.parse(await request(projectId, token, '/commands', barrierRegistryCommandSchema.parse(command), signal));
}
