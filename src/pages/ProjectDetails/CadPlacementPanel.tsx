import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Body1, Button, Caption1, Field, Input, Spinner } from '@fluentui/react-components';
import { getApiBaseUrl } from '@/api/http';
import { normalizeQuaternion, alignConnectorPorts } from '@/viewer/componentTransforms';
import { getAalborgPocPorts, MATE_OPPOSING_FACE } from '@/viewer/pocConnectorCatalog';
import type { ViewerController } from '@/viewer/ViewerController';

type CatalogueItem = { id: string; partNumber: string; manufacturer: string; originalFilename: string; sourceSha256: string; conversionStatus: string; materialAssetId?: string | null; cadRevision?: number | null };
type Design = { id: string; modelVersionId: string; name: string; status: string; revision: number; activeModel: boolean };
type Connection = {
  id: string; sourceInstanceId: string; targetInstanceId: string;
  sourcePortId: string; targetPortId: string;
};
type Instance = {
  id: string; catalogItemId: string; partNumber: string; manufacturer: string; revision: number;
  xMm: number; yMm: number; zMm: number; qx: number; qy: number; qz: number; qw: number;
};
type Props = { projectId: string; modelVersionId: string; token: string; catalogue: CatalogueItem[];
  onPick: ViewerController['pickPoint']; onShow: ViewerController['showCadComponent']; onMove: ViewerController['moveCadComponent'];
  onFocus?: ViewerController['focusCadComponent']; };
type Coordinates = { x: string; y: string; z: string; rx: string; ry: string; rz: string };
const empty: Coordinates = { x: '0', y: '0', z: '0', rx: '0', ry: '0', rz: '0' };

function eulerQuaternion(rx: number, ry: number, rz: number) {
  const a = rx * Math.PI / 360, b = ry * Math.PI / 360, c = rz * Math.PI / 360;
  const [sa, ca, sb, cb, sc, cc] = [Math.sin(a), Math.cos(a), Math.sin(b), Math.cos(b), Math.sin(c), Math.cos(c)];
  return normalizeQuaternion({
    x: sa * cb * cc - ca * sb * sc,
    y: ca * sb * cc + sa * cb * sc,
    z: ca * cb * sc - sa * sb * cc,
    w: ca * cb * cc + sa * sb * sc,
  });
}

function quaternionEuler(instance: Instance): Pick<Coordinates, 'rx' | 'ry' | 'rz'> {
  const { qx: x, qy: y, qz: z, qw: w } = instance;
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
  return {
    rx: String(180 / Math.PI * Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))),
    ry: String(180 / Math.PI * pitch),
    rz: String(180 / Math.PI * Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))),
  };
}

