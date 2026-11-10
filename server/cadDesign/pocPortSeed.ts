import { getAalborgPocPorts } from '../../src/viewer/pocConnectorCatalog.js';

/**
 * Only the exact two user-supplied STEP binaries have measured PoC anchors.
 * Unrecognized source hashes deliberately receive no automatic snap ports.
 */
export function cadPocPortSeeds(filename: string, sha256: string) {
  return getAalborgPocPorts(filename, sha256).map(port => ({
    name: port.id,
    portType: `cable-ladder-${port.profile}`,
    localTransform: port.local,
  }));
}
