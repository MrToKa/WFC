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
  'tray-installation-material': {
    category: 'tray-installation-material',
    label: 'Tray installation material',
    tab: 'trayInstallationMaterials',
    route: (id) => `/materials/tray-installation-materials/${id}`,
  },
  tray: {
    category: 'tray',
    label: 'Tray',
    tab: 'trays',
    route: (id) => `/materials/trays/${id}`,
  },
  instrument: {
    category: 'instrument',
    label: 'Instrument',
    tab: 'instruments',
    route: (id) => `/materials/instruments/${id}`,
  },
  'instrument-installation-material': {
    category: 'instrument-installation-material',
    label: 'Instrument installation material',
    tab: 'instrumentInstallationMaterials',
    route: (id) => `/materials/instrument-installation-materials/${id}`,
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
