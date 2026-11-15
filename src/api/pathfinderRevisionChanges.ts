import { digestSha256 } from '../utils/sha256';
import { getApiBaseUrl } from './http';
import {
  parsePurposeJson,
  policyUuidSchema,
  policyRevisionSchema,
  canonicalPurposeJson,
} from '../../shared/pathfinderPurposePolicy';
import {
  revisionComparisonContextSchema,
  revisionComparisonCreateSchema,
  revisionComparisonManifestSchema,
  revisionComparisonReceiptSchema,
  revisionComparisonListSchema,
  revisionComparisonChangesPageSchema,
  revisionComparisonDecisionWriteSchema,
  revisionComparisonDecisionReceiptSchema,
  revisionComparisonDecisionHistorySchema,
  revisionComparisonErrorSchema,
  revisionComparisonDecisionHeadSchema,
  type RevisionComparisonDecisionHead,
  type RevisionComparisonContext,
  type RevisionComparisonCreate,
  type RevisionComparisonManifest,
  type RevisionComparisonReceipt,
  type RevisionComparisonList,
  type RevisionComparisonChangesPage,
  type RevisionComparisonDecisionWrite,
  type RevisionComparisonDecision,
  type RevisionComparisonDecisionReceipt,
  type RevisionComparisonDecisionHistory,
} from '../../shared/pathfinderRevisionComparison';
export type {
  RevisionComparisonContext,
  RevisionComparisonCreate,
  RevisionComparisonManifest,
  RevisionComparisonReceipt,
  RevisionComparisonList,
  RevisionComparisonChangesPage,
  RevisionComparisonDecisionWrite,
  RevisionComparisonDecision,
  RevisionComparisonDecisionReceipt,
  RevisionComparisonDecisionHistory,
  RevisionComparisonDecisionHead,
};
export type RevisionDecisionHeadQuery =
  | { kind: 'object-mapping'; sourceObjectRevisionIds: string[] }
  | { kind: 'frame-mapping' }
  | { kind: 'binding-frame-qualification'; sourceBindingId: string };
