import { getApiBaseUrl } from './http';
import {
  parsePurposeJson,
  policyUuidSchema,
  policyRevisionSchema,
  canonicalPurposeJson,
} from '../../shared/pathfinderPurposePolicy';
import {
  endpointBindingContextSchema,
  endpointBindingWriteSchema,
  endpointBindingReceiptSchema,
  endpointBindingHistorySchema,
  endpointBindingErrorSchema,
  type EndpointBindingContext,
  type EndpointBindingWrite,
  type EndpointBindingReceipt,
  type EndpointBindingHistory,
  endpointBindingContentHashInput,
  type EndpointBinding,
  endpointMigrationWriteSchema,
  endpointMigrationConfirmSchema,
  endpointMigrationDecisionSchema,
  endpointMigrationContentHashInput,
  type EndpointMigrationWrite,
  type EndpointMigrationConfirm,
  type EndpointMigrationDecision,
} from '../../shared/pathfinderEndpointBindings';

export type {
  EndpointBindingContext,
  EndpointBindingWrite,
  EndpointBindingReceipt,
  EndpointBindingHistory,
  EndpointMigrationWrite,
  EndpointMigrationConfirm,
  EndpointMigrationDecision,
};
export class EndpointBindingApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number | null,
    message = 'The shared endpoint could not be read. Refresh its current status.',
    public readonly outcome: 'refused' | 'unknown' = 'unknown',
  ) {
    super(message);
  }
}
const invalid = (): never => {
  throw new EndpointBindingApiError(
    'INVALID_RESPONSE',
    null,
    'The shared endpoint returned invalid or mismatched data. Reconcile the same saved command.',
  );
};
async function verifyBinding(binding: EndpointBinding) {
  const digest = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(canonicalPurposeJson(endpointBindingContentHashInput(binding))),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (digest !== binding.contentSha256) return invalid();
}
type Endpoint =
  | { kind: 'context' | 'save' | 'migration'; locationId: string }
  | { kind: 'confirm-migration'; locationId: string; decisionId: string }
  | { kind: 'history'; locationId: string; beforeRevision: string | null };
