import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Body1, Button, Caption1, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Spinner } from '@fluentui/react-components';
import { getApiBaseUrl } from '@/api/http';
import { alignConnectorPorts } from '@/viewer/componentTransforms';
import { eulerDegreesToQuaternion, quaternionToEulerDegrees, rotateAboutLocalAxis, orientAboutLocalPivot } from '../../../shared/cadRotation';
import { MATE_OPPOSING_FACE } from '@/viewer/pocConnectorCatalog';
import { supportsStraightCut, getInstanceCadPorts } from '../../../shared/cadLengths';
import type { ViewerController } from '@/viewer/ViewerController';

type CatalogueItem = { id: string; partNumber: string; manufacturer: string; originalFilename: string; sourceSha256: string; conversionStatus: string; componentKind?: string; materialAssetId?: string | null; cadRevision?: number | null };
type Design = { id: string; modelVersionId: string; name: string; status: string; revision: number; activeModel: boolean };
type Connection = {
  id: string; sourceInstanceId: string; targetInstanceId: string;
  sourcePortId: string; targetPortId: string;
};
type Instance = {
  id: string; catalogItemId: string; partNumber: string; manufacturer: string; revision: number;
  xMm: number; yMm: number; zMm: number; qx: number; qy: number; qz: number; qw: number;
  lengthMm?: number | null;
};
type Props = { projectId: string; modelVersionId: string; token: string; catalogue: CatalogueItem[];
  onPick: ViewerController['pickPoint']; onShow: ViewerController['showCadComponent']; onMove: ViewerController['moveCadComponent'];
  onFocus?: ViewerController['focusCadComponent']; onRemove?: ViewerController['removeCadComponent']; };
type Coordinates = { x: string; y: string; z: string; rx: string; ry: string; rz: string };
const empty: Coordinates = { x: '0', y: '0', z: '0', rx: '0', ry: '0', rz: '0' };

function rotationFields(q: { x: number; y: number; z: number; w: number }): Pick<Coordinates, 'rx' | 'ry' | 'rz'> {
  const angles = quaternionToEulerDegrees(q);
  const display = (value: number) => String(Number(value.toFixed(10)));
  return { rx: display(angles.rx), ry: display(angles.ry), rz: display(angles.rz) };
}

function quaternionEuler(instance: Instance): Pick<Coordinates, 'rx' | 'ry' | 'rz'> {
  return rotationFields({ x: instance.qx, y: instance.qy, z: instance.qz, w: instance.qw });
}

