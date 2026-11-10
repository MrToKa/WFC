import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Body1, Button, Caption1, Field, Input, Spinner } from '@fluentui/react-components';
import { getApiBaseUrl } from '@/api/http';
import { CadPlacementPanel } from './CadPlacementPanel';
import type { ViewerController } from '@/viewer/ViewerController';

type CatalogueItem = {
  id: string;
  manufacturer: string;
  partNumber: string;
  family: string;
  originalFilename: string;
  conversionStatus: 'pending' | 'ready' | 'failed';
};

type Props = {
  projectId: string | null;
  token: string | null;
  modelVersionId: string | null;
  ready: boolean;
  onShow: ViewerController['showCadComponent'];
  onMove: ViewerController['moveCadComponent'];
};

type CatalogueResponse = { items: CatalogueItem[] };
const MAX_STEP_SIZE = 8 * 1024 * 1024;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function CadComponentsPanel({ projectId, token, modelVersionId, ready, onShow, onMove }: Props) {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [manufacturer, setManufacturer] = useState('Niedax');
  const [partNumber, setPartNumber] = useState('');
  const [family, setFamily] = useState('Cable ladder');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const scoped = Boolean(projectId && UUID.test(projectId) && token && ready && modelVersionId && UUID.test(modelVersionId));

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!scoped || !projectId || !token) { setItems([]); return; }
    setLoading(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/cad-design/catalog`, {
        headers: { Authorization: `Bearer ${token}` }, signal,
        cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      });
      if (!response.ok) throw new Error(`Catalogue cannot be loaded (HTTP ${response.status}).`);
      const result: CatalogueResponse = await response.json();
      if (!Array.isArray(result.items)) throw new Error('Invalid catalogue response.');
      if (!signal?.aborted) setItems(result.items.filter(item =>
        UUID.test(item.id) && typeof item.partNumber === 'string' &&
        ['pending', 'ready', 'failed'].includes(item.conversionStatus)));
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : 'Failed to load catalogue.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [scoped, projectId, token]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setMessage(null);
    if (selected && !partNumber) setPartNumber(selected.name.replace(/\.(step|stp)$/i, '').slice(0, 160));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scoped || !projectId || !token || !file || busy) return;
    if (!/\.(step|stp)$/i.test(file.name) || file.size > MAX_STEP_SIZE) {
      setMessage('Select a STEP file smaller than 8 MiB.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.set('manufacturer', manufacturer.trim());
      body.set('partNumber', partNumber.trim());
      body.set('family', family.trim());
      body.set('file', file);
      const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/cad-design/catalog`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body,
        credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      });
      if (!response.ok) throw new Error(`STEP import failed (HTTP ${response.status}).`);
      setFile(null);
      setMessage('STEP source imported and prepared as a 3D mesh.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'STEP import failed.');
    } finally {
      setBusy(false);
    }
  };

  return <section aria-label="3D component catalogue">
    {!scoped ? <Body1>Load an active project model to open the component catalogue.</Body1> : null}
    <Caption1>Import real STEP parts. This stage stores source CAD; 3D placement is available only after mesh preparation and Scene API integration.</Caption1>
    <form onSubmit={event => { void submit(event); }} aria-label="Import STEP component">
      <Field label="Manufacturer"><Input aria-label="Manufacturer" value={manufacturer} maxLength={100}
        onChange={(_, data) => setManufacturer(data.value)} disabled={!scoped || busy} /></Field>
      <Field label="Part number"><Input aria-label="Part number" value={partNumber} maxLength={160}
        onChange={(_, data) => setPartNumber(data.value)} disabled={!scoped || busy} /></Field>
      <Field label="Family"><Input aria-label="Family" value={family} maxLength={100}
        onChange={(_, data) => setFamily(data.value)} disabled={!scoped || busy} /></Field>
      <Field label="STEP source file">
        <input aria-label="STEP source file" type="file" accept=".step,.stp" onChange={selectFile} disabled={!scoped || busy} />
      </Field>
      <Button appearance="primary" type="submit" disabled={!scoped || busy || !file || !manufacturer.trim() || !partNumber.trim() || !family.trim()}>
        {busy ? 'Importing…' : 'Import STEP'}
      </Button>
    </form>
    <div role="status" aria-live="polite">{loading ? <Spinner size="tiny" label="Loading catalogue…" /> : null}{message ? <Body1>{message}</Body1> : null}</div>
    <div aria-label="Imported components">
      <Caption1>{items.length} catalogue items</Caption1>
      <ul>{items.map(item => <li key={item.id}>
        <Body1>{item.manufacturer} · {item.partNumber}</Body1>
        <Caption1> {item.family} — {item.conversionStatus === 'ready' ? '3D ready' :
          item.conversionStatus === 'pending' ? 'Awaiting mesh preparation' : 'Conversion failed'}</Caption1>
      </li>)}</ul>
    </div>
    {scoped && projectId && token && modelVersionId ?
      <CadPlacementPanel projectId={projectId} token={token} modelVersionId={modelVersionId} catalogue={items}
        onShow={onShow} onMove={onMove} /> : null}
  </section>;
}
