import { digestSha256 } from '../utils/sha256';
import { z } from 'zod';
import { getApiBaseUrl } from './http';
import { pathFinderRequestDeadline, discardPathFinderBody, releasePathFinderReader } from './pathfinderRequestDeadline';
import {
  parsePurposeJson,
  policyUuidSchema,
  canonicalPurposeJson,
} from '../../shared/pathfinderPurposePolicy';
import {
  PREPARATION_LIMITS,
  preparationContextSchema,
  preparationIndexSchema,
  preparationCreateSchema,
  preparationSessionSchema,
  preparationResolutionWriteSchema,
  preparationResolutionReceiptSchema,
  preparationPartUploadSchema,
  preparationPartReceiptSchema,
  preparationMutationSchema,
  preparationPublicationSchema,
  preparationErrorSchema,
  preparationPlanHashInput,
  preparationPartScopeHashInput,
  type PreparationContext,
  type PreparationSession,
  type PreparationCreate,
  type PreparationResolutionWrite,
  type PreparationMutation,
} from '../../shared/pathfinderPreparation';
export type {
  PreparationContext,
  PreparationSession,
  PreparationCreate,
  PreparationResolutionWrite,
  PreparationMutation,
};
export type PreparationIndex = z.infer<typeof preparationIndexSchema>;
export type PreparationPartUpload = z.infer<typeof preparationPartUploadSchema>;
export type PreparationPartReceipt = z.infer<typeof preparationPartReceiptSchema>;
export type PreparationPublication = z.infer<typeof preparationPublicationSchema>;
export class PreparationApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number | null,
    message = 'Project preparation could not be completed. Refresh its current status.',
    public readonly outcome: 'refused' | 'unknown' = 'unknown',
  ) {
    super(message);
  }
}
type Endpoint =
  | { kind: 'context' | 'index' | 'create' | 'resolution' }
  | { kind: 'session' | 'publish' | 'cancel'; sessionId: string }
  | { kind: 'part'; sessionId: string; partId: string };
