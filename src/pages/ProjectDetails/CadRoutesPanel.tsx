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
import { Flowchart20Regular, TableSimple20Regular } from '@fluentui/react-icons';
import { getApiBaseUrl } from '@/api/http';
import { useToast } from '@/context/ToastContext';
import { useProjectTrayPurposes } from '@/hooks/useProjectTrayPurposes';
import { cadRouteGroupInputSchema, type CadRouteGroup } from '../../../shared/cadRouteGroups';

type Instance = {
  id: string;
  partNumber: string;
  revision: number;
  xMm: number;
  yMm: number;
  zMm: number;
  lengthMm?: number | null;
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
  updatedRoute?: CadRouteGroup;
  onSectionVisibility?: (id: string, visible: boolean) => Promise<void>;
  hiddenSectionIds?: string[];
};
type AutoAttachment = {
  instanceId: string;
  portName: 'start' | 'end' | 'branch';
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
  updatedRoute,
  onSectionVisibility,
  hiddenSectionIds = [],
}: Props) {
  const { showToast } = useToast();
  const reportCommand = (
    title: string,
    body: string,
    intent: 'success' | 'error' | 'warning' = 'success',
  ) => {
    setMessage(body);
    showToast({ title, body, intent, ...(intent === 'success' ? {} : { timeout: 10000 }) });
  };
  const projectPurposes = useProjectTrayPurposes(projectId, token);
  const purposeOptions = projectPurposes.purposes
    .filter((purpose) => purpose.trayCount > 0)
    .map((purpose) => purpose.name);
  const [routes, setRoutes] = useState<CadRouteGroup[]>([]);
  const [addingExisting, setAddingExisting] = useState(false);
  const [existingId, setExistingId] = useState('');
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [fields, setFields] = useState(empty);
  const [members, setMembers] = useState<string[]>([]);
  const memberSelectionEpoch = useRef(0);
  const selectedMembershipRoute = useRef('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [removeCandidate, setRemoveCandidate] = useState<CadRouteGroup | null>(null);
  const [automaticPoints, setAutomaticPoints] = useState<AutomaticPoints | null>(null);
  const [automaticLoading, setAutomaticLoading] = useState(false);
  const [attachmentMessage, setAttachmentMessage] = useState('');
  const colors = useRef(new Map<string, string>());
  const selected = routes.find((route) => route.id === selectedId);
  const availableSections = instances.filter(
    (instance) => !selected?.instanceIds.includes(instance.id),
  );
  useEffect(() => {
    if (!updatedRoute) return;
    setRoutes((old) => old.map((route) => (route.id === updatedRoute.id ? updatedRoute : route)));
    memberSelectionEpoch.current++;
    selectedMembershipRoute.current = updatedRoute.id;
    setSelectedId(updatedRoute.id);
    setFields({
      name: updatedRoute.name,
      color: updatedRoute.color,
      purpose: updatedRoute.purpose,
    });
    setMembers(updatedRoute.instanceIds);
  }, [updatedRoute]);
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
    memberSelectionEpoch.current++;
    selectedMembershipRoute.current = '';
    setAddingExisting(false);
    setExistingId('');
    setSelectedId('');
    setFields(empty);
    setMembers([]);
    setMessage('');
  }, [resetKey]);
  useEffect(() => {
    if (!selectedId && newDraftInstanceIds) {
      const epoch = memberSelectionEpoch.current;
      setMembers((old) => {
        // React can replay this draft updater after a saved route is selected.
        // A later selection must retain its authoritative saved membership.
        if (selectedMembershipRoute.current || epoch !== memberSelectionEpoch.current) return old;
        return [
          ...new Set([
            ...old.filter((id) => !memberScopeIds || memberScopeIds.includes(id)),
            ...newDraftInstanceIds.filter((id) => !memberScopeIds || memberScopeIds.includes(id)),
          ]),
        ];
      });
    }
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
    memberSelectionEpoch.current++;
    selectedMembershipRoute.current = '';
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
    setAddingExisting(false);
    setExistingId('');
    memberSelectionEpoch.current++;
    selectedMembershipRoute.current = route.id;
    setSelectedId(route.id);
    setFields({ name: route.name, color: route.color, purpose: route.purpose });
    setMembers(route.instanceIds);
    setMessage('');
    onSelectionChange?.(route);
  };
  const toggleRoute = (route: CadRouteGroup) => {
    if (selectedId !== route.id) {
      edit(route);
      return;
    }
    memberSelectionEpoch.current++;
    selectedMembershipRoute.current = '';
    setSelectedId('');
    setFields(empty);
    setMembers([]);
    setAddingExisting(false);
    setExistingId('');
    setMessage('');
    onSelectionChange?.(null);
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
      reportCommand(
        'Cannot save route',
        'Enter a unique route name (letters, digits, dot, dash or underscore), purpose, colour and at least one component.',
        'warning',
      );
      return;
    }
    if (
      selected?.status !== 'published' &&
      (projectPurposes.loading || projectPurposes.error || !purposeOptions.includes(fields.purpose))
    ) {
      reportCommand(
        'Cannot save route',
        'Choose a purpose available in this project before saving.',
        'warning',
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
      if (selected) {
        try {
          await onTraysChanged?.();
        } catch {
          reportCommand(
            'Route saved',
            'Route and Trays entries saved. The Trays display could not be reloaded; reopen the project to see the updated entries.',
            'warning',
          );
          return;
        }
      }
      reportCommand('Route saved', 'Route saved. Its colour is applied to all member components.');
    } catch (error) {
      reportCommand(
        'Cannot save route',
        error instanceof Error ? error.message : 'Cannot save route.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };
  const addExisting = async () => {
    if (
      !selected ||
      selected.status !== 'draft' ||
      busy ||
      externalBusy ||
      unsavedChanges ||
      !availableSections.some((instance) => instance.id === existingId)
    )
      return;
    const source = routes.find((route) => route.instanceIds.includes(existingId));
    if (source?.status === 'published') return;
    setBusy(true);
    try {
      await onSectionVisibility?.(existingId, true);
      const data = await (
        await request(source ? `/${selected.id}/sections` : `/${selected.id}`, {
          method: source ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            source
              ? {
                  instanceId: existingId,
                  expectedRevision: selected.revision,
                  sourceRouteId: source.id,
                  expectedSourceRevision: source.revision,
                }
              : {
                  name: selected.name,
                  tag: selected.tag,
                  color: selected.color,
                  purpose: selected.purpose,
                  instanceIds: [...new Set([...selected.instanceIds, existingId])],
                  expectedRevision: selected.revision,
                },
          ),
        })
      ).json();
      if (source) await reload();
      else
        setRoutes((old) => old.map((route) => (route.id === data.route.id ? data.route : route)));
      edit(data.route);
      await onMetadataChanged?.();
      try {
        await onTraysChanged?.();
      } catch {
        reportCommand(
          'Section added',
          'Section assignment and Trays entries saved. The Trays display could not be reloaded; reopen the project to see the updated entries.',
          'warning',
        );
        return;
      }
      reportCommand(
        'Section added',
        source
          ? `Section moved from ${source.name} to ${data.route.name}.`
          : `Section added to ${data.route.name}.`,
      );
    } catch (error) {
      reportCommand(
        'Cannot add section',
        error instanceof Error ? error.message : 'Cannot add section.',
        'error',
      );
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
    if (action === 'align' && !pointsReady) {
      reportCommand(
        'Cannot align route',
        'Find compatible automatic connection points before continuing.',
        'warning',
      );
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
            ? { schemaVersion: 'wfc.cad.route-publication.write.v3' }
            : action === 'align'
              ? { attachment: attachments[0] }
              : {}),
        }),
      });
      if (action === 'align') await onGeometryChanged?.();
      if (action === 'publish' || action === 'withdraw') await onTraysChanged?.();
      await reload();
      reportCommand(
        action === 'publish'
          ? 'Route added to routing network'
          : action === 'align'
            ? 'Route aligned'
            : 'Route withdrawn',
        action === 'publish'
          ? 'Route added to the routing network.'
          : action === 'align'
            ? 'Whole route aligned and saved. Its internal connections, lengths and STEP revisions are preserved. Connection points are selected automatically again.'
            : 'Route withdrawn from the routing network.',
      );
    } catch (error) {
      reportCommand(
        'Routing network command failed',
        error instanceof Error ? error.message : 'Network publication failed.',
        'error',
      );
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
      reportCommand(
        'Connection points checked',
        `${result.connectionsCreated ?? 0} component connections and ${result.routingTransitionsCreated ?? 0} routing transitions saved automatically. ${result.connected ? 'The route is connected. Checking network connection points.' : 'Some ends need review: no unique nearby connection was found.'}`,
        result.connected ? 'success' : 'warning',
      );
    } catch (error) {
      reportCommand(
        'Cannot find connection points',
        error instanceof Error ? error.message : 'Cannot find automatic connections.',
        'error',
      );
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
      const trayId = result.trayId;
      if (typeof trayId === 'string') {
        setRoutes((old) =>
          old.map((route) =>
            route.id === selected.id ? { ...route, exportedTrayId: trayId } : route,
          ),
        );
      }
      await onTraysChanged?.();
      reportCommand(
        'Route added to trays list',
        `Added to trays list and assigned to saved geometry: ${selected.name}. Centreline length: ${(result.lengthMm / 1000).toFixed(3)} m.`,
      );
    } catch (error) {
      reportCommand(
        'Cannot add route to trays list',
        error instanceof Error ? error.message : 'Cannot add route to trays list.',
        'error',
      );
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
      memberSelectionEpoch.current++;
      selectedMembershipRoute.current = '';
      setSelectedId('');
      setFields(empty);
      setMembers([]);
      onSelectionChange?.(null);
      await reload();
      await onMetadataChanged?.();
      reportCommand(
        'Route group removed',
        'Route group removed. Its individual components remain in the proposal.',
      );
    } catch (error) {
      reportCommand(
        'Cannot remove route group',
        error instanceof Error ? error.message : 'Cannot remove route group.',
        'error',
      );
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
            void Promise.all([reload(), projectPurposes.refresh()])
              .then(async () => {
                await onMetadataChanged?.();
                memberSelectionEpoch.current++;
                selectedMembershipRoute.current = '';
                setSelectedId('');
                setFields(empty);
                setMembers([]);
                onSelectionChange?.(null);
                reportCommand('Routes refreshed', 'Saved routes refreshed.');
              })
              .catch((error) =>
                reportCommand(
                  'Cannot refresh routes',
                  error instanceof Error ? error.message : 'Cannot refresh saved routes.',
                  'error',
                ),
              )
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
                aria-pressed={selectedId === route.id}
                onClick={() => toggleRoute(route)}
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
              <span
                style={{ display: 'inline-flex', gap: 8, marginLeft: 8, verticalAlign: 'middle' }}
              >
                {route.projectTrayId || route.exportedTrayId ? (
                  <span role="img" aria-label="In Trays list" title="In Trays list">
                    <TableSimple20Regular aria-hidden />
                  </span>
                ) : null}
                {route.status === 'published' ? (
                  <span role="img" aria-label="In routing network" title="In routing network">
                    <Flowchart20Regular aria-hidden />
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {selected ? (
          <Button
            disabled={
              busy ||
              loading ||
              unsavedChanges ||
              selected.status !== 'draft' ||
              !availableSections.length
            }
            onClick={() => {
              setExistingId('');
              setAddingExisting(true);
            }}
          >
            Add existing section
          </Button>
        ) : null}
        {addingExisting ? (
          <section aria-label="Add existing section">
            <Caption1 block>Add existing section to {selected?.name}</Caption1>
            <div>
              <Caption1>
                Toggle Show/Hide to identify a section in the 3D model. Sections assigned to another
                route will be moved to this route.
              </Caption1>
              <fieldset disabled={busy || visibilityBusy || externalBusy}>
                <legend>Available sections</legend>
                {availableSections.map((instance) => {
                  const source = routes.find((route) => route.instanceIds.includes(instance.id));
                  return (
                    <div key={instance.id}>
                      <label>
                        <input
                          type="radio"
                          name="existing-section"
                          value={instance.id}
                          checked={existingId === instance.id}
                          disabled={source?.status === 'published'}
                          onChange={() => setExistingId(instance.id)}
                        />
                        {instance.partNumber}
                        {instance.lengthMm != null ? ` · ${instance.lengthMm} mm` : ''} · X{' '}
                        {instance.xMm}, Y {instance.yMm}, Z {instance.zMm} mm
                        {source
                          ? ` · ${source.name}${source.status === 'published' ? ' (withdraw from routing network before moving)' : ' → move to ' + selected?.name}`
                          : ' · Unassigned'}
                      </label>
                      {onSectionVisibility ? (
                        <Button
                          aria-label={`${hiddenSectionIds.includes(instance.id) ? 'Show' : 'Hide'} section ${instance.id}`}
                          disabled={!displayedIds.includes(instance.id)}
                          onClick={() => {
                            setVisibilityBusy(true);
                            void onSectionVisibility(
                              instance.id,
                              hiddenSectionIds.includes(instance.id),
                            )
                              .then(() =>
                                reportCommand(
                                  'Section visibility updated',
                                  `Section ${instance.partNumber} ${hiddenSectionIds.includes(instance.id) ? 'shown' : 'hidden'}.`,
                                ),
                              )
                              .catch((error) =>
                                reportCommand(
                                  'Cannot change section visibility',
                                  error instanceof Error
                                    ? error.message
                                    : 'Cannot change section visibility.',
                                  'error',
                                ),
                              )
                              .finally(() => setVisibilityBusy(false));
                          }}
                        >
                          {hiddenSectionIds.includes(instance.id) ? 'Show' : 'Hide'}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </fieldset>
            </div>
            <div>
              <Button disabled={busy || visibilityBusy} onClick={() => setAddingExisting(false)}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                disabled={busy || visibilityBusy || externalBusy || !existingId}
                onClick={() => {
                  void addExisting();
                }}
              >
                Add section
              </Button>
            </div>
          </section>
        ) : null}
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
            <Field
              label="Route purpose"
              hint={
                projectPurposes.error ||
                (projectPurposes.loading
                  ? 'Loading project purposes…'
                  : purposeOptions.length === 0
                    ? 'No tray purposes are available in this project.'
                    : fields.purpose && !purposeOptions.includes(fields.purpose)
                      ? 'This saved purpose is unavailable in this project. Choose a current purpose.'
                      : undefined)
              }
            >
              <select
                aria-label="Route purpose"
                value={fields.purpose}
                disabled={
                  busy ||
                  projectPurposes.loading ||
                  Boolean(projectPurposes.error) ||
                  selected?.status === 'published'
                }
                onChange={(event) => setFields((old) => ({ ...old, purpose: event.target.value }))}
              >
                <option value="">Choose purpose</option>
                {purposeOptions.map((purpose) => (
                  <option key={purpose} value={purpose}>
                    {purpose}
                  </option>
                ))}
                {fields.purpose && !purposeOptions.includes(fields.purpose) ? (
                  <option value={fields.purpose} disabled>
                    {fields.purpose} (unavailable in this project)
                  </option>
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
                (selected?.status !== 'published' &&
                  (projectPurposes.loading ||
                    Boolean(projectPurposes.error) ||
                    (Boolean(fields.purpose) && !purposeOptions.includes(fields.purpose)) ||
                    purposeOptions.length === 0)) ||
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
                  memberSelectionEpoch.current++;
                  selectedMembershipRoute.current = '';
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
        {selected ? (
          <Caption1>
            Routes can be separate or connect to nearby trays using the project connection gap.
            Sections within one route can also be separate. Empty gaps are not included in the saved
            tray length. Cable routing checks the current purposes and registered barriers.
          </Caption1>
        ) : null}
        {selected?.status === 'draft' ? (
          <Caption1>
            Add to trays list saves this route in the project Trays list. Use Add to routing network
            to make the saved route available for cable calculations.
          </Caption1>
        ) : null}
        {selected?.status === 'draft' ? (
          <fieldset disabled={busy}>
            <legend>Optional alignment with the existing routing network</legend>
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
            disabled={busy || (selected.status === 'draft' && unsavedChanges)}
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
