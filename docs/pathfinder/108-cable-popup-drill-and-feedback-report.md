# PF-B18 — cable popup calculation policy and feedback

Status: **SOURCE CHECKS PASS; NOT YET DELIVERED**.
Baseline4fc1bec on pf-b18-cable-popup-drill-local-20261022. The latest user
priority is to finish the popup, then resolve barrier publication and routing.

## Popup behavior

The popup has a separate, off-default `Drill through the walls` choice for the
next calculation of its selected cable. Opening another cable or changing its
owner clears this draft. It does not enable drilling for other cables that share
an endpoint. Shared-location Save continues to use the strict background policy.

Calculate now reports configuration requirements, submission, queue/running
progress, stopped work and unconfirmed submission. Only a positive acknowledgement
with the exact new job UUID starts polling and associates the selected policy
with a result. An unknown submission is retained without automatic retry or
borrowing another job. Submitted policy and recorded result policy are displayed
separately from the next-calculation checkbox.

Review, Apply and the calculated-length projection retain the acknowledged
calculation inputs, and also require current configuration readiness. An old
acknowledgement cannot bypass missing, dirty or pending barriers. Existing exact
proposal review and write rules remain: Auto length follows a verified current
result; populated Routing/Design require Review and Apply; the existing both-empty
initial-fill rule is retained. Endpoint-only Save does not certify a route.

The existing compact search/list, hover, persistent click popup, detached themed
window, parent-object assignment, bounding-box bottom-centre anchor and endpoint
display behavior are retained. This change does not prove actual browser behavior.

## Barrier publication boundary

The client marks a publication as sent only immediately before the exact HTTP
PUT, after Viewer/session/frame/selection/size/abort checks. A failure in those
preconditions no longer creates a false unknown-write lock. If an earlier PUT
really started, its uncertainty remains sticky across retry preflight failures;
only the matching receipt resolves it. This is not a status-code shortcut for
failures after a request was sent.

Server-side durable terminal geometry-refusal receipts and historical exact-command
reconciliation are still required. The existing server may have accepted a begin
intent, then refused geometry without a durable final outcome. A lost response or
lost acknowledgement must not be guessed to mean that no write committed.

## Latest retained Aalborg selections

Root checked the latest supplied28 exact dbId/name pairs against the immutable
retained package, independently of the earlier30-object diagnosis. All28 contain
triangle geometry:4790vertices and3789triangles, with3 fragments having local
boundary edges. No lines, collapsed faces, repeated faces, zero-area faces or
local nonmanifold/inconsistent edges were found in this bounded diagnostic.

These are original local RAW coordinate/index observations, not global transformed
topology, occupancy, opening clearance or publication qualification. The displayed
model/frame UUIDs have not been verified against this retained fingerprint. No
actual Viewer capture was executed. The structural catalog from B17 still needs
bounded surface queries, occupancy/own-terminal rules and runtime integration.

## Verification and delivery

Root completed473 unique Vitest checks: Workspace39, popup panel35, Results114,
Tab72, barrier hook/controller149 and preparation facade64. The installer passed16
pure checks. Full type checking, scoped lint and frontend/server builds passed;
independent source review was clear. Exact14 changed source-file pins and log
digests are in public receipt `evidence/barriers/b18-cable-popup-drill.json`.
Targeted new-feature cases were also run and are not double-counted.

Earlier interrupted test runs, the corrected TypeScript null guard and the
corrected assertion against collapsed historical details are retained in private
operation13328c95. The final standalone Tab run completed all72 cases in1216s;
its verbose log established slow progressing test queries rather than a render
loop. React act warnings remain in the log. The other three suites' completed
results were retained from the second interrupted multi-file run; no passing
count is inferred from its interrupted Tab worker.

Private operationee326dc1 retains the checked latest-wall diagnostic, process
memory/deadline guard and prepared owned-web delivery. Runtime5191 currently
remains B15weba0e6972c/APIac0d16ab. No API restart, database/model/cable writes,
original services, protected browser refusal or real Apply were changed. Actual
Aalborg acceptance and Simplified Preparer remain outstanding.
