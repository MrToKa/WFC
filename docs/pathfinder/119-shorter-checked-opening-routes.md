# PF-B25 — shorter checked opening routes

B25 lets a checked opening maneuver compete with an existing clear route. B24
kept the legacy clear graph whenever it was connected, so the isolated
`/C002 → /C107-1` diagnostic took a 2.951497m route through BC158 even though a
shorter path through the original wall2112 opening was available. The actual B25
diagnostic now follows `/C002/C107-1`: 0.9474394581607366m, four points and three
independently clear final segments. No wall geometry, hole proxy or collision
tolerance was changed.

## Search change

The legacy clear route becomes an incumbent upper bound. Blocked inter-tray
chords initially provide optimistic graph costs; only selected candidates are
expanded into checked three-leg maneuvers. A removal or actual-cost change
restarts the shortest-path search. A verified candidate replaces the incumbent
only when its graph cost is strictly better. Equal costs retain the exact legacy
path and adjacency tie choice.

The fixed search still tries at most 52 translations at radii 0.05m and 0.1m, using
the same 26 normalized directions and strict realized-displacement bound. It
applies only to conclusively blocked cross-tray chords. Within-tray obstructions
and uncertain contacts cannot be bent. The 64-link local attempt ceiling is
unchanged; exhausting this optional improvement ceiling may retain an existing
clear incumbent, which still requires fresh final checks. Global query, work and
deadline failures continue to refuse. Actual traveled length supplies graph
cost, reconstruction and the length ledger; every final leg is checked afresh.

The exact mixed-v3 profile now selects
`legacy-clear-upper-bound-lazy-selected-path.v1`. The earlier B24 graph-first
selection is refused even when its profile hash is recomputed; it is not
silently reinterpreted. Historical mixed-v2 behavior and explicit drilling
bypass remain unchanged. The 0.1m search displacement is not a material-contact
tolerance. Hidden Equipment23 is not used as an opening, portal or exemption.

## Executed checks

Root copied 151 source/reference files, verified their build-copy bookends and
passed 308 Core/transport checks: 32 maneuver, 66 constrained, 42 local connector,
31 mixed transport, 39 legacy transport, 63 direct SECONDARY and 35 length ledger.
This includes 10 new improvement regressions. Selected TypeScript suites passed
282 checks. Full frontend/server types, scoped lint, both application builds and
portable native publish passed. The
[source receipt](evidence/barriers/b25-opening-source-checks.json) records the
executed scope.

Root then executed nine normal-supervisor Linux cases against the unchanged
retained Aalborg snapshot and 28 original obstacles: four mixed-v2 baselines and
five new mixed-v3 cases. Source/input/artifact bookends passed, all processes were
positively joined and every helper was removed. An independent checker used the
unchanged exact original-triangle and closed-topology math for every successful
final polyline, including approaches, gaps and maneuver legs.

| Actual case | Result |
| --- | --- |
| Isolated C002/C107-1 endpoints, drilling Off | Direct two-tray route, 0.9474394581607366m; all 3 final segments independently clear. B24 used BC158 and 6 segments. |
| Retained real H1, drilling Off, new profile | 242 points, 241 fresh clear checks, design 91m; all 241 segments independently clear. |
| Retained real H1, drilling Off, old mixed-v2 | No successful final polyline; its refusal is retained. |
| Retained real H1, drilling On, both profiles | Both bypassed routes retain 4 original-triangle contacts; neither is relabelled physically clear. |

The checker completed 874 final segments across the nine cases:
39+39+0+237+39+39+241+237+3. The isolated endpoint diagnostic is explicitly separate
from a real cable calculation. Its result demonstrates a checked route through
the original opening; it does not establish acceptance of the user's complete
reference route. The
[native and independent receipt](evidence/barriers/b25-aalborg-opening-native-checks.json)
records the actual results and exact evidence pins. The B24 report and receipts
remain unchanged.

## Deployment and remaining acceptance

B25 is checked but not installed. Port 5191 still serves the B21 API/B22 web pair.
No business cable values were applied or reset. The real H1 cases retain the
latest saved From point at X 81.6835m and calculate design 91m. The user's earlier
reference shows X ≈51.26m; that endpoint difference still needs clarification.
No point was substituted to make the route match the reference.

Live SDK/current-frame validation, real cable Review/Apply acceptance,
own-terminal exit/entry, full capacity and Simplified Preparer completion remain
outside this result.
