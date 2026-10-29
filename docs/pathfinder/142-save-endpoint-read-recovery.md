# Recover endpoint foreground reads after Save

After the first-Show foreground update, the user changed the H1 cable's From
assignment to GENPRI 2338 and saw the correct new 100 m route without the
From and To objects.

Read-only checks of the installed Aalborg data found the correct From binding
42 and To binding 5. The current confirmed display IDs were 88494 and 390694.
Every fixed-world endpoint predicate matched. Replaying the actual frontend
resolver and actual endpoint API response validators against the captured
current server responses returned both IDs in about 29 ms. Older proposals
correctly omitted the changed From reference. There is no evidence supporting
relaxation of model, binding, point or display-hint checks.

The failure was reproduced using concurrent, legitimate read operations against
the installed server. Workflow and endpoint readers take the same project-row
`FOR NO KEY UPDATE` lock with a one-second lock timeout. A workflow detail read
completed in 1815 ms while From returned `WORKFLOW_DATABASE_BUSY` / 503 after
1023 ms. In another wave the workflow read took 1598 ms and both endpoint reads
returned 503 after about 1002 ms. No artificial lock hold or database mutation
was used. The helper matched the API's node user and kept its volume read-only.

The endpoint resolver aborts its peer after an ordinary read failure. Results
then keeps the verified route drawable but treats the failed foreground lookup
as terminal. Another Calculate changes the result key and incidentally retries
it. Previous Results and Save-flow tests mocked the entire endpoint resolver,
so they could not detect this real response path.

The fix must retry only the optional endpoint lookup after route verification,
with bounded, abortable backoff under the same selected-result lifetime.
It must retain immediate route readiness, exact identity checks, authorization
revocation, hidden-view behavior and serialized enrichment. It must not submit
another calculation or repeat the full route-proof read.

Evidence: `D:/Codex-test-output/changed-endpoint-show-20261026/`.

The selected-result reader now makes up to two optional metadata retries, with
250 ms and 750 ms abortable backoffs, after the exact route proof has settled.
Each attempt uses the latest matching model state and the same result-scoped
controller. Authorization failures are never retried and retain immediate
revocation. SQL locking, identity predicates, application deadlines, route
proof reads, calculations and the serialized draw queue are unchanged.

The new integration test uses the real Results component, endpoint resolver
and endpoint HTTP client, including schema and SHA verification. Only HTTP
transport and the separate route-proof boundary are supplied by the fixture.
It changes the saved binding, advances the automatic cable write, returns a
temporary 503, and then returns sealed current endpoint contexts. The test
holds the route proof longer than the first retry delay to prove that endpoint
recovery does not start while that proof is still pending.

The exact deployed Results source
`dbad989f4db7a523478000c855172142fe88e0ee3a12d36f961f66b84931349d`
fails that regression. The fixed source
`8ca920c2e3a3ca3d88a5e1b74100b58358f4f3fd3f4d75f932415a372e6deab5`
passes the four real-HTTP cases. The original source was restored and verified
after the temporary baseline run. The integration also checks a late denied
request, cancellation and invalid response hashes.

The final selected validation passed 125 executions: four real-HTTP integration
cases, 39 focused Results cases, 69 complete resolver cases and 13 Save-flow
cases. The Results run deliberately filtered 145 unrelated cases; this is not
a claim of a new full-suite run. Frontend type checking and focused ESLint
both exited zero. An independent review verified all seven final source pins
and the three production retry hunks. The integration fixture's final workflow
detail envelope is parsed with the real schema and includes its query hash.

## Installed verification

Port 5191 now serves frontend image
`sha256:1cda39d75e2225857d339481cb3bd8580cb8cae64c75938bdb94e88439062777`
(operation `0a3381b1-290e-428d-a039-7ecd0b6a89e1`). The V5 frontend-only
installer passed 48 controls and independent review of its 38 frozen source
files, immutable image and strict preflight before installation.

The installer and an independent root check both verified all 32 qualified
served files. The 28 viewer runtime files and their inventory are unchanged.
The API process and configuration, and the services on ports 5180 and 5193,
were preserved. HTTP checks returned 200 on 5191, 5193 and 5180. No calculation,
model change or engineering/database write was submitted by the delivery.

The installed-server contention reproduction and actual endpoint response
validation are confirmed. An interactive browser Save to Show check remains
unconfirmed under the existing browser access restriction. Close an old popup
and reload the main page once to load the installed frontend.

Installed evidence: `delivery/deploy.pass.json` and
`root-final-verification.json` in the evidence directory above.
Owned temporary helpers and configuration temporary files are removed;
`delivery/cleanup.pass.json` records zero remaining. Current and rollback images
are retained.
