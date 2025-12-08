import type { Tray, Cable } from '@/api/client';

const TrayConstants = {
  canvasMargin: 50,
  textPadding: 40,
  defaultRungHeightMm: 15,
  defaultSpacingMm: 15,
  defaultCableDiameterMm: 1,
  cablePurposes: {
    power: 'power',
    control: 'control',
    mv: 'mv',
    vfd: 'vfd'
  },
  trayPurposes: {
    typeB: 'type b',
    typeBC: 'type bc'
  },
  bundleTypes: {
    range0_8: '0-8',
    range8_1_15: '8.1-15',
    range15_1_21: '15.1-21',
    range21_1_30: '21.1-30',
    range30_1_40: '30.1-40',
    range40_1_45: '40.1-45',
    range45_1_60: '45.1-60',
    range60Plus: '60+'
  }
} as const;

const isGroundingPurpose = (purpose: string | null | undefined): boolean =>
  typeof purpose === 'string' && purpose.trim().toLowerCase().includes('ground');

export type CableBundleMap = Record<string, Record<string, Cable[]>>;

type CategoryKey = keyof typeof TrayConstants.cablePurposes;

export type ProjectLayoutConfig = {
  maxRows: number;
  maxColumns: number;
  bundleSpacing: '0' | '1D' | '2D';
  cableSpacing: number;
  trefoil: boolean;
  trefoilSpacingBetweenBundles: boolean;
  applyPhaseRotation: boolean;
};

export type CategoryLayoutConfig = Record<CategoryKey, ProjectLayoutConfig>;

type TrefoilGroup =
  | { kind: 'trefoil'; cables: Cable[] }
  | { kind: 'normal'; cables: Cable[] };

export const determineCableDiameterGroup = (diameter: number | null | undefined): string => {
  if (diameter === null || diameter === undefined || Number.isNaN(diameter) || diameter <= 0) {
    return TrayConstants.bundleTypes.range0_8;
  }

  if (diameter <= 8) return TrayConstants.bundleTypes.range0_8;
  if (diameter <= 15) return TrayConstants.bundleTypes.range8_1_15;
  if (diameter <= 21) return TrayConstants.bundleTypes.range15_1_21;
  if (diameter <= 30) return TrayConstants.bundleTypes.range21_1_30;
  if (diameter <= 40) return TrayConstants.bundleTypes.range30_1_40;
  if (diameter <= 45) return TrayConstants.bundleTypes.range40_1_45;
  if (diameter <= 60) return TrayConstants.bundleTypes.range45_1_60;
  return TrayConstants.bundleTypes.range60Plus;
};

const getCableDiameter = (cable: Cable): number => {
  if (typeof cable.diameterMm === 'number' && !Number.isNaN(cable.diameterMm) && cable.diameterMm > 0) {
    return cable.diameterMm;
  }
  return TrayConstants.defaultCableDiameterMm;
};

const logLayoutDebug = (message: string, details: Record<string, unknown>) => {
  if (typeof window !== 'undefined' && window?.console) {
    window.console.log(message, details);
  } else {
    console.log(message, details);
  }
};

const sumCableWidthsPx = (cables: Cable[], scale: number, spacingMm: number): number =>
  cables.reduce((total, cable) => total + (getCableDiameter(cable) + spacingMm) * scale, 0);

export type TrayLayoutSummary = {
  spacingMm: number;
  totalCableWidthMm: number;
  occupiedWidthWithBundleSpacingMm: number;
  occupiedWidthWithoutBundleSpacingMm: number;
  bundleSpacingContributionMm: number;
  segmentCount: number;
  hasBottomRow: boolean;
};

class TrayDrawingData {
  tray: Tray;
  cablesOnTray: Cable[];
  cableBundles: CableBundleMap;
  canvasScale: number;
  spacingMm: number;
  layoutConfig: CategoryLayoutConfig;
  trayHeightMm: number;
  rungHeightMm: number;
  usableTrayHeightMm: number;
  bottomRowPowerCables: Cable[] = [];
  bottomRowVFDCables: Cable[] = [];
  bottomRowControlCables: Cable[] = [];
  powerRightEdgePx = Number.NEGATIVE_INFINITY;
  vfdLeftEdgePx = Number.POSITIVE_INFINITY;
  controlLeftEdgePx = Number.POSITIVE_INFINITY;
  
  // Track actual drawn positions for accurate separator placement
  leftSideRightEdgePx = 0;
  rightSideLeftEdgePx = 0;
  bottomRowSegments: Record<string, Array<{ leftPx: number; rightPx: number }>> = {
    [TrayConstants.cablePurposes.power]: [],
    [TrayConstants.cablePurposes.vfd]: [],
    [TrayConstants.cablePurposes.control]: [],
    [TrayConstants.cablePurposes.mv]: []
  };

  constructor(
    tray: Tray,
    cablesOnTray: Cable[],
    cableBundles: CableBundleMap | undefined,
    canvasScale: number,
    spacingMm: number,
    layoutConfig: CategoryLayoutConfig,
    rungHeightMm: number
  ) {
    this.tray = tray;
    this.cablesOnTray = cablesOnTray;
    this.cableBundles = cableBundles ?? {};
    this.canvasScale = canvasScale;
    this.spacingMm = spacingMm;
    this.layoutConfig = layoutConfig;
    const rawTrayHeight =
      typeof tray.heightMm === 'number' && Number.isFinite(tray.heightMm) && tray.heightMm > 0
        ? tray.heightMm
        : 0;
    const normalisedRung =
      typeof rungHeightMm === 'number' && Number.isFinite(rungHeightMm) && rungHeightMm >= 0
        ? rungHeightMm
        : TrayConstants.defaultRungHeightMm;
    this.trayHeightMm = rawTrayHeight;
    this.rungHeightMm = rawTrayHeight > 0 ? Math.min(normalisedRung, rawTrayHeight) : 0;
    this.usableTrayHeightMm = Math.max(this.trayHeightMm - this.rungHeightMm, 0);
  }

  clearBottomRowCables() {
    this.bottomRowPowerCables = [];
    this.bottomRowVFDCables = [];
    this.bottomRowControlCables = [];
    this.powerRightEdgePx = Number.NEGATIVE_INFINITY;
    this.vfdLeftEdgePx = Number.POSITIVE_INFINITY;
    this.controlLeftEdgePx = Number.POSITIVE_INFINITY;
    this.leftSideRightEdgePx = 0;
    this.rightSideLeftEdgePx = 0;
    for (const key of Object.keys(this.bottomRowSegments)) {
      this.bottomRowSegments[key] = [];
    }
  }

  recordBottomRowSegment(purpose: string, leftPx: number, rightPx: number) {
    if (!Number.isFinite(leftPx) || !Number.isFinite(rightPx)) {
      return;
    }

    const normalizedPurpose = purpose.trim().toLowerCase();
    if (!normalizedPurpose) {
      return;
    }

    const left = Math.min(leftPx, rightPx);
    const right = Math.max(leftPx, rightPx);
    if (right - left <= 0) {
      return;
    }

    if (!this.bottomRowSegments[normalizedPurpose]) {
      this.bottomRowSegments[normalizedPurpose] = [];
    }

    this.bottomRowSegments[normalizedPurpose].push({ leftPx: left, rightPx: right });
  }

  getAllBottomRowSegments(): Array<{ leftPx: number; rightPx: number }> {
    return Object.values(this.bottomRowSegments).flat();
  }
}

type PowerResult = { leftStartX: number; bottomStartY: number };
type ControlResult = { rightStartX: number; bottomStartY: number };

class CableBundleDrawer {
  private splitTrefoilGroups(cables: Cable[], trefoilEnabled: boolean): TrefoilGroup[] {
    if (!trefoilEnabled || cables.length < 3) {
      return cables.length > 0 ? [{ kind: 'normal', cables }] : [];
    }

    const groupsByKey = new Map<string, number[]>();

    cables.forEach((cable, index) => {
      const from = cable.fromLocation?.trim();
      const to = cable.toLocation?.trim();
      if (!from || !to) {
        return;
      }
      const key = `${from}|${to}`;
      if (!groupsByKey.has(key)) {
        groupsByKey.set(key, []);
      }
      groupsByKey.get(key)!.push(index);
    });

    const startToTrefoil = new Map<number, Cable[]>();
    const skipIndices = new Set<number>();

    for (const indices of groupsByKey.values()) {
      const sortedIndices = [...indices].sort((a, b) => a - b);
      if (sortedIndices.length % 3 !== 0) {
        continue;
      }
      for (let i = 0; i + 2 < sortedIndices.length; i += 3) {
        const clusterIndices = sortedIndices.slice(i, i + 3);
        const clusterCables = clusterIndices.map((idx) => cables[idx]);
        const start = clusterIndices[0];
        startToTrefoil.set(start, clusterCables);
        for (let j = 1; j < clusterIndices.length; j++) {
          skipIndices.add(clusterIndices[j]);
        }
      }
    }

    const result: TrefoilGroup[] = [];
    let normalBuffer: Cable[] = [];

    for (let i = 0; i < cables.length; i++) {
      if (skipIndices.has(i)) {
        continue;
      }

      const trefoilCluster = startToTrefoil.get(i);
      if (trefoilCluster) {
        if (normalBuffer.length > 0) {
          result.push({ kind: 'normal', cables: normalBuffer });
          normalBuffer = [];
        }
        result.push({ kind: 'trefoil', cables: trefoilCluster });
        continue;
      }

      normalBuffer.push(cables[i]);
    }

    if (normalBuffer.length > 0) {
      result.push({ kind: 'normal', cables: normalBuffer });
    }

    return result;
  }

