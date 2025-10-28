import { useState, useEffect } from 'react';
import { MaterialTray, fetchAllMaterialTrays } from '../../../api/client';

export const useMaterialData = () => {
  const [materialTrays, setMaterialTrays] = useState<MaterialTray[]>([]);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState<boolean>(false);
  const [materialsError, setMaterialsError] = useState<string | null>(null);

  useEffect(() => {
    const loadMaterialTrays = async () => {
      setIsLoadingMaterials(true);
      setMaterialsError(null);
      try {
        const result = await fetchAllMaterialTrays();
        const sorted = [...result.trays].sort((a, b) =>
          a.type.localeCompare(b.type, undefined, { sensitivity: 'base' })
        );
        setMaterialTrays(sorted);
      } catch (err) {
        console.error('Fetch material trays failed', err);
        setMaterialsError('Failed to load tray types. Width, height, and weight cannot be updated automatically.');
      } finally {
        setIsLoadingMaterials(false);
      }
    };

    void loadMaterialTrays();
  }, []);

  const findMaterialTrayByType = (type: string) => {
    const normalised = type.trim().toLowerCase();
    if (!normalised) {
      return null;
    }
    return (
      materialTrays.find(
        (item) => item.type.trim().toLowerCase() === normalised
      ) ?? null
    );
  };

  return {
    materialTrays,
    isLoadingMaterials,
    materialsError,
    findMaterialTrayByType
  };
};
