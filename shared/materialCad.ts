export const materialComponentKinds = ['straight', 'bend', 'tee', 'reducer', 'connector', 'accessory', 'other'] as const;
export type MaterialComponentKind = typeof materialComponentKinds[number];
export type MaterialProductFamily = { id: string; manufacturer: string; name: string };
export type MaterialComponent = {
  id: string; familyId: string; familyName: string; manufacturer: string;
  partNumber: string; componentKind: MaterialComponentKind; name: string;
  materialTrayId: string | null; widthMm: number | null; heightMm: number | null; lengthMm: number | null;
  latestAssetId: string | null; latestRevision: number | null;
};
export type MaterialCadAsset = {
  id: string; componentId: string; revision: number; originalFilename: string;
  sourceSha256: string; sourceBytes: number; meshMetadata: Record<string, unknown>;
  active: boolean; createdAt: string;
};
export type CreateMaterialComponent = {
  familyId: string; partNumber: string; componentKind: MaterialComponentKind; name: string;
  materialTrayId?: string | null; widthMm?: number | null; heightMm?: number | null; lengthMm?: number | null;
};
