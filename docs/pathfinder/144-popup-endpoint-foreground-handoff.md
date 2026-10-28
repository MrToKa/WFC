# Keep popup endpoint objects in the checked route display

The user again reported a correct visible H1 route without its From/To objects.
Refreshing restored the objects. The popup itself still showed the saved
assignments. This incident concerns endpoint foreground display, separately
from the viewer lifecycle recovery in stage 143.

## Installed-data evidence

The latest L4 assignment and 116 m proposal match the screenshot. The fixed-world
From binding is revision 47, its location revision is 48, and its confirmed
display object is SDK 411850. To binding 5 resolves to SDK 390694. Actual response
validation and the existing resolver replay return both objects in about 33 ms.
The route contains 292 points and 59 segment object IDs; neither endpoint object
is in those segment IDs. The combined display needs 61 objects, within the
existing 512-object limit.

The incident timeline shows successful endpoint reads at 20:34:46 UTC followed
by three waves of duplicate reads returning temporary 503 responses between
20:34:47 and 20:34:51. PostgreSQL recorded lock timeouts and serialization
failures. The later manual Refresh read the same objects successfully. The
data and object identities therefore do not require correction.

The current Results flow gives up optional endpoint hydration after three
failed reads and retains the drawable route without those IDs. A subsequent
Show redraws that cached payload. The popup has its own verified endpoint
reader, but its successful current contexts are not connected to Results.
This creates a route-only display even though the same popup can show valid
saved From/To assignments. The prior HTTP regression covered recovery after
one temporary failure, rather than exhaustion followed by popup convergence.

Evidence: `D:/Codex-test-output/endpoint-final-attempt-20261026/backend/`.

## Scoped handoff contract

The popup can hand its live verified endpoint contexts to Results under the
same account/login, project, cable, model and preparation scope. Drafts, retained
labels, pending commands and retired or failed readers do not provide identity.
The existing fixed-world display predicate must be shared by HTTP resolution
and this handoff: binding ID/hash/revisions, point, model, preparation, current
scope and confirmed display evidence all retain their exact checks.

Results may enrich only its already checked current path. An active explicit
Show uses the existing serialized draw ticket; a hidden path enriches its cache
without taking ownership of the viewer. Handoff before route verification must
be applied once the route proof commits. Later failed or empty optional reads
must not remove correctly verified IDs for that same result.

The handoff does not submit a calculation, change an assignment, repeat route
proof verification, or create a new endpoint GET. Existing HTTP fallback and
history behavior remain available. No identity is inferred from coordinates,
names, proximity or old labels.

The explicitly requested integrated-browser attempt was refused by its origin
permission gate for `http://127.0.0.1:5191`. No alternate browser, native UI,
CDP, authentication injection or other bypass was used. The local code and
stored-data checks do not claim an interactive browser reproduction.

## Causal and installed-data checks

The real popup integration mounts the actual routing panel and pair-selection
hook, using the real endpoint HTTP client, response validators and resolver.
It first exhausts all three Results endpoint lookup attempts while the exact
route is already visible. The popup then completes its own verified pair read.
Both endpoint IDs must enter the existing Show payload with eight total endpoint
GETs, one route-proof read and no Refresh, Calculate, Save or other write.

Swapping only Results back to the exact deployed `8ca920c2...` source makes that
test fail with the popup's foreground-ready marker present and the endpoint IDs
missing. Restoring the new Results source passes the eleven real-HTTP cases.
The test also covers early contexts at route-proof commit, hidden cache updates,
late empty HTTP results, denied popup reads, and ownership/scope mismatches.

The new pure-context path was also replayed offline against the actual saved
Aalborg proposal and verified From/To responses. The real API parser rechecked
the captured context and binding hashes. Both the pure resolver and the ordinary
resolver supplied with these contexts returned SDK 411850 and 390694 with fetch
configured to throw: zero new fetches. The complete path remains 292 points,
116 m, with 61 display objects. Captured inputs and route data are unchanged.
Evidence: `backend/pure-contexts-replay.json` in the stage evidence directory.

Final validation covers 220 distinct passing cases, with 231 passing executions:
181 cases in the complete panel, real-HTTP, resolver and Save-flow suites,
39 selected Results cases, and eleven publisher cases repeated after a test
fixture received its required type field. The Results run intentionally filters
145 unrelated history cases; the publisher repeat filters 76 other panel cases.
This is not a claim of a new full Results-suite run. Frontend TypeScript and
ESLint for all thirteen pinned source/test files exit zero. Independent review
matched every pin and found the shared binding predicate text-identical to the
previous predicate after whitespace normalization. The V6 controller, hook and
endpoint HTTP client remain unchanged.

The publisher shares only live verified contexts. It retracts its payload for
retired, pending, draft, failed or changed-scope readers. This change cannot
manufacture object identity if neither reader has valid authoritative metadata.

## Installed verification

Port 5191 now serves image
`sha256:377679eb89b8857a0d3c4e0d15195cb08b4731bb6bb9d47fc8390761befc56ed`,
operation `1ab8f959-74f6-4aa6-a55f-1ee9eb4cfdb0`. The V7 WEB-only operator passed
49 controls. Independent review checked its 47 frozen inputs and all nine
delivery evidence hashes before the swap. Current and rollback images are kept.

The installer and independent root postcheck verified all 32 served files.
The 28 viewer runtime files and inventory are unchanged. The API process and
configuration, port 5180 and the healthy preparer on 5193 were preserved. HTTP
checks returned 200 on 5191, 5193 and 5180. Verification did not submit a new
calculation or engineering-data write.

Installed evidence is `delivery/deploy.pass.json` and
`root-final-verification.json` in the stage evidence directory. Loading the new
frontend requires closing an old popup and reloading the main page once. The
interactive browser result remains unconfirmed under the origin permission
refusal recorded above.

Owned cleanup passed: zero temporary helper containers and zero configuration
temporary files remain; no source build context was created. The current WEB,
rollback WEB and current API images are retained. No global prune was used.
