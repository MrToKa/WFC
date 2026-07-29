import type { StandardMaterialOwnerCategory } from '@/api/client';
import type { MaterialsTab } from './Materials.types';

export type MaterialDetailsCapability = {
  category: StandardMaterialOwnerCategory;
  label: string;
  tab: MaterialsTab;
  route: (id: string) => string;
};

export const MATERIAL_DETAILS_CAPABILITIES: Record<
  StandardMaterialOwnerCategory,
  MaterialDetailsCapability
> = {
  'cable-type': {
    category: 'cable-type',
    label: 'Cable type',
    tab: 'cableTypes',
    route: (id) => `/materials/cable-types/${id}`,
  },
  'cable-installation-material': {
    category: 'cable-installation-material',
    label: 'Cable installation material',
    tab: 'cableInstallationMaterials',
    route: (id) => `/materials/cable-installation-materials/${id}`,
  },
  tray: {
    category: 'tray',
    label: 'Tray',
    tab: 'trays',
    route: (id) => `/materials/trays/${id}`,
  },
  support: {
    category: 'support',
    label: 'Support',
    tab: 'supports',
    route: (id) => `/materials/supports/${id}`,
  },
};

export const materialsBackPath = (tab: MaterialsTab): string =>
  `/materials?tab=${encodeURIComponent(tab)}`;
