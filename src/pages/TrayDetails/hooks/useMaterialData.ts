import { useState, useEffect } from 'react';
import { MaterialTray, fetchAllMaterialTrays, fetchProjectTrayData } from '../../../api/client';

export const useMaterialData = (projectId: string | undefined, isAdmin: boolean) => {
  const [materialTrays, setMaterialTrays] = useState<MaterialTray[]>([]);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState<boolean>(false);
  const [materialsError, setMaterialsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setMaterialTrays([]);
    const loadMaterialTrays = async () => {
      setIsLoadingMaterials(true);
      setMaterialsError(null);
      try {
        const result = isAdmin
          ? await fetchAllMaterialTrays()
          : projectId
            ? await fetchProjectTrayData(projectId)
            : { trays: [] };
        if (!active) return;
        const sorted = [...result.trays].sort((a, b) =>
          a.type.localeCompare(b.type, undefined, { sensitivity: 'base' }),
        );
        setMaterialTrays(sorted);
      } catch (err) {
        if (!active) return;
        console.error('Fetch material trays failed', err);
        setMaterialsError(
          'Failed to load tray types. Width, height, and weight cannot be updated automatically.',
        );
      } finally {
        if (active) setIsLoadingMaterials(false);
      }
    };

    void loadMaterialTrays();
    return () => {
      active = false;
    };
  }, [projectId, isAdmin]);

  const findMaterialTrayByType = (type: string) => {
    const normalised = type.trim().toLowerCase();
    if (!normalised) {
      return null;
    }
    return materialTrays.find((item) => item.type.trim().toLowerCase() === normalised) ?? null;
  };

  return {
    materialTrays,
    isLoadingMaterials,
    materialsError,
    findMaterialTrayByType,
  };
};
