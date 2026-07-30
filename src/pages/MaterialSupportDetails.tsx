import type { MaterialSupport } from '@/api/client';
import { MasterMaterialDetailsPage } from './Materials/MasterMaterialDetailsPage';

const numeric = (input: number | null, suffix: string): string =>
  input === null ? '—' : `${input} ${suffix}`;

export const MaterialSupportDetails = () => (
  <MasterMaterialDetailsPage<MaterialSupport>
    category="support"
    idParam="supportId"
    getTitle={(material) => material.type}
    getProperties={(material) => [
      { label: 'Type', value: material.type },
      { label: 'Manufacturer', value: material.manufacturer ?? '—' },
      { label: 'Height', value: numeric(material.heightMm, 'mm') },
      { label: 'Width', value: numeric(material.widthMm, 'mm') },
      { label: 'Length', value: numeric(material.lengthMm, 'mm') },
      { label: 'Weight', value: numeric(material.weightKg, 'kg') },
      {
        label: 'Minimum order',
        value: `${material.minimumOrderQuantity} ${material.orderMeasurement}`,
      },
      { label: 'Packaging', value: material.packaging },
      { label: 'Image template', value: material.imageTemplateFileName ?? '—' },
    ]}
  />
);