/** Server validation is120s; allow bounded upload, admission and commit/response margin. */
export const PREPARATION_REQUEST_TIMEOUT_MS = 180_000;
async function request(
  projectId: string,
  token: string,
  endpoint: Endpoint,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  if (
    !policyUuidSchema.safeParse(projectId).success ||
    !token ||
    token.length > 16384 ||
    ('sessionId' in endpoint && !policyUuidSchema.safeParse(endpoint.sessionId).success) ||
    ('partId' in endpoint && !policyUuidSchema.safeParse(endpoint.partId).success)
  )
    throw new PreparationApiError(
      'INVALID_REQUEST',
      400,
      'Use the current administrator project and preparation session.',
      'refused',
    );
  let suffix = '',
    method = 'GET';
  switch (endpoint.kind) {
    case 'context':
      suffix = '/context';
      break;
    case 'index':
      break;
    case 'create':
      method = 'POST';
      break;
    case 'resolution':
      suffix = '/resolutions';
      method = 'POST';
      break;
    case 'session':
      suffix = '/' + endpoint.sessionId;
      break;
    case 'part':
      suffix = `/${endpoint.sessionId}/parts/${endpoint.partId}`;
      method = 'PUT';
      break;
    case 'publish':
    case 'cancel':
      suffix = `/${endpoint.sessionId}/${endpoint.kind}`;
      method = 'POST';
      break;
  }
  const deadline = pathFinderRequestDeadline(signal, PREPARATION_REQUEST_TIMEOUT_MS, () =>
    new PreparationApiError('REQUEST_TIMEOUT', null, 'The preparation request timed out. Refresh its status before retrying the saved command.', 'unknown'));
  try {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (
      encoded !== undefined &&
      new TextEncoder().encode(encoded).byteLength >
        (endpoint.kind === 'part'
          ? PREPARATION_LIMITS.partBytes + 4096
          : PREPARATION_LIMITS.controlBytes)
    )
      throw new PreparationApiError(
        'PREPARATION_BODY_LIMIT',
        413,
        'The preparation exceeds its supported request size.',
        'refused',
      );
    const response = await deadline.wait(() => fetch(
      `${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/preparations${suffix}`,
      {
        method,
        signal: deadline.signal,
        cache: 'no-store',
        redirect: 'error',
        credentials: 'same-origin',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(encoded === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(encoded === undefined ? {} : { body: encoded }),
      },
    ), late => discardPathFinderBody(late.body));
    const reader = response.body?.getReader();
    if (!reader) throw new PreparationApiError('INVALID_RESPONSE', response.status);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const item = await deadline.wait(() => reader.read());
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > PREPARATION_LIMITS.controlBytes)
          throw new PreparationApiError('PREPARATION_RESPONSE_LIMIT', response.status);
        chunks.push(item.value);
      }
    } finally {
      releasePathFinderReader(reader);
    }
    deadline.check();
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let value: unknown;
    try {
      value = parsePurposeJson(new TextDecoder('utf-8', { fatal: true }).decode(joined), {
        maximumBytes: PREPARATION_LIMITS.controlBytes,
      });
    } catch {
      throw new PreparationApiError('INVALID_RESPONSE', response.status);
    }
    if (!response.ok) {
      const error = preparationErrorSchema.safeParse(value);
      if (!error.success) throw new PreparationApiError('INVALID_RESPONSE', response.status);
      throw new PreparationApiError(
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
const invalid = (): never => {
  throw new PreparationApiError('INVALID_RESPONSE', 502);
};
async function sha(value: unknown): Promise<string> {
  const bytes = await digestSha256(new TextEncoder().encode(canonicalPurposeJson(value)),
  );
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
export async function verifyPreparationSession(
  input: unknown,
  projectId: string,
  sessionId?: string,
): Promise<PreparationSession> {
  const result = preparationSessionSchema.safeParse(input);
  if (
    !result.success ||
    result.data.projectId !== projectId ||
    (sessionId !== undefined && result.data.id !== sessionId)
  )
    return invalid();
  const session = result.data,
    plan = session.plan;
  if (
    (await sha(preparationPlanHashInput(plan))) !== plan.orderedPlanSha256 ||
    !(
      await Promise.all(
        plan.partPlan.map(
          async (part) => (await sha(preparationPartScopeHashInput(part))) === part.scopeSha256,
        ),
      )
    ).every(Boolean)
  )
    return invalid();
  if (
    new Set(session.parts.map((part) => part.partId)).size !== session.parts.length ||
    session.parts.some((part) => {
      const expected = plan.partPlan.find((value) => value.partId === part.partId);
      return (
        !expected ||
        part.partIndex !== expected.partIndex ||
        part.sessionPlanSha256 !== plan.orderedPlanSha256 ||
        part.scopeSha256 !== expected.scopeSha256 ||
        part.modelVersionId !== plan.modelVersionId ||
        part.contentFingerprint !== plan.contentFingerprint ||
        part.coordinateFrameId !== plan.coordinateFrameId
      );
    })
  )
    return invalid();
  const missing = plan.partPlan
    .filter((part) => !session.parts.some((value) => value.partId === part.partId))
    .map((part) => part.partId);
  if (
    session.coverage.expectedParts !== plan.partPlan.length ||
    session.coverage.committedParts !== session.parts.length ||
    JSON.stringify(missing) !== JSON.stringify(session.coverage.missingPartIds) ||
    (session.coverage.requestedScopeComplete && missing.length)
  )
    return invalid();
  return session;
}
export async function fetchPreparationContext(
  projectId: string,
  token: string,
  signal?: AbortSignal,
): Promise<PreparationContext> {
  const parsed = preparationContextSchema.safeParse(
    await request(projectId, token, { kind: 'context' }, undefined, signal),
  );
  return parsed.success && parsed.data.projectId === projectId ? parsed.data : invalid();
}
export async function fetchPreparationIndex(
  projectId: string,
  token: string,
  signal?: AbortSignal,
): Promise<PreparationIndex> {
  const parsed = preparationIndexSchema.safeParse(
    await request(projectId, token, { kind: 'index' }, undefined, signal),
  );
  return parsed.success ? parsed.data : invalid();
}
export async function fetchPreparationSession(
  projectId: string,
  token: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<PreparationSession> {
  return verifyPreparationSession(
    await request(projectId, token, { kind: 'session', sessionId }, undefined, signal),
    projectId,
    sessionId,
  );
}
export async function createPreparation(
  projectId: string,
  token: string,
  input: PreparationCreate,
  signal?: AbortSignal,
): Promise<PreparationSession> {
  const body = preparationCreateSchema.safeParse(input);
  if (!body.success)
    throw new PreparationApiError(
      'INVALID_REQUEST',
      400,
      'Review the complete discovery report before freezing a plan.',
      'refused',
    );
  return verifyPreparationSession(
    await request(projectId, token, { kind: 'create' }, body.data, signal),
    projectId,
  );
}
export async function savePreparationResolution(
  projectId: string,
  token: string,
  input: PreparationResolutionWrite,
  signal?: AbortSignal,
) {
  const body = preparationResolutionWriteSchema.safeParse(input);
  if (!body.success)
    throw new PreparationApiError(
      'INVALID_REQUEST',
      400,
      'Select the confirmed roots or exclusion and give a reason.',
      'refused',
    );
  const result = preparationResolutionReceiptSchema.safeParse(
    await request(projectId, token, { kind: 'resolution' }, body.data, signal),
  );
  return result.success ? result.data : invalid();
}
export async function uploadPreparationPart(
  projectId: string,
  token: string,
  sessionId: string,
  partId: string,
  input: PreparationPartUpload,
  signal?: AbortSignal,
): Promise<PreparationPartReceipt> {
  const body = preparationPartUploadSchema.safeParse(input);
  if (!body.success)
    throw new PreparationApiError(
      'INVALID_REQUEST',
      400,
      'Use the frozen preparation part.',
      'refused',
    );
  const result = preparationPartReceiptSchema.safeParse(
    await request(projectId, token, { kind: 'part', sessionId, partId }, body.data, signal),
  );
  return result.success &&
    result.data.part.sessionId === sessionId &&
    result.data.part.partId === partId &&
    result.data.part.sessionPlanSha256 === input.sessionPlanSha256
    ? result.data
    : invalid();
}
export async function mutatePreparation(
  projectId: string,
  token: string,
  sessionId: string,
  operation: 'publish' | 'cancel',
  input: PreparationMutation,
  signal?: AbortSignal,
) {
  const body = preparationMutationSchema.safeParse(input);
  if (!body.success)
    throw new PreparationApiError(
      'INVALID_REQUEST',
      400,
      'Refresh the preparation and provide a reason.',
      'refused',
    );
  const value = await request(projectId, token, { kind: operation, sessionId }, body.data, signal);
  if (operation === 'cancel') return verifyPreparationSession(value, projectId, sessionId);
  const result = preparationPublicationSchema.safeParse(value);
  return result.success &&
    result.data.sessionId === sessionId &&
    result.data.aggregate.projectId === projectId &&
    result.data.aggregate.sessionId === sessionId
    ? result.data
    : invalid();
}
