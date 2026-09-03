import type { MaterialTray } from '@/api/client';
import { MasterMaterialDetailsPage } from './Materials/MasterMaterialDetailsPage';
import { MaterialSourceLink } from './Materials/components/MaterialDetailsLayout';

const numeric = (input: number | null, suffix: string): string =>
  input === null ? '—' : `${input} ${suffix}`;

export const MaterialTrayDetails = () => (
  <MasterMaterialDetailsPage<MaterialTray>
    category="tray"
    idParam="trayId"
    getTitle={(material) => material.type}
    getProperties={(material) => [
      { label: 'Type', value: material.type },
      { label: 'Manufacturer', value: material.manufacturer ?? '—' },
      { label: 'Height', value: numeric(material.heightMm, 'mm') },
      { label: 'Rung height', value: numeric(material.rungHeightMm, 'mm') },
      { label: 'Width', value: numeric(material.widthMm, 'mm') },
      { label: 'Weight', value: numeric(material.weightKgPerM, 'kg/m') },
      {
        label: 'Minimum order',
        value: `${material.minimumOrderQuantity} ${material.orderMeasurement}`,
      },
      { label: 'Packaging', value: material.packaging },
      { label: 'Price', value: material.unitPrice },
      { label: 'Load curve', value: material.loadCurveName ?? '—' },
      { label: 'Image template', value: material.imageTemplateFileName ?? '—' },
      { label: 'Source', value: <MaterialSourceLink source={material.source} /> },
    ]}
  />
);
