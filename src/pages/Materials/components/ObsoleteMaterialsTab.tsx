import { useCallback, useEffect, useState } from 'react';
import { Body1, Button, Spinner } from '@fluentui/react-components';
import { Link } from 'react-router-dom';
import { request } from '@/api/http';
import type { StandardMaterialOwnerCategory } from '@/api/client';
import { MATERIAL_DETAILS_CAPABILITIES } from '../materialCapabilities';

type RetiredMaterial = { id: string; category: StandardMaterialOwnerCategory; name: string; obsoleteAt: string };

export const ObsoleteMaterialsTab = ({ token }: { token: string | null }) => {
  const [materials, setMaterials] = useState<RetiredMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const response = await request<{ materials: RetiredMaterial[] }>('/api/materials/obsolete', { token });
      setMaterials(response.materials);
    } catch { setError('Unable to load obsolete materials.'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  if (!token) return <Body1>Sign in to view obsolete materials.</Body1>;
  return <section aria-label="Obsolete materials">
    <p>Obsolete materials remain stored with their composition and project references. They are unavailable for new selection.</p>
    <Button onClick={() => void load()} disabled={loading}>Refresh</Button>
    {loading ? <Spinner label="Loading obsolete materials" /> : error ? <p role="alert">{error}</p> :
      materials.length === 0 ? <p>No obsolete materials.</p> :
      <table><thead><tr><th>Material</th><th>Category</th><th>Obsolete since</th></tr></thead>
        <tbody>{materials.map((material) => <tr key={`${material.category}:${material.id}`}>
          <td><Link to={MATERIAL_DETAILS_CAPABILITIES[material.category].route(material.id)}>{material.name}</Link></td>
          <td>{MATERIAL_DETAILS_CAPABILITIES[material.category].label}</td>
          <td>{new Date(material.obsoleteAt).toLocaleString()}</td>
        </tr>)}</tbody></table>}
  </section>;
};
