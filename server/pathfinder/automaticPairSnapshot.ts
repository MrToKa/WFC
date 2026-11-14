import { automaticPairMaterialStateSchema, automaticPairMaterialObservationSchema, type AutomaticPairMandate,
  type AutomaticPairMaterialState } from '../../shared/pathfinderAutomaticPair.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';

type Row = Record<string, any>;
type Policy = AutomaticPairMandate['baselinePolicy'];
const same = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);

/** PostgreSQL snapshots retain microseconds; Date.parse alone loses the last
 * three digits and cannot enforce the lineage's exact timestamp bounds. */
function snapshotTimestamp(value: unknown): bigint | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const milliseconds = Date.parse(parts[1] + 'Z');
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 19) !== parts[1]) return null;
  const zone = parts[3], hours = zone === 'Z' ? 0 : Number(zone.slice(1, 3)), minutes = zone === 'Z' ? 0 : Number(zone.slice(4));
  if (hours > 23 || minutes > 59) return null;
  const offset = BigInt((hours * 60 + minutes) * (zone[0] === '-' ? -1 : 1));
  return BigInt(milliseconds) * 1000n + BigInt((parts[2] ?? '').padEnd(6, '0')) - offset * 60_000_000n;
}
export function automaticPairMaterialState(snapshot: Row): AutomaticPairMaterialState | null {
  const parsed = automaticPairMaterialStateSchema.safeParse({ initialized: snapshot.materials_initialized,
    customized: snapshot.materials_customized, updatedAt: snapshot.updated_at });
  return parsed.success && snapshotTimestamp(parsed.data.updatedAt) !== null ? parsed.data : null;
}
function materialStateContinues(previous: AutomaticPairMaterialState, before: AutomaticPairMaterialState, authorizedAt: string): boolean {
  if (same(previous, before)) return true;
  const from = snapshotTimestamp(previous.updatedAt), to = snapshotTimestamp(before.updatedAt), limit = snapshotTimestamp(authorizedAt);
  return !previous.customized && !before.customized && before.initialized
    && from !== null && to !== null && limit !== null && from <= to && to <= limit;
}
/** Explicit engineering snapshots omit only the incidental fields whose exact
 * observations are retained separately. Every business/unknown field remains. */
export function automaticPairBaselineSnapshot(snapshot: Row, policy: Policy): Row {
  if (!policy) return snapshot;
  const { materials_initialized: _initialized, updated_at: _updated, ...engineering } = snapshot;
  return engineering;
}
export function automaticPairMaterialBaselineCurrent(policy: Policy, before: Row, authorizedAt: string): boolean {
  if (!policy) return true;
  const observed = automaticPairMaterialState(before);
  return observed !== null && materialStateContinues(policy.materials, observed, authorizedAt);
}
export function automaticPairMaterialObservation(policy: Policy, before: Row, after: Row, authorizedAt: string) {
  if (!policy) return undefined;
  const observedBefore = automaticPairMaterialState(before), observedAfter = automaticPairMaterialState(after);
  if (!observedBefore || !observedAfter) return null;
  const observation = { schemaVersion: 'wfc.pf.automatic-pair-material-observation.v1' as const, before: observedBefore, after: observedAfter };
  return validAutomaticPairMaterialObservation(policy, automaticPairBaselineSnapshot(before, policy),
    automaticPairBaselineSnapshot(after, policy), observation, authorizedAt) ? observation : null;
}
export function validAutomaticPairMaterialObservation(policy: Policy, before: Row, after: Row, raw: unknown, authorizedAt: string): boolean {
  if (!policy) return raw === undefined;
  const parsed = automaticPairMaterialObservationSchema.safeParse(raw);
  if (!parsed.success || [before, after].some(value => Object.hasOwn(value, 'materials_initialized') || Object.hasOwn(value, 'updated_at'))) return false;
  const observed = parsed.data, from = snapshotTimestamp(observed.before.updatedAt), to = snapshotTimestamp(observed.after.updatedAt), limit = snapshotTimestamp(authorizedAt);
  return materialStateContinues(policy.materials, observed.before, authorizedAt)
    && before.materials_customized === observed.before.customized && after.materials_customized === observed.after.customized
    && observed.before.initialized === observed.after.initialized && observed.before.customized === observed.after.customized
    && from !== null && to !== null && limit !== null && from <= to && to <= limit;
}
export function automaticPairObservedSnapshot(snapshot: Row, state?: AutomaticPairMaterialState): Row {
  return state ? { ...snapshot, materials_initialized: state.initialized, updated_at: state.updatedAt } : snapshot;
}
/** Default material initialization/synchronization touches its nonengineering
 * flag and timestamp. Keep all other values and receipt/history lineage exact. */
export function continuesAutomaticSnapshot(previous: Row, before: Row, authorizedAt: string): boolean {
  if (same(previous, before)) return true;
  const old = automaticPairMaterialState(previous), current = automaticPairMaterialState(before);
  return old !== null && current !== null && materialStateContinues(old, current, authorizedAt)
    && same(Object.keys(previous).sort(), Object.keys(before).sort())
    && Object.keys(previous).every(key => key === 'materials_initialized' || key === 'updated_at' || same(previous[key], before[key]));
}
