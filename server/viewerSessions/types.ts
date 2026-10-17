import type { ManifestResource, PortableManifest } from '../modelRegistry/types.js';

export interface ViewerPrincipal { userId: string; loginId: string; loginExpiresAt: number }
export interface ViewerSessionDto {
  sessionId: string; projectId: string; modelVersionId: string; loadId: string;
  expiresAt: string; absoluteExpiresAt: string;
}
export interface ViewerVersion {
  id: string; projectId: string; contentFingerprint: string; supportProfile: string;
  format: string; sdkVersion: string; entrypoint: string; resourceCount: number; totalBytes: number;
  manifest: PortableManifest; storagePrefix: string;
}
export interface ViewerDescriptor {
  projectId: string; modelVersionId: string; loadId: string; contentFingerprint: string;
  supportProfile: string; format: string; sdkVersion: string; entrypoint: string;
  resourceCount: number; totalBytes: number;
}
export interface ResourceIdentity {
  projectId: string; modelVersionId: string; sessionId: string; cookieSecret: string;
}
export interface AuthorizedViewerResource { session: ViewerSessionDto; version: ViewerVersion }
export type ViewerResource = ManifestResource;
