import { useMemo } from 'react';
import { Project, Tray, Cable, MaterialSupport } from '../../../api/client';
import { SupportCalculationResult } from '../TrayDetails.types';
import { KN_PER_KG } from '../TrayDetails.utils';

export const useTrayCalculations = (
  project: Project | null,
  tray: Tray | null,
  trayCables: Cable[],
  materialSupportsById: Record<string, MaterialSupport>,
  trayWeightPerMeterKg: number | null,
  groundingCableWeightKgPerM: number | null
) => {
  const supportOverride = useMemo(() => {
    if (!project || !tray || !tray.type) {
      return null;
    }
    return project.supportDistanceOverrides[tray.type] ?? null;
  }, [project, tray]);

  const supportIdToLoad = supportOverride?.supportId ?? null;

  const overrideSupport = useMemo(() =>
    supportIdToLoad && materialSupportsById[supportIdToLoad]
      ? materialSupportsById[supportIdToLoad]
      : null,
    [supportIdToLoad, materialSupportsById]
  );

  const supportCalculations = useMemo<SupportCalculationResult>(() => {
    const lengthMeters =
      tray && tray.lengthMm !== null && tray.lengthMm > 0
        ? tray.lengthMm / 1000
        : null;

    const overrideDistance =
      supportOverride && supportOverride.distance !== null
        ? supportOverride.distance
        : null;

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
      overrideSupport && overrideSupport.weightKg !== null
        ? overrideSupport.weightKg
        : null;

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
        weightPerMeterKg: null
      };
    }

    const baseSegments = Math.floor(lengthMeters / distanceMeters);
    let supportsCount = Math.max(2, baseSegments + 1);
    const remainder = lengthMeters - baseSegments * distanceMeters;

    if (baseSegments >= 1 && remainder > distanceMeters * 0.2) {
      supportsCount += 1;
    }

    const totalWeightKg =
      weightPerPieceKg !== null ? supportsCount * weightPerPieceKg : null;

    const weightPerMeterKg =
      totalWeightKg !== null && lengthMeters > 0
        ? totalWeightKg / lengthMeters
        : null;

    return {
      lengthMeters,
      distanceMeters,
      supportsCount,
      weightPerPieceKg,
      totalWeightKg,
      weightPerMeterKg
    };
  }, [project, tray, supportOverride, overrideSupport]);

  const nonGroundingCables = useMemo(() => trayCables, [trayCables]);

  const cablesForWeightCalculation = useMemo(() => {
    return nonGroundingCables.filter((cable) => {
      const weight = cable.weightKgPerM;
      return weight !== null && !Number.isNaN(weight);
    });
  }, [nonGroundingCables]);

  const cablesWeightLoadPerMeterKg = useMemo(() => {
    let total = 0;
    let hasWeightData = false;

    for (const cable of cablesForWeightCalculation) {
      const weight = cable.weightKgPerM;
      if (weight !== null && !Number.isNaN(weight)) {
        total += weight;
        hasWeightData = true;
      }
    }

    if (groundingCableWeightKgPerM !== null) {
      total += groundingCableWeightKgPerM;
      hasWeightData = true;
    }

    return hasWeightData ? total : null;
  }, [cablesForWeightCalculation, groundingCableWeightKgPerM]);

  const supportWeightPerMeterKg = supportCalculations.weightPerMeterKg;
  const trayLengthMeters = supportCalculations.lengthMeters;

  const trayWeightLoadPerMeterKg = useMemo(() => {
    if (trayWeightPerMeterKg === null || supportWeightPerMeterKg === null) {
      return null;
    }
    return trayWeightPerMeterKg + supportWeightPerMeterKg;
  }, [trayWeightPerMeterKg, supportWeightPerMeterKg]);

  const trayTotalOwnWeightKg = useMemo(() => {
    if (
      trayWeightLoadPerMeterKg === null ||
      trayLengthMeters === null ||
      trayLengthMeters <= 0
    ) {
      return null;
    }
    return trayWeightLoadPerMeterKg * trayLengthMeters;
  }, [trayWeightLoadPerMeterKg, trayLengthMeters]);

  const cablesTotalWeightKg = useMemo(() => {
    if (
      cablesWeightLoadPerMeterKg === null ||
      trayLengthMeters === null ||
      trayLengthMeters <= 0
    ) {
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

  const totalWeightLoadPerMeterKn = useMemo(() => {
    if (totalWeightLoadPerMeterKg === null) {
      return null;
    }
    return totalWeightLoadPerMeterKg * KN_PER_KG;
  }, [totalWeightLoadPerMeterKg]);

  return {
    supportOverride,
    overrideSupport,
    supportCalculations,
    nonGroundingCables,
    cablesWeightLoadPerMeterKg,
    trayWeightLoadPerMeterKg,
    trayTotalOwnWeightKg,
    cablesTotalWeightKg,
    totalWeightLoadPerMeterKg,
    totalWeightKg,
    totalWeightLoadPerMeterKn
  };
};
