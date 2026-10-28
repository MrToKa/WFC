# Project discovery and tray assignment scope

The Aalborg project contains 330 project trays and 1527 distinct endpoint names.
Discovery searches 660 exact tray-name variants. The 328 automatic roots do not
mean that two project trays have been removed: A105 and A120 are named /A105x and
/A120x in the model and have explicit manual assignments. Those assignments were
being rejected after endpoint registry revisions changed, despite an unchanged
model, catalog and routing permissions.

Manual assignment compatibility now ignores only locationRegistryRevision and
resolutionRevision. Full preparation/create/write scope checks remain strict.
Discovery still reads assigned objects and their hierarchy from the current
model; planning still requires their existence, valid ancestry, authorized
physical leaves and unambiguous ownership. A changed model/catalog/permission
scope requires verification and is labelled accordingly. A scope revision alone
is not evidence of an actual tray geometry change. This change does not claim
to compare tray geometry automatically across different model revisions.

Endpoint discovery previously rebuilt its complete property index for each
8 KiB query batch. An optional equipment-only indexNames field now supplies a
project name universe bounded to 4096 names and 32 KiB. Query names must be a
subset. The runtime retains only matching postings for that universe and echoes
only the current query names. Larger universes use the existing per-batch path.
The 24 KiB response, 256 MiB index, 32M property, 45 second SDK callback and
300 second request budgets are unchanged. Every page still checks current SDK
visibility before and after processing. Aborted or failed index builds are
discarded.

Discovery errors now preserve their stage, page cursor and relevant root, with
specific codes for property timeouts, malformed responses and individual limits.
Cancellation, access failure and bounded viewer reload behaviour are preserved.
A failed attempt cannot leave an earlier in-memory discovery eligible to freeze.
The published network and frozen historical plans are not overwritten by discovery.

Validation includes 89 frontend cases, 139 runtime cases, 40 planner cases and
77 contract/managed preparation integration cases. TypeScript and applicable
ESLint checks passed. An offline replay used the exact pinned Aalborg property
resources and current project query names across all seven result pages:
ordered matching IDs were identical, and SDK property calls fell from 3424 to
856. Its elapsed time fell from 52.266 to 15.117 seconds with a synthetic flat
hierarchy, all-visible fragments and synchronous callbacks. These are not live
browser timings. The precise original live failure remains unconfirmed.

Investigation and delivery receipts are under
`D:/Codex-test-output/discovery-investigation-20261026/`. Browser interaction
was not retried through a different route after the retained origin-access
rejection. Existing engine binaries and project data are outside this change.
