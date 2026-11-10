import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Body1, Button, Caption1, Field, Spinner } from '@fluentui/react-components';
import { getApiBaseUrl } from '@/api/http';
import type { MaterialCadAsset, MaterialComponent } from '../../../shared/materialCad';
import { CadPlacementPanel } from './CadPlacementPanel';
import type { ViewerController } from '@/viewer/ViewerController';

type CatalogueItem = {
  id: string; manufacturer: string; partNumber: string; family: string;
  originalFilename: string; sourceSha256: string;
  conversionStatus: 'pending' | 'ready' | 'failed';
  materialAssetId: string | null; cadRevision: number | null;
};
type Props = {
  projectId: string | null; token: string | null; modelVersionId: string | null; ready: boolean;
  onPick: ViewerController['pickPoint']; onShow: ViewerController['showCadComponent']; onMove: ViewerController['moveCadComponent'];
  onFocus?: ViewerController['focusCadComponent'];
  onRemove?: ViewerController['removeCadComponent'];
};
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function CadComponentsPanel({ projectId, token, modelVersionId, ready, onPick, onShow, onMove, onFocus, onRemove }: Props) {
  const generation = useRef(0);
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [components, setComponents] = useState<MaterialComponent[]>([]);
  const [componentId, setComponentId] = useState('');
  const [assets, setAssets] = useState<MaterialCadAsset[]>([]);
  const [assetId, setAssetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const scoped = Boolean(projectId && UUID.test(projectId) && token && ready && modelVersionId && UUID.test(modelVersionId));
  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${getApiBaseUrl()}/api/${path}`, {
      ...init, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
    if (!response.ok) throw new Error(`Component catalogue request failed (HTTP ${response.status}).`);
    return response;
  }, [token]);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!scoped || !projectId) { setItems([]); setComponents([]); return; }
    const requestedGeneration = generation.current;
    setLoading(true);
    try {
      const [projectResponse, materialsResponse] = await Promise.all([
        request(`projects/${projectId}/cad-design/catalog`, { signal }),
        request('materials/components', { signal }),
      ]);
      const project: { items: CatalogueItem[] } = await projectResponse.json();
      const materials: { components: MaterialComponent[] } = await materialsResponse.json();
      if (!Array.isArray(project.items) || !Array.isArray(materials.components)) throw new Error('Invalid component catalogue response.');
      if (!signal?.aborted && generation.current === requestedGeneration) { setItems(project.items); setComponents(materials.components); }
    } catch (error) {
      if (!signal?.aborted && generation.current === requestedGeneration) setMessage(error instanceof Error ? error.message : 'Failed to load catalogue.');
    } finally { if (!signal?.aborted && generation.current === requestedGeneration) setLoading(false); }
  }, [scoped, projectId, request]);
  useEffect(() => {
    const controller = new AbortController();
    generation.current += 1;
    setBusy(false); setMessage(null); setLoading(false);
    setItems([]); setComponents([]); setComponentId(''); setAssetId(''); setAssets([]);
    void load(controller.signal);
    return () => { controller.abort(); generation.current += 1; };
  }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    setAssets([]); setAssetId('');
    if (!componentId || !scoped) { setAssetsLoading(false); return () => controller.abort(); }
    setAssetsLoading(true);
    void (async () => {
      try {
        const response = await request(`materials/components/${componentId}/cad-assets`, { signal: controller.signal });
        const data: { assets: MaterialCadAsset[] } = await response.json();
        if (!Array.isArray(data.assets)) throw new Error('Invalid CAD revision response.');
        if (!controller.signal.aborted) {
          setAssets(data.assets);
          setAssetId(data.assets.find(asset => asset.active)?.id ?? '');
        }
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Failed to load CAD revisions.');
      } finally { if (!controller.signal.aborted) setAssetsLoading(false); }
    })();
    return () => controller.abort();
  }, [componentId, scoped, request]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scoped || !projectId || !assetId || busy || assetsLoading) return;
    const submittedGeneration = generation.current;
    setBusy(true); setMessage(null);
    try {
      await request(`projects/${projectId}/cad-design/catalog`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId }),
      });
      if (generation.current !== submittedGeneration) return;
      setMessage('Materials CAD revision selected. Existing instances keep their saved revision.');
      await load();
    } catch (error) {
      if (generation.current === submittedGeneration) setMessage(error instanceof Error ? error.message : 'Failed to select CAD revision.');
    } finally { if (generation.current === submittedGeneration) setBusy(false); }
  };
  return <section aria-label="3D component catalogue">
    {!scoped ? <Body1>Load an active project model to choose components.</Body1> : null}
    <Caption1>Choose real parts from the shared Materials catalogue. Create products and upload STEP revisions in Materials → Components.</Caption1>
    <form onSubmit={event => { void submit(event); }} aria-label="Select Materials component">
      <Field label="Materials component">
        <select aria-label="Materials component" value={componentId} disabled={!scoped || busy || loading}
          onChange={event => setComponentId(event.target.value)}>
          <option value="">Choose family and part number</option>
          {components.map(component => <option key={component.id} value={component.id}>
            {component.manufacturer} · {component.familyName} · {component.componentKind} · {component.partNumber}
          </option>)}
        </select>
      </Field>
      <Field label="STEP revision">
        <select aria-label="STEP revision" value={assetId} disabled={!scoped || busy || assetsLoading || !assets.length}
          onChange={event => setAssetId(event.target.value)}>
          <option value="">{assetsLoading ? 'Loading revisions…' : 'Choose a STEP revision'}</option>
          {assets.map(asset => <option key={asset.id} value={asset.id} disabled={!asset.active}>
            Revision {asset.revision} · {asset.originalFilename}{asset.active ? '' : ' (historical — existing instances only)'}
          </option>)}
        </select>
      </Field>
      {componentId && !assetsLoading && !assets.length ? <Caption1>This component has no STEP revision. Add its STEP file in Materials.</Caption1> : null}
      <Button appearance="primary" type="submit" disabled={!scoped || busy || loading || assetsLoading || !assetId}>
        {busy ? 'Selecting…' : 'Use selected revision'}
      </Button>
    </form>
    <div role="status" aria-live="polite">{loading ? <Spinner size="tiny" label="Loading catalogue…" /> : null}{message ? <Body1>{message}</Body1> : null}</div>
    <div aria-label="Selected component revisions">
      <Caption1>{items.length} saved component revisions</Caption1>
      <ul>{items.map(item => <li key={item.id}>
        <Body1>{item.manufacturer} · {item.partNumber}</Body1>
        <Caption1> {item.family} · {item.materialAssetId ? `CAD revision ${item.cadRevision}` : 'Legacy project part — existing instances only'}</Caption1>
      </li>)}</ul>
    </div>
    {scoped && projectId && token && modelVersionId ? <CadPlacementPanel key={`${projectId}:${modelVersionId}:${token}`}
      projectId={projectId} token={token} modelVersionId={modelVersionId} catalogue={items} onPick={onPick} onShow={onShow} onMove={onMove} onFocus={onFocus} onRemove={onRemove} /> : null}
  </section>;
}
