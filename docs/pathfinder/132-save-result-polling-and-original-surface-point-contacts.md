# Save result polling and original surface point contacts

The reported 27-object Aalborg capture failed with `NONMANIFOLD_VERTEX`.
Replaying its exact 355,621 bytes with the installed B31 verifier reproduced the
refusal. Its SHA256 is
`719c92a58792e71343c2353d3b8af5f3935ebf996c79218486d58870a4903ed7`.
The only disconnected face fan is in `VOLMODEL 2772`, `dbid:173396`, fragment
1095: original vertex 92 connects triangle 50 to triangles 70 and 71 at a point
without a shared edge. This is an edge-connected open surface, not a closed
solid. The complete selection contains 5,031 vertices and 3,971 triangles.

Mixed original surfaces now retain point contacts without requiring a single
vertex fan. Component boundary classification precedes that decision. Every
component implicated in a disconnected fan must be an original surface; an
implicated closed component still fails. No triangle, coordinate, index, owner,
parent, component membership or opening is removed or moved. Edge incidence,
winding, duplicate and degenerate checks remain. Closed solids retain the
existing complete qualification, including closed self-intersection checks.
This does not claim a new general open-surface self-intersection certification.
Numerical tolerance and resource limits are unchanged.

The native implementation changes and must receive a fresh compiled identity.
The B31 unchanged-native installation certificate cannot certify this update.
All 138 bounded managed geometry/runtime checks passed, including the exact
27-object capture and original triangle/index/coordinate-bit preservation.

## Foreground result retrieval

The core already uses Dijkstra. The observed minute-long popup wait is not
evidence that this search needs replacement. In a read-only live observation,
recent selected proposal timestamps were approximately 8–12 seconds after job
creation. The latest location Save was about 16 seconds before the final job
update. These SQL timestamps include transaction-start semantics and do not
independently prove commit or browser display latency. A rollback-only,
SELECT-only profile of installed readers measured approximately 599 ms for one
proposal detail and 629 ms for five recent proposal previews, without contention.

Two client behaviors can strand a finished server result. The old 80-read
budget charged status and detail separately, then could prevent the final
verification read. Separately, one transient impact-progress error suspended
polling and discarded the observed job identity. Impact reads also paused when
the main tab was hidden, even if its detached cable popup remained visible.

The updated workspace budgets complete polling rounds, permits one bounded
GET-only recovery window, and refreshes full project state only after the
selected result and its own automatic write are terminal. Impact progress uses
bounded transient GET retries and retains the last validated observation under
the same account, model, calculation and impact identity. A visible detached
popup may keep only its owned pending Save progress active while the main tab
is hidden. Other hidden pages retain their visibility suspension. Hard access
and scope refusals remain fenced, and no retry creates another Save or Calculate.

A model reload may rehydrate an externally selected cable by a current exact
GET. It does not replay commands or reopen the popup automatically. The latest
persisted result still passes the existing display checks before Show is enabled.

The viewer footer now identifies a failed operation and sanitized error code.
The previous generic statement that the viewer had stopped was inaccurate for
command failures that left its loaded model intact. Access and model failures
remain terminal where already required.

Installation evidence and final combined test counts are recorded separately.
The browser tool denied origin 5191; no alternate browser or access workaround
was used. Offline native checks and synthetic component tests do not certify
live browser interaction or engineering acceptance.
