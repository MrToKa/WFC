import type { MaterialSupport, MaterialTray } from '@/api/client';

export const makeSupport = (index: number): MaterialSupport => ({
  id: `support-${index}`,
  type: `Support ${String(index).padStart(2, '0')}`,
  manufacturer: index % 2 === 0 ? 'Alpha' : 'Beta',
  heightMm: 150,
  widthMm: 600,
  lengthMm: 1200,
  weightKg: 3.509,
  minimumOrderQuantity: 5,
  orderMeasurement: 'pcs',
  packaging: 'Box',
  unitPrice: 42.5,
  imageTemplateId: null,
  imageTemplateFileName: null,
  imageTemplateContentType: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

export const makeTray = (index: number): MaterialTray => {
  const { lengthMm: _length, weightKg, ...common } = makeSupport(index);
  return {
    ...common,
    id: `tray-${index}`,
    type: `Tray ${String(index).padStart(2, '0')}`,
    weightKgPerM: weightKg,
    rungHeightMm: 31,
    loadCurveId: 'curve-1',
    loadCurveName: 'Medium span',
  };
};
