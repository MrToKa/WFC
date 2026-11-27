import { Tray, Cable, TrayInput } from '../../api/client';
import type { CableCategoryKey } from '../ProjectDetails/hooks/cableLayoutDefaults';
import { TrayFormState, TrayFormErrors } from './TrayDetails.types';
import type {
  TrayAutoLengthMeasurement,
  TrayAutoLengthReference,
} from '../../../shared/trayAutoLength';

export const KN_PER_KG = 9.80665 / 1000;
export const FLOAT_TOLERANCE = 1e-6;

export class TrayAutoLengthRequest {
  private ticket: object | null = null;

  get pending(): boolean {
    return this.ticket !== null;
  }

  start(owner: string, currentOwner: () => string): () => boolean {
    const ticket = {};
    this.ticket = ticket;
    return () => this.ticket === ticket && currentOwner() === owner;
  }

  cancel(): void {
    this.ticket = null;
  }
}

export const toNullableString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export const toTrayFormState = (tray: Tray): TrayFormState => ({
  name: tray.name,
  type: tray.type ?? '',
  purpose: tray.purpose ?? '',
  widthMm: tray.widthMm !== null ? String(tray.widthMm) : '',
  heightMm: tray.heightMm !== null ? String(tray.heightMm) : '',
  // CAD route lengths can retain more than three decimals. Rounding an untouched
  // value here would turn an unrelated metadata save into a manual length edit.
  lengthMm:
    tray.lengthMm !== null
      ? tray.lengthSource === 'auto' &&
        !(
          tray.lengthCalculation &&
          'source' in tray.lengthCalculation &&
          tray.lengthCalculation.source === 'cad-route'
        )
        ? tray.lengthMm.toFixed(3)
        : String(tray.lengthMm)
      : '',
  lengthSource: tray.lengthSource ?? 'manual',
  autoLengthRequested: false,
  autoLengthReference:
    tray.lengthSource === 'auto' &&
    tray.lengthCalculation &&
    !('source' in tray.lengthCalculation && tray.lengthCalculation.source === 'cad-route')
      ? autoLengthReference(tray.lengthCalculation)
      : undefined,
  weightKgPerM: '',
});

const autoLengthReference = (measurement: TrayAutoLengthReference): TrayAutoLengthReference =>
  'source' in measurement
    ? {
        source: 'tray-capture',
        modelVersionId: measurement.modelVersionId,
        selectionRevision: measurement.selectionRevision,
        assignmentSha256: measurement.assignmentSha256,
        measurementId: measurement.measurementId,
      }
    : {
        modelVersionId: measurement.modelVersionId,
        geometryRevision: measurement.geometryRevision,
        aggregateId: measurement.aggregateId,
        traceId: measurement.traceId,
      };

export const applyTrayAutoLength = (
  values: TrayFormState,
  measurement: TrayAutoLengthMeasurement,
  approvedManualLengthMm = values.approvedManualLengthMm,
): TrayFormState => ({
  ...values,
  lengthMm: measurement.lengthMm.toFixed(3),
  lengthSource: 'auto',
  autoLengthRequested: true,
  autoLengthReference: autoLengthReference(measurement),
  approvedManualLengthMm,
});

export const requiresTrayAutoLengthApproval = (
  values: TrayFormState,
  saved: Pick<Tray, 'lengthMm' | 'lengthSource'>,
): boolean =>
  values.lengthSource !== 'auto' &&
  (values.lengthMm.trim() !== '' || (saved.lengthSource !== 'auto' && saved.lengthMm !== null));

export const updateTrayFormField = (
  values: TrayFormState,
  field: keyof TrayFormState,
  value: string,
): TrayFormState => ({
  ...values,
  [field]: value,
  ...(field === 'lengthMm'
    ? {
        lengthSource: 'manual' as const,
        autoLengthRequested: false,
        autoLengthReference: undefined,
        approvedManualLengthMm: undefined,
      }
    : {}),
});

export const parseNumberInput = (value: string): { numeric: number | null; error?: string } => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { numeric: null };
  }
  const normalised = trimmed.replace(',', '.');
  const parsed = Number(normalised);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { numeric: null, error: 'Enter a valid non-negative number' };
  }
  return { numeric: parsed };
};

export const routingContainsTray = (routing: string | null, trayName: string): boolean => {
  if (!routing) {
    return false;
  }

  const target = trayName.trim().toLowerCase();
  if (!target) {
    return false;
  }

  return routing
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .some((segment) => segment === target);
};

export const filterCablesByTray = (cables: Cable[], trayName: string): Cable[] =>
  cables.filter((cable) => routingContainsTray(cable.routing, trayName));

export const isGroundingPurpose = (purpose: string | null): boolean =>
  purpose !== null && purpose.trim().toLowerCase() === 'grounding';

export const formatDimensionValue = (value: number | null | undefined): string =>
  value === null || value === undefined || Number.isNaN(value) ? '' : String(value);

export const formatWeightValue = (value: number | null | undefined): string =>
  value === null || value === undefined || Number.isNaN(value) ? '' : value.toFixed(3);

export const buildTrayInput = (
  values: TrayFormState,
): { input: TrayInput; errors: TrayFormErrors } => {
  const errors: TrayFormErrors = {};

  const name = values.name.trim();
  if (name === '') {
    errors.name = 'Name is required';
  }

  const widthResult = parseNumberInput(values.widthMm);
  if (widthResult.error) {
    errors.widthMm = widthResult.error;
  }

  const heightResult = parseNumberInput(values.heightMm);
  if (heightResult.error) {
    errors.heightMm = heightResult.error;
  }

  const lengthResult = parseNumberInput(values.lengthMm);
  if (lengthResult.error) {
    errors.lengthMm = lengthResult.error;
  }
  const requestedAutoLength = values.lengthSource === 'auto' && values.autoLengthRequested;
  if (requestedAutoLength && !values.autoLengthReference) {
    errors.lengthMm = 'Use Auto-length again to verify this calculated length before saving.';
  }

  const input: TrayInput = {
    name,
    type: toNullableString(values.type),
    purpose: toNullableString(values.purpose),
    widthMm: widthResult.numeric,
    heightMm: heightResult.numeric,
    lengthMm: lengthResult.numeric,
    ...(values.lengthSource === 'manual' ? { lengthSource: 'manual' as const } : {}),
    ...(requestedAutoLength
      ? {
          lengthSource: 'auto' as const,
          autoLengthReference: values.autoLengthReference,
          ...(values.approvedManualLengthMm !== undefined
            ? { approvedManualLengthMm: values.approvedManualLengthMm }
            : {}),
        }
      : {}),
  };

  return { input, errors };
};

export const sortTrays = (items: Tray[]): Tray[] =>
  [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

export const matchCableCategory = (purpose: string | null): CableCategoryKey | null => {
  if (!purpose) {
    return null;
  }

  const normalized = purpose.trim().toLowerCase();
  if (normalized === '') {
    return null;
  }

  if (normalized.includes('ground')) {
    return 'mv';
  }

  if (normalized.startsWith('mv') || normalized.includes('medium voltage')) {
    return 'mv';
  }

  if (normalized.includes('vfd')) {
    return 'vfd';
  }

  if (normalized.startsWith('power') || normalized.includes(' power')) {
    return 'power';
  }

  if (normalized.includes('control')) {
    return 'control';
  }

  return null;
};
