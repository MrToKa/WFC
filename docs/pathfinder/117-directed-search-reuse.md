# PF-B23 — reuse exact search segments within one calculation

The retained H1 wall test spent its 100,000 collision-query allowance repeatedly
pruning the same tray edges for different endpoint candidate pairs. A new bounded
cache belongs to one calculation budget and one exact oracle delegate instance.
Its key contains all six ordered binary64 endpoint values; signed zero and
adjacent values remain distinct. It keeps only fully admitted Clear/Blocked
statuses, up to the existing query ceiling, and disables reuse after a delegate
change. Uncertain, failed, cancelled, late and over-budget results are not cached.

Every lookup still charges guarded work. Only physical oracle invocations add
oracle work and query counts. Reused search observations carry no physical hit
witness or performed work; the original actual blocking observation is retained.
The final complete route and standalone local connector finalization always make
fresh physical queries. Public contracts, geometry, collision tolerance and all
time/work/query limits remain unchanged.

## Executed verification

Root copied and hash-checked 146 source files into an isolated build fixture.
All 265 checks passed: constrained66, local connector42, mixed runtime20, legacy
barrier runtime39, direct SECONDARY63 and length ledger35. These include 14 new
regressions for repeated graph edges, exact directed keys, delegate/cross-job
isolation, refusal accounting and fresh final checks. The first mixed test
invocation omitted its required arguments and exited2 without assertions; that
empty log is retained and the corrected invocation passed all20 cases.

The portable candidate runner published successfully. Root executed the same
four real retained Aalborg requests through that candidate in the installed API's
Linux runtime, using read-only inputs/candidate artifacts and private temporary
caches. Exact artifact manifests, source/input bookends, positive process joins
and removal of all helpers passed. No real Cable list write was performed.

L2 Off/On and H1 On retain their previous calculated results. H1 Off now reaches
all64 allowed candidate pairs with **7,608** physical queries and 5,035,102 charged
work, rather than failing at100,000 queries after21 pairs. It still returns
`CANDIDATE_PAIR_LIMIT`; no successful H1 route is claimed. Independent checks of
the three successful final polylines preserve the earlier geometry findings.

The exact source/log/artifact pins are in
[b23-directed-search-reuse-checks.json](evidence/barriers/b23-directed-search-reuse-checks.json).
This correction is source-checked and candidate-tested; it is **not installed**.
Port5191 still serves the B21 API and B22 web pair from reports113/115.

## User-supplied opening reference

The user's intended H1 route is
`/DFBC002-1/DFC001/DFC002/DFC003/C002/C107-1/C107-2/BC175/BC030-1/BC030/BC020`.
The `/BC175 → /BC030-1` transition must pass through an existing opening in
`VOLMODEL 581`, with drilling disabled. Hidden `EQUIPMENT 23 of ZONE
/ACS_WALL&FLOOR_PENETRATIONS` is only an optional locator; it never defines a hole,
subtracts a wall or authorizes crossing original wall material.

Actual installed-engine legacy lookups calculate the full reference and the
two-code transition. Independent original-geometry diagnostics check all87 and8
returned segments respectively. The transition has no contact or closed-topology
containment against any of the28 registered originals, including all232 triangles
of wall581. The full reference has no wall581 contacts but segment18 crosses
wall2112 (`dbid:171737`, fragment851). Equipment approach legs are absent from
these reference lookups, so neither is a complete barrier-approved cable result.

The optional hidden reference name is absent from the retained package's checked
property names. Its original refusal and a separate exhaustive name diagnostic
are retained; no fuzzy substitute is accepted and the absence does not block the
wall geometry checks. Its absence does not establish why the live model differs.

Lookup endpoints are selected outer terminals and can omit branch geometry. A
29m distance from one terminal to the current From point does not prove a wrong
assignment. Native all-segment/category diagnostics are being prepared to inspect
the actual connection and the remaining wall2112 crossing. Live SDK/current-frame
acceptance, own-terminal exit/entry, full capacity and Simplified Preparer remain.
