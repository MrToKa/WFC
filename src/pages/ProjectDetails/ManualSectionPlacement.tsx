import { useEffect, useRef, useState } from 'react';
import { Button, Caption1, Field, Input } from '@fluentui/react-components';
import type { ViewerController } from '@/viewer/ViewerController';
import { getInstanceCadPorts } from '../../../shared/cadLengths';
import { normalizeQuaternion, rotateVector, validatePosition, type Vec3 } from '../../../shared/cadTransforms';
import type { CadRouteGroup } from '../../../shared/cadRouteGroups';

type Instance = {
  id: string; catalogItemId: string; revision: number; partNumber: string;
  xMm: number; yMm: number; zMm: number; qx: number; qy: number; qz: number; qw: number;
  lengthMm?: number | null;
};
type CatalogueItem = { id: string; originalFilename: string; sourceSha256: string };
type Target = { objectId?: string | number; objectRevisionId: string; portIndex: number; pointMm: Vec3; label: string };
type Props = {
  instances: Instance[]; catalogue: CatalogueItem[]; editingId: string;
  route: CadRouteGroup | null; disabled: boolean;
  pick: ViewerController['pickPlacementPoint'];
  request: (path: string, init?: RequestInit) => Promise<Response>;
  onBusyChange: (busy: boolean) => void;
  onMoved: () => Promise<void>;
};

const worldPoint = (row: Instance, local: Vec3): Vec3 => {
  const v = rotateVector(local, { x: row.qx, y: row.qy, z: row.qz, w: row.qw });
  return validatePosition({ x: row.xMm + v.x, y: row.yMm + v.y, z: row.zMm + v.z });
};
const mmPoint = (point: readonly number[]): Vec3 => validatePosition({ x: point[0] * 1000, y: point[1] * 1000, z: point[2] * 1000 });
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const pointText = (p: Vec3) => `X ${Number(p.x.toFixed(3))}, Y ${Number(p.y.toFixed(3))}, Z ${Number(p.z.toFixed(3))} mm`;

