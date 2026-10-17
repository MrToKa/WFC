export interface ModelSource {
  name: string;
  bytes: number;
  sha256: string;
  identityBasis: 'observed-local-file' | 'captured-at-conversion';
}

export interface ManifestResource {
  path: string;
  bytes: number;
  sha256: string;
}

export interface PackageLimits {
  maxArchiveBytes: number;
  maxTotalResourceBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxManifestBytes: number;
  maxNestedBytes: number;
  maxNestedTotalBytes: number;
  maxDepth: number;
  maxExpansionRatio: number;
  maxMs: number;
}

export interface PortableManifest {
  schemaVersion: 1;
  packageId: string;
  label: string;
  source: ModelSource;
  preparedAt: string;
  supportProfile: 'svf-local-7.130.0-v1';
  format: 'svf';
  sdkVersion: '7.130.0';
  entrypoint: 'resources/output/0/0.svf';
  resources: ManifestResource[];
  contentFingerprint: string;
}

export interface VerificationReport {
  reportSchemaVersion: 1;
  toolVersion: string;
  nodeVersion: string;
  operation: 'verify';
  status: 'PASS';
  startedAt: string;
  finishedAt: string;
  package: { path: string; bytes: number; sha256: string; packageId: string };
  contentFingerprint: string;
  canonicalBytes: number;
  resourceCount: number;
  totalRawBytes: number;
  limits: PackageLimits;
  checks: Record<'portableManifest' | 'safeArchive' | 'rawInventory' | 'fingerprint' | 'supportedProfile' | 'nestedReferences', 'PASS'>;
  profile: Record<string, unknown>;
  extraction: null | { directory: string; resourceCount: number; hashesCompared: number; status: 'PASS' };
  manifest: PortableManifest;
  resources: (ManifestResource & { verifiedSha256: string })[];
  limitations: string[];
}

export type VersionState = 'staging' | 'validating' | 'ready' | 'failed';
export type ModelHealth = 'unchecked' | 'healthy' | 'unavailable';
export type ImportState = 'receiving' | 'staging' | 'validating' | 'publishing' | 'complete' | 'failed';
export interface ModelFailure { code: string; message: string }

export interface VersionRecord {
  id: string;
  projectId: string;
  packageId: string;
  contentFingerprint: string;
  label: string;
  source: ModelSource;
  schemaVersion: 1;
  supportProfile: PortableManifest['supportProfile'];
  format: 'svf';
  sdkVersion: '7.130.0';
  entrypoint: PortableManifest['entrypoint'];
  preparedAt: string;
  importedAt: string | null;
  importedBy: string;
  state: VersionState;
  health: ModelHealth;
  resourceCount: number;
  totalBytes: number;
  validationReportId: string | null;
  failure: ModelFailure | null;
  manifest: PortableManifest;
  storagePrefix: string;
  ownerImportId: string;
}

export interface ImportRecord {
  id: string;
  projectId: string;
  requestedBy: string;
  idempotencyKey: string;
  archiveSha256: string;
  expectedBytes: number | null;
  ownerToken: string;
  receivedBytes: number;
  state: ImportState;
  modelVersionId: string | null;
  failure: ModelFailure | null;
  verificationReport: VerificationReport | null;
  duplicate: boolean;
  cleanedAt: string | null;
  stagingCleanedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StorageOwnership {
  importId: string;
  projectId: string;
  modelVersionId: string;
  storagePrefix: string;
  ownerToken: string;
  published: boolean;
  cleanedAt: string | null;
  createdAt: string;
}

export interface SelectionRecord {
  projectId: string;
  activeModelVersionId: string | null;
  selectionRevision: number;
  updatedAt: string;
}

export type ModelVersionDto = Omit<VersionRecord, 'manifest' | 'storagePrefix' | 'ownerImportId'>;
export type ImportDto = Pick<ImportRecord, 'id' | 'projectId' | 'requestedBy' | 'state' | 'modelVersionId' | 'failure' | 'receivedBytes' | 'expectedBytes' | 'duplicate' | 'createdAt' | 'updatedAt'>;

export function toVersionDto(version: VersionRecord): ModelVersionDto {
  return {
    id: version.id, projectId: version.projectId, packageId: version.packageId,
    contentFingerprint: version.contentFingerprint, label: version.label, source: { ...version.source },
    schemaVersion: version.schemaVersion, supportProfile: version.supportProfile, format: version.format,
    sdkVersion: version.sdkVersion, entrypoint: version.entrypoint, preparedAt: version.preparedAt,
    importedAt: version.importedAt, importedBy: version.importedBy, state: version.state, health: version.health,
    resourceCount: version.resourceCount, totalBytes: version.totalBytes,
    validationReportId: version.validationReportId, failure: version.failure ? { ...version.failure } : null,
  };
}

export function toImportDto(job: ImportRecord): ImportDto {
  return {
    id: job.id, projectId: job.projectId, requestedBy: job.requestedBy, state: job.state,
    modelVersionId: job.modelVersionId, failure: job.failure ? { ...job.failure } : null,
    receivedBytes: job.receivedBytes, expectedBytes: job.expectedBytes, duplicate: job.duplicate,
    createdAt: job.createdAt, updatedAt: job.updatedAt,
  };
}