export function CadPlacementPanel({ projectId, modelVersionId, token, catalogue, onPick, onShow, onMove, onFocus, onRemove }: Props) {
  const rendered = useRef(new Set<string>());
  const renderedLengths = useRef(new Map<string, number | null>());
  const [displayedIds, setDisplayedIds] = useState<string[]>([]);
  const [displaying, setDisplaying] = useState(false);
  const [designId, setDesignId] = useState<string | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [editingId, setEditingId] = useState<string>('');
  const [removeCandidate, setRemoveCandidate] = useState<Instance | null>(null);
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
  const [lengthMm, setLengthMm] = useState('6000');
  const [moveStepMm, setMoveStepMm] = useState('50');
  const [rotateStepDegrees, setRotateStepDegrees] = useState('90');
  const [rotationPivot, setRotationPivot] = useState<'start' | 'center' | 'end'>('start');
  const [meshCenter, setMeshCenter] = useState<{ catalogId: string; point: { x: number; y: number; z: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const base = `${getApiBaseUrl()}/api/projects/${projectId}/cad-design`;
  const activeCatalogue = catalogue.filter(item => item.conversionStatus === 'ready' && item.materialAssetId);
  const editing = instances.find(instance => instance.id === editingId);
  const chosenPart = catalogue.find(item => item.id === selectedId);
  const canSetLength = chosenPart?.componentKind === 'straight' && supportsStraightCut(chosenPart.originalFilename, chosenPart.sourceSha256);
  const validLength = Number.isFinite(Number(lengthMm)) && Number(lengthMm) >= 1 && Number(lengthMm) <= 6000;
  const selectedLength = canSetLength && validLength && Number(lengthMm) !== 6000 ? Number(lengthMm) : null;
  const editingConnected = Boolean(editing && connections.some(row => row.sourceInstanceId === editing.id || row.targetInstanceId === editing.id));
  const sourcePorts = getInstanceCadPorts(chosenPart?.originalFilename ?? '', chosenPart?.sourceSha256 ?? '', selectedLength);
  const startPivot = sourcePorts.find(port => port.id === 'start')?.local.position;
  const endPivot = sourcePorts.find(port => port.id === 'end')?.local.position;
  const centerPivot = canSetLength && startPivot && endPivot
    ? { x: (startPivot.x + endPivot.x) / 2, y: (startPivot.y + endPivot.y) / 2, z: (startPivot.z + endPivot.z) / 2 }
    : meshCenter?.catalogId === selectedId ? meshCenter.point : undefined;
  const pivotPoint = rotationPivot === 'start' ? startPivot : rotationPivot === 'end' ? endPivot : centerPivot;
  const target = instances.find(instance => instance.id === snapTarget);
  const targetPorts = getInstanceCadPorts(catalogue.find(item => item.id === target?.catalogItemId)?.originalFilename ?? '', catalogue.find(item => item.id === target?.catalogItemId)?.sourceSha256 ?? '', target?.lengthMm ?? null);

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

  useEffect(() => {
    if (!selectedId || canSetLength) return;
    const controller = new AbortController();
    void api(`/catalog/${selectedId}/mesh`, { signal: controller.signal }).then(response => response.json()).then(mesh => {
      const bounds = mesh.boundsMm;
      if (!controller.signal.aborted && bounds?.min?.length === 3 && bounds?.max?.length === 3 &&
          [...bounds.min, ...bounds.max].every(Number.isFinite)) {
        setMeshCenter({ catalogId: selectedId, point: { x: (bounds.min[0] + bounds.max[0]) / 2,
          y: (bounds.min[1] + bounds.max[1]) / 2, z: (bounds.min[2] + bounds.max[2]) / 2 } });
      }
    }).catch(() => { /* Unavailable geometry keeps the centre pivot disabled. */ });
    return () => controller.abort();
  }, [api, selectedId, canSetLength]);

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
    if (!instances.length || !designId) { setDisplayedIds([]); setDisplaying(false); return; }
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
          if (rendered.current.has(instance.id) && renderedLengths.current.get(instance.id) !== (instance.lengthMm ?? null)) {
            rendered.current.delete(instance.id);
          }
          if (rendered.current.has(instance.id)) {
            try { await onMove(instance.id, transform); }
            catch { rendered.current.delete(instance.id); }
          }
          if (!rendered.current.has(instance.id)) {
            const meshPath = instance.lengthMm != null
              ? `/designs/${designId}/instances/${instance.id}/mesh` : `/catalog/${instance.catalogItemId}/mesh`;
            const response = await api(meshPath, { signal: controller.signal });
            const mesh: unknown = await response.json();
            if (controller.signal.aborted) return;
            await onShow(instance.id, mesh, transform);
            rendered.current.add(instance.id);
            renderedLengths.current.set(instance.id, instance.lengthMm ?? null);
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
  }, [instances, designId, api, onShow, onMove]);

  useEffect(() => { rendered.current.clear(); renderedLengths.current.clear(); setDisplayedIds([]); }, [projectId, modelVersionId, token]);

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
    setLengthMm(String(instance.lengthMm ?? 6000));
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

  const orient = (rotation: { x: number; y: number; z: number; w: number }) => {
    if (!pivotPoint) throw new Error('Choose an available rotation point.');
    const result = orientAboutLocalPivot({ position: { x: Number(coordinates.x), y: Number(coordinates.y), z: Number(coordinates.z) },
      rotation: eulerDegreesToQuaternion(Number(coordinates.rx), Number(coordinates.ry), Number(coordinates.rz)) }, rotation, pivotPoint);
    setCoordinates({ x: String(result.position.x), y: String(result.position.y), z: String(result.position.z), ...rotationFields(result.rotation) });
    setPendingSnap(null);
  };

  const rotateLocal = (axis: 'x' | 'y' | 'z', direction: -1 | 1) => {
    if (editingConnected || busy || !selectedId || !pivotPoint) return;
    const step = Number(rotateStepDegrees);
    if (!Number.isFinite(step) || step <= 0 || step > 360) {
      setNotice('Enter a rotation step greater than 0 and at most 360 degrees.'); return;
    }
    try {
      const q = eulerDegreesToQuaternion(Number(coordinates.rx), Number(coordinates.ry), Number(coordinates.rz));
      orient(rotateAboutLocalAxis(q, axis, direction * step));
      setNotice(`Rotated around local ${axis} at ${rotationPivot} by ${direction * step} degrees. Save to apply in 3D.`);
    } catch { setNotice('Enter finite rotation angles.'); }
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
    if (canSetLength && !validLength) { setNotice('Enter a length from 1 to 6000 mm.'); return; }
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
        ...(canSetLength ? { lengthMm: selectedLength } : {}),
        transform: {
          positionMm: { x: numeric[0], y: numeric[1], z: numeric[2] },
          rotation: eulerDegreesToQuaternion(numeric[3], numeric[4], numeric[5]),
        },
      });
      let savedId = editing?.id ?? '';
      if (editing) {
        await api(`/designs/${currentId}/instances/${editing.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: editing.revision, transform: JSON.parse(body).transform,
            ...(canSetLength ? { lengthMm: selectedLength } : {}) }),
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

  const removeSelected = async () => {
    if (!removeCandidate || !designId || !onRemove || busy || displaying) return;
    const candidate = removeCandidate;
    setBusy(true); setNotice('');
    try {
      await api(`/designs/${designId}/instances/${candidate.id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: candidate.revision }),
      });
      rendered.current.delete(candidate.id);
      renderedLengths.current.delete(candidate.id);
      setDisplayedIds(ids => ids.filter(id => id !== candidate.id));
      setInstances(rows => rows.filter(row => row.id !== candidate.id));
      setConnections(rows => rows.filter(row => row.sourceInstanceId !== candidate.id && row.targetInstanceId !== candidate.id));
      setEditingId(''); setSelectedId(''); setCoordinates(empty); setPendingSnap(null);
      setSnapTarget(''); setSnapTargetPort(''); setSnapSourcePort(''); setRemoveCandidate(null);
      try {
        await onRemove(candidate.id);
        setNotice('Component and its connector relationships removed from this proposal.');
      } catch {
        setNotice('Component removed from the proposal. Reload the 3D view to clear its remaining display.');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'STALE_INSTANCE') {
        setRemoveCandidate(null);
        await reload().catch(() => {});
        setNotice('This component changed. Select it again before removing it.');
      } else {
        setNotice(error instanceof Error ? error.message : 'Could not remove the component.');
      }
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
        onChange={e => { setSelectedId(e.target.value); setEditingId(''); setLengthMm('6000'); setPendingSnap(null); setCoordinates(empty); }}>
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
    <section aria-label="Local axis rotation controls">
      <Caption1>X/Y/Z move in model space. Local x/y/z rotate about the selected point, which stays fixed. Save to apply in 3D.</Caption1>
      <Field label="Rotation point">
        <select aria-label="Rotation point" value={rotationPivot} disabled={busy || editingConnected}
          onChange={event => setRotationPivot(event.target.value as 'start' | 'center' | 'end')}>
          <option value="start" disabled={!startPivot}>Start</option>
          <option value="center" disabled={!centerPivot}>Center</option>
          <option value="end" disabled={!endPivot}>End</option>
        </select>
      </Field>
      {editingConnected ? <Caption1>Disconnect this component before rotating it.</Caption1> : null}
      <Field label="Rotation step (degrees)">
        <Input type="number" min="0.1" max="360" step="any" aria-label="Rotation step degrees"
          value={rotateStepDegrees} disabled={busy || editingConnected} onChange={(_, data) => setRotateStepDegrees(data.value)} />
      </Field>
      {(['x','y','z'] as const).map(axis => <div key={axis}>
        <Button type="button" disabled={busy || editingConnected || !selectedId || !pivotPoint} onClick={() => rotateLocal(axis, -1)}>Local {axis} −</Button>
        <Button type="button" disabled={busy || editingConnected || !selectedId || !pivotPoint} onClick={() => rotateLocal(axis, 1)}>Local {axis} +</Button>
      </div>)}
      {canSetLength ? <Button type="button" disabled={busy || editingConnected || !pivotPoint} onClick={() => {
        try { orient({ x: 0, y: 0, z: 0, w: 1 }); } catch { setNotice('Enter finite coordinates and rotation angles.'); return; }
        setNotice('Straight length aligned vertically with model Z. Save to apply in 3D.');
      }}>Vertical (model Z)</Button> : null}
    </section>
    <form onSubmit={event => { void save(event); }} aria-label="Save component position">
      <Caption1>Orientation values show the resulting model XYZ angles. Use Local x/y/z and Rotation step above to rotate about the selected point.</Caption1>
      <Field label="Length (mm)" validationState={canSetLength && !validLength ? 'error' : 'none'}
        validationMessage={canSetLength && !validLength ? 'Enter 1–6000 mm.' : undefined}
        hint={editingConnected && canSetLength ? 'Disconnect this component before changing its length.' :
          canSetLength ? 'Original piece: 6000 mm. Shorter pieces are cut without stretching the profile or rungs.' :
            'Choose a prepared straight component to set a cut length. Fittings keep their original dimensions.'}>
        <Input aria-label="Length (mm)" type="number" min={1} max={6000} step="any" value={canSetLength ? lengthMm : ''}
          disabled={busy || !canSetLength || editingConnected} placeholder="Original STEP"
          onChange={(_, data) => { setLengthMm(data.value); setPendingSnap(null); }} />
      </Field>
      {(['x', 'y', 'z', 'rx', 'ry', 'rz'] as const).map(axis => <Field key={axis}
        label={['x','y','z'].includes(axis) ? `${axis.toUpperCase()} (mm)` : `Orientation ${axis.slice(1).toUpperCase()} (degrees)`}>
        <Input type="number" step="any" aria-label={axis} value={coordinates[axis]}
          readOnly={axis.startsWith('r')}
          disabled={busy || (editingConnected && axis.startsWith('r'))} onChange={(_, data) => { setPendingSnap(null); setCoordinates(old => ({ ...old, [axis]: data.value })); }} />
      </Field>)}
      <Button type="submit" appearance="primary" disabled={busy || !selectedId}>{editing ? 'Update saved position' : 'Save new component'}</Button>
      <Button type="button" disabled={busy} onClick={() => { setEditingId(''); setPendingSnap(null); setCoordinates(empty); }}>New position</Button>
    </form>
    <div role="status" aria-live="polite"><Body1>{notice}</Body1></div>
    <Caption1>Saved component instances: {instances.length}; saved connector relationships: {connections.length}</Caption1>
    <div><Caption1>{displaying ? 'Displaying saved components…' : `${displayedIds.filter(id => instances.some(instance => instance.id === id)).length} of ${instances.length} saved components ready in 3D`}</Caption1></div>
    <Button type="button" disabled={busy || displaying || !onFocus || !editing || !displayedIds.includes(editingId)}
      onClick={() => { void focusSelected(); }}>Zoom to selected component</Button>
    <Button type="button" disabled={busy || displaying || !onRemove || !editing || !designId}
      onClick={() => { if (editing) setRemoveCandidate({ ...editing }); }}>Remove selected component</Button>
    <Dialog open={removeCandidate !== null} onOpenChange={(_, data) => { if (!busy && !data.open) setRemoveCandidate(null); }}>
      <DialogSurface><DialogBody>
        <DialogTitle>Remove component from proposal?</DialogTitle>
        <DialogContent>
          <Body1>{removeCandidate?.partNumber} and its connector relationships will be removed from this proposal.</Body1>
          {removeCandidate ? <p>X {removeCandidate.xMm}, Y {removeCandidate.yMm}, Z {removeCandidate.zMm} mm</p> : null}
          <p>The Materials product and its STEP revisions remain available.</p>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setRemoveCandidate(null)}>Cancel</Button>
          <Button appearance="primary" disabled={busy || displaying} onClick={() => { void removeSelected(); }}>Remove component</Button>
        </DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
    <ul>{instances.map(instance => <li key={instance.id}>
      <Button appearance={editingId === instance.id ? 'primary' : 'subtle'}
        onClick={() => selectInstance(instance.id)} disabled={busy}>
        {instance.manufacturer} {instance.partNumber}{instance.lengthMm != null ? ` · ${instance.lengthMm} mm` : ''} — X {instance.xMm}, Y {instance.yMm}, Z {instance.zMm} mm
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