export function CadPlacementPanel({ projectId, modelVersionId, token, catalogue, onPick, onShow, onMove, onFocus }: Props) {
  const rendered = useRef(new Set<string>());
  const [displayedIds, setDisplayedIds] = useState<string[]>([]);
  const [displaying, setDisplaying] = useState(false);
  const [designId, setDesignId] = useState<string | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [editingId, setEditingId] = useState<string>('');
  const [snapTarget, setSnapTarget] = useState('');
  const [snapTargetPort, setSnapTargetPort] = useState('');
  const [snapSourcePort, setSnapSourcePort] = useState('');
  const [pendingSnap, setPendingSnap] = useState<{
    targetInstanceId: string;
    targetPortName: 'start' | 'end';
    sourcePortName: 'start' | 'end';
  } | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [coordinates, setCoordinates] = useState<Coordinates>(empty);
  const [moveStepMm, setMoveStepMm] = useState('50');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const base = `${getApiBaseUrl()}/api/projects/${projectId}/cad-design`;
  const activeCatalogue = catalogue.filter(item => item.conversionStatus === 'ready' && item.materialAssetId);
  const editing = instances.find(instance => instance.id === editingId);
  const sourcePorts = getAalborgPocPorts(catalogue.find(item => item.id === selectedId)?.originalFilename ?? '', catalogue.find(item => item.id === selectedId)?.sourceSha256 ?? '');
  const target = instances.find(instance => instance.id === snapTarget);
  const targetPorts = getAalborgPocPorts(catalogue.find(item => item.id === target?.catalogItemId)?.originalFilename ?? '', catalogue.find(item => item.id === target?.catalogItemId)?.sourceSha256 ?? '');

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
    if (!response.ok) {
      let code = `HTTP ${response.status}`;
      try { const payload: { code?: string } = await response.json(); if (payload.code) code = payload.code; } catch { /* Safe error only */ }
      throw new Error(code);
    }
    return response;
  }, [base, token]);

  const reload = useCallback(async (signal?: AbortSignal) => {
    const response = await api('/designs', { signal });
    const data: { designs: Design[] } = await response.json();
    const current = data.designs.find(row => row.modelVersionId === modelVersionId && row.activeModel);
    if (!current) { if (!signal?.aborted) { setDesignId(null); setInstances([]); setConnections([]); } return; }
    const listing = await api(`/designs/${current.id}/instances`, { signal });
    const details: { instances: Instance[] } = await listing.json();
    const graph = await api(`/designs/${current.id}/connections`, { signal });
    const links: { connections: Connection[] } = await graph.json();
    if (!signal?.aborted) {
      setDesignId(current.id);
      setInstances(details.instances);
      setConnections(links.connections);
    }
  }, [api, modelVersionId]);

  useEffect(() => {
    const controller = new AbortController();
    setDesignId(null); setInstances([]); setNotice(''); setLoading(true);
    void reload(controller.signal).catch(error => {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'Unable to load placements.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  // Recreate saved CAD instances after a Viewer reload. This is a display
  // side effect only; source STEP objects and project model remain immutable.
  useEffect(() => {
    if (!instances.length) { setDisplayedIds([]); setDisplaying(false); return; }
    const controller = new AbortController();
    const confirmed: string[] = [];
    setDisplayedIds([]);
    setDisplaying(true);
    const display = async () => {
      for (const instance of instances) {
        if (controller.signal.aborted) return;
        try {
          const transform = {
            positionMm: { x: instance.xMm, y: instance.yMm, z: instance.zMm },
            rotation: { x: instance.qx, y: instance.qy, z: instance.qz, w: instance.qw },
          };
          if (rendered.current.has(instance.id)) {
            try { await onMove(instance.id, transform); }
            catch { rendered.current.delete(instance.id); }
          }
          if (!rendered.current.has(instance.id)) {
            const response = await api(`/catalog/${instance.catalogItemId}/mesh`, { signal: controller.signal });
            const mesh: unknown = await response.json();
            if (controller.signal.aborted) return;
            await onShow(instance.id, mesh, transform);
            rendered.current.add(instance.id);
          }
          if (!controller.signal.aborted) {
            confirmed.push(instance.id);
            setDisplayedIds([...confirmed]);
            setNotice(previous => previous.includes('Displaying the 3D mesh') ? 'Component saved and displayed in 3D.' : previous);
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            setNotice(error instanceof Error ? `3D rendering: ${error.message}` : '3D rendering unavailable.');
          }
        }
      }
    };
    void display().finally(() => { if (!controller.signal.aborted) setDisplaying(false); });
    return () => controller.abort();
  }, [instances, api, onShow, onMove]);

  useEffect(() => { rendered.current.clear(); setDisplayedIds([]); }, [projectId, modelVersionId, token]);

  const focusSelected = async () => {
    if (!onFocus || !editingId || busy || displaying || !displayedIds.includes(editingId)) return;
    setBusy(true);
    try {
      await onFocus(editingId);
      setNotice('Camera focused on the selected saved component.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not focus the selected component.');
    } finally { setBusy(false); }
  };

  const selectInstance = (id: string) => {
    setPendingSnap(null);
    const instance = instances.find(row => row.id === id);
    setEditingId(id);
    if (!instance) return;
    setSelectedId(instance.catalogItemId);
    setCoordinates({
      x: String(instance.xMm), y: String(instance.yMm), z: String(instance.zMm),
      ...quaternionEuler(instance),
    });
  };

  const nudge = (axis: 'x' | 'y' | 'z', direction: -1 | 1) => {
    const step = Number(moveStepMm);
    const current = Number(coordinates[axis]);
    if (!Number.isFinite(step) || step <= 0 || step > 10000 || !Number.isFinite(current) ||
        Math.abs(current + direction * step) > 1e9) {
      setNotice('Choose a step between 0 and 10000 mm within the model coordinate range.');
      return;
    }
    setPendingSnap(null);
    setCoordinates(old => ({ ...old, [axis]: String(current + direction * step) }));
    setNotice(`Moved ${axis.toUpperCase()} by ${direction * step} mm. Save to persist.`);
  };

  const pickPosition = async () => {
    if (busy) return;
    setBusy(true); setNotice('Click a surface on the active Aalborg model.');
    try {
      const selection = await onPick();
      const [x, y, z] = selection.point;
      if (![x, y, z].every(Number.isFinite)) throw new Error('Selected point is not finite.');
      setPendingSnap(null);
      setCoordinates(old => ({ ...old,
        x: String(x * 1000), y: String(y * 1000), z: String(z * 1000),
      }));
      setNotice('Model point selected. Adjust XYZ or rotation, then Save.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not pick a model point.');
    } finally { setBusy(false); }
  };

  const snap = () => {
    if (!target || target.id === editingId) { setNotice('Select another saved component as the snap target.'); return; }
    const sourcePort = sourcePorts.find(port => port.id === snapSourcePort);
    const targetPort = targetPorts.find(port => port.id === snapTargetPort);
    if (!sourcePort || !targetPort || sourcePort.profile !== targetPort.profile) {
      setNotice('Choose compatible and verified source/target connection ports.'); return;
    }
    try {
      const snapped = alignConnectorPorts(
        { position: { x: target.xMm, y: target.yMm, z: target.zMm },
          rotation: { x: target.qx, y: target.qy, z: target.qz, w: target.qw } },
        targetPort.local, sourcePort.local, MATE_OPPOSING_FACE,
      );
      const angles = quaternionEuler({ qx: snapped.rotation.x, qy: snapped.rotation.y,
        qz: snapped.rotation.z, qw: snapped.rotation.w } as Instance);
      setCoordinates({ x: String(snapped.position.x), y: String(snapped.position.y),
        z: String(snapped.position.z), ...angles });
      setPendingSnap({
        targetInstanceId: target.id,
        targetPortName: targetPort.id,
        sourcePortName: sourcePort.id,
      });
      setNotice('Connector snap calculated. Save to persist the position; fitting and clearance still need engineering verification.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Connector snap failed.');
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const numeric = [coordinates.x, coordinates.y, coordinates.z, coordinates.rx, coordinates.ry, coordinates.rz].map(Number);
    if (numeric.some(value => !Number.isFinite(value)) || numeric.slice(0, 3).some(value => Math.abs(value) > 1e9)) {
      setNotice('All coordinates must be finite and within the project millimetre range.'); return;
    }
    if (!selectedId || !activeCatalogue.some(item => item.id === selectedId)) {
      setNotice('Select a 3D-ready catalogue part.'); return;
    }
    setBusy(true); setNotice('');
    try {
      let currentId = designId;
      if (!currentId) {
        const design = await api('/designs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelVersionId, name: 'Aalborg proposed cable trays' }),
        });
        const created: { id: string } = await design.json();
        currentId = created.id; setDesignId(currentId);
      }
      const body = JSON.stringify({
        catalogItemId: selectedId,
        transform: {
          positionMm: { x: numeric[0], y: numeric[1], z: numeric[2] },
          rotation: eulerQuaternion(numeric[3], numeric[4], numeric[5]),
        },
      });
      let savedId = editing?.id ?? '';
      if (editing) {
        await api(`/designs/${currentId}/instances/${editing.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: editing.revision, transform: JSON.parse(body).transform }),
        });
        setNotice('Position saved to the current proposed design.');
      } else {
        const created = await api(`/designs/${currentId}/instances`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        });
        const payload: { id: string } = await created.json();
        savedId = payload.id;
        setNotice('New component placement saved. Displaying the 3D mesh…');
      }
      if (pendingSnap) {
        try {
          await api(`/designs/${currentId}/connections`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceInstanceId: savedId,
              sourcePortName: pendingSnap.sourcePortName,
              targetInstanceId: pendingSnap.targetInstanceId,
              targetPortName: pendingSnap.targetPortName,
            }),
          });
          setNotice('Component position and connector relationship saved.');
          setPendingSnap(null);
        } catch (error) {
          setNotice(`Position saved, but connector relation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save placement.');
    } finally { setBusy(false); }
  };

  const disconnect = async (connectionId: string) => {
    if (!designId || busy) return;
    setBusy(true); setNotice('');
    try {
      await api(`/designs/${designId}/connections/${connectionId}`, { method: 'DELETE' });
      await reload();
      setPendingSnap(null);
      setNotice('Connector relationship removed. The component can now be repositioned.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not disconnect components.');
    } finally { setBusy(false); }
  };

  const download = async (extension: 'materials.csv' | 'assembly.step') => {
    if (!designId || busy) return;
    setBusy(true); setNotice('');
    try {
      const response = await api(`/designs/${designId}/${extension}`);
      const data = await response.blob();
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = extension === 'materials.csv' ? 'Aalborg-Proposed-Cable-Trays-MTO.csv' : 'Aalborg-Proposed-Cable-Trays.step';
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 15000);
      setNotice(`Export prepared: ${link.download}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Export failed.'); }
    finally { setBusy(false); }
  };

  return <section aria-label="Proposed component placements">
    <Caption1>Saved parts appear in the current 3D model. Coordinates use millimetres. Use point picking, coordinates or connector snap to position parts, and check them against reference points before delivery.</Caption1>
    {loading ? <Spinner size="tiny" label="Reading proposal…" /> : null}
    <Field label="Catalogue component">
      <select aria-label="Catalogue component" value={selectedId} disabled={busy || !activeCatalogue.length}
        onChange={e => { setSelectedId(e.target.value); setEditingId(''); setPendingSnap(null); setCoordinates(empty); }}>
        <option value="">Choose a prepared component</option>
        {activeCatalogue.map(item => <option key={item.id} value={item.id}>{item.manufacturer} — {item.partNumber} · CAD revision {item.cadRevision}</option>)}
      </select>
    </Field>
    {sourcePorts.length ? <section aria-label="Connector snap">
      <Caption1>PoC connector snap — measured from the two supplied STEP files; no certified splice plate clearance.</Caption1>
      <Field label="Snap to placed component">
        <select aria-label="Snap target" value={snapTarget} onChange={event => { setSnapTarget(event.target.value); setSnapTargetPort(''); }} disabled={busy}>
          <option value="">Choose target</option>
          {instances.filter(instance => instance.id !== editingId).map(instance =>
            <option key={instance.id} value={instance.id}>{instance.manufacturer} {instance.partNumber} — {instance.id.slice(0, 8)}</option>)}
        </select>
      </Field>
      <Field label="Target connector">
        <select aria-label="Target connector" value={snapTargetPort} onChange={event => setSnapTargetPort(event.target.value)} disabled={busy}>
          <option value="">Choose port</option>
          {targetPorts.map(port => <option key={port.id} value={port.id}>{port.label}</option>)}
        </select>
      </Field>
      <Field label="New component connector">
        <select aria-label="Source connector" value={snapSourcePort} onChange={event => setSnapSourcePort(event.target.value)} disabled={busy}>
          <option value="">Choose port</option>
          {sourcePorts.map(port => <option key={port.id} value={port.id}>{port.label}</option>)}
        </select>
      </Field>
      <Button type="button" disabled={busy || !target || !snapTargetPort || !snapSourcePort} onClick={snap}>
        Snap to connector
      </Button>
    </section> : null}
    <Button type="button" disabled={busy || !selectedId} onClick={() => { void pickPosition(); }}>
      Pick position in 3D model
    </Button>
    <div aria-label="Axis movement controls">
      <Field label="Move step (mm)">
        <Input type="number" min="0.1" max="10000" step="any" aria-label="Move step mm"
          value={moveStepMm} disabled={busy} onChange={(_, data) => setMoveStepMm(data.value)} />
      </Field>
      {(['x','y','z'] as const).map(axis => <div key={axis}>
        <Button type="button" disabled={busy} onClick={() => nudge(axis, -1)}>{axis.toUpperCase()} −</Button>
        <Button type="button" disabled={busy} onClick={() => nudge(axis, 1)}>{axis.toUpperCase()} +</Button>
      </div>)}
    </div>
    <form onSubmit={event => { void save(event); }} aria-label="Save component position">
      {(['x', 'y', 'z', 'rx', 'ry', 'rz'] as const).map(axis => <Field key={axis}
        label={['x','y','z'].includes(axis) ? `${axis.toUpperCase()} (mm)` : `Rotation ${axis.slice(1).toUpperCase()} (degrees)`}>
        <Input type="number" step="any" aria-label={axis} value={coordinates[axis]}
          disabled={busy} onChange={(_, data) => { setPendingSnap(null); setCoordinates(old => ({ ...old, [axis]: data.value })); }} />
      </Field>)}
      <Button type="submit" appearance="primary" disabled={busy || !selectedId}>{editing ? 'Update saved position' : 'Save new component'}</Button>
      <Button type="button" disabled={busy} onClick={() => { setEditingId(''); setPendingSnap(null); setCoordinates(empty); }}>New position</Button>
    </form>
    <div role="status" aria-live="polite"><Body1>{notice}</Body1></div>
    <Caption1>Saved component instances: {instances.length}; saved connector relationships: {connections.length}</Caption1>
    <div><Caption1>{displaying ? 'Displaying saved components…' : `${displayedIds.filter(id => instances.some(instance => instance.id === id)).length} of ${instances.length} saved components ready in 3D`}</Caption1></div>
    <Button type="button" disabled={busy || displaying || !onFocus || !editing || !displayedIds.includes(editingId)}
      onClick={() => { void focusSelected(); }}>Zoom to selected component</Button>
    <ul>{instances.map(instance => <li key={instance.id}>
      <Button appearance={editingId === instance.id ? 'primary' : 'subtle'}
        onClick={() => selectInstance(instance.id)} disabled={busy}>
        {instance.manufacturer} {instance.partNumber} — X {instance.xMm}, Y {instance.yMm}, Z {instance.zMm} mm
      </Button>
    </li>)}</ul>

    <ul aria-label="Saved connector relationships">{connections.map(connection =>
      <li key={connection.id}>
        <Caption1>{connection.sourceInstanceId.slice(0, 8)} ↔ {connection.targetInstanceId.slice(0, 8)}</Caption1>
        <Button appearance="subtle" disabled={busy} onClick={() => { void disconnect(connection.id); }}>
          Disconnect
        </Button>
      </li>
    )}</ul>
    <Button disabled={busy || !designId || !instances.length} onClick={() => { void download('assembly.step'); }}>Export STEP assembly</Button>
    <Button disabled={busy || !designId || !instances.length} onClick={() => { void download('materials.csv'); }}>Export material list (CSV)</Button>
  </section>;
}
