import { sha, PROJECT, fail } from './corpus.mjs';
import { validateWfcFacts } from './wfc-baseline.mjs';

const limit = 32 * 1024 * 1024;

export function initLocalReports(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS wfc_fact_snapshots (
    id TEXT PRIMARY KEY, captured_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS joint_reports (
    id TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
}

export async function importFacts(db, input) {
  const chunks = [];
  let length = 0;
  for await (const chunk of input) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) fail('WFC_SNAPSHOT_TOO_LARGE');
    chunks.push(bytes);
  }
  let facts;
  try { facts = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { fail('WFC_SNAPSHOT_JSON_INVALID'); }
  validateWfcFacts(facts, { projectId: PROJECT });
  const payload = JSON.stringify(facts);
  const id = sha(payload);
  db.prepare('INSERT OR IGNORE INTO wfc_fact_snapshots VALUES (?,?,?)').run(id, facts.capturedAt, payload);
  return { factsId: id, capturedAt: facts.capturedAt, cables: facts.cables.length, endpointNames: facts.endpoints.length };
}

export function latestFacts(db) {
  const row = db.prepare('SELECT id,payload FROM wfc_fact_snapshots ORDER BY captured_at DESC,id DESC LIMIT 1').get();
  if (!row) fail('WFC_FACT_SNAPSHOT_REQUIRED');
  if (sha(row.payload) !== row.id) fail('WFC_SNAPSHOT_CORRUPT');
  const facts = JSON.parse(row.payload);
  validateWfcFacts(facts, { projectId: PROJECT });
  return { id: row.id, facts };
}

export function saveReport(db, report) {
  const payload = JSON.stringify(report);
  const id = sha(payload);
  db.prepare('INSERT OR IGNORE INTO joint_reports VALUES (?,?)').run(id, payload);
  return id;
}

export function readReport(db, id) {
  if (!/^[0-9a-f]{64}$/.test(id)) fail('ANALYSIS_REPORT_ID_REQUIRED');
  const row = db.prepare('SELECT payload FROM joint_reports WHERE id=?').get(id);
  if (!row || sha(row.payload) !== id) fail('ANALYSIS_REPORT_MISSING_OR_CORRUPT');
  return JSON.parse(row.payload);
}
