import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Spinner,
  Title3,
} from '@fluentui/react-components';
import { getApiBaseUrl } from '@/api/http';
import { TRAY_PURPOSE_OPTIONS } from '@/constants/trayPurposeOptions';
import { cadRouteGroupInputSchema, type CadRouteGroup } from '../../../shared/cadRouteGroups';

type Instance = {
  id: string;
  partNumber: string;
  revision: number;
  xMm: number;
  yMm: number;
  zMm: number;
};
type Props = {
  projectId: string;
  designId: string;
  token: string;
  instances: Instance[];
  displayedIds: string[];
  onColor: (id: string, color: string) => Promise<void>;
  onTraysChanged?: () => Promise<void>;
  onMetadataChanged?: () => Promise<void>;
  onGeometryChanged?: () => Promise<void>;
  onConnectionsChanged?: () => Promise<void>;
  onSelectionChange?: (route: CadRouteGroup | null) => void;
  onRoutesChange?: (routes: CadRouteGroup[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  onNewRoute?: () => void;
  resetKey?: number;
  memberScopeIds?: string[];
  newDraftInstanceIds?: string[];
  externalBusy?: boolean;
  creationActive?: boolean;
};
type AutoAttachment = {
  instanceId: string;
  portName: 'start' | 'end';
  targetObjectRevisionId: string;
  targetPortIndex: number;
  targetRouteCode?: string;
  targetPointMetres?: number[];
  gapMm?: number;
};
type AutomaticPoints = {
  status:
    | 'incomplete'
    | 'network-required'
    | 'aligned'
    | 'alignment-required'
    | 'ambiguous'
    | 'unavailable';
  attachments: AutoAttachment[];
  diagnostics?: {
    message?: string;
    logicalTransitions?: {
      sourceInstanceId: string;
      sourcePortName: string;
      targetInstanceId: string;
      targetPortName: string;
      gapMm: number;
    }[];
    nearestGaps?: {
      sourceInstanceId: string;
      sourcePortName: string;
      targetInstanceId: string;
      targetPortName: string;
      gapMm: number;
      aligned: boolean;
      orientationAligned?: boolean;
    }[];
  };
};
const empty = { name: '', color: '#3B82F6', purpose: '' };

export function CadRoutesPanel({
  projectId,
  designId,
  token,
  instances,
  displayedIds,
  onColor,
  onGeometryChanged,
  onConnectionsChanged,
  onTraysChanged,
  onMetadataChanged,
  onSelectionChange,
  onRoutesChange,
  onDirtyChange,
  onBusyChange,
  onNewRoute,
  resetKey = 0,
  memberScopeIds,
  newDraftInstanceIds,
  externalBusy = false,
  creationActive = false,
}: Props) {
  const [routes, setRoutes] = useState<CadRouteGroup[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [fields, setFields] = useState(empty);
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [removeCandidate, setRemoveCandidate] = useState<CadRouteGroup | null>(null);
  const [automaticPoints, setAutomaticPoints] = useState<AutomaticPoints | null>(null);
  const [automaticLoading, setAutomaticLoading] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState('');
  const colors = useRef(new Map<string, string>());
  const selected = routes.find((route) => route.id === selectedId);
  const geometryKey = instances
    .filter((instance) => selected?.instanceIds.includes(instance.id))
    .map((instance) => `${instance.id}:${instance.revision}`)
    .join(',');
  const pointsReady = Boolean(
    automaticPoints?.attachments.length &&
      ['aligned', 'alignment-required'].includes(automaticPoints.status),
  );
  const unsavedChanges = Boolean(
    selected &&
      (selected.name !== fields.name.trim() ||
        selected.color !== fields.color.toUpperCase() ||
        selected.purpose !== fields.purpose.trim() ||
        JSON.stringify([...selected.instanceIds].sort()) !== JSON.stringify([...members].sort())),
  );
  useEffect(() => {
    onRoutesChange?.(routes);
  }, [routes, onRoutesChange]);
  useEffect(() => {
    onDirtyChange?.(unsavedChanges);
  }, [unsavedChanges, onDirtyChange]);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    setSelectedId('');
    setFields(empty);
    setMembers([]);
    setMessage('');
  }, [resetKey]);
  useEffect(() => {
    if (!selectedId && newDraftInstanceIds)
      setMembers((old) => [
        ...new Set([
          ...old.filter((id) => !memberScopeIds || memberScopeIds.includes(id)),
          ...newDraftInstanceIds.filter((id) => !memberScopeIds || memberScopeIds.includes(id)),
        ]),
      ]);
  }, [selectedId, newDraftInstanceIds, memberScopeIds]);
  const base = `${getApiBaseUrl()}/api/projects/${projectId}/cad-design/designs/${designId}/routes`;
  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const response = await fetch(base + path, {
        ...init,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || error.message || error.code || `HTTP ${response.status}`);
      }
      return response;
    },
    [base, token],
  );
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const data = await (await request('', { signal })).json();
      if (!Array.isArray(data.routes)) throw new Error('Cannot read saved routes.');
      if (!signal?.aborted) setRoutes(data.routes);
    },
    [request],
  );
  useEffect(() => {
    const controller = new AbortController();
    setRoutes([]);
    setSelectedId('');
    setFields(empty);
    setMembers([]);
    setLoading(true);
    colors.current.clear();
    void reload(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    setAutomaticPoints(null);
    setAttachmentMessage('');
    setAutomaticLoading(false);
    if (!selected || selected.status !== 'draft') return;
    const controller = new AbortController();
    setAutomaticLoading(true);
    void request(`/${selected.id}/auto-attachments`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (!Array.isArray(data.attachments) || typeof data.status !== 'string')
          throw new Error('Automatic connection points are unavailable.');
        if (!controller.signal.aborted) setAutomaticPoints(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setAttachmentMessage(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAutomaticLoading(false);
      });
    return () => controller.abort();
  }, [request, selected, geometryKey]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const instance of instances) {
        if (cancelled || !displayedIds.includes(instance.id)) continue;
        const color =
          routes.find((route) => route.instanceIds.includes(instance.id))?.color ?? '#D9AB33';
        const identity = `${color}:${instance.revision}`;
        if (colors.current.get(instance.id) === identity) continue;
        try {
          await onColor(instance.id, color);
          if (!cancelled) colors.current.set(instance.id, identity);
        } catch (error) {
          if (!cancelled)
            setMessage(
              `Route colour: ${error instanceof Error ? error.message : 'Display failed.'}`,
            );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routes, instances, displayedIds, onColor]);
  const edit = (route: CadRouteGroup) => {
    setSelectedId(route.id);
    setFields({ name: route.name, color: route.color, purpose: route.purpose });
    setMembers(route.instanceIds);
    setMessage('');
    onSelectionChange?.(route);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const legacyTag =
      selected &&
      selected.name === fields.name.trim() &&
      selected.tag !== selected.name.trim().toUpperCase()
        ? selected.tag
        : undefined;
    const parsed = cadRouteGroupInputSchema.safeParse({
      ...fields,
      instanceIds: members,
      ...(legacyTag ? { tag: legacyTag } : {}),
    });
    if (!parsed.success) {
      setMessage(
        'Enter a unique route name (letters, digits, dot, dash or underscore), purpose, colour and at least one component.',
      );
      return;
    }
    if (busy || externalBusy) return;
    setBusy(true);
    setMessage('');
    try {
      const data = await (
        await request(selected ? `/${selected.id}` : '', {
          method: selected ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: parsed.data.name,
            color: parsed.data.color,
            purpose: parsed.data.purpose,
            instanceIds: parsed.data.instanceIds,
            ...(legacyTag ? { tag: legacyTag } : {}),
            ...(selected ? { expectedRevision: selected.revision } : {}),
          }),
        })
      ).json();
      await reload();
      edit(data.route);
      await onMetadataChanged?.();
      setMessage('Route saved. Its colour is applied to all member components.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cannot save route.');
    } finally {
      setBusy(false);
    }
  };
  const networkAction = async (action: 'publish' | 'withdraw' | 'align') => {
    if (!selected || busy || externalBusy) return;
    const attachments = (automaticPoints?.attachments ?? []).map(
      ({ instanceId, portName, targetObjectRevisionId, targetPortIndex }) => ({
        instanceId,
        portName,
        targetObjectRevisionId,
        targetPortIndex,
      }),
    );
    if (action !== 'withdraw' && !pointsReady) {
      setMessage('Find compatible automatic connection points before continuing.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await request(`/${selected.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: selected.revision,
          ...(action === 'publish'
            ? { attachments }
            : action === 'align'
              ? { attachment: attachments[0] }
              : {}),
        }),
      });
      if (action === 'align') await onGeometryChanged?.();
      await reload();
      setMessage(
        action === 'publish'
          ? 'Route added to the routing network.'
          : action === 'align'
            ? 'Whole route aligned and saved. Its internal connections, lengths and STEP revisions are preserved. Connection points are selected automatically again.'
            : 'Route withdrawn from the routing network.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Network publication failed.');
    } finally {
      setBusy(false);
    }
  };
  const autoConnect = async () => {
    if (!selected || busy || externalBusy || unsavedChanges) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await (
        await request(`/${selected.id}/auto-connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: selected.revision }),
        })
      ).json();
      await onConnectionsChanged?.();
      await reload();
      setMessage(
        `${result.connectionsCreated ?? 0} component connections and ${result.routingTransitionsCreated ?? 0} routing transitions saved automatically. ${result.connected ? 'The route is connected. Checking network connection points.' : 'Some ends need review: no unique nearby connection was found.'}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cannot find automatic connections.');
    } finally {
      setBusy(false);
    }
  };
  const addToTraysList = async () => {
    if (!selected || busy || externalBusy || unsavedChanges) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await (
        await request(`/${selected.id}/trays-list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: selected.revision }),
        })
      ).json();
      if (typeof result.lengthMm !== 'number' || !Number.isFinite(result.lengthMm))
        throw new Error('Cannot read the saved centreline length.');
      await onTraysChanged?.();
      setMessage(
        `Added to trays list: ${selected.name}. Centreline length: ${(result.lengthMm / 1000).toFixed(3)} m.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cannot add route to trays list.');
    } finally {
      setBusy(false);
    }
  };
  const removeGroup = async () => {
    if (!removeCandidate || busy || externalBusy) return;
    setBusy(true);
    try {
      await request(`/${removeCandidate.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: removeCandidate.revision }),
      });
      setRemoveCandidate(null);
      setSelectedId('');
      setFields(empty);
      setMembers([]);
      onSelectionChange?.(null);
      await reload();
      await onMetadataChanged?.();
      setMessage('Route group removed. Its individual components remain in the proposal.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cannot remove route group.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Saved CAD routes">
      <fieldset disabled={externalBusy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Title3 block>Complete routes</Title3>
        <Caption1 block>
          Group placed components into one named route. X/Y/Z placement and STEP revisions remain
          individual.
        </Caption1>
        <Button
          disabled={busy || loading}
          onClick={() => {
            setBusy(true);
            void reload()
              .then(async () => {
                await onMetadataChanged?.();
                setSelectedId('');
                setFields(empty);
                setMembers([]);
                onSelectionChange?.(null);
                setMessage('Saved routes refreshed.');
              })
              .catch((error) => setMessage(error.message))
              .finally(() => setBusy(false));
          }}
        >
          Refresh routes
        </Button>
        {loading ? <Spinner size="tiny" label="Loading saved routes" /> : null}
        {busy ? <Spinner size="tiny" label="Saving route…" /> : null}
        <ul>
          {routes.map((route) => (
            <li key={route.id}>
              <Button
                disabled={busy}
                appearance={selectedId === route.id ? 'primary' : 'subtle'}
                onClick={() => edit(route)}
              >
                {route.name} · {route.instanceIds.length} components · {route.status}
              </Button>
              <span
                aria-label={`Route colour ${route.color}`}
                style={{
                  backgroundColor: route.color,
                  display: 'inline-block',
                  width: 16,
                  height: 16,
                  marginLeft: 8,
                }}
              />
            </li>
          ))}
        </ul>
        {!onNewRoute || selected || creationActive ? (
          <form
            aria-label="Save complete route"
            onSubmit={(event) => {
              void save(event);
            }}
          >
            <Field label="Route name">
              <Input
                aria-label="Route name"
                value={fields.name}
                maxLength={200}
                disabled={busy || selected?.status === 'published'}
                onChange={(_, data) =>
                  setFields((old) => ({ ...old, name: data.value.toUpperCase() }))
                }
              />
            </Field>
            <Field label="Route purpose">
              <select
                aria-label="Route purpose"
                value={fields.purpose}
                disabled={busy || selected?.status === 'published'}
                onChange={(event) => setFields((old) => ({ ...old, purpose: event.target.value }))}
              >
                <option value="">Choose purpose</option>
                {TRAY_PURPOSE_OPTIONS.map((purpose) => (
                  <option key={purpose} value={purpose}>
                    {purpose}
                  </option>
                ))}
                {fields.purpose &&
                !(TRAY_PURPOSE_OPTIONS as readonly string[]).includes(fields.purpose) ? (
                  <option value={fields.purpose}>{fields.purpose}</option>
                ) : null}
              </select>
            </Field>
            <Field label="Route colour">
              <input
                aria-label="Route colour"
                type="color"
                value={fields.color}
                disabled={busy}
                onInput={(event) => {
                  const value = event.currentTarget.value.toUpperCase();
                  setFields((old) => ({ ...old, color: value }));
                }}
                onChange={(event) =>
                  setFields((old) => ({ ...old, color: event.target.value.toUpperCase() }))
                }
              />
              <Input
                aria-label="Route colour hex"
                value={fields.color}
                maxLength={7}
                placeholder="#3B82F6"
                disabled={busy}
                onChange={(_, data) =>
                  setFields((old) => ({ ...old, color: data.value.toUpperCase() }))
                }
              />
            </Field>
            <fieldset disabled={busy || selected?.status === 'published'}>
              <legend>Route components</legend>
              {instances
                .filter((instance) => !memberScopeIds || memberScopeIds.includes(instance.id))
                .map((instance, index) => {
                  const other = routes.find(
                    (route) => route.id !== selectedId && route.instanceIds.includes(instance.id),
                  );
                  return (
                    <label key={instance.id} style={{ display: 'block' }}>
                      <input
                        type="checkbox"
                        aria-label={`Include component ${instance.id}`}
                        checked={members.includes(instance.id)}
                        disabled={Boolean(other)}
                        onChange={(event) =>
                          setMembers((old) =>
                            event.target.checked
                              ? [...old, instance.id]
                              : old.filter((id) => id !== instance.id),
                          )
                        }
                      />
                      Component {index + 1}: {instance.partNumber} · X {Math.round(instance.xMm)}, Y{' '}
                      {Math.round(instance.yMm)}, Z {Math.round(instance.zMm)} mm
                      {other ? ` (${other.name})` : ''}
                    </label>
                  );
                })}
            </fieldset>
            <Button
              type="submit"
              appearance="primary"
              disabled={
                busy ||
                loading ||
                (selected?.status === 'published' && selected.color === fields.color)
              }
            >
              {selected ? 'Save route changes' : 'Save complete route'}
            </Button>
            {!onNewRoute ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  setSelectedId('');
                  setFields(empty);
                  setMembers([]);
                  setMessage('');
                  onSelectionChange?.(null);
                }}
              >
                New route
              </Button>
            ) : null}
          </form>
        ) : null}
        {selected ? (
          <Button
            disabled={busy || unsavedChanges}
            onClick={() => {
              void addToTraysList();
            }}
          >
            Add to trays list
          </Button>
        ) : null}
        {selected?.status === 'draft' ? (
          <fieldset disabled={busy}>
            <legend>Connections to existing routing network</legend>
            <Caption1>
              Route ends and compatible network points are detected automatically. Nearby
              installation transitions can connect differently oriented ends without moving
              components; their distance counts towards routing length.
            </Caption1>
            <Button
              disabled={busy || unsavedChanges || automaticLoading}
              onClick={() => {
                void autoConnect();
              }}
            >
              Auto-select connection points
            </Button>
            {automaticLoading ? <Spinner size="tiny" label="Finding connection points…" /> : null}
            {attachmentMessage ? <p>{attachmentMessage}</p> : null}
            {automaticPoints?.diagnostics?.message ? (
              <p>{automaticPoints.diagnostics.message}</p>
            ) : null}
            {automaticPoints?.attachments.length ? (
              <ul aria-label="Automatically selected network connections">
                {automaticPoints.attachments.map((attachment, index) => (
                  <li key={index}>
                    Component{' '}
                    {instances.findIndex((instance) => instance.id === attachment.instanceId) + 1}{' '}
                    {attachment.portName} → {attachment.targetRouteCode ?? 'Existing network point'}
                    {attachment.gapMm != null ? ` · ${Math.round(attachment.gapMm)} mm` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            {automaticPoints?.diagnostics?.logicalTransitions?.length ? (
              <ul aria-label="Installation routing transitions">
                {automaticPoints.diagnostics.logicalTransitions.map((link, index) => (
                  <li key={index}>
                    Component{' '}
                    {instances.findIndex((instance) => instance.id === link.sourceInstanceId) + 1}{' '}
                    {link.sourcePortName} → component{' '}
                    {instances.findIndex((instance) => instance.id === link.targetInstanceId) + 1}{' '}
                    {link.targetPortName}: {Math.round(link.gapMm)} mm routing transition
                  </li>
                ))}
              </ul>
            ) : null}
            {automaticPoints?.diagnostics?.nearestGaps?.length ? (
              <ul aria-label="Component connection gaps">
                {automaticPoints.diagnostics.nearestGaps.slice(0, 4).map((gap, index) => (
                  <li key={index}>
                    Component{' '}
                    {instances.findIndex((instance) => instance.id === gap.sourceInstanceId) + 1}{' '}
                    {gap.sourcePortName} → component{' '}
                    {instances.findIndex((instance) => instance.id === gap.targetInstanceId) + 1}{' '}
                    {gap.targetPortName}: {Math.round(gap.gapMm)} mm
                    {gap.orientationAligned === false ? ' · orientation differs' : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            <Button
              disabled={busy || automaticLoading || !pointsReady || unsavedChanges}
              onClick={() => {
                void networkAction('align');
              }}
            >
              Align whole route to network point
            </Button>
          </fieldset>
        ) : null}
        {unsavedChanges ? <Caption1>Save route changes before continuing.</Caption1> : null}
        {selected ? (
          <Button
            disabled={
              busy ||
              (selected.status === 'draft' && (!pointsReady || automaticLoading || unsavedChanges))
            }
            onClick={() => {
              void networkAction(selected.status === 'published' ? 'withdraw' : 'publish');
            }}
          >
            {selected.status === 'published'
              ? 'Withdraw from routing network'
              : 'Add to routing network'}
          </Button>
        ) : null}
        {selected?.status === 'draft' ? (
          <Button disabled={busy} onClick={() => setRemoveCandidate(selected)}>
            Remove route group
          </Button>
        ) : null}
        <Dialog
          open={Boolean(removeCandidate)}
          onOpenChange={(_, data) => {
            if (!data.open && !busy) setRemoveCandidate(null);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Remove route group?</DialogTitle>
              <DialogContent>
                {removeCandidate?.name}
                <p>
                  The individual components remain available. Only the grouping, name, tag and group
                  colour are removed.
                </p>
              </DialogContent>
              <DialogActions>
                <Button disabled={busy} onClick={() => setRemoveCandidate(null)}>
                  Cancel
                </Button>
                <Button
                  appearance="primary"
                  disabled={busy}
                  onClick={() => {
                    void removeGroup();
                  }}
                >
                  Remove group
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
        <div role="status" aria-live="polite">
          {message}
        </div>
      </fieldset>
    </section>
  );
}
