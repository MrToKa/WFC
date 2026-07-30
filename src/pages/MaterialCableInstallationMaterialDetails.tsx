import type { MaterialCableInstallationMaterial } from '@/api/client';
import { MasterMaterialDetailsPage } from './Materials/MasterMaterialDetailsPage';

const value = (input: string | null): string => input ?? '—';

export const MaterialCableInstallationMaterialDetails = () => (
  <MasterMaterialDetailsPage<MaterialCableInstallationMaterial>
    category="cable-installation-material"
    idParam="cableInstallationMaterialId"
    getTitle={(material) => material.type}
    getProperties={(material) => [
      { label: 'Type', value: material.type },
      { label: 'Purpose', value: value(material.purpose) },
      { label: 'Material', value: value(material.material) },
      { label: 'Description', value: value(material.description) },
      { label: 'Manufacturer', value: value(material.manufacturer) },
      { label: 'Part number', value: value(material.partNo) },
      {
        label: 'Minimum order',
        value: `${material.minimumOrderQuantity} ${material.orderMeasurement}`,
      },
      { label: 'Packaging', value: material.packaging },
    ]}
  />
);
