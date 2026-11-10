import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Body1, Button, Caption1, Field, Input, Spinner } from '@fluentui/react-components';
import { getApiBaseUrl } from '@/api/http';
import { normalizeQuaternion } from '@/viewer/componentTransforms';
import type { ViewerController } from '@/viewer/ViewerController';

type CatalogueItem = { id: string; partNumber: string; manufacturer: string; conversionStatus: string };
type Design = { id: string; modelVersionId: string; name: string; status: string; revision: number; activeModel: boolean };
type Instance = {
  id: string; catalogItemId: string; partNumber: string; manufacturer: string; revision: number;
  xMm: number; yMm: number; zMm: number; qx: number; qy: number; qz: number; qw: number;
};
type Props = { projectId: string; modelVersionId: string; token: string; catalogue: CatalogueItem[];
  onShow: ViewerController['showCadComponent']; onMove: ViewerController['moveCadComponent']; };
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

export function CadPlacementPanel({ projectId, modelVersionId, token, catalogue, onShow, onMove }: Props) {
  const rendered = useRef(new Set<string>());
  const [designId, setDesignId] = useState<string | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [editingId, setEditingId] = useState<string>('');
  const [coordinates, setCoordinates] = useState<Coordinates>(empty);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const base = `${getApiBaseUrl()}/api/projects/${projectId}/cad-design`;
  const activeCatalogue = catalogue.filter(item => item.conversionStatus === 'ready');
  const editing = instances.find(instance => instance.id === editingId);

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
    if (!current) { if (!signal?.aborted) { setDesignId(null); setInstances([]); } return; }
    const listing = await api(`/designs/${current.id}/instances`, { signal });
    const details: { instances: Instance[] } = await listing.json();
    if (!signal?.aborted) { setDesignId(current.id); setInstances(details.instances); }
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
    if (!instances.length) return;
    const controller = new AbortController();
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
        } catch (error) {
          if (!controller.signal.aborted) {
            setNotice(error instanceof Error ? `3D rendering: ${error.message}` : '3D rendering unavailable.');
          }
        }
      }
    };
    void display();
    return () => controller.abort();
  }, [instances, api, onShow, onMove]);

  useEffect(() => { rendered.current.clear(); }, [projectId, modelVersionId, token]);

  const selectInstance = (id: string) => {
    const instance = instances.find(row => row.id === id);
    setEditingId(id);
    if (!instance) return;
    setSelectedId(instance.catalogItemId);
    setCoordinates({
      x: String(instance.xMm), y: String(instance.yMm), z: String(instance.zMm),
      ...quaternionEuler(instance),
    });
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
      if (editing) {
        await api(`/designs/${currentId}/instances/${editing.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: editing.revision, transform: JSON.parse(body).transform }),
        });
        setNotice('Position saved to the current proposed design.');
      } else {
        await api(`/designs/${currentId}/instances`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        });
        setNotice('New component placement saved. Three-dimensional display is not yet connected.');
      }
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save placement.');
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
    <Caption1>Saved components are drawn in the active SVF with Scene API. Enter world coordinates in millimetres; validate against reference points before client delivery. Freehand gizmo and Object Snap are not yet available.</Caption1>
    {loading ? <Spinner size="tiny" label="Reading proposal…" /> : null}
    <Field label="Catalogue component">
      <select aria-label="Catalogue component" value={selectedId} disabled={busy || !activeCatalogue.length}
        onChange={e => { setSelectedId(e.target.value); setEditingId(''); setCoordinates(empty); }}>
        <option value="">Choose a prepared component</option>
        {activeCatalogue.map(item => <option key={item.id} value={item.id}>{item.manufacturer} — {item.partNumber}</option>)}
      </select>
    </Field>
    <form onSubmit={event => { void save(event); }} aria-label="Save component position">
      {(['x', 'y', 'z', 'rx', 'ry', 'rz'] as const).map(axis => <Field key={axis}
        label={['x','y','z'].includes(axis) ? `${axis.toUpperCase()} (mm)` : `Rotation ${axis.slice(1).toUpperCase()} (degrees)`}>
        <Input type="number" step="any" aria-label={axis} value={coordinates[axis]}
          disabled={busy} onChange={(_, data) => setCoordinates(old => ({ ...old, [axis]: data.value }))} />
      </Field>)}
      <Button type="submit" appearance="primary" disabled={busy || !selectedId}>{editing ? 'Update saved position' : 'Save new component'}</Button>
      <Button type="button" disabled={busy} onClick={() => { setEditingId(''); setCoordinates(empty); }}>New position</Button>
    </form>
    <div role="status" aria-live="polite"><Body1>{notice}</Body1></div>
    <Caption1>Saved component instances: {instances.length}</Caption1>
    <ul>{instances.map(instance => <li key={instance.id}>
      <Button appearance={editingId === instance.id ? 'primary' : 'subtle'}
        onClick={() => selectInstance(instance.id)} disabled={busy}>
        {instance.manufacturer} {instance.partNumber} — X {instance.xMm}, Y {instance.yMm}, Z {instance.zMm} mm
      </Button>
    </li>)}</ul>
    <Button disabled={busy || !designId || !instances.length} onClick={() => { void download('assembly.step'); }}>Export STEP assembly</Button>
    <Button disabled={busy || !designId || !instances.length} onClick={() => { void download('materials.csv'); }}>Export material list (CSV)</Button>
  </section>;
}