  private canApplyPhaseRotationGroup(cables: Cable[], purpose: string): boolean {
    if (purpose === TrayConstants.cablePurposes.mv) {
      return cables.length > 0;
    }

    if (
      purpose !== TrayConstants.cablePurposes.power &&
      purpose !== TrayConstants.cablePurposes.vfd
    ) {
      return false;
    }

    if (cables.length < 3 || cables.length % 3 !== 0) {
      return false;
    }

    const normalizeLocation = (value?: string | null) =>
      value ? value.trim().toLowerCase() : '';

    const [first] = cables;
    const fromRaw = first.fromLocation?.trim() ?? '';
    const toRaw = first.toLocation?.trim() ?? '';
    if (!fromRaw || !toRaw) {
      return false;
    }

    const from = normalizeLocation(fromRaw);
    const to = normalizeLocation(toRaw);

    return cables.every(
      (candidate) =>
        normalizeLocation(candidate.fromLocation) === from &&
        normalizeLocation(candidate.toLocation) === to
    );
  }

  private updateSeparatorBounds(
    _data: TrayDrawingData,
    _purpose: string,
    _leftEdgePx: number,
    _rightEdgePx: number
  ) {
    // This method is no longer needed with the new separator drawing approach
    // that calculates position based on cable widths rather than tracking edges.
    // Kept as a no-op to avoid breaking existing code that calls it.
  }

  private computeTrefoilGeometry(
    data: TrayDrawingData,
    cables: Cable[]
  ): { success: true; positions: Array<{ cable: Cable; left: number; bottomOffset: number }>; widthPx: number } | { success: false } {
    if (cables.length !== 3) {
      return { success: false };
    }

    const [c1, c2, c3] = cables;
    const r1 = (getCableDiameter(c1) * data.canvasScale) / 2;
    const r2 = (getCableDiameter(c2) * data.canvasScale) / 2;
    const r3 = (getCableDiameter(c3) * data.canvasScale) / 2;

    if (!Number.isFinite(r1) || !Number.isFinite(r2) || !Number.isFinite(r3)) {
      return { success: false };
    }

    const internalSpacingPx = data.spacingMm * data.canvasScale;

    const x1 = r1;
    const y1 = -r1;

    const x2 = x1 + r1 + r2 + internalSpacingPx;
    const y2 = -r2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) {
      return { success: false };
    }

    // Add spacing between bottom and top cables
    const R1 = r1 + r3 + internalSpacingPx;
    const R2 = r2 + r3 + internalSpacingPx;

    if (d > R1 + R2 || d < Math.abs(R1 - R2)) {
      return { success: false };
    }

    const a = (R1 * R1 - R2 * R2 + d * d) / (2 * d);
    const hSquared = R1 * R1 - a * a;
    if (hSquared < 0) {
      return { success: false };
    }
    const h = Math.sqrt(hSquared);

    const point2x = x1 + (dx * a) / d;
    const point2y = y1 + (dy * a) / d;

    const rx = -dy * (h / d);
    const ry = dx * (h / d);

    const candidate1 = { x: point2x + rx, y: point2y + ry };
    const candidate2 = { x: point2x - rx, y: point2y - ry };

    const topCenter = candidate1.y < candidate2.y ? candidate1 : candidate2;

    const left1 = 0;
    const left2 = x2 - r2;
    const left3 = topCenter.x - r3;

    const positions: Array<{ cable: Cable; left: number; bottomOffset: number }> = [
      { cable: c1, left: left1, bottomOffset: 0 },
      { cable: c2, left: left2, bottomOffset: 0 },
      { cable: c3, left: left3, bottomOffset: topCenter.y + r3 }
    ];

    const minLeft = Math.min(...positions.map((position) => position.left));
    if (minLeft !== 0) {
      for (const position of positions) {
        position.left -= minLeft;
      }
    }

    const widthPx = Math.max(
      positions[0].left + 2 * r1,
      positions[1].left + 2 * r2,
      positions[2].left + 2 * r3
    );

