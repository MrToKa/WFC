import { createHash } from 'node:crypto';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ensure = (ok, code) => { if (!ok) throw Object.assign(Error(code), { code }); };
/** Reject authentication material, including JSON embedded in recorded HTTP bodies. */
export function assertNoAuth(value) {
  let nodes = 0;
  function walk(v, depth) {
    ensure(++nodes < 500000 && depth <= 64, 'PROVENANCE_SCAN_BOUND');
    if (typeof v === 'string') {
      ensure(!/\bBearer\s+\S+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|wfc_viewer_session=/i.test(v), 'PROVENANCE_AUTH_VALUE');
      if (/^\s*[\[{]/.test(v)) { let parsed; try { parsed = JSON.parse(v); } catch { return; } walk(parsed, depth + 1); }
    } else if (v && typeof v === 'object') {
      for (const [key, child] of Object.entries(v)) {
        ensure(!/^(?:password|token|accessToken|refreshToken|bearer|cookie|authorization|jwtSecret|databasePassword|storagePassword|secret|secretSha256|settings|credentials)$/i.test(key), 'PROVENANCE_AUTH_KEY');
        walk(child, depth + 1);
      }
    }
  }
  walk(value, 0); return true;
}
export function validateChain(intentBytes, events, directory, expected) {
  ensure(Array.isArray(events) && events.length === 67 && expected.events === 67, 'PROVENANCE_EVENT_COUNT');
  let previous = sha(intentBytes), total = intentBytes.length; const records = [];
  for (let i = 0; i < events.length; i++) {
    const { name, bytes } = events[i], e = JSON.parse(bytes);
    ensure(name === 'event-' + String(i).padStart(4, '0') + '.private.json' && e.schemaVersion === 'pathfinder.copied-project.import-event.v1' && e.sequence === i && e.previousSha256 === previous, 'PROVENANCE_CHAIN');
    previous = sha(bytes); total += bytes.length;
    records.push({ path: directory + '/' + name, bytes: bytes.length, sha256: previous });
  }
  ensure(previous === expected.finalSha256 && total === expected.bytes && sha(JSON.stringify(records)) === expected.recordsSha256 && sha(intentBytes) === expected.intent.sha256, 'PROVENANCE_CHAIN_PIN');
  return { events: events.length, bytes: total, finalSha256: previous, recordsSha256: sha(JSON.stringify(records)) };
}
