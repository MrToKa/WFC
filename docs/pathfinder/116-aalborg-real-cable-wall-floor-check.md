# Retained Aalborg cable, wall and floor checks

Root executed four actual native calculations from the installed API image on
the unchanged retained Aalborg planning snapshot, latest retained From/To points
and all 28 supplied wall/floor objects. The input contains 4,790 original vertices
and 3,789 triangles, qualified as three original surfaces and 25 closed solids.
Fresh fixture identifiers make this an explicit offline check; original geometry
and snapshot bytes remain unchanged. No real Cable list Apply was performed.

The user accepts coordinate comparison differences up to 0.1 m inclusive. All
eight original routing-fragment witnesses satisfy that bound; the largest
conservative Euclidean residual is `8.098227944691265e-7 m`. This threshold did
not alter coordinates or the production collision tolerance of `1e-7 m`.

## Observed results

| Cable | Drilling | Actual result | Design length | Independent geometry diagnostic |
| --- | --- | --- | --- | --- |
| `=L2=LC1=WGB1` | Off | Calculated; 39/39 final segments checked | 30 m | No exact contact or closed-topology containment detected |
| `=L2=LC1=WGB1` | On | Calculated; explicit bypass, zero barrier checks | 30 m | No exact contact or closed-topology containment detected |
| `=H1=KF1=TAC1=WGA1` | Off | Resource limit: 100,000 collision queries; incomplete search | — | No successful final polyline; no clearance result inferred |
| `=H1=KF1=TAC1=WGA1` | On | Calculated; explicit bypass, zero barrier checks | 90 m | Two final segments cross original wall geometry |

H1 uses its latest retained From point, starting at X `81.6835444405499 m`.
Earlier successful proposals with different saved endpoints were not substituted.
The two detected crossings are through wall fragments 442 and 851, owned by the
supplied `VOLMODEL 2076` and `VOLMODEL 2112` objects respectively.

All four normal supervisor processes positively joined, their 16 packaged
artifacts matched before/after, and every temporary helper was removed. Each run
used a read-only copy of its inputs and a private temporary cache. Actual worker
limits were unchanged. Runtime ranged from approximately 9.6 to 12.6 seconds per
case, including preparation. A process exit of zero was not treated as proof of
a successful route: H1 Off remains an observed resource refusal.

## Independent original-geometry checks

A separate checker imported no production collision kernel. Its 11 analytic
cases passed. It checked all 315 final polyline edges from the three successful
results, including approaches and tray gaps, with exact dyadic triangle contact
tests and independent closed-topology endpoint diagnostics. No ambiguous contacts
were promoted to clearance. Source, original geometry and consumed output hashes
matched before and after the check.

The original floor (`VOLMODEL 2956`) probe crosses its solid part and detects four
triangle contacts. A separate gap, bracketed by contacting samples on four sides,
crosses that same floor without touching any registered original triangle. The
wall probe detects its solid surface. No wall opening was found within that
bounded probe set. These are original-geometry diagnostics, not physical cable
clearance or whole-building coverage certificates.

The sanitized counts, statuses and proof hashes are in
[aalborg-real-cable-checks.json](evidence/barriers/aalborg-real-cable-checks.json).

## Required follow-up

H1 Off exposed repeated collision checks while rebuilding the graph for each
candidate pair. A bounded reuse of exact directed segment verdicts is being
implemented. Final route and standalone local connector checks must still invoke
the actual collision oracle afresh. Existing work, time and collision limits stay
unchanged; a new successful H1 route is not yet claimed.

This check uses real retained model/cable inputs and the actual packaged native
engine, but does not establish live SDK/current-frame acceptance or protected
publication. Authenticated own-object first exit/final entry, whole-model capacity
and the subsequent Simplified Preparer work remain unfinished.
