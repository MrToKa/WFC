import type { TrayRow } from '../models/tray.js';
import { PathFinderError } from '../pathfinder/errors.js';

type Profile = { trayType: string; widthMm: number; heightMm: number };

export function projectTrayProfile(row: TrayRow): Profile {
  const widthMm = Number(row.width_mm), heightMm = Number(row.height_mm);
  if (!row.tray_type?.trim() || !Number.isFinite(widthMm) || widthMm <= 0 ||
      !Number.isFinite(heightMm) || heightMm <= 0) {
    throw new PathFinderError('CAD_ROUTE_REAL_PROFILE_REQUIRED', 409, 'Enter a type, positive width and height in Trays before using substitute STEP geometry.');
  }
  return { trayType: row.tray_type, widthMm, heightMm };
}

export function routingTrayProfile(step: Profile, exported: { link: { substitute_step?: boolean }; row: TrayRow } | null) {
  return exported?.link?.substitute_step ? projectTrayProfile(exported.row) : step;
}
