export type TrayFormState = {
  name: string;
  type: string;
  purpose: string;
  widthMm: string;
  heightMm: string;
  lengthMm: string;
  weightKgPerM: string;
};

export type TrayFormErrors = Partial<Record<keyof TrayFormState, string>>;

export type SupportCalculationResult = {
  lengthMeters: number | null;
  distanceMeters: number | null;
  supportsCount: number | null;
  weightPerPieceKg: number | null;
  totalWeightKg: number | null;
  weightPerMeterKg: number | null;
};

export type LoadCurveChartStatus =
  | 'no-curve'
  | 'loading'
  | 'awaiting-data'
  | 'no-points'
  | 'ok'
  | 'too-long'
  | 'too-short'
  | 'load-too-high';

export type GroundingSelection = { 
  include: boolean; 
  typeId: string | null;
};

export type ChartEvaluation = {
  status: LoadCurveChartStatus;
  message: string;
  marker: {
    span: number;
    load: number;
    color: string;
    label: string;
  } | null;
  limitHighlight: {
    span: number;
    load: number;
    type: 'min' | 'max';
    label: string;
  } | null;
  minSpan: number | null;
  maxSpan: number | null;
  allowableLoadAtSpan: number | null;
};
