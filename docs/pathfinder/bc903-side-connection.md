# BC903 end-to-side routing correction

## Observed case

Read from the authenticated embedded browser on 2026-11-17:

- Project `da667921-1f13-4c1d-9f87-063d127b98ce`, cable `-WG-3117`.
- Live site: `http://192.168.5.55:5173`.
- BC903 and BC027-2 are published CAD routes, included in the network for Control.
- Connection gap: 1.2 m; SECONDARY trigger: 2 m; vertical approach preferred.
- Saved route: `/SECONDARY/BC027-2/SECONDARY`, design length 25 m.
- Latest visible barrier result: `ACCESSIBLE_STRAIGHT_PAIR_CLEAR`, three pair attempts,
  truncated candidates, no local connector plans, registered barrier revision 47.

The previous stale-result warning was not the cause: refreshing and calculating again
retained the route, and the current result was shown as already saved.

## Geometry and exact failure

Routings builder showed these saved placements, in millimetres:

| Section | Position X/Y/Z | Orientation X/Y/Z | Length |
| --- | --- | --- | --- |
| BC903 KL 60.303 | 5400 / 70650 / 17500 | 0 / 0 / 0 degrees | 1800 |
| First BC027-2 KL 60.303 | 4610 / 68540 / 19300 | 90 / 0 / 180 degrees | 6000 |

The straight source centreline is local `(0,30,z)` mm. Thus BC903 is the vertical
line `(5.4,70.68,17.5)` to `(5.4,70.68,19.3)` metres. The first BC027-2 section is
`(4.61,68.54,19.33)` to `(4.61,74.54,19.33)` metres.

BC903's top is **0.790569415 m** from the interior of BC027-2, inside the configured
1.2 m gap. Its distances to that section's ends are 2.281359244 and 3.940126902 m,
both outside the gap. Other published CAD sections read from the browser do not
supply a nearby endpoint bridge to BC903.

Saved equipment points:

- From: `(5.633498219775822,70.5099999010227,17.079999968424254)` m.
- To: `(4.825416188525821,72.94217177602272,17.069999968424256)` m.

The From approach to BC903 is **0.509726867 m**, below the 2 m SECONDARY trigger.
The native runner previously marked every CAD chain as port-only and tested two
such chains only at endpoint pairs. It never inserted the valid end-to-side edge.
The exact geometry regression failed before the change with selected From BC903
and To BC027-2 reported as disconnected at 1.2 m. The fallback search shown in the
live result could then choose a longer attachment to BC027-2.

Candidate truncation and early fallback are separate search behavior; neither is
the specific missing-edge defect corrected here.

## Correction and scope

Current v3 CAD overlays opt genuinely straight, nondegenerate, monotone centrelines
into receiving side connections. The new contact must still start at a genuine
end of the other chain. Both segment ordering directions are handled. The existing
gap limit, original-geometry barrier checks, purpose rules and independent-chain
refusal still apply.

Curved/fitted port-only paths retain their physical endpoint restrictions. Two
interiors crossing do not become a junction. Historical v1/v2 overlays retain
their endpoint-only behavior. The side-connection property participates in the
prepared graph fingerprint and is copied through constrained, load-balanced and
ordered route processing.

## Validation boundary

The C# regression and actual native-runner integration use the browser-read two
CAD lines and the exact saved equipment coordinates. The isolated corrected route
is `/BC903/BC027-2/SECONDARY`; the From end no longer needs SECONDARY. Tests also
exercise the measured gap boundary, reverse ordering, historical overlay behavior,
interior-crossing refusal, curved geometry and graph reuse/barrier handling.

This isolated fixture is not a replay of the entire live model and its 147 saved
barrier parents. The server must be updated and the cable recalculated against its
current barriers before treating a new full-project route as verified. No live
placement, barrier registration, cable endpoint or saved cable value was changed
during diagnosis.

Final checks: 114 C# routing regressions, 100 constrained-routing checks,
43 graph-reuse checks, 16 native-runner integration tests and 48 CAD overlay /
publication unit tests passed (321 checks). Server TypeScript checking and both
Debug and Release native-runner builds passed. One Debug regression run hit the
existing dense-network timing cap; the unchanged retry passed all 114 checks.
