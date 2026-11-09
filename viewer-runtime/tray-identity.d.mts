export interface TrayObjectIdentity { externalId: string | null; guid: string | null; sourceFile: string | null }
export interface TrayIdentityMatch { identity: TrayObjectIdentity; status: 'unique' | 'missing' | 'ambiguous' | 'unavailable'; objectIds: number[] }
export interface TrayIdentityRequest { schemaVersion: 'wfc.pf.tray-identity-request.v1'; identities: TrayObjectIdentity[] }
export interface TrayIdentityResponse { schemaVersion: 'wfc.pf.tray-identity-response.v1'; matches: TrayIdentityMatch[] }
export interface TrayIdentityOptions { signal?: AbortSignal; check?: () => void }
export const TRAY_IDENTITY_LIMITS: Readonly<{ requests: number; pageBytes: number; responseBytes: number; indexedObjects: number; batch: number; propertiesPerRow: number; scannedProperties: number; indexBytes: number; timeoutMs: number }>;
export function validateTrayIdentityRequest(value: unknown): value is TrayIdentityRequest;
export function validateTrayIdentityResponse(value: unknown): value is TrayIdentityResponse;
export function readTrayObjectIdentities(model: object, objectIds: number[], options?: TrayIdentityOptions): Promise<Array<{ objectId: number; identity: TrayObjectIdentity }>>;
export function resolveTrayObjectIdentities(model: object, identities: TrayObjectIdentity[], options?: TrayIdentityOptions): Promise<TrayIdentityMatch[]>;
