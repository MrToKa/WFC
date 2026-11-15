import type { CableRoutingControl } from './cableRoutingControl.js';

/** Display projection only; writes use revision-aware authenticated commands. */
export type CableRoutingReadView = {
  routingControl: CableRoutingControl; routingControlRevision: string; cableWriteRevision: string;
  autoCalculatedRouting: string | null; autoRoutingStatus: string; autoRoutingCalculatedAt: string | null;
  manualRouteLength: number | null; manualRouteLengthStatus: 'not-calculated' | 'pending' | 'stale' | 'calculated' | 'invalid';
  routingDiagnostics: string[];
};
