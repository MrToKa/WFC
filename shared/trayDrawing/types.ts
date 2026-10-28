/** Structural, serializable drawing inputs. This package never imports browser application modules. */
export type DrawingCable = {
  id: string;
  cableId: number;
  diameterMm?: number | null;
  purpose?: string | null;
  fromLocation?: string | null;
  toLocation?: string | null;
};
export type DrawingTray = { id?: string; name: string; widthMm?: number | null; heightMm?: number | null; useTrefoilClamps?: boolean };
export type CategoryKey = 'mv' | 'power' | 'vfd' | 'control';
export type SideMode = 'use-default' | 'left' | 'right';
export type CategoryModes = Record<CategoryKey, SideMode>;
export type CustomBundleRange = { id: string; min: number; max: number; maxRows?: number | null };
export type DrawingDiagnostic = { code: string; cableIds: string[]; message: string };
export type CablePlacement = { cableId: string; displayNumber: number; category: CategoryKey; side: 'left' | 'right'; xPx: number; yPx: number; radiusPx: number };

/** Deliberately limited Canvas subset, usable by a recorder or a browser context. */
export interface DrawingContext {
  canvas: DrawingCanvas;
  fillStyle: unknown; strokeStyle: unknown; font: string; lineWidth: number;
  textAlign: string; textBaseline: string; lineCap: string; lineJoin: string;
  save(): void; restore(): void; beginPath(): void; closePath(): void;
  fill(): void; stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number, counterclockwise?: boolean): void;
  translate(x: number, y: number): void; rotate(angle: number): void;
}
export interface DrawingCanvas { width: number; height: number; getContext(kind: '2d'): DrawingContext | null }

export const CATEGORY_ORDER: readonly CategoryKey[] = ['mv', 'power', 'vfd', 'control'];
export const DEFAULT_CATEGORY_MODES: CategoryModes = { mv: 'use-default', power: 'use-default', vfd: 'use-default', control: 'use-default' };
