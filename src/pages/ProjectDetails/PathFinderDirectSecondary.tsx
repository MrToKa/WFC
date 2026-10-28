import type { DirectSecondaryDecision } from '../../../shared/pathfinderDirectSecondary';

/** Recorded C# decision only. This display never calculates or authorizes a cable write. */
export function PathFinderDirectSecondary({ decision }: { decision?: DirectSecondaryDecision | null }) {
  if (!decision) return null;
  return <section aria-label="Direct SECONDARY decision">
    <h5>{decision.mode === 'direct-secondary' ? 'Direct SECONDARY connection' : 'Tray network route'}</h5>
    <p>From to To: {decision.distanceMeters} m. Nearest eligible tray from From: {decision.nearestFromMeters === null ? 'Unavailable' : `${decision.nearestFromMeters} m`}; from To: {decision.nearestToMeters === null ? 'Unavailable' : `${decision.nearestToMeters} m`}.</p>
    {decision.mode === 'direct-secondary' ? <>
      <p>The direct distance is shorter than {decision.comparison === 'both' ? 'both approaches' : decision.comparison === 'from-approach' ? 'the From approach' : 'the To approach'} to eligible trays.</p>
      <p>Design length: round up ((3D distance + For end connection) × (1 + Additional % for bending / 100)). Secondary tray length and extra connection gaps are not added.</p>
      <p>Check that the direct connection can be installed. This distance comparison does not verify obstacles or clearance.</p>
    </> : <p>{decision.eligibleTrays === 0 ? 'Eligible tray geometry is unavailable; it cannot authorize a direct connection.' : 'Neither nearest approach is longer than the direct distance. Normal tray routing applies.'}</p>}
  </section>;
}
