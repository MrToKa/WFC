import { CoreError } from '../index.mjs';
export const MESSAGES = Object.freeze({
  INVALID_REQUEST: 'The request is invalid.', ORIGIN_DENIED: 'The request origin is not allowed.',
  HOST_DENIED: 'The request host is not allowed.', CSRF_DENIED: 'The local request token is missing or invalid.',
  REQUEST_CONFLICT: 'This request identity belongs to a different operation.', OPERATION_BUSY: 'Another operation is active.',
  NOT_FOUND: 'The requested local item is unavailable.', UPLOAD_INVALID: 'The upload name or type is invalid.',
  UPLOAD_LIMIT: 'The upload exceeds the supported size limit.', UPLOAD_INTERRUPTED: 'The upload did not complete.',
  STORE_CORRUPT: 'Service state is corrupt; work is blocked.', LOCK_BUSY: 'Another or ambiguous service owner holds the data.',
  CLOUD_CLOSED: 'Live APS preparation is blocked: verified current zero-cost allowance is missing.',
  SIMULATION_ONLY: 'This action is available only in simulation mode.', ACTION_NOT_ALLOWED: 'This action is not allowed for the current state.',
  ARTIFACT_INVALID: 'The package or verified resource changed or failed validation.', PREVIEW_NOT_READY: 'Prepare the verified preview first.',
  SDK_UNAVAILABLE: 'The local Viewer SDK is unavailable.', LOCAL_ABORTED: 'Local work stopped; remote cancellation is not implied.',
  OPERATION_INTERRUPTED: 'The operation was interrupted by restart; it was not replayed.',
  PROVIDER_FAILURE: 'The operation did not return a usable result.', SOURCE_CHANGED: 'The selected source changed.',
  PROVIDER_RESPONSE_INVALID: 'The provider response does not match the supported model contract.',
  UNSUPPORTED_PROFILE: 'This model derivative is outside the supported offline SVF profile.',
  DOWNLOAD_INVALID: 'The resource download plan is invalid.', DOWNLOAD_PLAN_CHANGED: 'The resource plan changed; resuming this download is blocked.',
  PACKAGE_LIMIT_EXCEEDED: 'The operation exceeds a supported resource limit.',
  STORE_WRITE_FAILED: 'The local state could not be saved.', LOCK_OWNER_MISMATCH: 'The local state owner changed; work is blocked.',
  SNAPSHOT_CHANGED: 'The captured source bytes changed.', IDENTITY_MISMATCH: 'The immutable identity does not match.',
  COST_BLOCKED: 'Current verified zero-cost evidence is required.', SUBMISSION_UNKNOWN: 'The submission outcome is unknown; reconcile without resubmitting.',
  COST_EXPIRED: 'The cost and remaining allowance review has expired. A new current review is required before cloud requests.',
  DERIVATIVE_FAILED: 'The derivative failed; automatic forced retry is disabled.', DERIVATIVE_PENDING: 'The derivative is still pending.',
  DERIVATIVE_AMBIGUOUS: 'Select one compatible derivative root.', READ_LIMIT: 'The bounded read ended; the derivative may still be pending.',
  DOWNLOAD_INCOMPLETE: 'The model download is incomplete.', UNSAFE_PATH: 'The local path is outside the permitted boundary.',
  SHUTTING_DOWN: 'The local service is stopping.',
  NO_SPACE: 'There is not enough local disk space to complete this operation.',
  JOB_MISSING: 'The requested local job is unavailable.', PACKAGE_ADAPTER_FAILURE: 'The package failed local validation.',
});
export class ServiceError extends Error { constructor(code, status = 400) { super(MESSAGES[code] || MESSAGES.PROVIDER_FAILURE); this.code = code; this.status = status; } }
export function bad(code, status) { throw new ServiceError(code, status); }
export function safeError(error) {
  if (error?.code === 'ENOSPC' || error?.code === 'EDQUOT') return { code: 'NO_SPACE', message: MESSAGES.NO_SPACE };
  const trusted = error instanceof ServiceError || error instanceof CoreError;
  const code = trusted && Object.hasOwn(MESSAGES, error.code) ? error.code : 'PROVIDER_FAILURE';
  return { code, message: MESSAGES[code] };
}
