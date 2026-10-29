// Closed, public diagnostics only. SDK messages, object names and geometry never
// cross the frame boundary as error text.
export const BARRIER_CAPTURE_ERROR_MESSAGES = Object.freeze({
  BARRIER_CAPTURE_HIERARCHY_LIMIT: 'The selected object hierarchy exceeds the capture limit. Select smaller obstacle groups before starting a new capture.',
  BARRIER_CAPTURE_FRAGMENT_LIMIT: 'The selected objects contain too many geometry fragments. Select a smaller obstacle set before starting a new capture.',
  BARRIER_CAPTURE_VERTEX_LIMIT: 'The selected geometry exceeds the vertex limit. Select a smaller obstacle set before starting a new capture.',
  BARRIER_CAPTURE_TRIANGLE_LIMIT: 'The selected geometry exceeds the triangle limit. Select a smaller obstacle set before starting a new capture.',
  BARRIER_CAPTURE_PAYLOAD_LIMIT: 'The selected geometry exceeds the capture data limit. Select a smaller obstacle set before starting a new capture.',
  BARRIER_CAPTURE_GEOMETRY_NOT_READY: 'The selected geometry could not be read or verified for obstacle capture. Check the selected objects and capture details.',
  BARRIER_CAPTURE_TREE_UNAVAILABLE: 'The model hierarchy could not be read for obstacle capture. A visible model does not confirm that its hierarchy is available.',
  BARRIER_CAPTURE_IDENTITY_UNAVAILABLE: 'The selected objects\' external identities could not be verified. Check the selection and model properties before capturing obstacles.',
  BARRIER_CAPTURE_EMPTY_SELECTION: 'A selected object has no geometry fragments in its hierarchy. Choose obstacle objects that contain geometry.',
  BARRIER_CAPTURE_GEOMETRY_NOT_RESIDENT: 'Geometry data for a selected object is unavailable in the current viewer. Obstacle capture requires its mesh data.',
  BARRIER_CAPTURE_GEOMETRY_BECAME_UNAVAILABLE: 'Geometry data became unavailable before the final obstacle check. The obstacle set was not completed.',
  BARRIER_CAPTURE_UNSUPPORTED_PRIMITIVE: 'The selected objects include unsupported geometry. Choose objects with triangle geometry before starting a new capture.',
  BARRIER_CAPTURE_FRAME_UNSUPPORTED: 'The model coordinate frame is unsupported for barrier capture. Prepare a supported model frame before capturing obstacles.',
  BARRIER_CAPTURE_MODEL_CHANGED: 'The model changed during barrier capture. Reload the model and select its obstacle objects again.',
  BARRIER_CAPTURE_INVALID: 'The selected obstacle geometry could not be verified. Check the selected objects before retrying the saved command.',
  BARRIER_CAPTURE_DEADLINE: 'Reading the selected obstacle geometry timed out. Select a smaller obstacle set before starting a new capture.',
});
export const BARRIER_CAPTURE_ERROR_CODES = Object.freeze(Object.keys(BARRIER_CAPTURE_ERROR_MESSAGES));
export function barrierCaptureErrorMessage(code) {
  return typeof code === 'string' && Object.hasOwn(BARRIER_CAPTURE_ERROR_MESSAGES, code)
    ? BARRIER_CAPTURE_ERROR_MESSAGES[code] : null;
}
