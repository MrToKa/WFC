import type { MaterialInstrument } from '@/api/client';
import { MasterMaterialDetailsPage } from './Materials/MasterMaterialDetailsPage';
import { MaterialSourceLink } from './Materials/components/MaterialDetailsLayout';

const value = (input: string | null): string => input ?? '—';
const numeric = (input: number | null, suffix: string): string =>
  input === null ? '—' : `${input} ${suffix}`;

export const MaterialInstrumentDetails = () => (
  <MasterMaterialDetailsPage<MaterialInstrument>
    category="instrument"
    idParam="instrumentId"
    getTitle={(material) => material.type}
    getProperties={(material) => [
      { label: 'Type', value: material.type },
      { label: 'Purpose', value: value(material.purpose) },
      { label: 'Material', value: value(material.material) },
      { label: 'Description', value: value(material.description) },
      { label: 'Manufacturer', value: value(material.manufacturer) },
      { label: 'Part number', value: value(material.partNo) },
      { label: 'Dimension [mm]', value: value(material.dimensionMm) },
      { label: 'Weight [kg]', value: numeric(material.weightKg, 'kg') },
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