export class RevisionChangesApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number | null,
    message = 'Model revision changes could not be read. Refresh the current comparison.',
    public readonly outcome: 'refused' | 'unknown' = 'unknown',
  ) {
    super(message);
  }
}
const invalid = (): never => {
  throw new RevisionChangesApiError(
    'INVALID_RESPONSE',
    null,
    'The comparison returned invalid or mismatched data. Reconcile the same command before changing it.',
  );
};
type Endpoint =
  | { kind: 'context' | 'create' }
  | { kind: 'list'; offset: number }
  | { kind: 'manifest' | 'decision'; comparisonId: string }
  | { kind: 'changes'; comparisonId: string; offset: number }
  | { kind: 'history'; comparisonId: string; beforeRevision: string | null }
  | { kind: 'head'; comparisonId: string; query: RevisionDecisionHeadQuery };
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
    ('comparisonId' in endpoint && !policyUuidSchema.safeParse(endpoint.comparisonId).success) ||
    ('offset' in endpoint &&
      (!Number.isSafeInteger(endpoint.offset) ||
        endpoint.offset < 0 ||
        endpoint.offset > 1_000_000))
  )
    throw new RevisionChangesApiError(
      'INVALID_REQUEST',
      400,
      'Use the current project and fixed comparison identifiers.',
      'refused',
    );
  let suffix = '',
    method = 'GET';
  if (
    endpoint.kind === 'history' &&
    endpoint.beforeRevision !== null &&
    !policyRevisionSchema.safeParse(endpoint.beforeRevision).success
  )
    throw new RevisionChangesApiError(
      'INVALID_REQUEST',
      400,
      'Use the exact history revision.',
      'refused',
    );
  if (endpoint.kind === 'head') {
    const q = endpoint.query;
    if (
      !['object-mapping', 'frame-mapping', 'binding-frame-qualification'].includes(q.kind) ||
      Object.keys(q).some(
        (key) =>
          ![
            'kind',
            ...(q.kind === 'object-mapping'
              ? ['sourceObjectRevisionIds']
              : q.kind === 'binding-frame-qualification'
                ? ['sourceBindingId']
                : []),
          ].includes(key),
      ) ||
      (q.kind === 'object-mapping' &&
        (!q.sourceObjectRevisionIds.length ||
          q.sourceObjectRevisionIds.length > 100 ||
          new Set(q.sourceObjectRevisionIds).size !== q.sourceObjectRevisionIds.length ||
          q.sourceObjectRevisionIds.some((id) => !policyUuidSchema.safeParse(id).success))) ||
      (q.kind === 'binding-frame-qualification' &&
        !policyUuidSchema.safeParse(q.sourceBindingId).success)
    )
      throw new RevisionChangesApiError(
        'INVALID_REQUEST',
        400,
        'Select exact source review identifiers.',
        'refused',
      );
  }
  switch (endpoint.kind) {
    case 'context':
      suffix = '/context';
      break;
    case 'create':
      method = 'POST';
      break;
    case 'list':
      suffix = `?offset=${endpoint.offset}&limit=25`;
      break;
    case 'manifest':
      suffix = `/${endpoint.comparisonId}`;
      break;
    case 'changes':
      suffix = `/${endpoint.comparisonId}/changes?offset=${endpoint.offset}&limit=25`;
      break;
    case 'history':
      suffix = `/${endpoint.comparisonId}/decisions?limit=25${endpoint.beforeRevision === null ? '' : '&beforeRevision=' + endpoint.beforeRevision}`;
      break;
    case 'decision':
      suffix = `/${endpoint.comparisonId}/decisions`;
      method = 'POST';
      break;
  }
  if (endpoint.kind === 'head') {
    const q = endpoint.query;
    suffix = `/${endpoint.comparisonId}/decision-head?kind=${q.kind}${q.kind === 'object-mapping' ? '&sourceObjectRevisionIds=' + q.sourceObjectRevisionIds.join(',') : q.kind === 'binding-frame-qualification' ? '&sourceBindingId=' + q.sourceBindingId : ''}`;
  }
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  if (encoded && new TextEncoder().encode(encoded).byteLength > 65536)
    throw new RevisionChangesApiError(
      'BODY_LIMIT',
      413,
      'The comparison command exceeds its supported size.',
      'refused',
    );
  const response = await fetch(
    `${getApiBaseUrl()}/api/projects/${projectId}/pathfinder/revision-comparisons${suffix}`,
    {
      method,
      signal,
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(encoded ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(encoded ? { body: encoded } : {}),
    },
  );
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
    const parsed = revisionComparisonErrorSchema.safeParse(value);
    if (!parsed.success) return invalid();
    throw new RevisionChangesApiError(
      parsed.data.code,
      response.status,
      parsed.data.message,
      parsed.data.outcome,
    );
  }
  return value;
}
export async function verifyRevisionContent(value: { contentSha256: string }) {
  const { contentSha256, ...input } = value;
  const actual = [
    ...new Uint8Array(
      await digestSha256(new TextEncoder().encode(canonicalPurposeJson(input))),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (actual !== contentSha256) return invalid();
}
export async function fetchRevisionComparisonContext(
  projectId: string,
  token: string,
  signal?: AbortSignal,
): Promise<RevisionComparisonContext> {
  const parsed = revisionComparisonContextSchema.safeParse(
    await request(projectId, token, { kind: 'context' }, undefined, signal),
  );
  return parsed.success && parsed.data.projectId === projectId ? parsed.data : invalid();
}
export async function fetchRevisionComparisons(
  projectId: string,
  token: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<RevisionComparisonList> {
  const parsed = revisionComparisonListSchema.safeParse(
    await request(projectId, token, { kind: 'list', offset }, undefined, signal),
  );
  if (
    !parsed.success ||
    parsed.data.projectId !== projectId ||
    parsed.data.offset !== offset ||
    parsed.data.comparisons.length > 25 ||
    new Set(parsed.data.comparisons.map((item) => item.id)).size !==
      parsed.data.comparisons.length ||
    (parsed.data.nextOffset !== null && parsed.data.nextOffset <= offset)
  )
    return invalid();
  for (const item of parsed.data.comparisons) await verifyRevisionContent(item);
  return parsed.data;
}
export async function fetchRevisionComparison(
  projectId: string,
  token: string,
  comparisonId: string,
  signal?: AbortSignal,
): Promise<RevisionComparisonManifest> {
  const parsed = revisionComparisonManifestSchema.safeParse(
    await request(projectId, token, { kind: 'manifest', comparisonId }, undefined, signal),
  );
  if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.id !== comparisonId)
    return invalid();
  await verifyRevisionContent(parsed.data);
  return parsed.data;
}
export async function createRevisionComparison(
  projectId: string,
  token: string,
  input: RevisionComparisonCreate,
  signal?: AbortSignal,
): Promise<RevisionComparisonReceipt> {
  const body = revisionComparisonCreateSchema.safeParse(input);
  if (!body.success)
    throw new RevisionChangesApiError(
      'INVALID_REQUEST',
      400,
      'Review the exact historical pair and comparison revision.',
      'refused',
    );
  const parsed = revisionComparisonReceiptSchema.safeParse(
    await request(projectId, token, { kind: 'create' }, body.data, signal),
  );
  if (
    !parsed.success ||
    parsed.data.comparison.projectId !== projectId ||
    ['source', 'target'].some((side) => {
      const key = side as 'source' | 'target';
      const actual = parsed.data.comparison[key],
        expected = input[key];
      return Object.entries(expected).some(
        ([field, value]) => actual[field as keyof typeof expected] !== value,
      );
    })
  )
    return invalid();
  await verifyRevisionContent(parsed.data.comparison);
  return parsed.data;
}
export async function fetchRevisionChanges(
  projectId: string,
  token: string,
  comparisonId: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<RevisionComparisonChangesPage> {
  const parsed = revisionComparisonChangesPageSchema.safeParse(
    await request(projectId, token, { kind: 'changes', comparisonId, offset }, undefined, signal),
  );
  return parsed.success &&
    parsed.data.projectId === projectId &&
    parsed.data.comparisonId === comparisonId &&
    parsed.data.offset === offset
    ? parsed.data
    : invalid();
}
export async function saveRevisionDecision(
  projectId: string,
  token: string,
  comparisonId: string,
  input: RevisionComparisonDecisionWrite,
  signal?: AbortSignal,
): Promise<RevisionComparisonDecisionReceipt> {
  const body = revisionComparisonDecisionWriteSchema.safeParse(input);
  if (!body.success)
    throw new RevisionChangesApiError(
      'INVALID_REQUEST',
      400,
      'Review the exact mapping candidates, evidence and reason.',
      'refused',
    );
  const parsed = revisionComparisonDecisionReceiptSchema.safeParse(
    await request(projectId, token, { kind: 'decision', comparisonId }, body.data, signal),
  );
  if (
    !parsed.success ||
    parsed.data.projectId !== projectId ||
    parsed.data.comparisonId !== comparisonId ||
    parsed.data.decision.kind !== input.kind ||
    canonicalPurposeJson(parsed.data.decision.body) !== canonicalPurposeJson(input.body) ||
    parsed.data.decision.reason !== input.reason
  )
    return invalid();
  await verifyRevisionContent(parsed.data.decision);
  return parsed.data;
}
export async function fetchRevisionDecisionHistory(
  projectId: string,
  token: string,
  comparisonId: string,
  beforeRevision: string | null = null,
  signal?: AbortSignal,
): Promise<RevisionComparisonDecisionHistory> {
  const parsed = revisionComparisonDecisionHistorySchema.safeParse(
    await request(
      projectId,
      token,
      { kind: 'history', comparisonId, beforeRevision },
      undefined,
      signal,
    ),
  );
  if (
    !parsed.success ||
    parsed.data.projectId !== projectId ||
    parsed.data.comparisonId !== comparisonId
  )
    return invalid();
  let previous = beforeRevision === null ? null : BigInt(beforeRevision);
  for (const decision of parsed.data.decisions) {
    if (previous !== null && BigInt(decision.comparisonRevision) >= previous) return invalid();
    previous = BigInt(decision.comparisonRevision);
    await verifyRevisionContent(decision);
  }
  return parsed.data;
}
export async function fetchRevisionDecisionHead(
  projectId: string,
  token: string,
  comparisonId: string,
  query: RevisionDecisionHeadQuery,
  signal?: AbortSignal,
): Promise<RevisionComparisonDecisionHead> {
  const parsed = revisionComparisonDecisionHeadSchema.safeParse(
    await request(projectId, token, { kind: 'head', comparisonId, query }, undefined, signal),
  );
  if (
    !parsed.success ||
    parsed.data.projectId !== projectId ||
    parsed.data.comparisonId !== comparisonId
  )
    return invalid();
  if (parsed.data.head) await verifyRevisionContent(parsed.data.head);
  return parsed.data;
}
