import { z } from 'zod';
import { getApiBaseUrl } from './http';
import { pathFinderRequestDeadline, discardPathFinderBody, releasePathFinderReader } from './pathfinderRequestDeadline';
import {
  parsePurposeJson,
  policyUuidSchema,
  canonicalPurposeJson,
} from '../../shared/pathfinderPurposePolicy';
import {
  geometryTraceCreateSchema,
  geometryTraceManifestSchema,
  geometryTraceReceiptSchema,
  geometryObjectPageSchema,
  geometryObjectRevisionSchema,
  geometryTraceListSchema,
  geometryTraceErrorSchema,
  geometryTraceDiagnosticsPageSchema,
  captureEvidenceUploadSchema,
  captureEvidenceReceiptSchema,
  geometryTraceContentHashInput,
  type GeometryTraceCreate,
  type GeometryTraceManifest,
  type GeometryObjectRevision,
} from '../../shared/pathfinderGeometryTrace';
import {
  verifyCompletedCaptureEvidence,
  type CompletedCaptureEvidence,
} from '../../viewer-runtime/capture-evidence.mjs';
export type { GeometryTraceCreate, GeometryTraceManifest, GeometryObjectRevision };
export type GeometryObjectPage = z.infer<typeof geometryObjectPageSchema>;
export type GeometryTraceList = z.infer<typeof geometryTraceListSchema>;
export class GeometryTraceApiError extends Error {
  constructor(
    public code: string,
    public status: number | null,
    message: string,
    public outcome: 'refused' | 'unknown' = 'unknown',
  ) {
    super(message);
  }
}
const invalid = (): never => {
  throw new GeometryTraceApiError(
    'INVALID_RESPONSE',
    null,
    'Traceability returned invalid or mismatched data. Refresh its status.',
  );
};
type Endpoint =
  | { kind: 'list'; offset: number }
  | { kind: 'create' }
  | { kind: 'manifest'; traceId: string }
  | { kind: 'objects' | 'diagnostics'; traceId: string; offset: number }
  | { kind: 'object'; traceId: string; objectRevisionId: string }
  | { kind: 'evidence' | 'read-evidence'; sessionId: string; partId: string };
