// Transport packing only: the underlying capture events and their budgets stay
// unchanged. Leave ample space for the authenticated envelope's identity fields.
export const MODEL_CAPTURE_BATCH_EVENTS = 32;
export const MODEL_CAPTURE_BATCH_BYTES = 60 * 1024;
const encoder = new TextEncoder();
export const capturePacketBytes = value => encoder.encode(JSON.stringify(value)).byteLength;
export const validCaptureEventJson = value => typeof value === 'string' && value.length <= 49152 && encoder.encode(value).byteLength <= 24576;
export const validCaptureBatch = value => Array.isArray(value.eventJsons) && value.eventJsons.length >= 1
  && value.eventJsons.length <= MODEL_CAPTURE_BATCH_EVENTS && value.index + value.eventJsons.length <= 3000
  && value.eventJsons.every(validCaptureEventJson) && capturePacketBytes(value) <= MODEL_CAPTURE_BATCH_BYTES;
