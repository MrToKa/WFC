import { Tray, Cable, TrayInput } from '../../api/client';
import { TrayFormState, TrayFormErrors } from './TrayDetails.types';

export const KN_PER_KG = 9.80665 / 1000;
export const FLOAT_TOLERANCE = 1e-6;

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
  lengthMm: tray.lengthMm !== null ? String(tray.lengthMm) : '',
  weightKgPerM: ''
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

export const buildTrayInput = (values: TrayFormState): { input: TrayInput; errors: TrayFormErrors } => {
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

  const input: TrayInput = {
    name,
    type: toNullableString(values.type),
    purpose: toNullableString(values.purpose),
    widthMm: widthResult.numeric,
    heightMm: heightResult.numeric,
    lengthMm: lengthResult.numeric
  };

  return { input, errors };
};

export const sortTrays = (items: Tray[]): Tray[] =>
  [...items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
