const messages: Record<string, string> = {
  IDEMPOTENCY_CONFLICT: 'The request key is already bound to another package.',
  PACKAGE_ID_CONFLICT: 'The package identity conflicts with an existing package.',
  PROVENANCE_CONFLICT: 'The content fingerprint has conflicting source provenance.',
  MODEL_NOT_FOUND: 'The model version does not exist in this project.',
  PROJECT_NOT_FOUND: 'The project no longer exists.',
  IMPORT_NOT_FOUND: 'The import no longer exists.',
  IMPORT_FENCED: 'The import is no longer owned by this worker.',
  IMPORT_STATE_CONFLICT: 'The import cannot make this state transition.',
  MODEL_NOT_SELECTABLE: 'Only a ready and healthy model can be selected.',
  VERSION_NOT_READY: 'The model version has not been published.',
  SELECTION_CONFLICT: 'The model selection changed. Reload it before saving.',
  VERIFICATION_FAILED: 'The package has no complete successful verification.',
  UNSUPPORTED_SCHEMA: 'The package schema version is unsupported.',
  UNSUPPORTED_PROFILE: 'The package model profile is unsupported.',
  INVALID_MANIFEST: 'The package archive or manifest is invalid.',
  UNSAFE_PATH: 'The package contains an unsafe path.',
  EXECUTABLE_CONTENT: 'The package contains executable content.',
  EXTERNAL_REFERENCE: 'The package contains an external reference.',
  RESOURCE_MISSING: 'The package is missing a required resource.',
  RESOURCE_UNEXPECTED: 'The package contains an unexpected resource.',
  RESOURCE_HASH_MISMATCH: 'A package resource failed its SHA-256 check.',
  RESOURCE_SIZE_MISMATCH: 'A package resource failed its size check.',
  FINGERPRINT_MISMATCH: 'The package content fingerprint does not match.',
  RESOURCE_CHANGED: 'A package resource changed during verification.',
  PACKAGE_LIMIT_EXCEEDED: 'The package exceeds a verification limit.',
  STORAGE_EXHAUSTED: 'The import staging storage has insufficient capacity.',
  STORAGE_READBACK_FAILED: 'Stored resources did not match the verified inventory.',
  INVALID_IMPORT_REQUEST: 'The import request is invalid.',
  IMPORT_INTERRUPTED: 'The import was interrupted before publication.',
  UPLOAD_LIMIT: 'The package exceeds the upload limit.',
  UPLOAD_HASH_MISMATCH: 'The uploaded archive does not match its declared SHA-256.',
  UPLOAD_INTERRUPTED: 'The package upload was interrupted.',
  IMPORT_BUSY: 'Another import owns this package content.',
  STORAGE_UNAVAILABLE: 'Private model storage is unavailable.',
  MODEL_UNAVAILABLE: 'The model resources are unavailable.',
  INVALID_CONTENT_TYPE: 'The request must contain a ZIP package.',
  UPLOAD_TIMEOUT: 'The package upload exceeded its time limit.',
  IMPORT_ACCESS_REVOKED: 'The requesting account no longer has project editing access.',
  REGISTRY_FAILURE: 'The model registry operation failed.',
};

export class ModelRegistryError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(messages[code] ?? messages.REGISTRY_FAILURE);
    this.name = 'ModelRegistryError';
    this.code = Object.hasOwn(messages, code) ? code : 'REGISTRY_FAILURE';
    this.status = status;
  }
}