async function request(
  projectId: string,
  token: string,
  endpoint: Endpoint,
  body?: EndpointBindingWrite | EndpointMigrationWrite | EndpointMigrationConfirm,
  signal?: AbortSignal,
): Promise<unknown> {
  if (
    !policyUuidSchema.safeParse(projectId).success ||
    !policyUuidSchema.safeParse(endpoint.locationId).success ||
    ('decisionId' in endpoint && !policyUuidSchema.safeParse(endpoint.decisionId).success) ||
    !token ||
    token.length > 16384 ||
    (endpoint.kind === 'history' &&
      endpoint.beforeRevision !== null &&
      !policyRevisionSchema.safeParse(endpoint.beforeRevision).success)
  )
    throw new EndpointBindingApiError(
      'INVALID_REQUEST',
      400,
      'Use the current project and shared location identifiers.',
      'refused',
    );
  const suffix =
    endpoint.kind === 'history'
      ? `binding-history?limit=25${endpoint.beforeRevision === null ? '' : `&beforeRevision=${endpoint.beforeRevision}`}`
      : 'endpoint-binding';
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  if (encoded && new TextEncoder().encode(encoded).byteLength > 65536)
    throw new EndpointBindingApiError(
      'BODY_LIMIT',
      413,
      'The shared endpoint command exceeds its supported size.',
      'refused',
    );
  const target =
    endpoint.kind === 'migration'
      ? '/endpoint-bindings/migrations'
      : endpoint.kind === 'confirm-migration'
        ? `/endpoint-bindings/migrations/${endpoint.decisionId}/confirm`
        : `/locations/${endpoint.locationId}/${suffix}`;
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/pathfinder${target}`, {
    method:
      endpoint.kind === 'save'
        ? 'PUT'
        : endpoint.kind === 'migration' || endpoint.kind === 'confirm-migration'
          ? 'POST'
          : 'GET',
    signal,
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(encoded ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(encoded ? { body: encoded } : {}),
  });
  const reader = response.body?.getReader();
  if (!reader) return invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024 ** 2) {
        await reader.cancel();
        return invalid();
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  let value: unknown;
  try {
    value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
      maximumBytes: 1024 ** 2,
    });
  } catch {
    return invalid();
  }
  if (!response.ok) {
    const error = endpointBindingErrorSchema.safeParse(value);
    if (!error.success) return invalid();
    throw new EndpointBindingApiError(
      error.data.code,
      response.status,
      error.data.message,
      error.data.outcome,
    );
  }
  return value;
}
export async function fetchEndpointBinding(
  projectId: string,
  token: string,
  locationId: string,
  signal?: AbortSignal,
): Promise<EndpointBindingContext> {
  const parsed = endpointBindingContextSchema.safeParse(
    await request(projectId, token, { kind: 'context', locationId }, undefined, signal),
  );
  if (
    !parsed.success ||
    parsed.data.projectId !== projectId ||
    parsed.data.locationId !== locationId
  )
    return invalid();
  if (parsed.data.head) await verifyBinding(parsed.data.head);
  return parsed.data;
}
export async function saveEndpointBinding(
  projectId: string,
  token: string,
  locationId: string,
  input: EndpointBindingWrite,
  signal?: AbortSignal,
): Promise<EndpointBindingReceipt> {
  const body = endpointBindingWriteSchema.safeParse(input);
  if (!body.success)
    throw new EndpointBindingApiError(
      'INVALID_REQUEST',
      400,
      'Review the exact point, attachment mode and current endpoint scope.',
      'refused',
    );
  const parsed = endpointBindingReceiptSchema.safeParse(
    await request(projectId, token, { kind: 'save', locationId }, body.data, signal),
  );
  if (
    !parsed.success ||
    parsed.data.projectId !== projectId ||
    parsed.data.locationId !== locationId
  )
    return invalid();
  const binding = parsed.data.binding;
  if (
    binding.status !== 'confirmed' ||
    binding.reason !== input.reason ||
    binding.modelVersionId !== input.modelVersionId ||
    binding.aggregateId !== input.aggregateId ||
    binding.projectionSha256 !== input.projectionSha256 ||
    binding.captureFrameId !== input.captureFrameId ||
    binding.mode !== input.mode ||
    (input.mode === 'fixed-world' &&
      (canonicalPurposeJson(binding.pointProjectMetres) !==
        canonicalPurposeJson(input.pointProjectMetres) ||
        binding.derivation !== input.derivation ||
        canonicalPurposeJson(binding.sourceObject) !==
          canonicalPurposeJson(input.provenanceObject))) ||
    (input.mode === 'object-derived' &&
      (binding.derivation !== input.anchorRule ||
        canonicalPurposeJson(binding.sourceObject) !== canonicalPurposeJson(input.object)))
  )
    return invalid();
  await verifyBinding(binding);
  return parsed.data;
}
export async function fetchEndpointBindingHistory(
  projectId: string,
  token: string,
  locationId: string,
  beforeRevision: string | null = null,
  signal?: AbortSignal,
): Promise<EndpointBindingHistory> {
  const parsed = endpointBindingHistorySchema.safeParse(
    await request(
      projectId,
      token,
      { kind: 'history', locationId, beforeRevision },
      undefined,
      signal,
    ),
  );
  if (
    !parsed.success ||
    parsed.data.projectId !== projectId ||
    parsed.data.locationId !== locationId
  )
    return invalid();
  let previous = beforeRevision === null ? null : BigInt(beforeRevision);
  for (const binding of parsed.data.bindings) {
    if (previous !== null && BigInt(binding.bindingRevision) >= previous) return invalid();
    previous = BigInt(binding.bindingRevision);
    await verifyBinding(binding);
  }
  if (
    parsed.data.nextBeforeRevision !== null &&
    (previous === null || BigInt(parsed.data.nextBeforeRevision) !== previous)
  )
    return invalid();
  return parsed.data;
}
export async function evaluateEndpointMigration(
  projectId: string,
  token: string,
  locationId: string,
  input: EndpointMigrationWrite,
  signal?: AbortSignal,
): Promise<EndpointMigrationDecision> {
  const body = endpointMigrationWriteSchema.safeParse(input);
  if (!body.success)
    throw new EndpointBindingApiError(
      'INVALID_REQUEST',
      400,
      'Review the exact source binding and target frame.',
      'refused',
    );
  const parsed = endpointMigrationDecisionSchema.safeParse(
    await request(projectId, token, { kind: 'migration', locationId }, body.data, signal),
  );
  if (
    !parsed.success ||
    parsed.data.projectId !== projectId ||
    parsed.data.locationId !== locationId ||
    parsed.data.sourceBindingId !== input.sourceBindingId ||
    parsed.data.target.aggregateId !== input.targetAggregateId ||
    parsed.data.target.projectionSha256 !== input.targetProjectionSha256 ||
    parsed.data.target.captureFrameId !== input.targetCaptureFrameId
  )
    return invalid();
  const digest = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          canonicalPurposeJson(endpointMigrationContentHashInput(parsed.data)),
        ),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (digest !== parsed.data.contentSha256) return invalid();
  return parsed.data;
}
export async function confirmEndpointMigration(
  projectId: string,
  token: string,
  locationId: string,
  decisionId: string,
  input: EndpointMigrationConfirm,
  signal?: AbortSignal,
): Promise<EndpointBindingReceipt> {
  const body = endpointMigrationConfirmSchema.safeParse(input);
  if (!body.success)
    throw new EndpointBindingApiError(
      'INVALID_REQUEST',
      400,
      'Review the exact saved migration decision.',
      'refused',
    );
  const parsed = endpointBindingReceiptSchema.safeParse(
    await request(
      projectId,
      token,
      { kind: 'confirm-migration', locationId, decisionId },
      body.data,
      signal,
    ),
  );
  if (
    !parsed.success ||
    parsed.data.projectId !== projectId ||
    parsed.data.locationId !== locationId ||
    parsed.data.binding.sourceDecisionId !== decisionId
  )
    return invalid();
  await verifyBinding(parsed.data.binding);
  return parsed.data;
}