    return { success: true, positions, widthPx };
  }

  private renderTrefoilCluster(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    geometry: { positions: Array<{ cable: Cable; left: number; bottomOffset: number }>; widthPx: number },
    startLeftX: number,
    baseBottomY: number,
    purpose: string,
    bottomRowTarget: Cable[]
  ): number {
    const clusterLeft = startLeftX;
    const clusterRight = startLeftX + geometry.widthPx;
    this.updateSeparatorBounds(data, purpose, clusterLeft, clusterRight);

    for (const { cable, left, bottomOffset } of geometry.positions) {
      const absoluteLeft = startLeftX + left;
      const absoluteBottom = baseBottomY + bottomOffset;
      this.drawCable(ctx, data, cable, absoluteLeft, absoluteBottom);
      if (Math.abs(bottomOffset) < 0.5) {
        const diameterPx = getCableDiameter(cable) * data.canvasScale;
        data.recordBottomRowSegment(purpose, absoluteLeft, absoluteLeft + diameterPx);
        bottomRowTarget.push(cable);
      }
    }

    return startLeftX + geometry.widthPx;
  }

  drawPowerBundles(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    bundles: Record<string, Cable[]>,
    leftStartX: number,
    bottomStartY: number,
    spacingPx: number,
    purpose: 'power' | 'mv' | 'vfd' | 'control' = 'power'
  ): PowerResult {
    const entries = Object.entries(bundles).filter(([, cables]) => cables.length > 0);

    const leftBundles: Array<[string, Cable[]]> = [];
    const groundingBundles: Array<[string, Cable[]]> = [];

    if (purpose === 'mv') {
      for (const [key, cables] of entries) {
        const grounding = cables.filter((cable) => isGroundingPurpose(cable.purpose));
        const normal = cables.filter((cable) => !isGroundingPurpose(cable.purpose));
        if (normal.length > 0) {
          leftBundles.push([key, normal]);
        }
        if (grounding.length > 0) {
          groundingBundles.push([key, grounding]);
        }
      }
    } else {
      leftBundles.push(...entries);
    }

    const sortByDiameterDesc = ([, cablesA]: [string, Cable[]], [, cablesB]: [string, Cable[]]) =>
      getCableDiameter(cablesB[0]) - getCableDiameter(cablesA[0]);

    leftBundles.sort(sortByDiameterDesc);
    groundingBundles.sort(sortByDiameterDesc);

    const baseBottomY =
      TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;
    bottomStartY = baseBottomY;

    const lastBundleKey = leftBundles.length > 0 ? leftBundles[leftBundles.length - 1][0] : null;

    for (const [bundleKey, bundleCables] of leftBundles) {
      // Select the correct layout config based on purpose
      let layoutConfig: ProjectLayoutConfig;
      switch (purpose) {
        case 'mv':
          layoutConfig = data.layoutConfig.mv;
          break;
        case 'vfd':
          layoutConfig = data.layoutConfig.vfd;
          break;
        case 'control':
          layoutConfig = data.layoutConfig.control;
          break;
        case 'power':
        default:
          layoutConfig = data.layoutConfig.power;
          break;
      }

      const sortedCables = [...bundleCables].sort(
        (a, b) => getCableDiameter(b) - getCableDiameter(a)
      );

      const shouldIgnoreBundleLimits =
        purpose === 'mv' && layoutConfig.trefoil;
      const subBundles = shouldIgnoreBundleLimits
        ? [sortedCables]
        : [sortedCables];
      const maxDiameter = sortedCables.length > 0
        ? getCableDiameter(sortedCables[0])
        : TrayConstants.defaultCableDiameterMm;
      const bundleSpacingPx = this.calculateBundleSpacingPx(
        maxDiameter,
        layoutConfig.bundleSpacing,
        data.canvasScale,
        data.spacingMm
      );
      const enforceSingleColumnSpacing = layoutConfig.maxColumns === 1;

      for (let subBundleIdx = 0; subBundleIdx < subBundles.length; subBundleIdx++) {
        const subBundle = subBundles[subBundleIdx];

        // Select the correct bottom row array based on purpose
        const bottomRowCables =
          purpose === 'vfd'
            ? data.bottomRowVFDCables
            : purpose === 'control'
            ? data.bottomRowControlCables
            : data.bottomRowPowerCables;
        const purposeString =
          TrayConstants.cablePurposes[
            purpose as keyof typeof TrayConstants.cablePurposes
          ];

        const canApplyPhaseRotation =
          layoutConfig.trefoil &&
          layoutConfig.applyPhaseRotation &&
          (purpose === 'mv' || purpose === 'power' || purpose === 'vfd') &&
          this.canApplyPhaseRotationGroup(subBundle, purposeString);

        if (canApplyPhaseRotation) {
          ({ leftStartX, bottomStartY } = this.drawPhaseRotationBundles(
            ctx,
            data,
            subBundle,
            leftStartX,
            spacingPx,
            bottomRowCables,
            purposeString
          ));
          bottomStartY = baseBottomY;
          continue;
        }
        const grouped = this.splitTrefoilGroups(subBundle, layoutConfig.trefoil);

        const normalCableQueue: Cable[] = [];

        // First pass: Draw all trefoil bundles and collect normal cables
        for (let groupIdx = 0; groupIdx < grouped.length; groupIdx++) {
          const group = grouped[groupIdx];
          if (group.kind !== 'trefoil') {
            normalCableQueue.push(...group.cables);
            continue;
          }

          bottomStartY = baseBottomY;

          const geometry = this.computeTrefoilGeometry(data, group.cables);
          if (geometry.success) {
            leftStartX = this.renderTrefoilCluster(
              ctx,
              data,
              geometry,
              leftStartX,
              baseBottomY,
              purposeString,
              bottomRowCables
            );
            bottomStartY = baseBottomY;
          } else {
            let remainingCables = [...group.cables];
            const referenceLayout = this.calculateRowsAndColumns(
              data.usableTrayHeightMm,
              group.cables,
              purposeString,
              layoutConfig
            );
            const referenceRows = Math.max(referenceLayout.rows, 1);
            const referenceColumns = Math.max(referenceLayout.columns, 1);
            const maxCapacityPerChunk = Math.max(referenceRows * referenceColumns, 1);

            while (remainingCables.length > 0) {
              const chunkLength = Math.min(maxCapacityPerChunk, remainingCables.length);
              const chunk = remainingCables.slice(0, chunkLength);

          let rows = referenceRows;
          let columns = referenceColumns;
          if (chunkLength < rows * columns) {
            rows = Math.min(referenceRows, Math.max(chunkLength, 1));
            columns = Math.max(1, Math.min(referenceColumns, Math.ceil(chunkLength / rows)));
          }

          if (
            purposeString !== TrayConstants.cablePurposes.mv &&
            chunkLength === 2
          ) {
            rows = 1;
            columns = Math.max(columns, 2);
          }

          ({ leftStartX, bottomStartY } = this.drawVerticalStacking(
            ctx,
            data,
            chunk,
                leftStartX,
                bottomStartY,
                spacingPx,
                rows,
                columns,
                bottomRowCables,
                purposeString,
                bundleSpacingPx,
                enforceSingleColumnSpacing
              ));

              remainingCables = remainingCables.slice(chunk.length);
              bottomStartY = baseBottomY;

              if (remainingCables.length > 0) {
                leftStartX += bundleSpacingPx;
              }
            }
          }

          // Add spacing between trefoil bundles
          if (groupIdx < grouped.length - 1) {
            const nextTrefoil = grouped.slice(groupIdx + 1).find(g => g.kind === 'trefoil');
            if (nextTrefoil) {
              if (layoutConfig.trefoilSpacingBetweenBundles) {
                leftStartX += bundleSpacingPx;
              } else {
                leftStartX += data.spacingMm * data.canvasScale;
              }
            }
          }
        }

        // Check if we drew any trefoils and if there are normal cables
        const hasTrefoils = grouped.some(g => g.kind === 'trefoil');
        const hasNormals = normalCableQueue.length > 0;
        
        // Add bundle spacing between trefoils and normal cables
        if (hasTrefoils && hasNormals) {
          leftStartX += bundleSpacingPx;
        }

        // Draw all normal cables together so columns stay full
        if (hasNormals) {
          bottomStartY = baseBottomY;
          let remainingNormals = [...normalCableQueue];

          // Determine reference layout using the full normal set
          const referenceLayout = this.calculateRowsAndColumns(
            data.usableTrayHeightMm,
            normalCableQueue,
            purposeString,
            layoutConfig
          );
          const referenceRows = Math.max(referenceLayout.rows, 1);
          const referenceColumns = Math.max(referenceLayout.columns, 1);
          const maxCapacityPerChunk = Math.max(referenceRows * referenceColumns, 1);

          while (remainingNormals.length > 0) {
            const chunkLength = Math.min(maxCapacityPerChunk, remainingNormals.length);
            const chunk = remainingNormals.slice(0, chunkLength);

            let rows = referenceRows;
            let columns = referenceColumns;
            if (chunkLength < rows * columns) {
              rows = Math.min(referenceRows, Math.max(chunkLength, 1));
              columns = Math.max(1, Math.min(referenceColumns, Math.ceil(chunkLength / rows)));
            }

            if (
              purposeString !== TrayConstants.cablePurposes.mv &&
              chunkLength === 2
            ) {
              rows = 1;
              columns = Math.max(columns, 2);
            }

            if (
              bundleKey === TrayConstants.bundleTypes.range40_1_45 ||
              bundleKey === TrayConstants.bundleTypes.range45_1_60
            ) {
              ({ leftStartX, bottomStartY } = this.drawHexagonalPacking(
                ctx,
                data,
                chunk,
                leftStartX,
                bottomStartY,
                spacingPx
              ));
            } else {
              ({ leftStartX, bottomStartY } = this.drawVerticalStacking(
                ctx,
                data,
                chunk,
                leftStartX,
                bottomStartY,
                spacingPx,
                rows,
                columns,
                bottomRowCables,
                purposeString,
                bundleSpacingPx,
                enforceSingleColumnSpacing
              ));
            }

            remainingNormals = remainingNormals.slice(chunkLength);
            bottomStartY = baseBottomY;

            if (remainingNormals.length > 0) {
              leftStartX += bundleSpacingPx;
            }
          }
        }

        if (subBundleIdx < subBundles.length - 1) {
          leftStartX += bundleSpacingPx;
        }
      }

      if (bundleKey !== lastBundleKey) {
        leftStartX += bundleSpacingPx;
      }
    }

    // Draw grounding cables on MV trays from right to left
    if (purpose === 'mv' && groundingBundles.length > 0) {
      const trayWidthPx = (data.tray.widthMm ?? 0) * data.canvasScale;
      let rightStartX = TrayConstants.canvasMargin + trayWidthPx - spacingPx;

      for (let bundleIndex = 0; bundleIndex < groundingBundles.length; bundleIndex += 1) {
        const [, bundleCables] = groundingBundles[bundleIndex];
        const layoutConfig = data.layoutConfig.mv;
        const sortedCables = [...bundleCables].sort(
          (a, b) => getCableDiameter(b) - getCableDiameter(a)
        );
        const referenceLayout = this.calculateRowsAndColumns(
          data.usableTrayHeightMm,
          sortedCables,
          TrayConstants.cablePurposes.mv,
          layoutConfig
        );
        const referenceRows = Math.max(referenceLayout.rows, 1);
        const referenceColumns = Math.max(referenceLayout.columns, 1);
        const maxCapacityPerChunk = Math.max(referenceRows * referenceColumns, 1);
        const maxDiameter = sortedCables.length > 0
          ? getCableDiameter(sortedCables[0])
          : TrayConstants.defaultCableDiameterMm;
        const bundleSpacingPx = this.calculateBundleSpacingPx(
          maxDiameter,
          layoutConfig.bundleSpacing,
          data.canvasScale,
          data.spacingMm
        );

        let remainingCables = [...sortedCables];
        while (remainingCables.length > 0) {
          const chunkLength = Math.min(maxCapacityPerChunk, remainingCables.length);
          const chunk = remainingCables.slice(0, chunkLength);

          let rows = referenceRows;
          let columns = referenceColumns;
          if (chunkLength < rows * columns) {
            rows = Math.min(referenceRows, Math.max(chunkLength, 1));
            columns = Math.max(1, Math.min(referenceColumns, Math.ceil(chunkLength / rows)));
          }

          rightStartX = this.drawVerticalStackingFromRight(
            ctx,
            data,
            chunk,
            rightStartX,
            bottomStartY,
            spacingPx,
            rows,
            columns,
            data.bottomRowPowerCables,
            TrayConstants.cablePurposes.mv
          );

          remainingCables = remainingCables.slice(chunk.length);
          bottomStartY = baseBottomY;

          if (remainingCables.length > 0) {
            rightStartX -= bundleSpacingPx;
          }
        }

        const isLastBundle = bundleIndex === groundingBundles.length - 1;
        if (!isLastBundle) {
          rightStartX -= bundleSpacingPx;
        }
      }
    }

    // Track the rightmost position of power cables (left side)
    data.leftSideRightEdgePx = Math.max(data.leftSideRightEdgePx, leftStartX);

    bottomStartY = baseBottomY;
    return { leftStartX, bottomStartY };
  }

  drawControlBundles(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    bundles: Record<string, Cable[]>,
    rightStartX: number,
    bottomStartY: number,
    spacingPx: number
  ): ControlResult {
    const sortedBundles = Object.entries(bundles)
      .filter(([, cables]) => cables.length > 0)
      .sort(([, cablesA], [, cablesB]) => getCableDiameter(cablesB[0]) - getCableDiameter(cablesA[0]));
    let totalBundleSpacingPx = 0;

    for (const [bundleKey, bundleCables] of sortedBundles) {
      const layoutConfig = data.layoutConfig.control;
      const sortedCables = [...bundleCables].sort(
        (a, b) => getCableDiameter(b) - getCableDiameter(a)
      );

      // Split into sub-bundles if needed
      const subBundles = [sortedCables];
      const maxDiameter = sortedCables.length > 0 
        ? getCableDiameter(sortedCables[0]) 
        : TrayConstants.defaultCableDiameterMm;
      const bundleSpacingPx = this.calculateBundleSpacingPx(
        maxDiameter,
        layoutConfig.bundleSpacing,
        data.canvasScale,
        data.spacingMm
      );

      for (let subBundleIdx = 0; subBundleIdx < subBundles.length; subBundleIdx++) {
        const subBundle = subBundles[subBundleIdx];
        let remainingCables = [...subBundle];
        const referenceLayout = this.calculateRowsAndColumns(
          data.usableTrayHeightMm,
          subBundle,
          TrayConstants.cablePurposes.control,
          layoutConfig
        );
        const referenceRows = Math.max(referenceLayout.rows, 1);
        const referenceColumns = Math.max(referenceLayout.columns, 1);
        const maxCapacityPerChunk = Math.max(referenceRows * referenceColumns, 1);

        while (remainingCables.length > 0) {
          const chunkLength = Math.min(maxCapacityPerChunk, remainingCables.length);
          const chunk = remainingCables.slice(0, chunkLength);

          let rows = referenceRows;
          let columns = referenceColumns;
          if (chunkLength < rows * columns) {
            rows = Math.min(referenceRows, Math.max(chunkLength, 1));
            columns = Math.max(1, Math.min(referenceColumns, Math.ceil(chunkLength / rows)));
          }

          if (chunkLength === 2) {
            rows = 1;
            columns = Math.max(columns, 2);
          }

          rightStartX = this.drawVerticalStackingFromRight(
            ctx,
            data,
            chunk,
            rightStartX,
            bottomStartY,
            spacingPx,
            rows,
            columns,
            data.bottomRowControlCables,
            TrayConstants.cablePurposes.control
          );

          remainingCables = remainingCables.slice(chunk.length);
          bottomStartY =
            TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;

          if (remainingCables.length > 0) {
            rightStartX -= bundleSpacingPx;
          }
        }

        // Add spacing between sub-bundles (not after the last one)
        if (subBundleIdx < subBundles.length - 1) {
          rightStartX -= bundleSpacingPx;
        }
      }

      if (sortedBundles[sortedBundles.length - 1][0] !== bundleKey) {
        totalBundleSpacingPx += bundleSpacingPx;
      }

      const trayWidthPx = (data.tray.widthMm ?? 0) * data.canvasScale;
      rightStartX =
        TrayConstants.canvasMargin +
        trayWidthPx -
        spacingPx -
        totalBundleSpacingPx -
        sumCableWidthsPx(data.bottomRowControlCables, data.canvasScale, data.spacingMm);
      bottomStartY =
        TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;
    }

    // Track the leftmost position of Control cables (right side)
    data.rightSideLeftEdgePx = rightStartX;

    return { rightStartX, bottomStartY };
  }

  drawMvBundles(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    bundles: Record<string, Cable[]>,
    leftStartX: number,
    bottomStartY: number,
    spacingPx: number
  ): PowerResult {
    return this.drawPowerBundles(
      ctx,
      data,
      bundles,
      leftStartX,
      bottomStartY,
      spacingPx,
      'mv'
    );
  }

  drawVfdBundles(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    bundles: Record<string, Cable[]>,
    rightStartX: number,
    bottomStartY: number,
    spacingPx: number
  ): ControlResult {
    const sortedBundles = Object.entries(bundles)
      .filter(([, cables]) => cables.length > 0)
      .sort(([, cablesA], [, cablesB]) => getCableDiameter(cablesB[0]) - getCableDiameter(cablesA[0]));

    const baseBottomY =
      TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;
    const lastBundleKey = sortedBundles.length > 0 ? sortedBundles[sortedBundles.length - 1][0] : null;

    for (const [bundleKey, bundleCables] of sortedBundles) {
      const layoutConfig = data.layoutConfig.vfd;
      const sortedCables = [...bundleCables].sort(
        (a, b) => getCableDiameter(b) - getCableDiameter(a)
      );

      const subBundles = [sortedCables];
      const maxDiameter = sortedCables.length > 0
        ? getCableDiameter(sortedCables[0])
        : TrayConstants.defaultCableDiameterMm;
      const bundleSpacingPx = this.calculateBundleSpacingPx(
        maxDiameter,
        layoutConfig.bundleSpacing,
        data.canvasScale,
        data.spacingMm
      );

      for (let subBundleIdx = 0; subBundleIdx < subBundles.length; subBundleIdx++) {
        const subBundle = subBundles[subBundleIdx];

        const canApplyPhaseRotation =
          layoutConfig.trefoil &&
          layoutConfig.applyPhaseRotation &&
          this.canApplyPhaseRotationGroup(
            subBundle,
            TrayConstants.cablePurposes.vfd
          );

        if (canApplyPhaseRotation) {
          const result = this.drawPhaseRotationBundlesFromRight(
            ctx,
            data,
            subBundle,
            rightStartX,
            spacingPx,
            data.bottomRowVFDCables,
            TrayConstants.cablePurposes.vfd
          );
          rightStartX = result.rightStartX;
          bottomStartY = result.bottomStartY;
        } else {
          const grouped = this.splitTrefoilGroups(subBundle, layoutConfig.trefoil);

          // Log bundle composition for VFD cables
          console.log(
            `[VFD Bundles] Bundle Key: ${bundleKey}, Sub-bundle ${subBundleIdx + 1}:`
          );
          grouped.forEach((group, idx) => {
            if (group.kind === 'trefoil') {
              console.log(
                `  Trefoil bundle ${idx + 1}:`,
                group.cables.map((cable) => `Cable ${data.cablesOnTray.indexOf(cable) + 1}`)
              );
            } else {
              console.log(
                `  Normal bundle ${idx + 1}:`,
                group.cables.map((cable) => `Cable ${data.cablesOnTray.indexOf(cable) + 1}`)
              );
            }
          });

          // First pass: Draw all trefoil bundles
          for (let groupIdx = 0; groupIdx < grouped.length; groupIdx++) {
            const group = grouped[groupIdx];
            if (group.kind !== 'trefoil') continue;

            bottomStartY = baseBottomY;

            const geometry = this.computeTrefoilGeometry(data, group.cables);
            if (geometry.success) {
              const startLeftX = rightStartX - geometry.widthPx;
              this.renderTrefoilCluster(
                ctx,
                data,
                geometry,
                startLeftX,
                baseBottomY,
                TrayConstants.cablePurposes.vfd,
                data.bottomRowVFDCables
              );
              rightStartX = startLeftX;
              bottomStartY = baseBottomY;
            } else {
              const { rows } = this.calculateRowsAndColumns(
                data.usableTrayHeightMm,
                group.cables,
                TrayConstants.cablePurposes.vfd,
                layoutConfig
              );
              rightStartX = this.drawStandardVfdCables(
                ctx,
                data,
                group.cables,
                rightStartX,
                bottomStartY,
                spacingPx,
                rows,
                sortedBundles,
                bundleKey
              );
            }

            // Add spacing between trefoil bundles
            if (groupIdx < grouped.length - 1) {
              const nextTrefoil = grouped.slice(groupIdx + 1).find((g) => g.kind === 'trefoil');
              if (nextTrefoil) {
                if (layoutConfig.trefoilSpacingBetweenBundles) {
                  rightStartX -= bundleSpacingPx;
                } else {
                  rightStartX -= data.spacingMm * data.canvasScale;
                }
              }
            }
          }

          // Check if we drew any trefoils and if there are normal cables
          const hasTrefoils = grouped.some((group) => group.kind === 'trefoil');
          const hasNormals = grouped.some((group) => group.kind === 'normal');

          // Add bundle spacing between trefoils and normal cables
          if (hasTrefoils && hasNormals) {
            rightStartX -= bundleSpacingPx;
          }

          // Second pass: Draw all normal cables
          for (let groupIdx = 0; groupIdx < grouped.length; groupIdx++) {
            const group = grouped[groupIdx];
            if (group.kind !== 'normal') continue;

            bottomStartY = baseBottomY;

      const { rows } = this.calculateRowsAndColumns(
              data.usableTrayHeightMm,
              group.cables,
              TrayConstants.cablePurposes.vfd,
              layoutConfig
            );

            if (
              bundleKey === TrayConstants.bundleTypes.range30_1_40 ||
              bundleKey === TrayConstants.bundleTypes.range40_1_45
            ) {
              rightStartX = this.drawGroupedVfdCables(
                ctx,
                data,
                group.cables,
                rightStartX,
                bottomStartY,
                spacingPx,
                sortedBundles,
                bundleKey
              );
            } else {
              rightStartX = this.drawStandardVfdCables(
                ctx,
                data,
                group.cables,
                rightStartX,
                bottomStartY,
                spacingPx,
                rows,
                sortedBundles,
                bundleKey
              );
            }
          }
        }

        if (subBundleIdx < subBundles.length - 1) {
          rightStartX -= bundleSpacingPx;
        }
      }

      if (bundleKey !== lastBundleKey) {
        rightStartX -= bundleSpacingPx;
      }
    }

    // Don't recalculate rightStartX - we've been tracking it correctly during drawing
    // rightStartX is already at the correct position after drawing all cables
    bottomStartY = baseBottomY;

    // Track the leftmost position of VFD cables (right side)
    data.rightSideLeftEdgePx = rightStartX;

    return { rightStartX, bottomStartY };
  }

  private drawHexagonalPacking(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    sortedCables: Cable[],
    leftStartX: number,
    bottomStartY: number,
    spacingPx: number
  ): PowerResult {
    let row = 0;
    const usableTrayHeight = data.usableTrayHeightMm;
    let currentX = leftStartX;

    for (let index = 0; index < sortedCables.length; index++) {
      const cable = sortedCables[index];
      const diameterMm = getCableDiameter(cable);
      const diameterPx = diameterMm * data.canvasScale;

      if (
        index !== 0 &&
        index % 2 === 0 &&
        diameterMm <= 45 &&
        usableTrayHeight > 45
      ) {
        bottomStartY -=
          ((diameterMm * data.canvasScale) / 2) * (Math.sqrt(3) / 2) +
          (diameterMm * data.canvasScale) / 2 -
          spacingPx * 2;
        currentX = leftStartX + 
          sumCableWidthsPx(data.bottomRowPowerCables.slice(-1), data.canvasScale, data.spacingMm) -
          (diameterMm * data.canvasScale + spacingPx) * 1.5;
        row = 1;
      }

      const cableLeftEdge = currentX;
      const cableRightEdge = currentX + diameterPx;
      this.drawCable(ctx, data, cable, currentX, bottomStartY);
      bottomStartY =
        TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;

      if (row === 0) {
        this.updateSeparatorBounds(
          data,
          TrayConstants.cablePurposes.power,
          cableLeftEdge,
          cableRightEdge
        );
        data.recordBottomRowSegment(TrayConstants.cablePurposes.power, cableLeftEdge, cableRightEdge);
        data.bottomRowPowerCables.push(cable);
        currentX += (diameterMm + data.spacingMm) * data.canvasScale;
      } else if (row === 1) {
        row = 0;
        currentX = leftStartX + sumCableWidthsPx(data.bottomRowPowerCables, data.canvasScale, data.spacingMm);
        bottomStartY =
          TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;
      }
    }

    leftStartX = currentX;
    return { leftStartX, bottomStartY };
  }

  private drawVerticalStacking(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    sortedCables: Cable[],
    leftStartX: number,
    _bottomStartY: number,
    spacingPx: number,
    rows: number,
    columnsCount = Math.ceil(sortedCables.length / Math.max(rows, 1)),
    bottomRowCables: Cable[],
    purpose: string,
    bundleSpacingPx?: number,
    enforceBundleSpacingBetweenColumns = false
  ): PowerResult {
    let targetRows = Math.max(rows, 1);
    let requestedColumns = columnsCount;

    if (purpose !== TrayConstants.cablePurposes.mv && sortedCables.length === 2) {
      targetRows = 1;
      requestedColumns = Math.max(requestedColumns, 2);
    }

    const baseBottomY =
      TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;

    const minimumColumns = Math.max(Math.ceil(sortedCables.length / targetRows), 1);
    const normalizedColumnsCount = Number.isFinite(requestedColumns)
      ? Math.max(Math.floor(requestedColumns), 0)
      : 0;
    const totalColumns = Math.max(normalizedColumnsCount, minimumColumns);
    const columns: Cable[][] = [];
    let cursor = 0;
    for (let columnIndex = 0; columnIndex < totalColumns && cursor < sortedCables.length; columnIndex++) {
      const remainingColumns = totalColumns - columnIndex;
      const remainingCables = sortedCables.length - cursor;
      const rowsForColumn = Math.min(
        targetRows,
        Math.max(Math.ceil(remainingCables / remainingColumns), 1)
      );
      columns.push(sortedCables.slice(cursor, cursor + rowsForColumn));
      cursor += rowsForColumn;
    }

    let currentX = leftStartX;

    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      const column = columns[columnIndex];
      if (column.length === 0) {
        continue;
      }

      const columnBottomCable = column[0];
      bottomRowCables.push(columnBottomCable);

      let currentBottomY = baseBottomY;
      const columnLeftEdgePx = currentX;
      for (const cable of column) {
        this.drawCable(ctx, data, cable, currentX, currentBottomY);
        currentBottomY -= getCableDiameter(cable) * data.canvasScale + spacingPx;
      }

      const columnMaxDiameterMm = column.reduce(
        (max, cable) => Math.max(max, getCableDiameter(cable)),
        0
      );
      const columnMaxDiameterPx = columnMaxDiameterMm * data.canvasScale;
      const columnRightEdgePx = columnLeftEdgePx + columnMaxDiameterPx;
      this.updateSeparatorBounds(data, purpose, currentX, currentX + columnMaxDiameterPx);
      data.recordBottomRowSegment(purpose, columnLeftEdgePx, columnRightEdgePx);

      // Advance past the current column width
      currentX += columnMaxDiameterPx;

      // Add spacing between columns when needed
      if (columnIndex < columns.length - 1) {
        const spacingBetweenColumnsPx = enforceBundleSpacingBetweenColumns
          ? (bundleSpacingPx ?? spacingPx)
          : spacingPx;
        currentX += spacingBetweenColumnsPx;
      }
    }

    leftStartX = currentX;
    return { leftStartX, bottomStartY: baseBottomY };
  }

  private drawVerticalStackingFromRight(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    sortedCables: Cable[],
    rightStartX: number,
    _bottomStartY: number,
    spacingPx: number,
    rows: number,
    columnsCount = Math.ceil(sortedCables.length / Math.max(rows, 1)),
    bottomRowCables: Cable[],
    purpose: string
  ): number {
    let targetRows = Math.max(rows, 1);
    let requestedColumns = columnsCount;

    if (purpose !== TrayConstants.cablePurposes.mv && sortedCables.length === 2) {
      targetRows = 1;
      requestedColumns = Math.max(requestedColumns, 2);
    }

    const baseBottomY =
      TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;

    const minimumColumns = Math.max(Math.ceil(sortedCables.length / targetRows), 1);
    const normalizedColumnsCount = Number.isFinite(requestedColumns)
      ? Math.max(Math.floor(requestedColumns), 0)
      : 0;
    const totalColumns = Math.max(normalizedColumnsCount, minimumColumns);
    const columns: Cable[][] = [];
    let cursor = 0;
    for (let columnIndex = 0; columnIndex < totalColumns && cursor < sortedCables.length; columnIndex++) {
      const remainingColumns = totalColumns - columnIndex;
      const remainingCables = sortedCables.length - cursor;
      const rowsForColumn = Math.min(
        targetRows,
        Math.max(Math.ceil(remainingCables / remainingColumns), 1)
      );
      columns.push(sortedCables.slice(cursor, cursor + rowsForColumn));
      cursor += rowsForColumn;
    }

    let currentX = rightStartX;

    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      const column = columns[columnIndex];
      if (column.length === 0) {
        continue;
      }

      const columnRightEdge = currentX;
      const columnBottomCable = column[0];
      bottomRowCables.push(columnBottomCable);

      let currentBottomY = baseBottomY;
      for (const cable of column) {
        const diameterPx = getCableDiameter(cable) * data.canvasScale;
        const radius = diameterPx / 2;
        ctx.save();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(currentX - radius, currentBottomY - radius, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        this.drawCableNumber(ctx, data, cable, currentX - radius, currentBottomY - radius);
        currentBottomY -= diameterPx + spacingPx;
      }

      const columnMaxDiameterMm = column.reduce(
        (max, cable) => Math.max(max, getCableDiameter(cable)),
        0
      );
      const columnMaxDiameterPx = columnMaxDiameterMm * data.canvasScale;
      const columnLeftEdge = columnRightEdge - columnMaxDiameterPx;
      this.updateSeparatorBounds(data, purpose, columnLeftEdge, columnRightEdge);
      data.recordBottomRowSegment(purpose, columnLeftEdge, columnRightEdge);

      // Move left past column width
      currentX -= columnMaxDiameterPx;

      // Apply spacing before next column if needed
      if (columnIndex < columns.length - 1) {
        const spacingBetweenColumnsPx = spacingPx;
        currentX -= spacingBetweenColumnsPx;
      }
    }

    return currentX;
  }

  private drawPhaseRotationBundles(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    bundleCables: Cable[],
    leftStartX: number,
    spacingPx: number,
    bottomRowTarget: Cable[],
    purpose: string
  ): PowerResult {
    const sortedCables = [...bundleCables].sort(
      (a, b) => getCableDiameter(b) - getCableDiameter(a)
    );
    const phaseRotations = this.applyPhaseRotation(sortedCables);

    const baseBottomY =
      TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;
    let bottomStartY = baseBottomY;

    let row = 0;
    let cableIndex = 2;
    let leftStartBottom = leftStartX;
    let leftStartTop =
      leftStartX + ((getCableDiameter(phaseRotations[0]) / 2 + 0.5) * data.canvasScale);

    for (let index = 0; index < phaseRotations.length; index++) {
      const cable = phaseRotations[index];
      const diameterMm = getCableDiameter(cable);
      const diameterPx = diameterMm * data.canvasScale;

      if (index === cableIndex) {
        bottomStartY -=
          ((diameterMm * data.canvasScale) / 2) * (Math.sqrt(3) / 2) +
          (diameterMm * data.canvasScale) / 2 -
          spacingPx * 2;
        leftStartX = leftStartTop;
        row = 1;
        cableIndex += 3;
      }

      const cableLeftEdge = leftStartX;
      const cableRightEdge = leftStartX + diameterPx;
      this.drawCable(ctx, data, cable, leftStartX, bottomStartY);
      bottomStartY =
        TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;

      if (row === 0) {
        this.updateSeparatorBounds(
          data,
          purpose,
          cableLeftEdge,
          cableRightEdge
        );
        data.recordBottomRowSegment(purpose, cableLeftEdge, cableRightEdge);
        bottomRowTarget.push(cable);
        leftStartX += (diameterMm + data.spacingMm) * data.canvasScale;
        leftStartBottom = leftStartX;
      } else {
        row = 0;
        leftStartBottom += (diameterMm + data.spacingMm) * data.canvasScale * 2;
        leftStartX = leftStartBottom;
        leftStartTop += (diameterMm + data.spacingMm) * data.canvasScale * 4;
        bottomStartY =
          TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;
      }
    }

    return { leftStartX, bottomStartY: baseBottomY };
  }

  private drawPhaseRotationBundlesFromRight(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    bundleCables: Cable[],
    rightStartX: number,
    spacingPx: number,
    bottomRowTarget: Cable[],
    purpose: string
  ): ControlResult {
    const sortedCables = [...bundleCables].sort(
      (a, b) => getCableDiameter(b) - getCableDiameter(a)
    );
    if (sortedCables.length === 0) {
      return {
        rightStartX,
        bottomStartY:
          TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale
      };
    }

    const phaseRotations = this.applyPhaseRotation(sortedCables);

    const baseBottomY =
      TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;
    let bottomStartY = baseBottomY;

    let row = 0;
    let cableIndex = 2;
    let rightStartBottom = rightStartX;
    let rightStartTop =
      rightStartX -
      ((getCableDiameter(phaseRotations[0]) / 2 + 0.5) * data.canvasScale);

    for (let index = 0; index < phaseRotations.length; index++) {
      const cable = phaseRotations[index];
      const diameterMm = getCableDiameter(cable);
      const diameterPx = diameterMm * data.canvasScale;

      if (index === cableIndex) {
        bottomStartY -=
          ((diameterMm * data.canvasScale) / 2) * (Math.sqrt(3) / 2) +
          (diameterMm * data.canvasScale) / 2 -
          spacingPx * 2;
        rightStartX = rightStartTop;
        row = 1;
        cableIndex += 3;
      }

      const cableLeftEdge = rightStartX - diameterPx;
      const cableRightEdge = rightStartX;
      this.drawCable(ctx, data, cable, cableLeftEdge, bottomStartY);
      bottomStartY =
        TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;

      if (row === 0) {
        this.updateSeparatorBounds(
          data,
          purpose,
          cableLeftEdge,
          cableRightEdge
        );
        data.recordBottomRowSegment(purpose, cableLeftEdge, cableRightEdge);
        bottomRowTarget.push(cable);
        rightStartX -= (diameterMm + data.spacingMm) * data.canvasScale;
        rightStartBottom = rightStartX;
      } else {
        row = 0;
        rightStartBottom -= (diameterMm + data.spacingMm) * data.canvasScale * 2;
        rightStartX = rightStartBottom;
        rightStartTop -= (diameterMm + data.spacingMm) * data.canvasScale * 4;
        bottomStartY =
          TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;
      }
    }

    return { rightStartX, bottomStartY: baseBottomY };
  }

  private drawGroupedVfdCables(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    bundleCables: Cable[],
    rightStartX: number,
    bottomStartY: number,
    spacingPx: number,
    sortedBundles: Array<[string, Cable[]]>,
    currentBundleKey: string
  ): number {
    const groupedByDestination = new Map<string, Cable[]>();

    for (const cable of bundleCables) {
      const key = (cable.toLocation ?? 'unknown').trim() || 'unknown';
      if (!groupedByDestination.has(key)) {
        groupedByDestination.set(key, []);
      }
      groupedByDestination.get(key)?.push(cable);
    }

    for (const group of groupedByDestination.values()) {
      const sortedCables = [...group].sort(
        (a, b) => getCableDiameter(b) - getCableDiameter(a)
      );
      const rightStartBottom = bottomStartY;
      const rightStartTop =
        rightStartX - ((getCableDiameter(sortedCables[0]) / 2 + 0.5) * data.canvasScale);
      let row = 0;

      for (let index = 0; index < sortedCables.length; index++) {
        const cable = sortedCables[index];
        const diameterMm = getCableDiameter(cable);
        const radius = (diameterMm / 2) * data.canvasScale;

        if (index === 2 && diameterMm <= 45) {
          bottomStartY -=
            ((diameterMm * data.canvasScale) / 2) * (Math.sqrt(3) / 2) +
            (diameterMm * data.canvasScale) / 2 -
            spacingPx * 2;
          rightStartX = rightStartTop;
          row = 1;
        }

        ctx.save();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(rightStartX - radius, bottomStartY - radius, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        this.drawCableNumber(ctx, data, cable, rightStartX - radius, bottomStartY - radius);

        if (row === 0) {
          const leftEdge = rightStartX - diameterMm * data.canvasScale;
          const rightEdge = rightStartX;
          this.updateSeparatorBounds(
            data,
            TrayConstants.cablePurposes.vfd,
            leftEdge,
            rightEdge
          );
          data.recordBottomRowSegment(TrayConstants.cablePurposes.vfd, leftEdge, rightEdge);
          data.bottomRowVFDCables.push(cable);
          rightStartX -= (diameterMm + data.spacingMm) * data.canvasScale;
        } else {
          row = 0;
          bottomStartY = rightStartBottom;
          rightStartX -= diameterMm * data.canvasScale * 3.5;
        }
      }

      const isLastBundle =
        sortedBundles[sortedBundles.length - 1][0] === currentBundleKey;
      if (!isLastBundle && group.length > 0) {
        const firstCable = group[0];
        data.bottomRowVFDCables.push(firstCable, firstCable);
      }
    }

    return rightStartX;
  }

  private drawStandardVfdCables(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    bundleCables: Cable[],
    rightStartX: number,
    bottomStartY: number,
    spacingPx: number,
    rows: number,
    sortedBundles: Array<[string, Cable[]]>,
    currentBundleKey: string
  ): number {
    const sortedCables = [...bundleCables].sort(
      (a, b) => getCableDiameter(b) - getCableDiameter(a)
    );
    const biggestCable = sortedCables[0];
    let row = 0;

    const targetRows = Math.max(rows, 1);

    for (const cable of sortedCables) {
      const diameterMm = getCableDiameter(cable);
      const radius = (diameterMm / 2) * data.canvasScale;

      ctx.save();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(rightStartX - radius, bottomStartY - radius, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      this.drawCableNumber(ctx, data, cable, rightStartX - radius, bottomStartY - radius);
      bottomStartY -= diameterMm * data.canvasScale + spacingPx;

      if (row === 0) {
        const leftEdge = rightStartX - diameterMm * data.canvasScale;
        const rightEdge = rightStartX;
        this.updateSeparatorBounds(
          data,
          TrayConstants.cablePurposes.vfd,
          leftEdge,
          rightEdge
        );
        data.recordBottomRowSegment(TrayConstants.cablePurposes.vfd, leftEdge, rightEdge);
        data.bottomRowVFDCables.push(cable);
      }

      row += 1;
      if (row === targetRows) {
        row = 0;
        rightStartX -= diameterMm * data.canvasScale + spacingPx;
        bottomStartY =
          TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;
      }
    }

    const isLastBundle =
      sortedBundles[sortedBundles.length - 1][0] === currentBundleKey;
    if (!isLastBundle && biggestCable) {
      data.bottomRowVFDCables.push(biggestCable, biggestCable);
    }

    return rightStartX;
  }

  private drawCable(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    cable: Cable,
    x: number,
    y: number
  ) {
    const radius = (getCableDiameter(cable) / 2) * data.canvasScale;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x + radius, y - radius, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    this.drawCableNumber(ctx, data, cable, x + radius, y - radius);
  }

  private drawCableNumber(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    cable: Cable,
    x: number,
    y: number
  ) {
    const cableNumber = data.cablesOnTray.indexOf(cable) + 1;
    const label = cableNumber > 0 ? cableNumber.toString() : '?';

    ctx.save();
    ctx.font = '20px Arial';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
    ctx.restore();
  }

  private applyPhaseRotation(sortedCables: Cable[]): Cable[] {
    const phaseRotations: Cable[] = [];
    const blockSize = 6;

    for (let i = 0; i < sortedCables.length; i += blockSize) {
      const block = sortedCables.slice(i, i + blockSize);
      const half = Math.floor(blockSize / 2);
      const firstHalf = block.slice(1, half).concat(block.slice(0, 1));
      const secondHalf = block.slice(half).reverse();
      phaseRotations.push(...firstHalf, ...secondHalf);
    }

    return phaseRotations.length > 0 ? phaseRotations : sortedCables;
  }

  private calculateRowsAndColumns(
    usableTrayHeightMm: number,
    bundle: Cable[],
    purpose: string,
    layoutConfig: ProjectLayoutConfig
  ) {
    const usableHeight = Math.max(usableTrayHeightMm, 1);
    const maxDiameter: number = bundle.reduce(
      (max: number, cable) => Math.max(max, getCableDiameter(cable)),
      TrayConstants.defaultCableDiameterMm
    );

    if (maxDiameter <= 0 || bundle.length === 0) {
      logLayoutDebug('[TrayDrawing] rows/columns fallback (no diameter or cables)', {
        purpose,
        usableTrayHeightMm,
        usableHeight,
        maxDiameter
      });
      return { rows: 1, columns: bundle.length };
    }

    // Get project settings for max rows and columns
    const maxRowsSetting = Math.max(layoutConfig.maxRows || 1, 1);
    const maxColumnsSetting = Math.max(layoutConfig.maxColumns || 1, 1);

    const spacingMm = Math.max(layoutConfig.cableSpacing ?? TrayConstants.defaultSpacingMm, 0);
    const perCableHeightMm = Math.max(maxDiameter, 0) + spacingMm;
    const physicalMaxRows = Math.max(
      Math.floor((usableHeight + spacingMm) / Math.max(perCableHeightMm, 1)),
      1
    );

    const maxRowsAllowed = Math.max(Math.min(maxRowsSetting, physicalMaxRows), 1);
    let rows = maxRowsAllowed;
    let columns = Math.max(Math.ceil(bundle.length / rows), 1);

    while (columns > maxColumnsSetting && rows > 1) {
      rows -= 1;
      columns = Math.max(Math.ceil(bundle.length / rows), 1);
    }

    if (columns > maxColumnsSetting) {
      columns = maxColumnsSetting;
      rows = Math.max(Math.ceil(bundle.length / columns), 1);
      if (rows > maxRowsAllowed) {
        rows = maxRowsAllowed;
        columns = Math.max(Math.ceil(bundle.length / rows), 1);
      }
    }

    rows = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 1;
    rows = Math.max(1, Math.min(rows, maxRowsAllowed));

    const inferredColumns = Math.ceil(bundle.length / rows) || 1;
    columns = Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : inferredColumns;
    columns = Math.max(1, Math.min(columns, maxColumnsSetting));

    if (purpose !== TrayConstants.cablePurposes.mv && bundle.length === 2) {
      rows = 1;
      columns = Math.max(2, columns);
    }

    logLayoutDebug('[TrayDrawing] rows/columns result', {
      purpose,
      usableTrayHeightMm,
      usableHeight,
      maxDiameter,
      bundleCount: bundle.length,
      physicalMaxRows,
      maxRows: maxRowsSetting,
      maxColumns: maxColumnsSetting,
      rows,
      columns      
    });

    return { rows, columns };
  }

  /**
   * Calculate bundle spacing in pixels based on cable diameter and spacing config
   */
  private calculateBundleSpacingPx(
    maxDiameterMm: number,
    bundleSpacing: '0' | '1D' | '2D',
    scale: number,
    effectiveSpacingMm: number
  ): number {
    const baseSpacingMm = Math.max(
      Number.isFinite(maxDiameterMm) && maxDiameterMm > 0 ? maxDiameterMm : 0,
      Math.max(effectiveSpacingMm, 0)
    );

    if (bundleSpacing === '0') {
      return 0;
    } else if (bundleSpacing === '1D') {
      return baseSpacingMm * scale;
    } else if (bundleSpacing === '2D') {
      return baseSpacingMm * 2 * scale;
    }
    return 0;
  }
}

export class TrayDrawingService {
  private readonly bundleDrawer = new CableBundleDrawer();

  drawTrayLayout(
    canvas: HTMLCanvasElement | null,
    tray: Tray | null,
    cablesOnTray: Cable[],
    cableBundles: CableBundleMap | undefined,
    canvasScale: number,
    spacingMm?: number,
    layoutConfig?: CategoryLayoutConfig,
    options?: { rungHeightMm?: number | null }
  ): TrayLayoutSummary | null {
    if (!canvas) {
      throw new Error('Canvas cannot be null');
    }
    if (!tray) {
      throw new Error('Tray cannot be null');
    }

    const trayWidth = tray.widthMm ?? 0;
    const trayHeight = tray.heightMm ?? 0;

    if (trayWidth <= 0 || trayHeight <= 0) {
      this.drawMissingDimensions(canvas);
      return null;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to acquire 2D canvas context');
    }

    const effectiveSpacingMm =
      typeof spacingMm === 'number' && Number.isFinite(spacingMm) && spacingMm >= 0
        ? spacingMm
        : TrayConstants.defaultSpacingMm;

    // Space between the cables is set by effectiveSpacingMm
    // Create default layout config if not provided
    const defaultLayoutConfig: CategoryLayoutConfig = {
      power: { maxRows: 2, maxColumns: 20, bundleSpacing: '2D', cableSpacing: effectiveSpacingMm, trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false },
      control: { maxRows: 2, maxColumns: 20, bundleSpacing: '2D', cableSpacing: effectiveSpacingMm, trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false },
      mv: { maxRows: 2, maxColumns: 20, bundleSpacing: '2D', cableSpacing: effectiveSpacingMm, trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false },
      vfd: { maxRows: 2, maxColumns: 20, bundleSpacing: '2D', cableSpacing: effectiveSpacingMm, trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false }
    };

    const effectiveLayoutConfig: CategoryLayoutConfig = {
      power: layoutConfig?.power ?? defaultLayoutConfig.power,
      control: layoutConfig?.control ?? defaultLayoutConfig.control,
      mv: layoutConfig?.mv ?? defaultLayoutConfig.mv,
      vfd: layoutConfig?.vfd ?? defaultLayoutConfig.vfd
    };

    const rungHeightMm = options?.rungHeightMm ?? TrayConstants.defaultRungHeightMm;

    const drawingData = new TrayDrawingData(
      tray,
      cablesOnTray,
      cableBundles,
      canvasScale,
      effectiveSpacingMm,
      effectiveLayoutConfig,
      rungHeightMm
    );

    this.drawBaseTrayStructure(context, drawingData);
    this.drawCableBundles(context, drawingData);
    this.drawSeparators(context, drawingData);
    return this.buildLayoutSummary(drawingData, effectiveSpacingMm);
  }

  private drawMissingDimensions(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const width = canvas.width || 600;
    const height = canvas.height || 300;
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#201f1e';
    ctx.font = '16px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Provide tray width and height to render the concept.', width / 2, height / 2);
  }

  private drawBaseTrayStructure(ctx: CanvasRenderingContext2D, data: TrayDrawingData) {
    const trayWidth = data.tray.widthMm ?? 0;
    const trayHeight = data.trayHeightMm;
    const originX = TrayConstants.canvasMargin;
    const originY = TrayConstants.canvasMargin;

    const canvasWidth = trayWidth * data.canvasScale + TrayConstants.canvasMargin * 2;
    const canvasHeight = trayHeight * data.canvasScale + TrayConstants.canvasMargin * 2;

    const canvasElement = ctx.canvas as HTMLCanvasElement;
    canvasElement.width = canvasWidth;
    canvasElement.height = canvasHeight;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    this.drawTitle(ctx, data, originX, trayWidth);
    this.drawHeightLabel(ctx, data, originY, trayHeight);
    this.drawTrayRectangle(ctx, data, originX, originY);
    this.drawWidthLabel(ctx, data, originX, originY, trayWidth, trayHeight);
  }

  private drawTitle(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    originX: number,
    trayWidth: number
  ) {
    ctx.save();
    ctx.font = '30px Arial';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `Cables bundles laying concept for tray ${data.tray.name}`,
      originX + (trayWidth * data.canvasScale) / 2,
      30
    );
    ctx.restore();
  }

  private drawHeightLabel(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    originY: number,
    trayHeight: number
  ) {
    ctx.save();
    ctx.font = '30px Arial';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(TrayConstants.textPadding / 2, originY + (trayHeight * data.canvasScale) / 2);
    ctx.rotate(Math.PI / 2);
    const usefulHeight = data.usableTrayHeightMm;
    ctx.fillText(`Useful tray height: ${usefulHeight} mm`, 0, 0);
    ctx.restore();
  }

  private drawTrayRectangle(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    originX: number,
    originY: number
  ) {
    const trayWidth = data.tray.widthMm ?? 0;
    const trayHeight = data.trayHeightMm;
    const rungHeightPx = data.rungHeightMm * data.canvasScale;
    const trayHeightPx = trayHeight * data.canvasScale;
    const usableHeightPx = data.usableTrayHeightMm * data.canvasScale;
    const trayWidthPx = trayWidth * data.canvasScale;

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      originX,
      originY,
      trayWidthPx,
      usableHeightPx
    );
    ctx.strokeRect(
      originX,
      originY + trayHeightPx - rungHeightPx,
      trayWidthPx,
      rungHeightPx
    );

    ctx.fillStyle = '#d3d3d3';
    ctx.fillRect(
      originX,
      originY + trayHeightPx - rungHeightPx,
      trayWidthPx,
      rungHeightPx
    );
  }

  private drawWidthLabel(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    originX: number,
    originY: number,
    trayWidth: number,
    trayHeight: number
  ) {
    ctx.save();
    ctx.font = '30px Arial';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `Useful tray width: ${trayWidth} mm`,
      originX + (trayWidth * data.canvasScale) / 2,
      originY + trayHeight * data.canvasScale + TrayConstants.textPadding / 2 + 10
    );
    ctx.restore();
  }

  private drawCableBundles(ctx: CanvasRenderingContext2D, data: TrayDrawingData) {
    if (!data.cableBundles) {
      return;
    }

    data.clearBottomRowCables();

    const spacingMm = Math.max(data.spacingMm, 0);
    const spacingPx = spacingMm * data.canvasScale;
    const trayWidthPx = (data.tray.widthMm ?? 0) * data.canvasScale;

    let leftStartX = TrayConstants.canvasMargin + spacingPx;
    let rightStartX = TrayConstants.canvasMargin + trayWidthPx - spacingPx;
    let bottomStartY =
      TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;

    // Check if MV cables are present
    const hasMv = data.cableBundles[TrayConstants.cablePurposes.mv] && 
                  Object.values(data.cableBundles[TrayConstants.cablePurposes.mv]).some(
                    (cables: Cable[]) => cables.length > 0
                  );
    
    // Check which cable types are present
    const hasPower = data.cableBundles[TrayConstants.cablePurposes.power] &&
                     Object.values(data.cableBundles[TrayConstants.cablePurposes.power]).some(
                       (cables: Cable[]) => cables.length > 0
                     );
    const hasVfd = data.cableBundles[TrayConstants.cablePurposes.vfd] &&
                   Object.values(data.cableBundles[TrayConstants.cablePurposes.vfd]).some(
                     (cables: Cable[]) => cables.length > 0
                   );
    const hasControl = data.cableBundles[TrayConstants.cablePurposes.control] &&
                       Object.values(data.cableBundles[TrayConstants.cablePurposes.control]).some(
                         (cables: Cable[]) => cables.length > 0
                       );

    console.log('[TrayDrawing] Cable types present:', { hasMv, hasPower, hasVfd, hasControl });

    // Determine drawing strategy based on cable types
    if (hasMv) {
      // When MV cables are present, draw MV on left and everything else on right
      console.log('[TrayDrawing] MV cables detected, drawing MV on left and others on right');
      
      // Draw MV first (on the left)
      if (data.cableBundles[TrayConstants.cablePurposes.mv]) {
        ({ leftStartX, bottomStartY } = this.bundleDrawer.drawMvBundles(
          ctx,
          data,
          data.cableBundles[TrayConstants.cablePurposes.mv],
          leftStartX,
          bottomStartY,
          spacingPx
        ));
      }

      // Draw all other types from the right (as if they were VFD/Control cables)
      for (const [purposeKey, bundles] of Object.entries(data.cableBundles)) {
        const normalizedPurpose = purposeKey.trim().toLowerCase();
        
        if (normalizedPurpose === TrayConstants.cablePurposes.mv) {
          continue; // Already drawn
        }

        // For MV scenarios, all other cables are drawn from the right
        if (normalizedPurpose === TrayConstants.cablePurposes.power) {
          // Reuse VFD drawing logic for right-side power bundles by temporarily
          // swapping the relevant layout configuration & bottom-row tracking.
          const originalLayout = data.layoutConfig.vfd;
          const originalBottomRowRef = data.bottomRowVFDCables;
          try {
            data.layoutConfig.vfd = data.layoutConfig.power;
            data.bottomRowVFDCables = data.bottomRowPowerCables;
            ({ rightStartX, bottomStartY } = this.bundleDrawer.drawVfdBundles(
              ctx,
              data,
              bundles,
              rightStartX,
              bottomStartY,
              spacingPx
            ));
          } finally {
            data.layoutConfig.vfd = originalLayout;
            data.bottomRowVFDCables = originalBottomRowRef;
          }
          data.rightSideLeftEdgePx = rightStartX;
        } else if (normalizedPurpose === TrayConstants.cablePurposes.vfd) {
          ({ rightStartX, bottomStartY } = this.bundleDrawer.drawVfdBundles(
            ctx,
            data,
            bundles,
            rightStartX,
            bottomStartY,
            spacingPx
          ));
        } else if (normalizedPurpose === TrayConstants.cablePurposes.control) {
          ({ rightStartX, bottomStartY } = this.bundleDrawer.drawControlBundles(
            ctx,
            data,
            bundles,
            rightStartX,
            bottomStartY,
            spacingPx
          ));
        }
      }
    } else {
      // No MV cables - determine drawing strategy based on what's present
      
      if (hasPower) {
        // Power on left
        ({ leftStartX, bottomStartY } = this.bundleDrawer.drawPowerBundles(
          ctx,
          data,
          data.cableBundles[TrayConstants.cablePurposes.power],
          leftStartX,
          bottomStartY,
          spacingPx
        ));
        
        // VFD and/or Control on right
        if (hasVfd) {
          ({ rightStartX, bottomStartY } = this.bundleDrawer.drawVfdBundles(
            ctx,
            data,
            data.cableBundles[TrayConstants.cablePurposes.vfd],
            rightStartX,
            bottomStartY,
            spacingPx
          ));
        }
        if (hasControl) {
          ({ rightStartX, bottomStartY } = this.bundleDrawer.drawControlBundles(
            ctx,
            data,
            data.cableBundles[TrayConstants.cablePurposes.control],
            rightStartX,
            bottomStartY,
            spacingPx
          ));
        }
      } else if (hasVfd && hasControl) {
        // VFD on left, Control on right (no Power or MV)
        console.log('[TrayDrawing] VFD and Control only: VFD on left, Control on right');
        // Draw VFD from left using Power drawing logic but with VFD config
        ({ leftStartX, bottomStartY } = this.bundleDrawer.drawPowerBundles(
          ctx,
          data,
          data.cableBundles[TrayConstants.cablePurposes.vfd],
          leftStartX,
          bottomStartY,
          spacingPx,
          'vfd'
        ));
        
        // Draw Control from right
        ({ rightStartX, bottomStartY } = this.bundleDrawer.drawControlBundles(
          ctx,
          data,
          data.cableBundles[TrayConstants.cablePurposes.control],
          rightStartX,
          bottomStartY,
          spacingPx
        ));
      } else {
        // Only one type present
        if (hasVfd) {
          // Only VFD - draw from left using Power drawing logic but with VFD config
          ({ leftStartX, bottomStartY } = this.bundleDrawer.drawPowerBundles(
            ctx,
            data,
            data.cableBundles[TrayConstants.cablePurposes.vfd],
            leftStartX,
            bottomStartY,
            spacingPx,
            'vfd'
          ));
        }
        if (hasControl) {
          // Only Control - draw from right using Control drawing logic
          ({ rightStartX, bottomStartY } = this.bundleDrawer.drawControlBundles(
            ctx,
            data,
            data.cableBundles[TrayConstants.cablePurposes.control],
            rightStartX,
            bottomStartY,
            spacingPx
          ));
        }
      }
    }
  }

  private buildLayoutSummary(data: TrayDrawingData, spacingMm: number): TrayLayoutSummary {
    const segments = data.getAllBottomRowSegments();
    const scale = data.canvasScale;

    if (!Number.isFinite(scale) || scale <= 0) {
      return {
        spacingMm,
        totalCableWidthMm: 0,
        occupiedWidthWithBundleSpacingMm: 0,
        occupiedWidthWithoutBundleSpacingMm: 0,
        bundleSpacingContributionMm: 0,
        segmentCount: 0,
        hasBottomRow: false
      };
    }

    const normalizedSpacingMm = Math.max(spacingMm, 0);
    const sortedSegments = [...segments].sort((a, b) => a.leftPx - b.leftPx);
    let totalCableWidthPx = 0;
    let totalGapPx = 0;
    let totalGapCappedPx = 0;

    for (const segment of sortedSegments) {
      const lengthPx = Math.max(0, segment.rightPx - segment.leftPx);
      totalCableWidthPx += lengthPx;
    }

    for (let index = 0; index < sortedSegments.length - 1; index += 1) {
      const current = sortedSegments[index];
      const next = sortedSegments[index + 1];
      const gapPx = next.leftPx - current.rightPx;
      if (gapPx > 0) {
        totalGapPx += gapPx;
        const baseGapPx = normalizedSpacingMm * scale;
        totalGapCappedPx += Math.min(gapPx, baseGapPx);
      }
    }

    const totalCableWidthMm = totalCableWidthPx / scale;
    const occupiedWithBundleSpacingMm = (totalCableWidthPx + totalGapPx) / scale;
    const occupiedWithoutBundleSpacingMm = (totalCableWidthPx + totalGapCappedPx) / scale;
    const bundleSpacingContributionMm = Math.max(
      0,
      occupiedWithBundleSpacingMm - occupiedWithoutBundleSpacingMm
    );

    return {
      spacingMm: normalizedSpacingMm,
      totalCableWidthMm,
      occupiedWidthWithBundleSpacingMm: occupiedWithBundleSpacingMm,
      occupiedWidthWithoutBundleSpacingMm: occupiedWithoutBundleSpacingMm,
      bundleSpacingContributionMm,
      segmentCount: sortedSegments.length,
      hasBottomRow: sortedSegments.length > 0
    };
  }

  private drawSeparators(ctx: CanvasRenderingContext2D, data: TrayDrawingData) {
    try {
      // Determine which cable types are present on the tray
      const hasPower = data.bottomRowPowerCables.length > 0;
      const hasVfd = data.bottomRowVFDCables.length > 0;
      const hasControl = data.bottomRowControlCables.length > 0;
      
      // Check if MV cables exist in the cable bundles
      const hasMv = data.cableBundles && 
                    data.cableBundles[TrayConstants.cablePurposes.mv] && 
                    Object.values(data.cableBundles[TrayConstants.cablePurposes.mv]).some(
                      (cables: Cable[]) => cables.length > 0
                    );

      // Count how many cable types are present
      const cableTypes: string[] = [];
      if (hasPower) cableTypes.push('power');
      if (hasVfd) cableTypes.push('vfd');
      if (hasControl) cableTypes.push('control');
      if (hasMv) cableTypes.push('mv');

      console.log('[TrayDrawing] Cable types on tray', {
        cableTypes,
        count: cableTypes.length,
        hasPower,
        hasVfd,
        hasControl,
        hasMv,
        powerCount: data.bottomRowPowerCables.length,
        vfdCount: data.bottomRowVFDCables.length,
        controlCount: data.bottomRowControlCables.length
      });

      // Handle based on number of cable types
      if (cableTypes.length === 0) {
        console.log('[TrayDrawing] No cables on tray, skipping separator');
        return;
      }

      if (cableTypes.length === 1) {
        console.log('[TrayDrawing] Only one cable type on tray, no separator needed');
        return;
      }

      if (cableTypes.length >= 3) {
        console.warn('[TrayDrawing] Too many cable types on tray:', cableTypes);
        this.drawWarningMessage(ctx, data, 'Too many cable types on the tray!');
        return;
      }

      // Two cable types - determine separator placement
      if (hasMv) {
        console.log('[TrayDrawing] MV cables present with other type, no separator drawn');
        return;
      }

      // No MV cables, so we have 2 types from: power, vfd, control
      if (hasPower && hasVfd) {
        console.log('[TrayDrawing] Drawing separator between Power (left) and VFD (right)');
        this.drawSeparatorLine(ctx, data, data.bottomRowPowerCables, data.bottomRowVFDCables);
      } else if (hasPower && hasControl) {
        console.log('[TrayDrawing] Drawing separator between Power (left) and Control (right)');
        this.drawSeparatorLine(ctx, data, data.bottomRowPowerCables, data.bottomRowControlCables);
      } else if (hasVfd && hasControl) {
        console.log('[TrayDrawing] Drawing separator between VFD (left) and Control (right)');
        this.drawSeparatorLine(ctx, data, data.bottomRowVFDCables, data.bottomRowControlCables);
      }
    } catch (error) {
      console.error('[TrayDrawing] Error in drawSeparators:', error);
      // Don't re-throw separator drawing errors as they're not critical
    }
  }

  private drawWarningMessage(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    message: string
  ) {
    const trayWidthPx = (data.tray.widthMm ?? 0) * data.canvasScale;
    const trayHeightPx = (data.tray.heightMm ?? 0) * data.canvasScale;
    const centerX = TrayConstants.canvasMargin + trayWidthPx / 2;
    const centerY = TrayConstants.canvasMargin + trayHeightPx / 2;

    ctx.save();
    
    // Draw semi-transparent background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(
      centerX - 200,
      centerY - 30,
      400,
      60
    );
    
    // Draw border
    ctx.strokeStyle = '#d32f2f';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      centerX - 200,
      centerY - 30,
      400,
      60
    );
    
    // Draw warning text
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = '#d32f2f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, centerX, centerY);
    
    ctx.restore();
  }

  private drawSeparatorLine(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    leftCables: Cable[],
    rightCables: Cable[]
  ) {
    console.log('[TrayDrawing] drawSeparatorLine called', {
      hasWidth: !!data.tray.widthMm,
      hasHeight: !!data.tray.heightMm,
      widthMm: data.tray.widthMm,
      heightMm: data.tray.heightMm,
      leftCablesCount: leftCables.length,
      rightCablesCount: rightCables.length,
      leftSideRightEdgePx: data.leftSideRightEdgePx,
      rightSideLeftEdgePx: data.rightSideLeftEdgePx
    });

    if (!data.tray.widthMm || !data.tray.heightMm) {
      console.log('[TrayDrawing] Missing tray dimensions, skipping separator line');
      return;
    }

    try {
      // Use the tracked actual positions from drawing
      const leftEdgePx = data.leftSideRightEdgePx;
      const rightEdgePx = data.rightSideLeftEdgePx;

      if (leftEdgePx <= 0 || rightEdgePx <= 0 || rightEdgePx <= leftEdgePx) {
        console.log('[TrayDrawing] Invalid edge positions, skipping separator', {
          leftEdgePx,
          rightEdgePx
        });
        return;
      }

      // Calculate separator X position at the midpoint of the gap
      const separatorX = leftEdgePx + (rightEdgePx - leftEdgePx) / 2;

      // Calculate Y positions
      const bottomY =
        TrayConstants.canvasMargin + data.usableTrayHeightMm * data.canvasScale;
      const topY =
        TrayConstants.canvasMargin + data.rungHeightMm * data.canvasScale;

      console.log('[TrayDrawing] Drawing separator line', {
        separatorX,
        leftEdgePx,
        rightEdgePx,
        gapWidth: rightEdgePx - leftEdgePx,
        bottomY,
        topY,
        leftCablesCount: leftCables.length,
        rightCablesCount: rightCables.length
      });

      // Draw the separator line
      ctx.save();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(separatorX, bottomY);
      ctx.lineTo(separatorX, topY);
      ctx.stroke();
      ctx.restore();
    } catch (error) {
      console.error('[TrayDrawing] Error in drawSeparatorLine:', error);
      // Don't re-throw separator line drawing errors as they're not critical
    }
  }
}
