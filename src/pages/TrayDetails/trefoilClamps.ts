import type { Cable } from '@/api/client';

export type TrefoilClamp = {
  model: string;
  minDiameterMm: number;
  maxDiameterMm: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  weightGrams: number;
};

// Ellis Vulcan+ DS03E, issue 09 (13/10/25), supplied project data sheet.
// VRT+00B is a single-cable cleat, so it is excluded from the trefoil catalog.
export const TREFOIL_CLAMPS: readonly TrefoilClamp[] = [
  ['VRT+00C', 10, 15, 57, 94, 56, 276],
  ['VRT+00A', 15, 18, 60, 93, 54, 287],
  ['VRT+00', 19, 24, 60, 92, 54, 251],
  ['VRT+01', 23, 28, 66, 100, 54, 258],
  ['VRT+02', 27, 32, 74, 108, 54, 269],
  ['VRT+03', 30, 35, 80, 113, 54, 279],
  ['VRT+04', 33, 38, 86, 119, 54, 284],
  ['VRT+05', 36, 42, 94, 125, 54, 319],
  ['VRT+06', 40, 46, 102, 134, 54, 331],
  ['VRT+07', 44, 50, 110, 140, 54, 391],
  ['VRT+08', 48, 55, 120, 151, 54, 405],
  ['VRT+09', 51, 58, 126, 156, 54, 411],
  ['VRT+10', 55, 62, 134, 162, 54, 442],
  ['VRT+11', 59, 66, 142, 168, 54, 453],
  ['VRT+12', 63, 70, 150, 178, 54, 460],
  ['VRT+13', 67, 74, 158, 185, 54, 524],
  ['VRT+14', 71, 78, 166, 196, 54, 536],
  ['VRT+15', 74, 82, 174, 202, 54, 542],
  ['VRT+16', 77, 85, 180, 206, 54, 544],
  ['VRT+17', 81, 89, 188, 212, 54, 618],
  ['VRT+18', 85, 93, 196, 217, 54, 628],
  ['VRT+19', 89, 97, 204, 222, 54, 637],
  ['VRT+20', 93, 101, 212, 230, 54, 646],
].map(([model, minDiameterMm, maxDiameterMm, widthMm, heightMm, depthMm, weightGrams]) => ({
  model: model as string,
  minDiameterMm: minDiameterMm as number,
  maxDiameterMm: maxDiameterMm as number,
  widthMm: widthMm as number,
  heightMm: heightMm as number,
  depthMm: depthMm as number,
  weightGrams: weightGrams as number,
}));

/** Choose a range that fits every cable; overlaps use the closest range midpoint. */
export const selectTrefoilClamp = (
  diameters: readonly (number | null | undefined)[],
): TrefoilClamp | null => {
  if (
    diameters.length !== 3 ||
    diameters.some((d) => typeof d !== 'number' || !Number.isFinite(d) || d <= 0)
  ) {
    return null;
  }
  const validDiameters = diameters as readonly number[];
  const min = Math.min(...validDiameters);
  const max = Math.max(...validDiameters);
  return (
    [...TREFOIL_CLAMPS]
      .filter((clamp) => min >= clamp.minDiameterMm && max <= clamp.maxDiameterMm)
      .sort((a, b) => {
        const distance = (clamp: TrefoilClamp) =>
          Math.abs((clamp.minDiameterMm + clamp.maxDiameterMm) / 2 - max);
        return (
          distance(a) - distance(b) ||
          a.maxDiameterMm - a.minDiameterMm - (b.maxDiameterMm - b.minDiameterMm) ||
          a.maxDiameterMm - b.maxDiameterMm ||
          a.model.localeCompare(b.model)
        );
      })[0] ?? null
  );
};

export type TrefoilClampGroup = { cables: Cable[]; clamp: TrefoilClamp | null };
export type TrefoilClampWeightRow = {
  clamp: TrefoilClamp;
  groupCount: number;
  countPerGroup: number | null;
  totalCount: number | null;
  totalWeightKg: number | null;
};
export type TrefoilClampWeight = {
  rows: TrefoilClampWeightRow[];
  groupCount: number;
  countPerGroup: number | null;
  totalCount: number | null;
  totalWeightKg: number | null;
  weightPerMeterKg: number | null;
  issues: string[];
};

export const DEFAULT_TREFOIL_CLAMP_SPACING_MM = 600;

/** One clamp at each end, with no interval longer than the chosen spacing. */
export const calculateTrefoilClampWeight = (
  groups: readonly TrefoilClampGroup[] | undefined,
  lengthMm: number | null | undefined,
  spacingMm = DEFAULT_TREFOIL_CLAMP_SPACING_MM,
): TrefoilClampWeight => {
  const issues: string[] = [];
  const grouped = new Map<string, { clamp: TrefoilClamp; groupCount: number }>();
  if (!groups) issues.push('The tray layout is required to calculate trefoil clamps.');
  for (const [index, group] of (groups ?? []).entries()) {
    if (!group.clamp || group.cables.length !== 3) {
      const diameters = group.cables.map((cable) => cable.diameterMm ?? '?').join(', ');
      issues.push(
        `No Vulcan+ trefoil clamp fits group ${index + 1} (cable diameters: ${diameters} mm).`,
      );
      continue;
    }
    const item = grouped.get(group.clamp.model) ?? { clamp: group.clamp, groupCount: 0 };
    item.groupCount += 1;
    grouped.set(group.clamp.model, item);
  }

  const hasGroups = (groups?.length ?? 0) > 0;
  const validLength = typeof lengthMm === 'number' && Number.isFinite(lengthMm) && lengthMm > 0;
  const validSpacing = Number.isFinite(spacingMm) && spacingMm > 0 && spacingMm <= 1_000_000;
  if (hasGroups && !validLength)
    issues.push('Provide a positive tray length to calculate trefoil clamps.');
  if (hasGroups && !validSpacing)
    issues.push('Provide a clamp spacing greater than 0 and at most 1,000,000 mm.');
  const countPerGroup =
    hasGroups && validLength && validSpacing
      ? Math.ceil(lengthMm / spacingMm) + 1
      : hasGroups
        ? null
        : 0;
  const rows: TrefoilClampWeightRow[] = [...grouped.values()].map(({ clamp, groupCount }) => ({
    clamp,
    groupCount,
    countPerGroup,
    totalCount: countPerGroup === null ? null : countPerGroup * groupCount,
    totalWeightKg:
      countPerGroup === null ? null : (countPerGroup * groupCount * clamp.weightGrams) / 1000,
  }));
  const totalCount =
    issues.length === 0 ? rows.reduce((sum, row) => sum + (row.totalCount ?? 0), 0) : null;
  const totalWeightKg =
    issues.length === 0 ? rows.reduce((sum, row) => sum + (row.totalWeightKg ?? 0), 0) : null;
  const weightPerMeterKg =
    totalWeightKg === null ? null : !hasGroups ? 0 : totalWeightKg / (lengthMm! / 1000);
  return {
    rows,
    groupCount: groups?.length ?? 0,
    countPerGroup,
    totalCount,
    totalWeightKg,
    weightPerMeterKg,
    issues,
  };
};
