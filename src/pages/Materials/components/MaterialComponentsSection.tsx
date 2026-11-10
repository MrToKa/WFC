import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Body1,
  Button,
  Caption1,
  Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Field,
  Input,
  Select,
  Spinner,
  Title3,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Link } from 'react-router-dom';
import { TrayStepStatus } from './TrayStepStatus';
import { getApiBaseUrl } from '@/api/http';
import {
  materialComponentKinds as kinds,
  type MaterialProductFamily as Family,
  type MaterialComponent as Component,
  type MaterialCadAsset as Asset,
} from '../../../../shared/materialCad';
const root = '/api/materials/components';
const MAX_STEP_SIZE = 8 * 1024 * 1024;
const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  form: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
    gap: tokens.spacingHorizontalM,
    alignItems: 'end',
    padding: tokens.spacingHorizontalM,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  catalogue: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    paddingLeft: '20px',
  },
});

async function catalogueRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${root}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.code
        ? `${payload.code} (HTTP ${response.status})`
        : `Request failed (HTTP ${response.status}).`,
    );
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export function MaterialComponentsSection({
  token,
  isAdmin,
  materialTrayId,
  onBusyChange,
  onAssetsChange,
}: {
  token: string | null;
  isAdmin: boolean;
  materialTrayId?: string;
  onBusyChange?: (busy: boolean) => void;
  onAssetsChange?: () => void;
}) {
  const styles = useStyles();
  const [families, setFamilies] = useState<Family[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState(false);
  const [removeCandidate, setRemoveCandidate] = useState<Asset | null>(null);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [familyId, setFamilyId] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>('straight');
  const [dimensions, setDimensions] = useState({ widthMm: '', heightMm: '', lengthMm: '' });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const assetLoad = useRef<AbortController | null>(null);
  const selected = components.find((component) => component.id === selectedId);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setLoading(true);
      try {
        const [familyResult, componentResult] = await Promise.all([
          catalogueRequest<{ families: Family[] }>(token, '/families', { signal }),
          catalogueRequest<{ components: Component[] }>(token, '', { signal }),
        ]);
        if (signal?.aborted) return;
        setFamilies(familyResult.families);
        setComponents(componentResult.components);
        if (materialTrayId) setSelectedId(componentResult.components.find(component => component.materialTrayId === materialTrayId)?.id ?? '');
      } catch (caught) {
        if (!signal?.aborted)
          setError(caught instanceof Error ? caught.message : 'Cannot load components.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [token, materialTrayId],
  );

  useEffect(() => {
    setSelectedId('');
    setAssets([]);
    setAssetsError(false);
    setRemoveCandidate(null);
    setComponents([]);
    setFamilies([]);
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    assetLoad.current?.abort();
    setAssets([]);
    setAssetsError(false);
    setAssetsLoading(false);
    setRemoveCandidate(null);
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
    if (!selectedId || !token) return;
    const controller = new AbortController();
    assetLoad.current = controller;
    setAssetsLoading(true);
    void catalogueRequest<{ assets: Asset[] }>(token, `/${selectedId}/cad-assets`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setAssets(result.assets);
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setAssetsError(true);
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : 'Cannot load CAD revisions.');
      }).finally(() => { if (!controller.signal.aborted) setAssetsLoading(false); });
    return () => controller.abort();
  }, [selectedId, token]);

  const mutate = async (work: () => Promise<void>) => {
    if (!token || !isAdmin || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cannot save catalogue changes.');
    } finally {
      setBusy(false);
    }
  };
  const createFamily = (event: FormEvent) => {
    event.preventDefault();
    void mutate(async () => {
      const result = await catalogueRequest<{ family: Family }>(token!, '/families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manufacturer: manufacturer.trim(), name: familyName.trim() }),
      });
      await load();
      setFamilyId(result.family.id);
      setManufacturer('');
      setFamilyName('');
      setMessage('Product family saved.');
    });
  };
  const createComponent = (event: FormEvent) => {
    event.preventDefault();
    void mutate(async () => {
      const numericDimensions: Record<string, number> = {};
      for (const [key, value] of Object.entries(dimensions)) {
        if (!value.trim()) continue;
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0)
          throw new Error('Dimensions must be positive millimetres.');
        numericDimensions[key] = numeric;
      }
      const result = await catalogueRequest<{ component: Component }>(token!, '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyId,
          partNumber: partNumber.trim(),
          componentKind: kind,
          name: name.trim(),
          ...numericDimensions,
        }),
      });
      await load();
      setSelectedId(result.component.id);
      setPartNumber('');
      setName('');
      setDimensions({ widthMm: '', heightMm: '', lengthMm: '' });
      setMessage('Component saved with its own part number.');
    });
  };
  const uploadStep = (event: FormEvent) => {
    event.preventDefault();
    if (!file || !selectedId) return;
    if (!/\.(step|stp)$/i.test(file.name) || file.size < 1 || file.size > MAX_STEP_SIZE) {
      setError('Select a non-empty STEP file up to 8 MiB.');
      return;
    }
    void mutate(async () => {
      // A slow initial history read must not overwrite the newly uploaded revision.
      assetLoad.current?.abort();
      const body = new FormData();
      body.set('file', file);
      await catalogueRequest(token!, `/${selectedId}/cad-assets`, { method: 'POST', body });
      const result = await catalogueRequest<{ assets: Asset[] }>(
        token!,
        `/${selectedId}/cad-assets`,
      );
      setAssets(result.assets);
      setAssetsError(false);
      setAssetsLoading(false);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await load();
      onAssetsChange?.();
      setMessage('STEP revision saved. Existing project placements keep their pinned revision.');
    });
  };
  const changeAsset = (asset: Asset, remove: boolean) => {
    const componentId = selectedId;
    const currentAssetId = assets.find(item => item.active)?.id ?? null;
    void mutate(async () => {
      assetLoad.current?.abort();
      await catalogueRequest(token!, `/${componentId}/cad-assets/${asset.id}${remove ? '' : '/activate'}`, remove
        ? { method: 'DELETE' }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedActiveAssetId: currentAssetId }) });
      setRemoveCandidate(null);
      const history = await catalogueRequest<{ assets: Asset[] }>(token!, `/${componentId}/cad-assets`);
      setAssets(history.assets); setAssetsError(false); setAssetsLoading(false);
      await load(); onAssetsChange?.();
      setMessage(remove ? 'Current STEP removed from the catalogue selection. Revision history and existing placements are preserved.' :
        'STEP revision restored for new placements. Existing placements retain their pinned revision.');
    });
  };
  const download = async (asset: Asset) => {
    if (!token || !selected) return;
    try {
      const response = await fetch(
        `${getApiBaseUrl()}${root}/${selected.id}/cad-assets/${asset.id}/download`,
        {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'same-origin',
          redirect: 'error',
          cache: 'no-store',
        },
      );
      if (!response.ok) throw new Error(`Cannot download STEP (HTTP ${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = asset.originalFilename.replace(/[/\\\u0000-\u001f\u007f]/g, '_');
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cannot download STEP.');
    }
  };
  const visible = components.filter(
    (component) =>
      (!filter || component.familyId === filter) &&
      `${component.partNumber} ${component.name} ${component.manufacturer} ${component.componentKind}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  return (
    <section className={styles.root} aria-label="Materials components">
      <Title3>{materialTrayId ? 'Tray STEP file' : 'Product components and STEP'}</Title3>
      <Body1>
        {materialTrayId ? 'Add a STEP file or upload a replacement as a new revision. Existing placed parts retain their original revision.' :
          'Each straight, bend, tee or fitting has its own part number within a product family. Routings builder uses these shared Materials components.'}
      </Body1>
      {loading ? <Spinner size="tiny" label="Loading components" /> : null}
      {error ? <div role="alert">{error}</div> : null}
      <div role="status" aria-live="polite">
        {message}
      </div>
      <Button
        disabled={loading || busy || !token}
        onClick={() => {
          setError('');
          void load();
          if (selectedId && token) {
            assetLoad.current?.abort();
            const controller = new AbortController();
            assetLoad.current = controller;
            setAssetsLoading(true);
            void catalogueRequest<{ assets: Asset[] }>(token, `/${selectedId}/cad-assets`, { signal: controller.signal })
              .then(result => { if (!controller.signal.aborted) { setAssets(result.assets); setAssetsError(false); } })
              .catch(caught => { if (!controller.signal.aborted) { setAssetsError(true); setError(caught instanceof Error ? caught.message : 'Cannot load CAD revisions.'); } })
              .finally(() => { if (!controller.signal.aborted) setAssetsLoading(false); });
          }
        }}
      >
        {materialTrayId ? 'Refresh STEP files' : 'Refresh components'}
      </Button>
      {isAdmin && !materialTrayId ? (
        <>
          <form className={styles.form} aria-label="Create product family" onSubmit={createFamily}>
            <Field label="Family manufacturer">
              <Input
                aria-label="Family manufacturer"
                value={manufacturer}
                maxLength={200}
                onChange={(_, data) => setManufacturer(data.value)}
                disabled={busy}
              />
            </Field>
            <Field label="New family name">
              <Input
                aria-label="New family name"
                value={familyName}
                maxLength={200}
                onChange={(_, data) => setFamilyName(data.value)}
                disabled={busy}
              />
            </Field>
            <Button
              type="submit"
              disabled={busy || !token || !manufacturer.trim() || !familyName.trim()}
            >
              Add product family
            </Button>
          </form>
          <form
            className={styles.form}
            aria-label="Create catalogue component"
            onSubmit={createComponent}
          >
            <Field label="Product family">
              <Select
                aria-label="Product family"
                value={familyId}
                onChange={(_, data) => setFamilyId(data.value)}
                disabled={busy}
              >
                <option value="">Select family</option>
                {families.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.manufacturer} · {family.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Component type">
              <Select
                aria-label="Component type"
                value={kind}
                onChange={(_, data) => setKind(data.value)}
                disabled={busy}
              >
                {kinds.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Component part number">
              <Input
                aria-label="Component part number"
                value={partNumber}
                maxLength={200}
                onChange={(_, data) => setPartNumber(data.value)}
                disabled={busy}
              />
            </Field>
            <Field label="Component name">
              <Input
                aria-label="Component name"
                value={name}
                maxLength={200}
                onChange={(_, data) => setName(data.value)}
                disabled={busy}
              />
            </Field>
            {(['widthMm', 'heightMm', 'lengthMm'] as const).map((key, index) => (
              <Field key={key} label={`${['Width', 'Height', 'Length'][index]} (mm, optional)`}>
                <Input
                  aria-label={`${['Width', 'Height', 'Length'][index]} in mm`}
                  type="number"
                  min={0}
                  value={dimensions[key]}
                  onChange={(_, data) =>
                    setDimensions((previous) => ({ ...previous, [key]: data.value }))
                  }
                  disabled={busy}
                />
              </Field>
            ))}
            <Button
              type="submit"
              disabled={busy || !token || !familyId || !partNumber.trim() || !name.trim()}
            >
              Add component
            </Button>
          </form>
        </>
      ) : null}
      {!materialTrayId ? <>
      <Field label="Filter product family">
        <Select
          aria-label="Filter product family"
          value={filter}
          onChange={(_, data) => setFilter(data.value)}
        >
          <option value="">All families</option>
          {families.map((family) => (
            <option key={family.id} value={family.id}>
              {family.manufacturer} · {family.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Find component">
        <Input
          aria-label="Find component"
          value={search}
          onChange={(_, data) => setSearch(data.value)}
        />
      </Field>
      <Caption1>{visible.length} components</Caption1>
      <ul className={styles.catalogue} aria-label="Catalogue components">
        {visible.map((component) => (
          <li key={component.id}>
            <Button
              appearance={selectedId === component.id ? 'primary' : 'secondary'}
              disabled={busy}
              onClick={() => {
                setError('');
                setMessage('');
                setSelectedId(component.id);
              }}
            >
              {component.manufacturer} · {component.partNumber} · {component.name} (
              {component.componentKind})
            </Button>
            <Caption1>
              {' '}
              {component.familyName} ·{' '}
              {component.latestRevision ? `STEP revision ${component.latestRevision}` : 'No STEP'}
            </Caption1>
          </li>
        ))}
      </ul>
      {!visible.length && !loading ? (
        <Body1>No components match. Add real catalogue parts with independent part numbers.</Body1>
      ) : null}
      </> : null}
      {selected ? (
        <section className={styles.root} aria-label="Component STEP revisions">
          <Title3>{selected.partNumber} — STEP revisions</Title3>
          <TrayStepStatus status={assetsLoading ? 'loading' : assetsError ? 'error' : assets.some(asset => asset.active) ? 'attached' : 'missing'}
            revision={assets.find(asset => asset.active)?.revision} />
          {selected.materialTrayId && !materialTrayId ? (
            <Link to={`/materials/trays/${selected.materialTrayId}`}>
              Open straight tray material, image and load curve
            </Link>
          ) : null}
          <Caption1>
            {selected.widthMm ?? '—'} × {selected.heightMm ?? '—'} × {selected.lengthMm ?? '—'} mm
            (width × height × length)
          </Caption1>
          {isAdmin ? (
            <form className={styles.form} aria-label="Upload component STEP" onSubmit={uploadStep}>
              <Field label="Component STEP file">
                <input
                  ref={fileInput}
                  aria-label="Component STEP file"
                  type="file"
                  accept=".step,.stp"
                  disabled={busy}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setError('');
                  }}
                />
              </Field>
              <Caption1>
                Up to 8 MiB. A new revision preserves previous STEP files and project references.
              </Caption1>
              <Button type="submit" disabled={busy || !token || !file}>
                {busy ? 'Saving…' : materialTrayId ? assets.some(asset => asset.active) ? 'Upload replacement STEP' : 'Add STEP file' : 'Upload STEP revision'}
              </Button>
            </form>
          ) : null}
          <ul>
            {assets.map((asset) => (
              <li key={asset.id}>
                <Body1>
                  Revision {asset.revision}
                  {asset.active ? ' (current)' : ''} · {asset.originalFilename} ·{' '}
                  {asset.sourceBytes} bytes
                </Body1>
                <Caption1> SHA-256: {asset.sourceSha256}</Caption1>
                <Button onClick={() => void download(asset)}>
                  Download revision {asset.revision}
                </Button>
                {isAdmin ? asset.active ? <Button disabled={busy || assetsLoading || assetsError} onClick={() => setRemoveCandidate(asset)}>Remove current STEP</Button> :
                  <Button disabled={busy || assetsLoading || assetsError} onClick={() => changeAsset(asset, false)}>Restore revision {asset.revision}</Button> : null}
              </li>
            ))}
          </ul>
          {!assets.length && !assetsLoading && !assetsError ? <Body1>No STEP revisions for this component.</Body1> : null}
        </section>
      ) : (
        <Body1>{materialTrayId ? loading ? 'Loading tray STEP files…' : 'The linked catalogue component is unavailable. Refresh and try again.' : 'Select a component to view its STEP revisions.'}</Body1>
      )}
      <Dialog open={Boolean(removeCandidate)} onOpenChange={(_, data) => { if (!data.open && !busy) setRemoveCandidate(null); }}>
        <DialogSurface><DialogBody>
          <DialogTitle>Remove current STEP?</DialogTitle>
          <DialogContent>{removeCandidate?.originalFilename}<p>The tray will have no current STEP for new placements. Existing placements and all revision files are preserved. You can restore this revision later.</p></DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setRemoveCandidate(null)}>Cancel</Button>
            <Button appearance="primary" disabled={busy} onClick={() => { if (removeCandidate) changeAsset(removeCandidate, true); }}>Remove STEP</Button>
          </DialogActions>
        </DialogBody></DialogSurface>
      </Dialog>
    </section>
  );
}
