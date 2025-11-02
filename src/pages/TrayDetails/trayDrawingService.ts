import type { Tray, Cable } from '@/api/client';

const TrayConstants = {
  canvasMargin: 50,
  textPadding: 40,
  cProfileHeightMm: 15,
  defaultSpacingMm: 15,
  defaultCableDiameterMm: 25,
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

export type CableBundleMap = Record<string, Record<string, Cable[]>>;

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

const sumCableWidthsPx = (cables: Cable[], scale: number, spacingMm: number): number =>
  cables.reduce((total, cable) => total + (getCableDiameter(cable) + spacingMm) * scale, 0);

class TrayDrawingData {
  tray: Tray;
  cablesOnTray: Cable[];
  cableBundles: CableBundleMap;
  canvasScale: number;
  spacingMm: number;
  bottomRowPowerCables: Cable[] = [];
  bottomRowVFDCables: Cable[] = [];
  bottomRowControlCables: Cable[] = [];

  constructor(
    tray: Tray,
    cablesOnTray: Cable[],
    cableBundles: CableBundleMap | undefined,
    canvasScale: number,
    spacingMm: number
  ) {
    this.tray = tray;
    this.cablesOnTray = cablesOnTray;
    this.cableBundles = cableBundles ?? {};
    this.canvasScale = canvasScale;
    this.spacingMm = spacingMm;
  }

  clearBottomRowCables() {
    this.bottomRowPowerCables = [];
    this.bottomRowVFDCables = [];
    this.bottomRowControlCables = [];
  }
}

type PowerResult = { leftStartX: number; bottomStartY: number };
type ControlResult = { rightStartX: number; bottomStartY: number };

class CableBundleDrawer {
  drawPowerBundles(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    bundles: Record<string, Cable[]>,
    leftStartX: number,
    bottomStartY: number,
    spacingPx: number
  ): PowerResult {
    const sortedBundles = Object.entries(bundles)
      .filter(([, cables]) => cables.length > 0)
      .sort(([, cablesA], [, cablesB]) => getCableDiameter(cablesB[0]) - getCableDiameter(cablesA[0]));

    for (const [bundleKey, bundleCables] of sortedBundles) {
      const rows = this.calculateRowsAndColumns(
        data.tray.heightMm ?? 0,
        bundleCables,
        TrayConstants.cablePurposes.power
      ).rows;
      const sortedCables = [...bundleCables].sort(
        (a, b) => getCableDiameter(b) - getCableDiameter(a)
      );
      const biggestCable = sortedCables[0];

      if (
        bundleKey === TrayConstants.bundleTypes.range40_1_45 ||
        bundleKey === TrayConstants.bundleTypes.range45_1_60
      ) {
        ({ leftStartX, bottomStartY } = this.drawHexagonalPacking(
          ctx,
          data,
          sortedCables,
          leftStartX,
          bottomStartY,
          spacingPx
        ));
      } else {
        ({ leftStartX, bottomStartY } = this.drawVerticalStacking(
          ctx,
          data,
          sortedCables,
          leftStartX,
          bottomStartY,
          spacingPx,
          rows,
          data.bottomRowPowerCables
        ));
      }

      const isLastBundle = sortedBundles[sortedBundles.length - 1][0] === bundleKey;
      if (!isLastBundle && biggestCable) {
        data.bottomRowPowerCables.push(biggestCable, biggestCable);
      }

      leftStartX =
        TrayConstants.canvasMargin +
        spacingPx +
        sumCableWidthsPx(data.bottomRowPowerCables, data.canvasScale, data.spacingMm);
      bottomStartY =
        TrayConstants.canvasMargin +
        ((data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm) * data.canvasScale;
    }

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

    for (const [bundleKey, bundleCables] of sortedBundles) {
      const rows = this.calculateRowsAndColumns(
        data.tray.heightMm ?? 0,
        bundleCables,
        TrayConstants.cablePurposes.control
      ).rows;
      const sortedCables = [...bundleCables].sort(
        (a, b) => getCableDiameter(b) - getCableDiameter(a)
      );
      const biggestCable = sortedCables[0];

      rightStartX = this.drawVerticalStackingFromRight(
        ctx,
        data,
        sortedCables,
        rightStartX,
        bottomStartY,
        spacingPx,
        rows,
        data.bottomRowControlCables
      );

      const isLastBundle = sortedBundles[sortedBundles.length - 1][0] === bundleKey;
      if (!isLastBundle && biggestCable) {
        data.bottomRowControlCables.push(biggestCable, biggestCable);
      }

      rightStartX =
        TrayConstants.canvasMargin +
        (data.tray.widthMm ?? 0) * data.canvasScale -
        spacingPx -
        sumCableWidthsPx(data.bottomRowControlCables, data.canvasScale, data.spacingMm);
      bottomStartY =
        TrayConstants.canvasMargin +
        ((data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm) * data.canvasScale;
    }

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
    const sortedBundles = Object.entries(bundles)
      .filter(([, cables]) => cables.length > 0)
      .sort(([, cablesA], [, cablesB]) => getCableDiameter(cablesB[0]) - getCableDiameter(cablesA[0]));

    for (const [, bundleCables] of sortedBundles) {
      ({ leftStartX, bottomStartY } = this.drawPhaseRotationBundles(
        ctx,
        data,
        bundleCables,
        leftStartX,
        bottomStartY,
        spacingPx
      ));
    }

    return { leftStartX, bottomStartY };
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

    for (const [bundleKey, bundleCables] of sortedBundles) {
      const { rows } = this.calculateRowsAndColumns(
        data.tray.heightMm ?? 0,
        bundleCables,
        TrayConstants.cablePurposes.vfd
      );

      if (
        bundleKey === TrayConstants.bundleTypes.range30_1_40 ||
        bundleKey === TrayConstants.bundleTypes.range40_1_45
      ) {
        rightStartX = this.drawGroupedVfdCables(
          ctx,
          data,
          bundleCables,
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
          bundleCables,
          rightStartX,
          bottomStartY,
          spacingPx,
          rows,
          sortedBundles,
          bundleKey
        );
      }
    }

    rightStartX =
      TrayConstants.canvasMargin +
      (data.tray.widthMm ?? 0) * data.canvasScale -
      spacingPx -
      sumCableWidthsPx(data.bottomRowVFDCables, data.canvasScale, data.spacingMm);
    bottomStartY =
      TrayConstants.canvasMargin +
      ((data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm) * data.canvasScale;

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
    const usableTrayHeight = (data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm;

    for (let index = 0; index < sortedCables.length; index++) {
      const cable = sortedCables[index];
      const diameterMm = getCableDiameter(cable);

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
        leftStartX =
          TrayConstants.canvasMargin +
          spacingPx +
          sumCableWidthsPx(data.bottomRowPowerCables, data.canvasScale, data.spacingMm) -
          (diameterMm * data.canvasScale + spacingPx) * 1.5;
        row = 1;
      }

      this.drawCable(ctx, data, cable, leftStartX, bottomStartY);
      bottomStartY =
        TrayConstants.canvasMargin +
        ((data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm) * data.canvasScale;

      if (row === 0) {
        data.bottomRowPowerCables.push(cable);
        leftStartX =
          TrayConstants.canvasMargin +
          spacingPx +
          sumCableWidthsPx(data.bottomRowPowerCables, data.canvasScale, data.spacingMm);
      } else if (row === 1) {
        row = 0;
        leftStartX =
          TrayConstants.canvasMargin +
          spacingPx +
          sumCableWidthsPx(data.bottomRowPowerCables, data.canvasScale, data.spacingMm);
        bottomStartY =
          TrayConstants.canvasMargin +
          ((data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm) * data.canvasScale;
      }
    }

    return { leftStartX, bottomStartY };
  }

  private drawVerticalStacking(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    sortedCables: Cable[],
    leftStartX: number,
    bottomStartY: number,
    spacingPx: number,
    rows: number,
    bottomRowCables: Cable[]
  ): PowerResult {
    let row = 0;

    const targetRows = Math.max(rows, 1);

    for (const cable of sortedCables) {
      this.drawCable(ctx, data, cable, leftStartX, bottomStartY);
      bottomStartY -= getCableDiameter(cable) * data.canvasScale + spacingPx;

      if (row === 0) {
        bottomRowCables.push(cable);
      }

      row += 1;
      if (row === targetRows) {
        row = 0;
        leftStartX =
          TrayConstants.canvasMargin +
          spacingPx +
          sumCableWidthsPx(bottomRowCables, data.canvasScale, data.spacingMm);
        bottomStartY =
          TrayConstants.canvasMargin +
          ((data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm) * data.canvasScale;
      }
    }

    return { leftStartX, bottomStartY };
  }

  private drawVerticalStackingFromRight(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    sortedCables: Cable[],
    rightStartX: number,
    bottomStartY: number,
    spacingPx: number,
    rows: number,
    bottomRowCables: Cable[]
  ): number {
    let row = 0;
    const targetRows = Math.max(rows, 1);

    for (const cable of sortedCables) {
      const radius = (getCableDiameter(cable) / 2) * data.canvasScale;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(rightStartX - radius, bottomStartY - radius, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      this.drawCableNumber(ctx, data, cable, rightStartX - radius, bottomStartY - radius);

      bottomStartY -= getCableDiameter(cable) * data.canvasScale + spacingPx;

      if (row === 0) {
        bottomRowCables.push(cable);
      }

      row += 1;
      if (row === targetRows) {
        row = 0;
        rightStartX =
          TrayConstants.canvasMargin +
          (data.tray.widthMm ?? 0) * data.canvasScale -
          spacingPx -
          sumCableWidthsPx(bottomRowCables, data.canvasScale, data.spacingMm);
        bottomStartY =
          TrayConstants.canvasMargin +
          ((data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm) * data.canvasScale;
      }
    }

    return rightStartX;
  }

  private drawPhaseRotationBundles(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    bundleCables: Cable[],
    leftStartX: number,
    bottomStartY: number,
    spacingPx: number
  ): PowerResult {
    const sortedCables = [...bundleCables].sort(
      (a, b) => getCableDiameter(b) - getCableDiameter(a)
    );
    const phaseRotations = this.applyPhaseRotation(sortedCables);

    let row = 0;
    let cableIndex = 2;
    let leftStartBottom = leftStartX;
    let leftStartTop =
      leftStartX + ((getCableDiameter(phaseRotations[0]) / 2 + 0.5) * data.canvasScale);

    for (let index = 0; index < phaseRotations.length; index++) {
      const cable = phaseRotations[index];
      const diameterMm = getCableDiameter(cable);

      if (index === cableIndex) {
        bottomStartY -=
          ((diameterMm * data.canvasScale) / 2) * (Math.sqrt(3) / 2) +
          (diameterMm * data.canvasScale) / 2 -
          spacingPx * 2;
        leftStartX = leftStartTop;
        row = 1;
        cableIndex += 3;
      }

      this.drawCable(ctx, data, cable, leftStartX, bottomStartY);
      bottomStartY =
        TrayConstants.canvasMargin +
        ((data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm) * data.canvasScale;

      if (row === 0) {
        data.bottomRowPowerCables.push(cable);
        leftStartX += (diameterMm + data.spacingMm) * data.canvasScale;
        leftStartBottom = leftStartX;
      } else {
        row = 0;
        leftStartBottom += (diameterMm + data.spacingMm) * data.canvasScale * 2;
        leftStartX = leftStartBottom;
        leftStartTop += (diameterMm + data.spacingMm) * data.canvasScale * 4;
        bottomStartY =
          TrayConstants.canvasMargin +
          ((data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm) * data.canvasScale;
      }
    }

    return { leftStartX, bottomStartY };
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
        data.bottomRowVFDCables.push(cable);
      }

      row += 1;
      if (row === targetRows) {
        row = 0;
        rightStartX -= diameterMm * data.canvasScale + spacingPx;
        bottomStartY =
          TrayConstants.canvasMargin +
          ((data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm) * data.canvasScale;
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

  private calculateRowsAndColumns(trayHeightMm: number, bundle: Cable[], purpose: string) {
    const usableHeight = Math.max(trayHeightMm - TrayConstants.cProfileHeightMm, 1);
    const maxDiameter = bundle.reduce(
      (max, cable) => Math.max(max, getCableDiameter(cable)),
      TrayConstants.defaultCableDiameterMm
    );

    if (maxDiameter <= 0) {
      return { rows: 1, columns: bundle.length };
    }

    let rows = Math.min(Math.floor(usableHeight / maxDiameter), 2);
    if (rows < 1) {
      rows = 1;
    }

    let columns =
      purpose === TrayConstants.cablePurposes.control
        ? Math.min(Math.ceil(bundle.length / rows), 20)
        : Math.max(Math.floor(bundle.length / rows), 1);

    if (bundle.length === 2) {
      return { rows: 1, columns: 2 };
    }

    if (rows > columns) {
      const balanced = Math.max(Math.ceil(Math.sqrt(bundle.length)), 1);
      rows = balanced;
      columns = balanced;
    }

    return { rows, columns };
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
    spacingMm?: number
  ) {
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
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to acquire 2D canvas context');
    }

    const effectiveSpacingMm =
      typeof spacingMm === 'number' && Number.isFinite(spacingMm) && spacingMm >= 0
        ? spacingMm
        : TrayConstants.defaultSpacingMm;

    const drawingData = new TrayDrawingData(
      tray,
      cablesOnTray,
      cableBundles,
      canvasScale,
      effectiveSpacingMm
    );

    this.drawBaseTrayStructure(context, drawingData);
    this.drawCableBundles(context, drawingData);
    this.drawSeparators(context, drawingData);
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
    const trayHeight = data.tray.heightMm ?? 0;
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
    ctx.font = '24px Arial';
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
    ctx.font = '24px Arial';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(TrayConstants.textPadding, originY + (trayHeight * data.canvasScale) / 2);
    ctx.rotate(Math.PI / 2);
    const usefulHeight = trayHeight - TrayConstants.cProfileHeightMm;
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
    const trayHeight = data.tray.heightMm ?? 0;
    const cProfileHeightPx = TrayConstants.cProfileHeightMm * data.canvasScale;
    const trayHeightPx = trayHeight * data.canvasScale;
    const trayWidthPx = trayWidth * data.canvasScale;

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      originX,
      originY,
      trayWidthPx,
      (trayHeight - TrayConstants.cProfileHeightMm) * data.canvasScale
    );
    ctx.strokeRect(
      originX,
      originY + trayHeightPx - cProfileHeightPx,
      trayWidthPx,
      cProfileHeightPx
    );

    ctx.fillStyle = '#d3d3d3';
    ctx.fillRect(
      originX,
      originY + trayHeightPx - cProfileHeightPx,
      trayWidthPx,
      cProfileHeightPx
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
    ctx.font = '24px Arial';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `Useful tray width: ${trayWidth} mm`,
      originX + (trayWidth * data.canvasScale) / 2,
      originY + trayHeight * data.canvasScale + TrayConstants.textPadding
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
      TrayConstants.canvasMargin +
      ((data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm) * data.canvasScale;

    for (const [purposeKey, bundles] of Object.entries(data.cableBundles)) {
      const normalizedPurpose = purposeKey.trim().toLowerCase();

      if (normalizedPurpose === TrayConstants.cablePurposes.power) {
        ({ leftStartX, bottomStartY } = this.bundleDrawer.drawPowerBundles(
          ctx,
          data,
          bundles,
          leftStartX,
          bottomStartY,
          spacingPx
        ));
      } else if (normalizedPurpose === TrayConstants.cablePurposes.mv) {
        ({ leftStartX, bottomStartY } = this.bundleDrawer.drawMvBundles(
          ctx,
          data,
          bundles,
          leftStartX,
          bottomStartY,
          spacingPx
        ));
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
  }

  private drawSeparators(ctx: CanvasRenderingContext2D, data: TrayDrawingData) {
    if (!data.tray.purpose) {
      return;
    }

    const purpose = data.tray.purpose.trim().toLowerCase();
    const hasPower = data.bottomRowPowerCables.length > 0;
    const hasVfd = data.bottomRowVFDCables.length > 0;
    const hasControl = data.bottomRowControlCables.length > 0;

    if (purpose === TrayConstants.trayPurposes.typeB && hasPower && hasVfd) {
      this.drawSeparatorLine(ctx, data, data.bottomRowPowerCables, data.bottomRowVFDCables);
    } else if (purpose === TrayConstants.trayPurposes.typeBC && hasPower && hasControl) {
      this.drawSeparatorLine(ctx, data, data.bottomRowPowerCables, data.bottomRowControlCables);
    }
  }

  private drawSeparatorLine(
    ctx: CanvasRenderingContext2D,
    data: TrayDrawingData,
    leftCables: Cable[],
    rightCables: Cable[]
  ) {
    const spacingMm = data.spacingMm;
    const leftWidthMm = leftCables.reduce(
      (total, cable) => total + getCableDiameter(cable) + spacingMm,
      0
    );
    const rightWidthMm = rightCables.reduce(
      (total, cable) => total + getCableDiameter(cable) + spacingMm,
      0
    );
    const trayWidth = data.tray.widthMm ?? 0;
    const trayFreeSpace = trayWidth - (leftWidthMm + rightWidthMm);

    const separatorX =
      (leftWidthMm + trayFreeSpace / 2) * data.canvasScale + TrayConstants.canvasMargin;
    const topY =
      TrayConstants.canvasMargin +
      TrayConstants.cProfileHeightMm * data.canvasScale;
    const bottomY =
      TrayConstants.canvasMargin +
      ((data.tray.heightMm ?? 0) - TrayConstants.cProfileHeightMm) * data.canvasScale;

    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(separatorX, bottomY);
    ctx.lineTo(separatorX, topY);
    ctx.stroke();
    ctx.restore();
  }
}
