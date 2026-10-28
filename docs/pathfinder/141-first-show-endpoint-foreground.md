# From and To foreground on the first Show

The user confirmed that Show became available after the previous frontend
update, but opening the cable popup and using Show could still display the
route without its assigned From and To objects. A new Calculate made those
objects appear.

The selected-route reader updated its verified display cache after the separate
endpoint lookup completed. The protected viewer freezes the supplied object
IDs when a draw begins, so updating that cache did not change a route already
on screen. The delayed-foreground test previously asserted a single draw and
therefore retained this incomplete display behavior.

The required behavior is to include endpoint IDs in the first draw when their
lookup has already completed. When they arrive later, the same checked route
must automatically acquire their foreground without another calculation or
manual refresh. An in-progress draw must finish before an enriched replay;
the newest checked payload wins. Hidden routes may acquire cached metadata
without becoming visible, and a late response must not take viewer ownership
from another presentation. Calculation, model, scope, access, geometry limits
and write authority checks remain applicable.

Evidence for this follow-up is retained under
`D:/Codex-test-output/show-foreground-20261026/`.

The implementation keeps one display ticket for an explicit Show. Its original
viewer claim, selected-result key and operation counter fence every draw.
Endpoint completion may update the checked payload, but cannot acquire a new
viewer claim. A serial drainer finishes an in-progress draw before replaying
the newest enriched payload. An unchanged object-ID union does not replay it.
Selected-result Hide preserves the read-only metadata lookup while invalidating
its display ticket, allowing the next Show to use the enriched cache.

This uses the existing viewer interface and the exact same route geometry.
An exceptional late replay inherits that interface's camera fit and appearance
reset; the ordinary case with endpoints already resolved uses one complete
draw. The backend, viewer protocol and calculation engine are unchanged.

Frontend test artifacts are under the implementation worker's directory
`D:/Codex-test-output/show-endpoint-foreground-20261026/frontend/`.

## Validation

The frozen Results source is
`dbad989f4db7a523478000c855172142fe88e0ee3a12d36f961f66b84931349d`.
An independent implementation review confirmed its display ownership, scope,
authority and geometry gates.

Validation provides passing coverage of all 269 focused frontend tests through
combined runs. The three-suite run passed 268 and hit the existing five-second
runner limit in one unchanged history test. A final targeted run passed all
21 cases, including that exact test and the new endpoint scenarios. An
independent comparison of assertion identities confirmed 269 distinct passing
tests and no coverage gaps. This is not a claim that the full run exited zero.

Two existing multi-render history tests were close to or beyond the five-second
limit against the previous implementation as well. Only those tests received
local ten-second budgets. Assertion bodies and application deadlines are
unchanged; byte reconstruction verifies the final test-only difference.
Frontend type checking and focused ESLint both exited zero.

## Installed result

Port 5191 now serves frontend image
`sha256:6eef2ff33aca62d9b10028658fb42276a58f674d9391f95da632e8cd80e58336`
(operation `a8eb9245-685f-4f9d-9f15-f06fb869982e`). The frontend-only installer
passed 47 controls and independent review before the swap.

Both the installer and an independent root check verified all 32 qualified
served files, including the 28 unchanged viewer runtime files. The API process
and the services on 5180 and 5193 were preserved, and all three ports returned
HTTP 200 after installation. No database, model, calculation or engineering
write was needed. Owned temporary helpers and configuration temporary files
were removed; the current and rollback images remain available.

An interactive browser test remains unconfirmed under the existing browser
access restriction. The regression tests cover first Show on accepted and
saved-exact routes, endpoints arriving before and after Show, pending draws,
Hide, ownership changes, stale scopes and authority refusals. An already open
popup uses the previous JavaScript; close it and reload the main page once to
load the installed fix.

Installed evidence: `delivery/deploy.pass.json`, `delivery/cleanup.pass.json`
and `root-final-verification.json` in the follow-up evidence directory above.
