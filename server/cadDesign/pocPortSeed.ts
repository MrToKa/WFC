import { getAalborgPocPorts } from '../../shared/cadPocPorts.js';

/** Admit only connection ports from exactly verified STEP content hashes. */
export function cadPocPortSeeds(filename: string, sha256: string) {
  return getAalborgPocPorts(filename, sha256).map(port => ({
    name: port.id,
    portType: `cable-ladder-${port.profile}`,
    localTransform: port.local,
  }));
}
