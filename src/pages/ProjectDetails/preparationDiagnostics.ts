import type { PreparationContext, PreparationPlan } from '../../../shared/pathfinderPreparation';

type PreparationDiagnostic = PreparationPlan['diagnostics'][number];
type Tray = Pick<PreparationContext['trays'][number], 'projectTrayId' | 'rawName'>;
export type FormattedPreparationDiagnostic = { code: string; message: string; trayIds: string[]; trayNames: string[] };

const instructions: Record<string, string> = {
  PURPOSE_UNCONFIGURED: 'Routing permissions are missing. Set the purpose permissions in Project Details, then discover the trays again.',
  TRAY_POLICY_INVALID: 'The tray name or purpose is invalid or conflicts with another tray. Review the tray details in Project Details, then discover again.',
  TRAY_ROOT_MISSING: 'No matching model tray was found. Select the physical tray in the model and use its current selection to assign it.',
  TRAY_ROOT_AMBIGUOUS: 'More than one matching model tray was found. Select the intended physical tray and use its current selection to assign it.',
  NON_LEAF_ROUTING_GEOMETRY: 'An assigned parent object has its own geometry. Review the model hierarchy and assign the physical tray objects before discovering again.',
  TRAY_GEOMETRY_MISSING: 'The assigned model objects contain no usable tray geometry. Select physical tray objects with geometry and assign them again.',
  NO_AUTHORIZED_ROUTING_GEOMETRY: 'No usable tray geometry was found. Assign model objects to at least one tray with routing permissions, then discover again.',
  ENDPOINT_DISCOVERY_INCOMPLETE: 'The requested From/To discovery is incomplete. Repeat discovery for this preparation scope and wait for the model property search to finish.',
};

/** Explain saved plan diagnostics without changing the immutable plan or its hash. */
export function formatPreparationDiagnostics(
  diagnostics: readonly PreparationDiagnostic[],
  trays: readonly Tray[],
): FormattedPreparationDiagnostic[] {
  const names = new Map(trays.map(tray => [tray.projectTrayId, tray.rawName]));
  const groups = new Map<string, { trayIds: Set<string>; messages: Set<string> }>();
  for (const diagnostic of diagnostics) {
    const group = groups.get(diagnostic.code) ?? { trayIds: new Set<string>(), messages: new Set<string>() };
    diagnostic.projectTrayIds.forEach(id => group.trayIds.add(id));
    if (diagnostic.message.trim()) group.messages.add(diagnostic.message.trim());
    groups.set(diagnostic.code, group);
  }
  return [...groups].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([code, group]) => {
    const trayIds = [...group.trayIds].sort((left, right) =>
      (names.get(left) ?? left).localeCompare(names.get(right) ?? right, 'en', { numeric: true })
      || (left < right ? -1 : left > right ? 1 : 0));
    const trayNames = trayIds.map(id => names.get(id) ?? id);
    const explanation = instructions[code]
      ?? `${[...group.messages].sort().join(' ') || 'Preparation requires attention.'} (${code}).`;
    return { code, trayIds, trayNames,
      message: explanation + (trayNames.length ? ` Affected trays: ${trayNames.join(', ')}.` : '') };
  });
}
