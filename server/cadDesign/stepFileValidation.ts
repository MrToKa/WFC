import path from 'node:path';

// Existing nginx /api/ limit is 10 MiB; leave room for multipart framing.
export const MAX_STEP_BYTES = 8 * 1024 * 1024;

/**
 * Cheap fail-closed STEP Part-21 envelope preflight, NOT a CAD parser.
 * A successful result must still pass an OCCT sandbox conversion before
 * it can become a renderable/snap-able catalogue item.
 */
export function hasStepEnvelope(filename: string, bytes: Buffer): boolean {
  const extension = path.extname(filename).toLowerCase();
  if (!['.stp', '.step'].includes(extension) || bytes.length < 40 || bytes.length > MAX_STEP_BYTES) {
    return false;
  }
  const header = bytes.subarray(0, 512).toString('ascii').trimStart();
  const tail = bytes.subarray(Math.max(0, bytes.length - 512)).toString('ascii').trimEnd();
  return header.startsWith('ISO-10303-21;') && /END-ISO-10303-21;\s*$/i.test(tail);
}

export function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  // Escape spreadsheet formula injection even after leading whitespace.
  const guarded = /^[\s\u0000-\u001f]*[=+\-@]/u.test(raw) ? '\'' + raw : raw;
  return '"' + guarded.replaceAll('"', '""') + '"';
}
