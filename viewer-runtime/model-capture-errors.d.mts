export const MODEL_CAPTURE_ERROR_MESSAGES: Readonly<Record<string, string>>;
export function modelCaptureErrorMessage(code: unknown): string | null;
export function modelCaptureErrorContext(value: unknown): { objectId?: number; fragmentId?: number };
