import type { MaterialCableType } from '@/api/client';
import { MasterMaterialDetailsPage } from './Materials/MasterMaterialDetailsPage';
import { MaterialSourceLink } from './Materials/components/MaterialDetailsLayout';

const value = (input: string | number | null, suffix = ''): string =>
  input === null ? '—' : `${input}${suffix}`;

export const MaterialCableTypeDetails = () => (
  <MasterMaterialDetailsPage<MaterialCableType>
    category="cable-type"
    idParam="cableTypeId"
    getTitle={(material) => material.name}
    getProperties={(material) => [
      { label: 'Name', value: material.name },
      { label: 'Purpose', value: value(material.purpose) },
      { label: 'Material', value: value(material.material) },
      { label: 'Description', value: value(material.description) },
      { label: 'Manufacturer', value: value(material.manufacturer) },
      { label: 'Part number', value: value(material.partNo) },
      { label: 'Remarks', value: value(material.remarks) },
      { label: 'Diameter', value: value(material.diameterMm, ' mm') },
      { label: 'Weight', value: value(material.weightKgPerM, ' kg/m') },
      {
        label: 'Minimum order',
        value: `${material.minimumOrderQuantity} ${material.orderMeasurement}`,
      },
      { label: 'Packaging', value: material.packaging },
      { label: 'Price', value: material.unitPrice },
      { label: 'Source', value: <MaterialSourceLink source={material.source} /> },
    ]}
  />
);
