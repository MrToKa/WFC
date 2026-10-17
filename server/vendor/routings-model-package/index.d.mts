// WFC-owned declarations for the unchanged, pinned public ESM entrypoint.
import type { Readable } from 'node:stream';
import type { ManifestResource, PackageLimits, PortableManifest, VerificationReport } from '../../modelRegistry/types.js';

export type { PackageLimits, PortableManifest, VerificationReport };

export interface VerificationOptions {
  expectedFingerprint?: string;
  extractTo?: string;
  limits?: Partial<PackageLimits>;
  signal?: AbortSignal;
}

export interface PackOptions {
  modelDir: string;
  source: string;
  output: string;
  label: string;
  packageId?: string;
  preparedAt?: string;
  expectedFingerprint?: string;
  manifest?: string;
  report?: string;
  recover?: boolean;
  limits?: Partial<PackageLimits>;
  signal?: AbortSignal;
}

export type PackReport = Omit<VerificationReport, 'operation'> & {
  operation: 'pack';
  input: { modelDir: string; sourcePath: string };
  sourceIdentity: PortableManifest['source'];
  publication: { status: 'PASS'; resumed: boolean; manifestPath: string; reportPath: string };
  preflightProfile: Record<string, unknown>;
};

export interface ProfileProvider {
  resources: ManifestResource[];
  read(path: string, options?: { maxBytes?: number }): Promise<Buffer>;
  stream(path: string): Readable;
}

export function verifyPackage(inputZip: string, options?: VerificationOptions): Promise<VerificationReport>;
export function packModel(options: PackOptions): Promise<PackReport>;
export function validateManifest(value: unknown, options?: { limits?: Partial<PackageLimits> }): PortableManifest;
export function parseManifest(text: string, options?: { limits?: Partial<PackageLimits> }): PortableManifest;
export function computeFingerprint(manifest: PortableManifest): string;
export function canonicalFingerprintInput(manifest: PortableManifest): Buffer;
export function validateProfile(provider: ProfileProvider, options?: { limits?: Partial<PackageLimits>; signal?: AbortSignal }): Promise<Record<string, unknown>>;
export function inspectSvfEnvelope(bytes: Buffer, options?: { limits?: Partial<PackageLimits>; signal?: AbortSignal }): Promise<Record<string, unknown>>;

export class PackageError extends Error {
  constructor(code: string, message: string, details?: Record<string, unknown>);
  code: string;
  details: Record<string, unknown>;
}

export const DEFAULT_LIMITS: Readonly<PackageLimits>;
