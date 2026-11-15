export interface CadSectionMetadata {
  instanceId: string;
  name: string;
  actualLengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  partNumber: string;
  manufacturer: string;
  purpose: string | null;
  componentKind: string | null;
  cadAssetId: string | null;
  cadRevision: number | null;
}
export interface CadSectionRoute {
  id: string | null;
  name: string;
  purpose: string | null;
}
export function validateCadProperties(
  componentId: unknown,
  metadata: unknown,
  route: unknown,
): boolean;
