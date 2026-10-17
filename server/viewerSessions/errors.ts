const messages: Record<string, string> = {
  INVALID_VIEWER_REQUEST: 'Invalid 3D viewer request.',
  LOGIN_REFRESH_REQUIRED: 'Sign in again to open the 3D model.',
  AUTH_REQUIRED: 'A valid sign-in is required.',
  SESSION_NOT_FOUND: 'The model session was not found.',
  SESSION_EXPIRED: 'The model session has expired.',
  SESSION_REVOKED: 'The model session has been revoked.',
  ACCESS_REVOKED: 'Access to this project has been revoked.',
  PROJECT_NOT_FOUND: 'The project was not found.',
  MODEL_SELECTION_CHANGED: 'The selected model has changed. Reload the viewer.',
  MODEL_UNAVAILABLE: 'The verified model is unavailable.',
  RESOURCE_NOT_FOUND: 'The model resource was not found.',
  RESOURCE_FAILED: 'The model resource failed verification.',
  VIEWER_ORIGIN_DENIED: 'The request is not from an allowed WFC origin.',
  METHOD_NOT_ALLOWED: 'This method is not allowed for this resource.',
  RANGE_NOT_SATISFIABLE: 'Invalid byte range.',
  VIEWER_BUSY: 'Please wait for the current resource reads to finish.',
  VIEWER_STOPPED: 'The 3D service is shutting down.',
  STORAGE_EXHAUSTED: 'There is not enough free space to verify the resource.',
  VIEWER_FAILURE: 'The 3D resource could not be opened.',
};
export class ViewerSessionError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(messages[code] ?? messages.VIEWER_FAILURE);
    this.name = 'ViewerSessionError';
  }
}
export const viewerError = (error: unknown): ViewerSessionError => error instanceof ViewerSessionError
  ? error : new ViewerSessionError('VIEWER_FAILURE', 500);
