export type DisplayVisibilityScope = { schemaVersion: 'wfc.pf.sdk-display-visibility.v1'; basis: 'sdk-display-before-pf-appearance'; contentSha256: string };
export type EquipmentEligibility = { schemaVersion: 'wfc.pf.equipment-eligibility.v1'; matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v3'; visibilityScopeSha256: string; visibility: 'visible'; checkedAncestorCount: number; fragmentStatus: 'all-visible' | 'geometry-free-node-bounds'; fragmentCount: number };
export const DISPLAY_VISIBILITY_SCHEMA: 'wfc.pf.sdk-display-visibility.v1';
export const EQUIPMENT_VISIBILITY_POLICY: 'wfc.pf.project-exact-candidates.v3';
export function sameDisplayVisibility(first: unknown, second: unknown): boolean;
export type DisplayVisibilityObservation = { scope: DisplayVisibilityScope; equipmentEligibility(id: number): EquipmentEligibility | null; refresh(): Promise<DisplayVisibilityObservation> };
export function captureDisplayVisibility(viewer: unknown, tree: unknown, ids: number[], options?: { check?: () => void; pause?: () => Promise<void>; indexById?: Map<number, number> }): Promise<DisplayVisibilityObservation>;
