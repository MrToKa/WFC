import { useMemo } from 'react';
import { Project, Tray, Cable, MaterialSupport } from '../../../api/client';
import { SupportCalculationResult } from '../TrayDetails.types';
import { calculateTraySpanLoad, isValidWeight } from '../loadAssessment';

export const useTrayCalculations = (
  project: Project | null,
  tray: Tray | null,
  trayCables: Cable[],
  materialSupportsById: Record<string, MaterialSupport>,
  trayWeightPerMeterKg: number | null,
  groundingCableWeightKgPerM: number | null,
  includeGroundingCable = false,
  trefoilClampsWeightKgPerM: number | null = 0,
) => {
  const supportOverride = useMemo(() => {
    if (!project || !tray || !tray.type) {
      return null;
    }
    return project.supportDistanceOverrides[tray.type] ?? null;
  }, [project, tray]);

  const supportIdToLoad = supportOverride?.supportId ?? null;

  const overrideSupport = useMemo(
    () =>
      supportIdToLoad && materialSupportsById[supportIdToLoad]
        ? materialSupportsById[supportIdToLoad]
        : null,
    [supportIdToLoad, materialSupportsById],
  );

  const supportCalculations = useMemo<SupportCalculationResult>(() => {
    const lengthMeters =
      tray && tray.lengthMm !== null && tray.lengthMm > 0 ? tray.lengthMm / 1000 : null;

    const overrideDistance =
      supportOverride && supportOverride.distance !== null ? supportOverride.distance : null;

    let distanceMeters =
      overrideDistance ??
      (project && project.supportDistance !== null ? project.supportDistance : null);

    if (
      (distanceMeters === null || distanceMeters === undefined || distanceMeters <= 0) &&
      tray?.type
    ) {
      if (tray.type.trim().toLowerCase() === 'kl 100.603 f') {
        distanceMeters = 2;
      }
    }

    if (distanceMeters !== null && distanceMeters <= 0) {
      distanceMeters = null;
    }

    const weightPerPieceOverride =
      overrideSupport && overrideSupport.weightKg !== null ? overrideSupport.weightKg : null;

    const weightPerPieceKg =
      weightPerPieceOverride !== null
        ? weightPerPieceOverride
        : project && project.supportWeight !== null
          ? project.supportWeight
          : null;

    if (lengthMeters === null || lengthMeters <= 0 || distanceMeters === null) {
      return {
        lengthMeters,
        distanceMeters,
        supportsCount: null,
        weightPerPieceKg,
        totalWeightKg: null,
        weightPerMeterKg: null,
      };
    }

    const baseSegments = Math.floor(lengthMeters / distanceMeters);
    let supportsCount = Math.max(2, baseSegments + 1);
    const remainder = lengthMeters - baseSegments * distanceMeters;

    if (baseSegments >= 1 && remainder > distanceMeters * 0.2) {
      supportsCount += 1;
    }

    const totalWeightKg = weightPerPieceKg !== null ? supportsCount * weightPerPieceKg : null;

    const weightPerMeterKg =
      totalWeightKg !== null && lengthMeters > 0 ? totalWeightKg / lengthMeters : null;

    return {
      lengthMeters,
      distanceMeters,
      supportsCount,
      weightPerPieceKg,
      totalWeightKg,
      weightPerMeterKg,
    };
  }, [project, tray, supportOverride, overrideSupport]);

  // Keep drawing/grouping order aligned with the tray table (# column).
  const sortedTrayCables = useMemo(
    () => [...trayCables].sort((a, b) => a.cableId - b.cableId),
    [trayCables],
  );

  const cablesWeightLoadPerMeterKg = useMemo(() => {
    if (
      sortedTrayCables.some((cable) => !isValidWeight(cable.weightKgPerM)) ||
      !isValidWeight(trefoilClampsWeightKgPerM) ||
      (includeGroundingCable && !isValidWeight(groundingCableWeightKgPerM))
    )
      return null;
    // The optional tray grounding conductor is additional to routed schedule cables.
    const total = sortedTrayCables.reduce((sum, cable) => sum + (cable.weightKgPerM ?? 0), 0);
    return total + (includeGroundingCable ? (groundingCableWeightKgPerM ?? 0) : 0) + (trefoilClampsWeightKgPerM ?? 0);
  }, [sortedTrayCables, groundingCableWeightKgPerM, includeGroundingCable, trefoilClampsWeightKgPerM]);

  const supportWeightPerMeterKg = supportCalculations.weightPerMeterKg;
  const trayLengthMeters = supportCalculations.lengthMeters;

  const trayWeightLoadPerMeterKg = useMemo(() => {
    if (trayWeightPerMeterKg === null || supportWeightPerMeterKg === null) {
      return null;
    }
    return trayWeightPerMeterKg + supportWeightPerMeterKg;
  }, [trayWeightPerMeterKg, supportWeightPerMeterKg]);

  const trayTotalOwnWeightKg = useMemo(() => {
    if (trayWeightLoadPerMeterKg === null || trayLengthMeters === null || trayLengthMeters <= 0) {
      return null;
    }
    return trayWeightLoadPerMeterKg * trayLengthMeters;
  }, [trayWeightLoadPerMeterKg, trayLengthMeters]);

  const cablesTotalWeightKg = useMemo(() => {
    if (cablesWeightLoadPerMeterKg === null || trayLengthMeters === null || trayLengthMeters <= 0) {
      return null;
    }
    return cablesWeightLoadPerMeterKg * trayLengthMeters;
  }, [cablesWeightLoadPerMeterKg, trayLengthMeters]);

  const totalWeightLoadPerMeterKg = useMemo(() => {
    if (trayWeightLoadPerMeterKg === null || cablesWeightLoadPerMeterKg === null) {
      return null;
    }
    return trayWeightLoadPerMeterKg + cablesWeightLoadPerMeterKg;
  }, [trayWeightLoadPerMeterKg, cablesWeightLoadPerMeterKg]);

  const totalWeightKg = useMemo(() => {
    if (trayTotalOwnWeightKg === null || cablesTotalWeightKg === null) {
      return null;
    }
    return trayTotalOwnWeightKg + cablesTotalWeightKg;
  }, [trayTotalOwnWeightKg, cablesTotalWeightKg]);

  const traySpanLoadKnPerM = useMemo(
    () => calculateTraySpanLoad(trayWeightPerMeterKg, cablesWeightLoadPerMeterKg),
    [trayWeightPerMeterKg, cablesWeightLoadPerMeterKg],
  );

  return {
    supportOverride,
    overrideSupport,
    supportCalculations,
    sortedTrayCables,
    cablesWeightLoadPerMeterKg,
    trayWeightLoadPerMeterKg,
    trayTotalOwnWeightKg,
    cablesTotalWeightKg,
    totalWeightLoadPerMeterKg,
    totalWeightKg,
    traySpanLoadKnPerM,
  };
};
