import type { StandardMaterialOwnerCategory } from '@/api/client';

export const STANDARD_MATERIAL_CATEGORIES: {
  value: StandardMaterialOwnerCategory;
  label: string;
  itemLabel: string;
}[] = [
  { value: 'cable-type', label: 'Cable types', itemLabel: 'Cable Type' },
  {
    value: 'cable-installation-material',
    label: 'Cable installation materials',
    itemLabel: 'Cable Installation Material',
  },
  { value: 'tray', label: 'Trays', itemLabel: 'Tray' },
  {
    value: 'tray-installation-material',
    label: 'Trays installation materials',
    itemLabel: 'Tray Installation Material',
  },
  { value: 'instrument', label: 'Instruments', itemLabel: 'Instrument' },
  {
    value: 'instrument-installation-material',
    label: 'Instruments installation materials',
    itemLabel: 'Instrument Installation Material',
  },
  { value: 'support', label: 'Supports', itemLabel: 'Support' },
];

export const defaultStandardMaterialCategory = (
  owner: StandardMaterialOwnerCategory,
): StandardMaterialOwnerCategory => {
  if (owner === 'instrument' || owner === 'instrument-installation-material')
    return 'instrument-installation-material';
  if (owner === 'tray' || owner === 'tray-installation-material' || owner === 'support')
    return 'tray-installation-material';
  return 'cable-installation-material';
};

export type StandardMaterialCatalogItem = { id: string; type: string; purpose?: string | null };
