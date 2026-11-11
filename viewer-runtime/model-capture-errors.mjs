// Public allowlisted diagnostics. Never forward SDK text, names or geometry.
export const MODEL_CAPTURE_ERROR_MESSAGES = Object.freeze({
  MODEL_CAPTURE_INVALID: 'The selected model data did not pass capture validation. Check the reported object and retry preparation.',
  MODEL_CAPTURE_GEOMETRY_NOT_RESIDENT: 'Mesh data for a selected tray is unavailable in the viewer. Reload the model and retry the retained preparation.',
  MODEL_CAPTURE_INVALID_GEOMETRY: 'A selected tray contains incomplete or invalid triangle geometry. Check its assigned model objects and export.',
  MODEL_CAPTURE_FRAGMENT_LIMIT: 'This preparation part exceeds the geometry fragment limit. Prepare smaller tray groups.',
  MODEL_CAPTURE_VERTEX_LIMIT: 'This preparation part exceeds the vertex limit. Prepare smaller tray groups.',
  MODEL_CAPTURE_TRIANGLE_LIMIT: 'This preparation part exceeds the triangle limit. Prepare smaller tray groups.',
  MODEL_CAPTURE_PAYLOAD_LIMIT: 'This preparation part exceeds the capture data or response limit. Prepare smaller tray groups.',
  MODEL_CAPTURE_PROPERTY_LIMIT: 'A selected object exceeds the property capture limit. Check its model properties.',
  MODEL_CAPTURE_SDK_TIMEOUT: 'The viewer did not finish reading selected model data within 45 seconds. Retry preparation.',
  MODEL_CAPTURE_SDK_FAILED: 'The viewer could not read selected model data. Reload the model and retry preparation.',
  MODEL_CAPTURE_DEADLINE: 'This preparation part exceeded its five-minute capture deadline. Prepare smaller tray groups.',
  MODEL_CAPTURE_MODEL_CHANGED: 'The active model changed during capture. Reload the current model and discover the trays again.',
});
export function modelCaptureErrorMessage(code) {
  return typeof code === 'string' && Object.hasOwn(MODEL_CAPTURE_ERROR_MESSAGES, code) ? MODEL_CAPTURE_ERROR_MESSAGES[code] : null;
}
export function modelCaptureErrorContext(value) {
  const result = {};
  for (const key of ['objectId', 'fragmentId']) if (Number.isSafeInteger(value?.[key]) && value[key] >= 0 && value[key] <= 2147483647) result[key] = value[key];
  return result;
}
