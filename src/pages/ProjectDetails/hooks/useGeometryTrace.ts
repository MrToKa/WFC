import { digestSha256 } from '../../../utils/sha256';
import { generateId } from '@/utils/generateId';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createGeometryTrace,
  fetchGeometryTraces,
  fetchGeometryTraceManifest,
  fetchGeometryTraceObjects,
  fetchGeometryObjectRevision,
  fetchCaptureEvidence,
  fetchGeometryTraceDiagnostics,
  GeometryTraceApiError,
  type GeometryTraceCreate,
  type GeometryTraceManifest,
  type GeometryObjectRevision,
  type GeometryObjectPage,
  type GeometryTraceList,
} from '@/api/pathfinderGeometryTrace';
import type { CompletedCaptureEvidence } from '../../../../viewer-runtime/capture-evidence.mjs';
import {
  GEOMETRY_TRACE_DERIVATION,
  type GeometryTraceDiagnosticsPage,
} from '../../../../shared/pathfinderGeometryTrace';
import { canonicalPurposeJson } from '../../../../shared/pathfinderPurposePolicy';
import type { usePathFinder } from './usePathFinder';

type State = {
  identity: string;
  list: GeometryTraceList | null;
  manifest: GeometryTraceManifest | null;
  page: GeometryObjectPage | null;
  object: GeometryObjectRevision | null;
  evidence: CompletedCaptureEvidence | null;
  diagnostics: GeometryTraceDiagnosticsPage | null;
  busy: boolean;
  unknown: boolean;
  error: string | null;
};
const empty = (identity: string): State => ({
  identity,
  list: null,
  manifest: null,
  page: null,
  object: null,
  evidence: null,
  diagnostics: null,
  busy: false,
  unknown: false,
  error: null,
});
export function useGeometryTrace(pf: ReturnType<typeof usePathFinder>, active: boolean) {
  const access = pf.preparationAccess,
    identity = JSON.stringify([
      access?.projectId,
      access?.loadedProjectId,
      access?.token,
      access?.isAdmin,
      pf.data?.activeModel.modelVersionId,
      pf.data?.activeModel.selectionRevision,
      pf.preparationViewerGeneration,
    ]);
  const accountIdentity = JSON.stringify([
    access?.projectId,
    access?.loadedProjectId,
    access?.token,
    access?.isAdmin,
  ]);
  const pendingAccount = useRef(accountIdentity);
  const enabled = Boolean(
    access?.isAdmin &&
      access.token &&
      access.projectId === access.loadedProjectId &&
      access.projectId,
  );
  const latest = useRef(identity);
  latest.current = identity;
  const latestPf = useRef(pf);
  latestPf.current = pf;
  const mounted = useRef(true),
    abort = useRef<AbortController | null>(null),
    busy = useRef(false),
    pending = useRef<GeometryTraceCreate | null>(null);
  const [state, setState] = useState<State>(() => empty(identity)),
    stateRef = useRef(state);
  stateRef.current = state;
  const current = useCallback(
    (signal?: AbortSignal) => {
      if (!mounted.current || latest.current !== identity || signal?.aborted)
        throw new DOMException('Traceability context changed.', 'AbortError');
    },
    [identity],
  );
  const update = useCallback(
    (change: Partial<State>) => {
      if (mounted.current && latest.current === identity)
        setState((value) => ({ ...value, ...change }));
    },
    [identity],
  );
  const run = useCallback(
    async (operation: (signal: AbortSignal) => Promise<void>) => {
      if (!enabled || busy.current) return;
      busy.current = true;
      const controller = new AbortController();
      abort.current = controller;
      update({ busy: true, error: null });
      try {
        await operation(controller.signal);
        current(controller.signal);
      } catch (error) {
        if (latest.current !== identity || !mounted.current) return;
        if (error instanceof GeometryTraceApiError && [401, 403].includes(error.status ?? 0)) {
          pending.current = null;
          latestPf.current.cancelOperation();
          latestPf.current.refresh();
          setState({ ...empty(identity), error: error.message });
        } else {
          const unknown =
            Boolean(pending.current) &&
            (!(error instanceof GeometryTraceApiError) || error.outcome === 'unknown');
          if (!unknown) pending.current = null;
          update({
            unknown,
            error:
              error instanceof DOMException && error.name === 'AbortError'
                ? null
                : unknown
                  ? 'Trace creation outcome is unknown. Retry the same saved command.'
                  : error instanceof Error
                    ? error.message
                    : 'Traceability could not be read.',
          });
        }
      } finally {
        if (abort.current === controller) {
          abort.current = null;
          busy.current = false;
        }
        update({ busy: false });
      }
    },
    [current, enabled, identity, update],
  );
  const readList = useCallback(
    async (signal: AbortSignal, offset = 0) => {
      const list = await fetchGeometryTraces(access.projectId!, access.token!, offset, signal);
      current(signal);
      update({ list, unknown: Boolean(pending.current) });
    },
    [access?.projectId, access?.token, current, update],
  );
  useEffect(() => {
    mounted.current = true;
    if (pendingAccount.current !== accountIdentity) {
      pending.current = null;
      pendingAccount.current = accountIdentity;
    }
    busy.current = false;
    abort.current?.abort();
    setState({ ...empty(identity), unknown: Boolean(pending.current) });
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, [identity, accountIdentity]);
  useEffect(() => {
    if (enabled && active) void run((signal) => readList(signal));
    else abort.current?.abort();
  }, [identity, enabled, active, run, readList]);
  const open = useCallback(
    (traceId: string) =>
      run(async (signal) => {
        if (pending.current) return;
        const manifest = await fetchGeometryTraceManifest(
          access.projectId!,
          access.token!,
          traceId,
          signal,
        );
        current(signal);
        const page = await fetchGeometryTraceObjects(
          access.projectId!,
          access.token!,
          traceId,
          0,
          signal,
        );
        current(signal);
        if (page.contentSha256 !== manifest.contentSha256)
          throw new Error('Trace object page belongs to different saved bytes.');
        update({ manifest, page, object: null, evidence: null, diagnostics: null });
      }),
    [run, access?.projectId, access?.token, current, update],
  );
  const objects = useCallback(
    (offset: number) =>
      run(async (signal) => {
        if (pending.current || !stateRef.current.manifest) return;
        const manifest = stateRef.current.manifest;
        const page = await fetchGeometryTraceObjects(
          access.projectId!,
          access.token!,
          manifest.id,
          offset,
          signal,
        );
        current(signal);
        if (page.contentSha256 !== manifest.contentSha256)
          throw new Error('Trace object page changed.');
        update({ page, object: null, evidence: null });
      }),
    [run, access?.projectId, access?.token, current, update],
  );
  const inspect = useCallback(
    (id: string) =>
      run(async (signal) => {
        if (pending.current || !stateRef.current.manifest) return;
        const manifest = stateRef.current.manifest,
          summary = stateRef.current.page?.objects.find((object) => object.id === id);
        if (!summary) return;
        const object = await fetchGeometryObjectRevision(
          access.projectId!,
          access.token!,
          manifest.id,
          id,
          signal,
        );
        current(signal);
        const digest = [
          ...new Uint8Array(
            await digestSha256(new TextEncoder().encode(canonicalPurposeJson(object)),
            ),
          ),
        ]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        current(signal);
        if (
          digest !== summary.recordSha256 ||
          object.aggregateId !== manifest.aggregateId ||
          object.modelVersionId !== manifest.modelVersionId
        )
          throw new Error('Object revision bytes do not match the immutable trace.');
        update({ object, evidence: null });
      }),
    [run, access?.projectId, access?.token, current, update],
  );
  const execute = useCallback(
    async (command: GeometryTraceCreate, signal: AbortSignal) => {
      pending.current = command;
      update({ unknown: false });
      const receipt = await createGeometryTrace(access.projectId!, access.token!, command, signal);
      pending.current = null;
      current(signal);
      update({
        manifest: receipt.trace,
        page: null,
        object: null,
        evidence: null,
        diagnostics: null,
        unknown: false,
      });
      await readList(signal);
    },
    [access?.projectId, access?.token, current, readList, update],
  );
  const create = useCallback(
    (aggregateId: string, projectionSha256: string) =>
      run(async (signal) => {
        if (pending.current) return;
        await execute(
          {
            schemaVersion: 'wfc.pf.geometry-trace-create.v1',
            aggregateId,
            expectedProjectionSha256: projectionSha256,
            derivationVersion: GEOMETRY_TRACE_DERIVATION,
            idempotencyKey: generateId(),
          },
          signal,
        );
      }),
    [run, execute],
  );
  const retry = useCallback(
    () =>
      run(async (signal) => {
        if (pending.current) await execute(pending.current, signal);
      }),
    [run, execute],
  );
  const readEvidence = useCallback(
    (partId: string) =>
      run(async (signal) => {
        const object = stateRef.current.object;
        if (
          pending.current ||
          !object ||
          !object.provenance.partIds.includes(partId) ||
          object.provenance.missingCaptureEvidencePartIds.includes(partId)
        )
          return;
        const evidence = await fetchCaptureEvidence(
          access.projectId!,
          access.token!,
          object.provenance.sessionId,
          partId,
          signal,
        );
        current(signal);
        const digest = [
          ...new Uint8Array(
            await digestSha256(new TextEncoder().encode(canonicalPurposeJson(evidence)),
            ),
          ),
        ]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        current(signal);
        if (
          evidence.binding.modelVersionId !== object.modelVersionId ||
          evidence.binding.contentFingerprint !== object.provenance.contentFingerprint ||
          !object.provenance.completedCaptureEvidence.some((ref) => ref.sha256 === digest)
        )
          throw new Error('Completed observations do not match this immutable object revision.');
        update({ evidence });
      }),
    [run, access?.projectId, access?.token, current, update],
  );
  const readDiagnostics = useCallback(
    (offset = 0) =>
      run(async (signal) => {
        const manifest = stateRef.current.manifest;
        if (pending.current || !manifest) return;
        const diagnostics = await fetchGeometryTraceDiagnostics(
          access.projectId!,
          access.token!,
          manifest.id,
          offset,
          signal,
        );
        current(signal);
        if (diagnostics.contentSha256 !== manifest.contentSha256)
          throw new Error('Diagnostics belong to different trace bytes.');
        update({ diagnostics });
      }),
    [run, access?.projectId, access?.token, current, update],
  );
  return {
    ...(state.identity === identity && enabled ? state : empty(identity)),
    enabled,
    refresh: (offset = 0) => run((signal) => readList(signal, offset)),
    open,
    objects,
    inspect,
    create,
    retry,
    readEvidence,
    readDiagnostics,
  };
}