/** The trace server lease is150s; retain30s for admission, commit and response. */
export const GEOMETRY_TRACE_REQUEST_TIMEOUT_MS = 180_000;
async function request(
  projectId: string,
  token: string,
  endpoint: Endpoint,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  if (
    !policyUuidSchema.safeParse(projectId).success ||
    !token ||
    token.length > 16384 ||
    Object.entries(endpoint).some(
      ([key, value]) => key.endsWith('Id') && !policyUuidSchema.safeParse(value).success,
    ) ||
    ('offset' in endpoint &&
      (!Number.isSafeInteger(endpoint.offset) || endpoint.offset < 0 || endpoint.offset > 5000000))
  )
    throw new GeometryTraceApiError(
      'INVALID_REQUEST',
      400,
      'Use current project and fixed traceability identifiers.',
      'refused',
    );
  let suffix = '/geometry-traces',
    method = 'GET';
  switch (endpoint.kind) {
    case 'list':
      suffix += `?offset=${endpoint.offset}&limit=25`;
      break;
    case 'create':
      method = 'POST';
      break;
    case 'manifest':
      suffix += `/${endpoint.traceId}/manifest`;
      break;
    case 'objects':
    case 'diagnostics':
      suffix += `/${endpoint.traceId}/${endpoint.kind}?offset=${endpoint.offset}&limit=25`;
      break;
    case 'object':
      suffix += `/${endpoint.traceId}/objects/${endpoint.objectRevisionId}`;
      break;
    case 'read-evidence':
    case 'evidence':
      suffix = `/geometry-evidence/sessions/${endpoint.sessionId}/parts/${endpoint.partId}`;
      method = endpoint.kind === 'evidence' ? 'PUT' : 'GET';
      break;
  }
  const deadline = pathFinderRequestDeadline(signal, GEOMETRY_TRACE_REQUEST_TIMEOUT_MS, () =>
    new GeometryTraceApiError('REQUEST_TIMEOUT', null, 'The traceability request timed out. Refresh its status before retrying the saved command.', 'unknown'));
  try {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (
      encoded &&
      new TextEncoder().encode(encoded).length >
        (endpoint.kind === 'evidence' ? 4 * 1024 ** 2 + 4096 : 65536)
    )
      throw new GeometryTraceApiError(
        'BODY_LIMIT',
        413,
        'Traceability request exceeds its supported size.',
        'refused',
      );
    const response = await deadline.wait(() => fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder${suffix}`, {
      method,
      signal: deadline.signal,
      cache: 'no-store',
      redirect: 'error',
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(encoded ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(encoded ? { body: encoded } : {}),
    }), late => discardPathFinderBody(late.body));
    const maximumResponseBytes =
      endpoint.kind === 'read-evidence'
        ? 4 * 1024 ** 2 + 4096
        : endpoint.kind === 'object'
          ? 512 * 1024 + 65536
          : endpoint.kind === 'manifest' || endpoint.kind === 'create'
            ? 256 * 1024 + 65536
            : 1024 ** 2;
    const reader = response.body?.getReader();
    if (!reader) return invalid();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const item = await deadline.wait(() => reader.read());
        if (item.done) break;
        size += item.value.length;
        if (size > maximumResponseBytes) {
          return invalid();
        }
        chunks.push(item.value);
      }
    } finally {
      releasePathFinderReader(reader);
    }
    deadline.check();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let value: unknown;
    try {
      value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
        maximumBytes: maximumResponseBytes,
      });
    } catch {
      return invalid();
    }
    if (!response.ok) {
      const error = geometryTraceErrorSchema.safeParse(value);
      if (!error.success) return invalid();
      throw new GeometryTraceApiError(
        error.data.code,
        response.status,
        error.data.message,
        error.data.outcome,
      );
    }
    deadline.check();
    return value;
  } finally { deadline.dispose(); }
}
async function verifyManifest(value: unknown, projectId: string, traceId?: string) {
  const parsed = geometryTraceManifestSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.projectId !== projectId ||
    (traceId && parsed.data.id !== traceId)
  )
    return invalid();
  const digest = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(canonicalPurposeJson(geometryTraceContentHashInput(parsed.data))),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (digest !== parsed.data.contentSha256) return invalid();
  return parsed.data;
}
export async function fetchGeometryTraces(
  projectId: string,
  token: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<GeometryTraceList> {
  const parsed = geometryTraceListSchema.safeParse(
    await request(projectId, token, { kind: 'list', offset }, undefined, signal),
  );
  if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.offset !== offset)
    return invalid();
  if (parsed.data.traces.some((trace) => trace.projectId !== projectId)) return invalid();
  return parsed.data;
}
export async function fetchGeometryTraceManifest(
  projectId: string,
  token: string,
  traceId: string,
  signal?: AbortSignal,
) {
  return verifyManifest(
    await request(projectId, token, { kind: 'manifest', traceId }, undefined, signal),
    projectId,
    traceId,
  );
}
export async function createGeometryTrace(
  projectId: string,
  token: string,
  input: GeometryTraceCreate,
  signal?: AbortSignal,
) {
  const body = geometryTraceCreateSchema.safeParse(input);
  if (!body.success)
    throw new GeometryTraceApiError(
      'INVALID_REQUEST',
      400,
      'Use the exact saved aggregate and derivation command.',
      'refused',
    );
  const parsed = geometryTraceReceiptSchema.safeParse(
    await request(projectId, token, { kind: 'create' }, body.data, signal),
  );
  if (
    !parsed.success ||
    parsed.data.trace.aggregateId !== input.aggregateId ||
    parsed.data.trace.projection.sha256 !== input.expectedProjectionSha256
  )
    return invalid();
  await verifyManifest(parsed.data.trace, projectId);
  return parsed.data;
}
export async function fetchGeometryTraceObjects(
  projectId: string,
  token: string,
  traceId: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<GeometryObjectPage> {
  const parsed = geometryObjectPageSchema.safeParse(
    await request(projectId, token, { kind: 'objects', traceId, offset }, undefined, signal),
  );
  if (
    !parsed.success ||
    parsed.data.projectId !== projectId ||
    parsed.data.traceId !== traceId ||
    parsed.data.offset !== offset
  )
    return invalid();
  return parsed.data;
}
export async function fetchGeometryObjectRevision(
  projectId: string,
  token: string,
  traceId: string,
  objectRevisionId: string,
  signal?: AbortSignal,
): Promise<GeometryObjectRevision> {
  const parsed = geometryObjectRevisionSchema.safeParse(
    await request(
      projectId,
      token,
      { kind: 'object', traceId, objectRevisionId },
      undefined,
      signal,
    ),
  );
  return parsed.success &&
    parsed.data.projectId === projectId &&
    parsed.data.traceId === traceId &&
    parsed.data.id === objectRevisionId
    ? parsed.data
    : invalid();
}
export async function saveCaptureEvidence(
  projectId: string,
  token: string,
  sessionId: string,
  partId: string,
  sessionPlanSha256: string,
  payloadSha256: string,
  evidence: CompletedCaptureEvidence,
  signal?: AbortSignal,
) {
  if (
    !(await verifyCompletedCaptureEvidence(evidence)) ||
    evidence.binding.projectId !== projectId ||
    evidence.binding.sessionId !== sessionId ||
    evidence.binding.partId !== partId ||
    evidence.binding.planSha256 !== sessionPlanSha256 ||
    evidence.binding.partPayloadSha256 !== payloadSha256 ||
    evidence.binding.selectionRevision === null ||
    evidence.binding.loadId === null
  )
    return invalid();
  const body = captureEvidenceUploadSchema.parse({
    schemaVersion: 'wfc.pf.capture-evidence-upload.v1',
    sessionPlanSha256,
    payloadSha256,
    evidence,
  });
  const parsed = captureEvidenceReceiptSchema.safeParse(
    await request(projectId, token, { kind: 'evidence', sessionId, partId }, body, signal),
  );
  return parsed.success && parsed.data.sessionId === sessionId && parsed.data.partId === partId
    ? parsed.data
    : invalid();
}

export async function fetchCaptureEvidence(
  projectId: string,
  token: string,
  sessionId: string,
  partId: string,
  signal?: AbortSignal,
): Promise<CompletedCaptureEvidence> {
  const value = await request(
    projectId,
    token,
    { kind: 'read-evidence', sessionId, partId },
    undefined,
    signal,
  );
  if (!(await verifyCompletedCaptureEvidence(value))) return invalid();
  const evidence = value as CompletedCaptureEvidence;
  return evidence.binding.projectId === projectId &&
    evidence.binding.sessionId === sessionId &&
    evidence.binding.partId === partId
    ? evidence
    : invalid();
}

export async function fetchGeometryTraceDiagnostics(
  projectId: string,
  token: string,
  traceId: string,
  offset = 0,
  signal?: AbortSignal,
) {
  const parsed = geometryTraceDiagnosticsPageSchema.safeParse(
    await request(projectId, token, { kind: 'diagnostics', traceId, offset }, undefined, signal),
  );
  return parsed.success &&
    parsed.data.projectId === projectId &&
    parsed.data.traceId === traceId &&
    parsed.data.offset === offset
    ? parsed.data
    : invalid();
}
