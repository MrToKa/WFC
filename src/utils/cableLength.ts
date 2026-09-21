import type { Tray } from '@/api/client';

const normalizeRoutingSegment = (value: string): string => value.trim().toLowerCase();

export const calculateAutoCableLength = (
  routing: string | null | undefined,
  trays: Tray[],
  secondaryTrayLength: number | null | undefined,
  additionalBendingPercent = 10,
  endConnectionLength = 5,
): number | null => {
  const routingSegments =
    routing
      ?.split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0) ?? [];

  if (routingSegments.length === 0) {
    return null;
  }

  const traysByName = new Map<string, Tray>();

  for (const tray of trays) {
    const key = normalizeRoutingSegment(tray.name);

    if (key && !traysByName.has(key)) {
      traysByName.set(key, tray);
    }
  }

  let totalLengthM = 0;

  for (const segment of routingSegments) {
    if (normalizeRoutingSegment(segment) === 'secondary') {
      if (
        typeof secondaryTrayLength !== 'number' ||
        !Number.isFinite(secondaryTrayLength) ||
        secondaryTrayLength < 0
      ) {
        return null;
      }

      totalLengthM += secondaryTrayLength;
      continue;
    }

    const tray = traysByName.get(normalizeRoutingSegment(segment));
    const lengthMm = tray?.lengthMm;

    if (typeof lengthMm !== 'number' || !Number.isFinite(lengthMm) || lengthMm < 0) {
      return null;
    }

    totalLengthM += lengthMm / 1000;
  }

  return Math.ceil(totalLengthM * (1 + additionalBendingPercent / 100) + endConnectionLength);
};

