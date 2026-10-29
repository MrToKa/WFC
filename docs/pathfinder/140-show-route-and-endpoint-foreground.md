# Show readiness and optional endpoint foreground

The repeated Save report showed the new calculated route and design length,
but Show stayed disabled until another Calculate or Refresh.

Read-only checks on the installed API confirmed that both reported Saves
produced valid proposals and automatic cable writes. The 100 m result belonged
to From binding 40, and the subsequent 58 m result to binding 41. Both endpoint
contexts were confirmed and supplied valid version-local display selections.
The installed context readers completed in about 28 ms and 14 ms; the workflow
detail read completed in about 1.2 seconds. These observations do not constitute
a browser trace or a benchmark of every request.

The frontend published the exact route text before waiting for a separate
endpoint foreground lookup. It advertised Show readiness only after that lookup.
A refusal, timeout or cancellation could therefore leave text loaded without a
drawable payload. Losing presentation ownership also advanced the shared
operation counter and aborted this read, without necessarily changing the
workflow key that schedules verification. The popup's generic message still
described this retained state as an active endpoint check.

The display contract is that an exact checked route can be shown independently
of optional equipment highlighting. Proposal, job, live-current/accepted/saved
display authority, model/artifact identity, compatibility and geometry budgets
still determine whether that route is valid. Route text alone is insufficient.
Unknown equipment IDs must not be supplied to the protected viewer. Endpoint
foreground may enrich the checked payload without delaying it or recalculating
the route. Review, Apply and endpoint Save remain separate authorities.

Evidence is retained under
`D:/Codex-test-output/show-endpoints-20261026/`. No calculation or engineering
write was submitted during the backend investigation.

## Implementation and validation

The selected proposal hydration now commits its checked drawable payload and
display proof together with the route text. Optional endpoint foreground reads
can enrich that payload later. A slow lookup, ordinary lookup failure or loss
of presentation ownership does not retire the checked route. Account, model,
cable and workflow changes still invalidate obsolete reads. A known authority
refusal prevents publication, and a late authority refusal immediately revokes
the retained route, including while a draw is pending.

The regression suite includes Save to Show with delayed or never-finishing
optional highlighting, display ownership changes, stale scope replies, denied
access and geometry budgets. Three causal regressions fail against the exact
previous Results implementation and pass with the fix. The final frozen source
passed 259 tests in the three focused frontend suites, `tsc --noEmit`, and
focused ESLint with no warnings. The final full test process exited zero using
the supported thread pool; an earlier Windows fork progress RPC timeout is
recorded separately in the validation receipt.

The source pin for `PathFinderResults.tsx` is
`27143a0c5e9a2d9c49bd20a1cb2db691171c8584177130fd0a64f424f3d9924b`.
The panel change only clarifies the readiness text. Endpoint assignment, Save,
Review and Apply gates are preserved.

## Installed verification

The frontend-only image installed on port 5191 is
`sha256:8755b643cc8c8b4c3e5b55ea2e6daec63e071b2cbb7f2d9050d61233073a9175`
(operation `2d45b97f-1660-4d9e-9039-ddf9a0cd9e3e`). The first installation
attempt refused a noncanonical Windows path before changing either runtime
file and resumed the same healthy previous frontend. The corrected installer
uses a canonical path and a strict planning check before stopping the frontend;
its 46 operator tests pass. The strict baseline guard is unchanged.

The completed installation and a separate root verification both checked all
32 qualified served files, including the 28 unchanged viewer runtime files.
The API retained its container, process, start time and configuration. The
services on ports 5180 and 5193 retained their processes, and all three ports
returned HTTP 200 after installation. No database or engineering writes and
no calculation submissions were needed for this delivery.

The test and installed-file checks are confirmed. An interactive browser
Save to Show test is not confirmed: the existing browser access restriction
was retained. An already open popup still runs the previous JavaScript; close
it and reload the main page once to load the installed fix.

Delivery evidence: `web-delivery/attempt2/deploy.pass.json` and
`root-final-verification.json` under the evidence directory above.
