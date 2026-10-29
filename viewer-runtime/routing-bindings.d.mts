export type RoutingBindings = Readonly<{
  schemaVersion: 'wfc.viewer.routing-bindings.v1'; modelVersionId: string; contentFingerprint: string;
  selectionRevision: string; aggregateId: string | null;
  bindings: ReadonlyArray<Readonly<{ routeName: string; rootObjectIds: ReadonlyArray<string> }>>;
}>;
export const ROUTING_BINDINGS_LIMITS: Readonly<{ maps: 128; roots: 512; bytes: number }>;
export function parseRoutingBindings(value: unknown, descriptor: { modelVersionId: string; contentFingerprint: string }, selectionRevision?: string): RoutingBindings | null;
