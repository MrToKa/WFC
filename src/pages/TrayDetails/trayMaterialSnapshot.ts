import type { MaterialTray, Tray } from '../../api/client';

export const isNewTrayMaterialSelection = (
  tray: Tray | null,
  type: string,
  editing: boolean,
): boolean => editing && (tray?.type?.trim().toLowerCase() ?? '') !== type.trim().toLowerCase();

export const getTrayDisplayMaterial = (
  tray: Tray | null,
  type: string,
  editing: boolean,
  findCurrent: (type: string) => MaterialTray | null,
): MaterialTray | null =>
  isNewTrayMaterialSelection(tray, type, editing)
    ? findCurrent(type)
    : (tray?.materialSnapshot?.material ?? null);