export function ManualSectionPlacement({ instances, catalogue, editingId, route, disabled, pick, request, onBusyChange, onMoved }: Props) {
  const [scope, setScope] = useState<'section' | 'route'>(editingId ? 'section' : 'route');
  const [anchor, setAnchor] = useState<{ instanceId: string; localPointMm: Vec3; world: Vec3; revisions: string } | null>(null);
  const [target, setTarget] = useState({ x: '', y: '', z: '' });
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetKey, setTargetKey] = useState('');
  const generation = useRef(0);
  const moving = instances.filter(row => scope === 'route' && route ? route.instanceIds.includes(row.id) : row.id === editingId);
  const revisions = moving.map(row => `${row.id}:${row.revision}`).sort().join('|');
  const identity = `${editingId}|${route?.id ?? ''}|${route?.revision ?? ''}|${scope}|${revisions}`;
  useEffect(() => { setScope(editingId ? 'section' : 'route'); }, [editingId, route?.id]);
  useEffect(() => {
    generation.current++;
    setAnchor(null); setTarget({ x: '', y: '', z: '' }); setMessage(''); setTargetKey('');
    return () => { generation.current++; };
  }, [identity]);
  useEffect(() => {
    const controller = new AbortController();
    void request('/placement-targets', { signal: controller.signal }).then(r => r.json()).then((data: { targets?: Target[] }) => {
      if (!controller.signal.aborted) setTargets(data.targets ?? []);
    }).catch(() => { if (!controller.signal.aborted) setTargets([]); });
    return () => controller.abort();
  }, [request]);
  const setPoint = (p: Vec3) => setTarget({ x: String(p.x), y: String(p.y), z: String(p.z) });
  const run = async (work: (current: () => boolean) => Promise<void>) => {
    if (working || disabled) return;
    const epoch = generation.current;
    const current = () => epoch === generation.current;
    setWorking(true); onBusyChange(true);
    try { await work(current); }
    catch (error) { if (current()) setMessage(error instanceof Error ? error.message : 'Point placement failed.'); }
    finally { setWorking(false); onBusyChange(false); }
  };
  const selectAnchor = () => run(async current => {
    setMessage('Click a point on the selected section. Press Escape in the model to cancel.');
    const result = await pick({ cadInstanceIds: moving.map(row => row.id) });
    if (!current()) return;
    const row = moving.find(item => item.id === result.cadInstanceId);
    if (!row) throw new Error('Choose a point on the selected section.');
    const world = mmPoint(result.point);
    const q = normalizeQuaternion({ x: row.qx, y: row.qy, z: row.qz, w: row.qw });
    const localPointMm = rotateVector({ x: world.x - row.xMm, y: world.y - row.yMm, z: world.z - row.zMm }, { x: -q.x, y: -q.y, z: -q.z, w: q.w });
    setAnchor({ instanceId: row.id, localPointMm, world, revisions }); setPoint(world);
    setMessage('Point selected. Enter its destination coordinates or pick a destination in the model.');
  });
  const selectTarget = (snap: boolean) => run(async current => {
    setMessage(snap ? 'Click the end of another route. Its known endpoint will be selected.' : 'Click the exact destination point. Press Escape in the model to cancel.');
    const result = await pick({ cadInstanceIds: instances.filter(row => !moving.some(item => item.id === row.id)).map(row => row.id), allowSource: true });
    if (!current()) return;
    let point = mmPoint(result.point);
    if (snap) {
      const candidates: Vec3[] = [];
      const row = instances.find(item => item.id === result.cadInstanceId);
      if (row) {
        const part = catalogue.find(item => item.id === row.catalogItemId);
        if (part) candidates.push(...getInstanceCadPorts(part.originalFilename, part.sourceSha256, row.lengthMm).map(port => worldPoint(row, port.local.position)));
      } else if (result.objectId) {
        candidates.push(...targets.filter(item => String(item.objectId) === String(result.objectId)).map(item => item.pointMm));
      }
      if (!candidates.length) throw new Error('This part has no registered endpoints. Use Pick destination point to select its end manually, or enter exact coordinates.');
      point = candidates.reduce((nearest, candidate) => distance(candidate, point) < distance(nearest, point) ? candidate : nearest);
    }
    setPoint(point); setTargetKey('');
    setMessage(`${snap ? 'Endpoint snapped' : 'Destination point selected'}: ${pointText(point)}. Choose Move and save to apply.`);
  });
  const move = () => run(async current => {
    if (!anchor || anchor.revisions !== revisions) throw new Error('The selection changed. Pick the moving point again.');
    if (Object.values(target).some(value => value.trim() === '')) throw new Error('Enter X, Y and Z for the selected point.');
    const targetPointMm = validatePosition({ x: Number(target.x), y: Number(target.y), z: Number(target.z) });
    await request('/translate-selection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anchor: { instanceId: anchor.instanceId, localPointMm: anchor.localPointMm }, targetPointMm,
        instances: moving.map(row => ({ id: row.id, expectedRevision: row.revision })),
        ...(scope === 'route' && route ? { route: { id: route.id, expectedRevision: route.revision } } : {}) }),
    });
    if (!current()) return;
    setAnchor(null);
    setMessage('Position saved. The selected point is at the destination; all selected parts moved together.');
    await onMoved();
  });
  const blocked = disabled || working;
  return <section aria-label="Move by selected point" style={{ border: '1px solid currentColor', borderRadius: 6, padding: 12, margin: '12px 0' }}>
    <strong>Move by selected point</strong>
    <Caption1 block>Pick a point on any saved section, then set the coordinates of that point. Movement preserves orientation and lengths.</Caption1>
    <Field label="Move selection">
      <select aria-label="Move selection" value={scope} disabled={blocked} onChange={event => setScope(event.target.value as 'section' | 'route')}>
        <option value="section">Selected section</option>
        <option value="route" disabled={!route}>Whole selected route</option>
      </select>
    </Field>
    <Caption1 block>{moving.length} section{moving.length === 1 ? '' : 's'} selected. Uses saved geometry.</Caption1>
    <Button disabled={blocked || !moving.length} onClick={() => { void selectAnchor(); }}>Pick moving point</Button>
    {anchor ? <Caption1 block>Selected point: {pointText(anchor.world)}</Caption1> : null}
    {(['x', 'y', 'z'] as const).map(axis => <Field key={axis} label={`Point ${axis.toUpperCase()} (mm)`}>
      <Input aria-label={`Point ${axis.toUpperCase()} (mm)`} type="number" step="any" value={target[axis]} disabled={blocked || !anchor}
        onChange={(_, data) => { setTarget(old => ({ ...old, [axis]: data.value })); setTargetKey(''); }} />
    </Field>)}
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      <Button disabled={blocked || !anchor} onClick={() => { void selectTarget(false); }}>Pick destination point</Button>
      <Button disabled={blocked || !anchor} onClick={() => { void selectTarget(true); }}>Snap to route end</Button>
    </div>
    {targets.length ? <Field label="Existing route endpoint">
      <select aria-label="Existing route endpoint" disabled={blocked || !anchor} value={targetKey} onChange={event => {
        setTargetKey(event.target.value);
        const item = targets.find(row => `${row.objectRevisionId}:${row.portIndex}` === event.target.value);
        if (item) { setPoint(item.pointMm); setMessage(`Endpoint selected: ${pointText(item.pointMm)}.`); }
      }}>
        <option value="">Choose endpoint</option>
        {targets.map(item => <option key={`${item.objectRevisionId}:${item.portIndex}`} value={`${item.objectRevisionId}:${item.portIndex}`}>{item.label} — {pointText(item.pointMm)}</option>)}
      </select>
    </Field> : null}
    <Button appearance="primary" style={{ marginTop: 8 }} disabled={blocked || !anchor} onClick={() => { void move(); }}>Move and save</Button>
    <Caption1 block>Point placement aligns positions. It does not rotate parts or create a connector relationship.</Caption1>
    <div role="status" aria-live="polite">{message}</div>
  </section>;
}
