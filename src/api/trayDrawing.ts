import { digestSha256 } from '../utils/sha256';
import { getApiBaseUrl } from './http';
import { canonicalPurposeJson, parsePurposeJson, policyUuidSchema, policyErrorSchema } from '../../shared/pathfinderPurposePolicy';
import { drawingErrorSchema } from '../../shared/pathfinderDrawingPolicy';
import { trayDrawingResponseSchema, drawingSettingsWriteSchema, drawingExportWriteSchema, drawingExportReceiptSchema,
  drawingInputHashInput, drawingSettingsHashInput, drawingContentHashInput,
  type TrayDrawingResponse as WireResponse, type DrawingSettingsWrite, type DrawingExportWrite } from '../../shared/trayDrawingSnapshot';
import { parseTrayDrawingLayout, type TrayDrawingLayout } from '../../shared/trayDrawing/index';
export type TrayDrawingResponse = Omit<WireResponse, 'layout'> & { layout: TrayDrawingLayout };
export type { DrawingSettingsWrite, DrawingExportWrite };
export class TrayDrawingApiError extends Error {
  constructor(public readonly code: string, public readonly status: number | null, message = 'The shared tray drawing could not be loaded. Refresh to try again.', public readonly confirmedRejection = false) { super(message); }
}
async function request(projectId: string, trayId: string, token: string, kind: 'snapshot' | 'settings' | 'export', body?: DrawingSettingsWrite | DrawingExportWrite, signal?: AbortSignal): Promise<unknown> {
  if (!policyUuidSchema.safeParse(projectId).success || !policyUuidSchema.safeParse(trayId).success || !token || token.length > 16384) throw new TrayDrawingApiError('INVALID_REQUEST', 400, undefined, true);
  const method = kind === 'snapshot' ? 'GET' : kind === 'settings' ? 'PUT' : 'POST';
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/trays/${trayId}/drawing-${kind}`, { method, signal, cache: 'no-store', redirect: 'error', credentials: 'same-origin',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const reader = response.body?.getReader(); if (!reader) throw new TrayDrawingApiError('INVALID_RESPONSE', response.status);
  const chunks: Uint8Array[] = []; let count = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; count += item.value.byteLength; if (count > 64 * 1024 * 1024) throw new TrayDrawingApiError('RESPONSE_LIMIT', response.status); chunks.push(item.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const joined = new Uint8Array(count); let at = 0; for (const chunk of chunks) { joined.set(chunk, at); at += chunk.byteLength; }
  let value: unknown; try { value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(joined), { maximumBytes: 64 * 1024 * 1024 }); } catch { throw new TrayDrawingApiError('INVALID_RESPONSE', response.status); }
  if (!response.ok) {
    const error = drawingErrorSchema.safeParse(value); const policy = policyErrorSchema.safeParse(value); const parsed = error.success ? error.data : policy.success ? policy.data : null;
    if (!parsed) throw new TrayDrawingApiError('INVALID_RESPONSE', response.status);
    throw new TrayDrawingApiError(parsed.code, response.status, parsed.message, [400,401,403,404,405,409,413,415].includes(response.status));
  }
  return value;
}
async function hash(value: unknown): Promise<string> {
  const digest = await digestSha256(new TextEncoder().encode(canonicalPurposeJson(value)));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function verifyTrayDrawingResponse(value: unknown, projectId: string, trayId: string): Promise<TrayDrawingResponse> {
  const parsed = trayDrawingResponseSchema.safeParse(value); if (!parsed.success) throw new TrayDrawingApiError('INVALID_RESPONSE', 502);
  const result = parsed.data;
  if (result.snapshot.projectId !== projectId || result.snapshot.projectTrayId !== trayId) throw new TrayDrawingApiError('INVALID_RESPONSE', 502);
  try { parseTrayDrawingLayout(result.layout); } catch { throw new TrayDrawingApiError('INVALID_LAYOUT', 502, 'The shared drawing layout is invalid. Refresh to try again.'); }
  if (await hash(drawingInputHashInput(result.data, result.sourceSha256)) !== result.snapshot.inputSha256 ||
      await hash(drawingSettingsHashInput(result.override, result.snapshot.categoryModes)) !== result.snapshot.settingsSha256 ||
      await hash(drawingContentHashInput(result.snapshot, result.layout)) !== result.snapshot.contentSha256)
    throw new TrayDrawingApiError('DRAWING_SNAPSHOT_MISMATCH', 409, 'The drawing inputs do not match their shared snapshot. Refresh the drawing.');
  return result as TrayDrawingResponse;
}
export async function fetchTrayDrawingSnapshot(projectId: string, trayId: string, token: string, signal?: AbortSignal): Promise<TrayDrawingResponse> {
  return verifyTrayDrawingResponse(await request(projectId, trayId, token, 'snapshot', undefined, signal), projectId, trayId);
}
export async function saveTrayDrawingSettings(projectId: string, trayId: string, token: string, body: DrawingSettingsWrite, signal?: AbortSignal): Promise<TrayDrawingResponse> {
  const parsed = drawingSettingsWriteSchema.safeParse(body); if (!parsed.success) throw new TrayDrawingApiError('INVALID_REQUEST', 400, 'Review the tray bundle settings.', true);
  // Even a historical receipt must return a freshly collected current snapshot.
  return verifyTrayDrawingResponse(await request(projectId, trayId, token, 'settings', parsed.data, signal), projectId, trayId);
}
export async function exportTrayDrawing(projectId: string, trayId: string, token: string, body: DrawingExportWrite, signal?: AbortSignal) {
  const parsed = drawingExportWriteSchema.safeParse(body); if (!parsed.success) throw new TrayDrawingApiError('INVALID_REQUEST', 400, 'Review the drawing export files.', true);
  const receipt = drawingExportReceiptSchema.safeParse(await request(projectId, trayId, token, 'export', parsed.data, signal));
  if (!receipt.success || receipt.data.projectId !== projectId || receipt.data.projectTrayId !== trayId || receipt.data.snapshotId !== body.snapshotId || receipt.data.contentSha256 !== body.expectedContentSha256) throw new TrayDrawingApiError('INVALID_RESPONSE', 502);
  return receipt.data;
}
export async function drawingBlobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('The drawing file could not be read.')); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob); });
}
