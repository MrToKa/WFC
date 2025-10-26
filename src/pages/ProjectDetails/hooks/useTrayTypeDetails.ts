import { useMemo } from 'react';
import { Project } from '@/api/client';

type Tray = {
  type: string | null;
  widthMm: number | null;
};

export type TrayTypeDetail = {
  trayType: string;
  widthMm: number | null;
  hasMultipleWidths: boolean;
};

type UseTrayTypeDetailsParams = {
  trays: Tray[];
  project: Project | null;
};

export const useTrayTypeDetails = ({
  trays,
  project
}: UseTrayTypeDetailsParams): TrayTypeDetail[] => {
  return useMemo<TrayTypeDetail[]>(() => {
    const map = new Map<string, Set<number>>();

    trays.forEach((tray) => {
      if (!tray.type) {
        return;
      }

      if (!map.has(tray.type)) {
        map.set(tray.type, new Set<number>());
      }

      if (tray.widthMm !== null && tray.widthMm !== undefined) {
        map.get(tray.type)!.add(tray.widthMm);
      }
    });

    Object.keys(project?.supportDistanceOverrides ?? {}).forEach((trayType) => {
      if (trayType && !map.has(trayType)) {
        map.set(trayType, new Set<number>());
      }
    });

    return Array.from(map.entries())
      .map(([trayType, widths]) => {
        const values = Array.from(widths);
        const hasMultipleWidths = values.length > 1;
        const widthMm = values.length === 1 ? values[0] : null;

        return {
          trayType,
          widthMm,
          hasMultipleWidths
        };
      })
      .sort((a, b) =>
        a.trayType.localeCompare(b.trayType, undefined, {
          sensitivity: 'base'
        })
      );
  }, [project?.supportDistanceOverrides, trays]);
};
