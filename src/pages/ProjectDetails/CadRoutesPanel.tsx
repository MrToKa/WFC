import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Caption1, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Spinner, Title3 } from '@fluentui/react-components';
import { getApiBaseUrl } from '@/api/http';
import { TRAY_PURPOSE_OPTIONS } from '@/constants/trayPurposeOptions';
import { cadRouteGroupInputSchema, type CadRouteGroup } from '../../../shared/cadRouteGroups';

type Instance = { id: string; partNumber: string; revision: number; xMm: number; yMm: number; zMm: number };
type Props = { projectId: string; designId: string; token: string; instances: Instance[]; displayedIds: string[];
  onColor: (id: string, color: string) => Promise<void>; onGeometryChanged?: () => Promise<void> };
type AttachmentOptions = { options: { objectRevisionId: string; objectId: string; portIndex: number; pointMetres: number[]; routeCode: string }[];
  endpoints: { instanceId: string; portName: 'start' | 'end'; pointMetres: number[] }[] };
const empty = { name: '', tag: '', color: '#3B82F6', purpose: '' };

export function CadRoutesPanel({ projectId, designId, token, instances, displayedIds, onColor, onGeometryChanged }: Props) {
  const [routes, setRoutes] = useState<CadRouteGroup[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [fields, setFields] = useState(empty);
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [removeCandidate, setRemoveCandidate] = useState<CadRouteGroup | null>(null);
  const [attachmentOptions, setAttachmentOptions] = useState<AttachmentOptions | null>(null);
  const [attachmentMessage, setAttachmentMessage] = useState('');
  const [attachmentPairs, setAttachmentPairs] = useState([{ endpoint: '', target: '' }, { endpoint: '', target: '' }]);
  const colors = useRef(new Map<string, string>());
  const selected = routes.find(route => route.id === selectedId);
  const unsavedChanges = Boolean(selected && (selected.name !== fields.name.trim() || selected.tag !== fields.tag.trim().toUpperCase() ||
    selected.color !== fields.color.toUpperCase() || selected.purpose !== fields.purpose.trim() ||
    JSON.stringify([...selected.instanceIds].sort()) !== JSON.stringify([...members].sort())));
  const base = `${getApiBaseUrl()}/api/projects/${projectId}/cad-design/designs/${designId}/routes`;
  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(base + path, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, ...init.headers } });
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || error.message || error.code || `HTTP ${response.status}`); }
    return response;
  }, [base, token]);
  const reload = useCallback(async (signal?: AbortSignal) => {
    const data = await (await request('', { signal })).json();
    if (!Array.isArray(data.routes)) throw new Error('Cannot read saved routes.');
    if (!signal?.aborted) setRoutes(data.routes);
  }, [request]);
  useEffect(() => {
    const controller = new AbortController(); setRoutes([]); setSelectedId(''); setFields(empty); setMembers([]); setLoading(true); colors.current.clear();
    void reload(controller.signal).catch(error => { if (!controller.signal.aborted) setMessage(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    setAttachmentOptions(null); setAttachmentMessage(''); setAttachmentPairs([{ endpoint: '', target: '' }, { endpoint: '', target: '' }]);
    if (!selected || selected.status !== 'draft') return;
    const controller = new AbortController();
    void request(`/${selected.id}/attachment-options`, { signal: controller.signal }).then(response => response.json()).then(data => {
      if (!Array.isArray(data.options) || !Array.isArray(data.endpoints)) throw new Error('Network connection options are unavailable.');
      if (!controller.signal.aborted) setAttachmentOptions(data);
    }).catch(error => { if (!controller.signal.aborted) setAttachmentMessage(error.message); });
    return () => controller.abort();
  }, [request, selected]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const instance of instances) {
        if (cancelled || !displayedIds.includes(instance.id)) continue;
        const color = routes.find(route => route.instanceIds.includes(instance.id))?.color ?? '#D9AB33';
        const identity = `${color}:${instance.revision}`;
        if (colors.current.get(instance.id) === identity) continue;
        try { await onColor(instance.id, color); if (!cancelled) colors.current.set(instance.id, identity); }
        catch (error) { if (!cancelled) setMessage(`Route colour: ${error instanceof Error ? error.message : 'Display failed.'}`); }
      }
    })();
    return () => { cancelled = true; };
  }, [routes, instances, displayedIds, onColor]);
  const edit = (route: CadRouteGroup) => { setSelectedId(route.id); setFields({ name: route.name, tag: route.tag, color: route.color, purpose: route.purpose }); setMembers(route.instanceIds); setMessage(''); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = cadRouteGroupInputSchema.safeParse({ ...fields, instanceIds: members });
    if (!parsed.success) { setMessage('Enter a name, a unique tag (letters, digits, dot, dash or underscore), purpose, colour and at least one component.'); return; }
    if (busy) return; setBusy(true); setMessage('');
    try {
      const data = await (await request(selected ? `/${selected.id}` : '', { method: selected ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...parsed.data, ...(selected ? { expectedRevision: selected.revision } : {}) }) })).json();
      await reload(); edit(data.route); setMessage('Route saved. Its colour is applied to all member components.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Cannot save route.'); }
    finally { setBusy(false); }
  };
  const networkAction = async (action: 'publish' | 'withdraw' | 'align') => {
    if (!selected || busy) return;
    const attachments = attachmentPairs.filter(pair => pair.endpoint && pair.target).map(pair => {
      const [instanceId, portName] = pair.endpoint.split('/');
      const [targetObjectRevisionId, portIndex] = pair.target.split('/');
      return { instanceId, portName, targetObjectRevisionId, targetPortIndex: Number(portIndex) };
    });
    if (action !== 'withdraw' && !attachments.length) { setMessage('Choose at least one route end and an existing network connection point.'); return; }
    setBusy(true); setMessage('');
    try {
      await request(`/${selected.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: selected.revision,
        ...(action === 'publish' ? { attachments } : action === 'align' ? { attachment: attachments[0] } : {}) }) });
      if (action === 'align') await onGeometryChanged?.();
      await reload(); setMessage(action === 'publish' ? 'Route added to the routing network.' : action === 'align'
        ? 'Whole route aligned and saved. Its internal connections, lengths and STEP revisions are preserved. Select the network connection again to publish.' : 'Route withdrawn from the routing network.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Network publication failed.'); }
    finally { setBusy(false); }
  };
  const removeGroup = async () => {
    if (!removeCandidate || busy) return; setBusy(true);
    try {
      await request(`/${removeCandidate.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: removeCandidate.revision }) });
      setRemoveCandidate(null); setSelectedId(''); setFields(empty); setMembers([]); await reload();
      setMessage('Route group removed. Its individual components remain in the proposal.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Cannot remove route group.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Saved CAD routes">
    <Title3>Complete routes</Title3>
    <Caption1>Group placed components into one named route. X/Y/Z placement and STEP revisions remain individual.</Caption1>
    <Button disabled={busy || loading} onClick={() => {
      setBusy(true);
      void reload().then(() => { setSelectedId(''); setFields(empty); setMembers([]); setMessage('Saved routes refreshed.'); })
        .catch(error => setMessage(error.message)).finally(() => setBusy(false));
    }}>Refresh routes</Button>
    {loading ? <Spinner size="tiny" label="Loading saved routes" /> : null}
    {busy ? <Spinner size="tiny" label="Saving route…" /> : null}
    <ul>{routes.map(route => <li key={route.id}><Button disabled={busy} appearance={selectedId === route.id ? 'primary' : 'subtle'} onClick={() => edit(route)}>
      {route.tag} — {route.name} · {route.instanceIds.length} components · {route.status}
    </Button><span aria-label={`Route colour ${route.color}`} style={{ backgroundColor: route.color, display: 'inline-block', width: 16, height: 16, marginLeft: 8 }} /></li>)}</ul>
    <form aria-label="Save complete route" onSubmit={event => { void save(event); }}>
      <Field label="Route name"><Input aria-label="Route name" value={fields.name} maxLength={200} disabled={busy || selected?.status === 'published'} onChange={(_, data) => setFields(old => ({ ...old, name: data.value }))} /></Field>
      <Field label="Route tag"><Input aria-label="Route tag" value={fields.tag} maxLength={200} disabled={busy || selected?.status === 'published'} onChange={(_, data) => setFields(old => ({ ...old, tag: data.value }))} /></Field>
      <Field label="Route purpose"><select aria-label="Route purpose" value={fields.purpose} disabled={busy || selected?.status === 'published'} onChange={event => setFields(old => ({ ...old, purpose: event.target.value }))}>
        <option value="">Choose purpose</option>{TRAY_PURPOSE_OPTIONS.map(purpose => <option key={purpose} value={purpose}>{purpose}</option>)}
        {fields.purpose && !(TRAY_PURPOSE_OPTIONS as readonly string[]).includes(fields.purpose) ? <option value={fields.purpose}>{fields.purpose}</option> : null}
      </select></Field>
      <Field label="Route colour"><input aria-label="Route colour" type="color" value={fields.color} disabled={busy}
        onInput={event => { const value = event.currentTarget.value.toUpperCase(); setFields(old => ({ ...old, color: value })); }}
        onChange={event => setFields(old => ({ ...old, color: event.target.value.toUpperCase() }))} />
        <Input aria-label="Route colour hex" value={fields.color} maxLength={7} placeholder="#3B82F6" disabled={busy}
          onChange={(_, data) => setFields(old => ({ ...old, color: data.value.toUpperCase() }))} />
      </Field>
      <fieldset disabled={busy || selected?.status === 'published'}><legend>Route components</legend>{instances.map(instance => {
        const other = routes.find(route => route.id !== selectedId && route.instanceIds.includes(instance.id));
        return <label key={instance.id} style={{ display: 'block' }}><input type="checkbox" aria-label={`Include component ${instance.id}`} checked={members.includes(instance.id)} disabled={Boolean(other)}
          onChange={event => setMembers(old => event.target.checked ? [...old, instance.id] : old.filter(id => id !== instance.id))} />
          {instance.partNumber} · X {Math.round(instance.xMm)}, Y {Math.round(instance.yMm)}, Z {Math.round(instance.zMm)} mm{other ? ` (${other.tag})` : ''}
        </label>;
      })}</fieldset>
      <Button type="submit" appearance="primary" disabled={busy || loading || selected?.status === 'published' && selected.color === fields.color}>{selected ? 'Save route changes' : 'Save complete route'}</Button>
      <Button type="button" disabled={busy} onClick={() => { setSelectedId(''); setFields(empty); setMembers([]); setMessage(''); }}>New route</Button>
    </form>
    {selected?.status === 'draft' ? <fieldset disabled={busy}><legend>Connections to existing routing network</legend>
      <Caption1>Connect one or both ends to verified network points. The end positions must coincide before publication.</Caption1>
      {attachmentMessage ? <p>{attachmentMessage}</p> : null}
      {attachmentPairs.map((pair, index) => <div key={index}>
        <Field label={`Route end ${index + 1}`}><select aria-label={`Route end ${index + 1}`} value={pair.endpoint} onChange={event => setAttachmentPairs(old => old.map((value, row) => row === index ? { ...value, endpoint: event.target.value } : value))}>
          <option value="">Choose route end{index === 1 ? ' (optional)' : ''}</option>{attachmentOptions?.endpoints.map(endpoint => <option key={`${endpoint.instanceId}/${endpoint.portName}`} value={`${endpoint.instanceId}/${endpoint.portName}`}>
            {instances.find(instance => instance.id === endpoint.instanceId)?.partNumber} · {endpoint.instanceId.slice(0, 8)} · {endpoint.portName}
          </option>)}
        </select></Field>
        <Field label={`Network point ${index + 1}`}><select aria-label={`Network point ${index + 1}`} value={pair.target} onChange={event => setAttachmentPairs(old => old.map((value, row) => row === index ? { ...value, target: event.target.value } : value))}>
          <option value="">Choose existing network point</option>{attachmentOptions?.options.map(option => <option key={`${option.objectRevisionId}/${option.portIndex}`} value={`${option.objectRevisionId}/${option.portIndex}`}>
            {option.routeCode} · {option.objectId} · end {option.portIndex + 1} · {option.pointMetres.join(', ')} m
          </option>)}
        </select></Field>
      </div>)}
      <Button disabled={!attachmentOptions || unsavedChanges || !attachmentPairs[0].endpoint || !attachmentPairs[0].target} onClick={() => { void networkAction('align'); }}>
        Align whole route to network point
      </Button>
    </fieldset> : null}
    {unsavedChanges ? <Caption1>Save route changes before continuing.</Caption1> : null}
    {selected ? <Button disabled={busy || selected.status === 'draft' && (!attachmentOptions || unsavedChanges)} onClick={() => { void networkAction(selected.status === 'published' ? 'withdraw' : 'publish'); }}>{selected.status === 'published' ? 'Withdraw from routing network' : 'Add to routing network'}</Button> : null}
    {selected?.status === 'draft' ? <Button disabled={busy} onClick={() => setRemoveCandidate(selected)}>Remove route group</Button> : null}
    <Dialog open={Boolean(removeCandidate)} onOpenChange={(_, data) => { if (!data.open && !busy) setRemoveCandidate(null); }}>
      <DialogSurface><DialogBody><DialogTitle>Remove route group?</DialogTitle>
        <DialogContent>{removeCandidate?.tag} — {removeCandidate?.name}<p>The individual components remain available. Only the grouping, name, tag and group colour are removed.</p></DialogContent>
        <DialogActions><Button disabled={busy} onClick={() => setRemoveCandidate(null)}>Cancel</Button><Button appearance="primary" disabled={busy} onClick={() => { void removeGroup(); }}>Remove group</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
    <div role="status" aria-live="polite">{message}</div>
  </section>;
}
