import { TABLES, canonical, sourceProjectionHashes } from './source-lib.mjs';
const need = (ok, code) => { if (!ok) throw Object.assign(Error(code), { code }); };
export function validatePlanInputs(plan, source, expectedSourceRef, seedPlan, expectedSeedRef) {
  need(canonical(plan.source.ref) === canonical(expectedSourceRef) && canonical(plan.seed.ref) === canonical(expectedSeedRef), 'CATALOG_PLAN_INPUT_REF');
  need(plan.source.projectionSha256 === sourceProjectionHashes(source).sha256, 'CATALOG_PLAN_SOURCE_HASH');
  need(canonical(plan.seed.types) === canonical(seedPlan.types), 'CATALOG_PLAN_SEED_MAP');
  need(plan.projectDrawing?.sourceRowText === source.project.rowText && plan.projectDrawing.targetExpectedRowText === plan.baseline.projectRowText && canonical(plan.projectDrawing.columns) === canonical(['support_distance', 'support_weight', 'tray_load_safety_factor', 'cable_layout_settings']), 'CATALOG_PLAN_PROJECT_DRAWING');
  let count = 0;
  const ordered = rows => [...rows].sort((a, b) => canonical(a.key).localeCompare(canonical(b.key), 'en'));
  for (const table of TABLES) {
    const actual = plan.rows.filter(row => row.table === table.table).map(row => ({ key: row.sourceKey, rowText: row.sourceRowText }));
    const expected = source.groups[table.table].rows;
    need(canonical(ordered(actual)) === canonical(ordered(expected)), 'CATALOG_PLAN_SOURCE_ROWS');
    count += actual.length;
  }
  need(count === plan.rows.length, 'CATALOG_PLAN_EXTRA_TABLE'); return plan;
}
export function validateFileIntent(intent, manifest, owner) {
  need(intent?.owner === owner && manifest && intent.prefix === manifest.prefix && Array.isArray(intent.entries) && Array.isArray(manifest.entries) && intent.entries.length === manifest.entries.length && intent.entries.every((entry, i) => entry && manifest.entries[i] && ['table', 'sourceId', 'targetId', 'sourceObjectKey', 'targetObjectKey', 'bytes', 'sha256'].every(key => entry[key] === manifest.entries[i][key])), 'CATALOG_FILE_INTENT_CHANGED');
  return intent;
}
