export type RoutingBindings = Readonly<{
  schemaVersion: 'wfc.viewer.routing-bindings.v1' | 'wfc.viewer.routing-bindings.v2'; modelVersionId: string; contentFingerprint: string;
  selectionRevision: string; aggregateId: string | null;
  bindings: ReadonlyArray<Readonly<{ routeName: string; rootObjectIds: ReadonlyArray<string> }>>;
  cadBindings?: ReadonlyArray<Readonly<{ routeName: string; paths: ReadonlyArray<Readonly<{ pointsMetres: ReadonlyArray<ReadonlyArray<number>>; widthMetres: number }>> }>>;
}>;
export const ROUTING_BINDINGS_LIMITS: Readonly<{ maps: 128; roots: 512; bytes: number; cadBytes: number; cadPaths: number; cadPoints: number }>;
export function parseRoutingBindings(value: unknown, descriptor: { modelVersionId: string; contentFingerprint: string }, selectionRevision?: string, requestedKeys?: readonly string[]): RoutingBindings | null;
