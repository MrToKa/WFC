# Independent From/To matching and the endpoint-discovery viewer failure

## Observed fault and causal reproduction

The user reported that all 330 project trays completed discovery, followed by
`Searching From/To properties: 0 of 1478`, `RESOURCE_FAILED`, and removal of the
loaded viewer. The pinned local SDK is Autodesk Viewer 7.130.0.

Its `enumNodeChildren(id, callback, true)` invokes the callback on `id` before
visiting descendants. The previous visibility checker initialized its visited
set with `id`, inspected it, and then used that recursive API. The first callback
therefore falsely reported a hierarchy cycle. The resulting
`PREPARATION_VISIBILITY_UNAVAILABLE` was absent from the bridge's safe error
dictionary and became terminal `RESOURCE_FAILED`.

A test with the pinned SDK's starting-node callback failed before the fix.
Visibility now traverses direct child edges explicitly, inspecting each node
once and retaining rejection of actual cycles, duplicate descendants, inconsistent
parents and unavailable visibility. The bridge reports the two known visibility
refusals as recoverable discovery errors. Genuine SDK resource failures still
terminate the affected model load.

## Product behavior

`Find and assign From/To` is visible above the Routes/Path tools. It searches the
current project's distinct From/To names in the full loaded model tree and its
readable human scalar properties. Exact NFC/trim/case normalization and the one
model-only leading-slash adapter are retained. Numeric suffixes, leading zeroes
and engineering punctuation remain significant.

The complete candidate scan precedes writes. An eligible unique object supplies
the centre of its display bounding box's bottom face in canonical project metres.
The binding explicitly records an approximate fixed-world observation with
`matched-model-bottom-aabb.v1` and immutable command/scan/model evidence. It does
not claim a manual object choice, retained native mesh proof, or engineering
acceptance. A later model/preparation needs a fresh match for this observation.

The operation preserves manual and legacy bindings. Existing aliases share one
logical location. It reports missing, multiple and unavailable/hidden matches;
unavailable duplicates cannot be silently dropped to invent uniqueness. Nodes
without usable recursive fragment bounds are reported unavailable. It does not
guess among candidates, change the published network, or enqueue calculations.

Assignments use bounded atomic pages, current model and registry checks, and an
idempotent command ledger. A saved pending page is retained before submission;
an uncertain result can retry the same page. Confirmed manual assignments remain
available to all cables sharing their logical names. Display object identities
are recovered from the exact successful matching receipt, separately from native
geometry authority.

Manual `Discover project tray candidates` now reads trays only. Its historical
frozen-plan endpoint candidate counts are not the current location-binding
registry. From/To assignments can be updated separately once a published network
provides the canonical calculation frame. Existing managed preparation keeps its
original full collection entry point.

## Verification and delivery records

- Causal SDK enumeration RED: `D:/Codex-test-output/preparation-visibility-20261027/red-sdk-enumeration.log`.
- Controller/lifecycle/collector checks: 184 passed.
- Final affected viewer/bridge/protocol/visibility checks: 178 passed.
- Backend full affected checks: 206 passed; final additional target: 14 passed.
- UI checks: 96 distinct client/hook/panel/preparation checks and eight selected
  Path Finder composition checks passed. The other 68 legacy Tab cases were not
  rerun; they are not counted as passing this delivery.
- Exact eight new production SQL queries ran against a dedicated temporary
  PostgreSQL fixture: seven checks passed, transaction rollback verified and
  helper container removed. No 5191 engineering data were used as fixtures.
- Source, build, immutable image and installed delivery evidence:
  `D:/Codex-test-output/model-location-match-20261027/`.
- A broad runtime run had 445 passing tests and one unrelated 180-second
  cancellation in the existing 620831-occurrence barrier planner capacity test;
  that limit was not changed or reported as a pass.

The integrated browser origin remained denied by its access gate. Source-backed
SDK reproduction, UI tests, isolated SQL and immutable/installed byte checks do
not establish a live Aalborg browser interaction.

## Installed 5191 checkpoint

Operation `64945d5b-0867-4f6f-be4c-a008e4070904` installed successfully:

- API: `sha256:21ec5f6c7f5be05025bdc17bc4b390e3ca4215e6756d0e2c229cf87e59bcc1a2`.
- WEB: `sha256:5da34b2b8d5d60de0ad936f45f2ca14c770651b7fb6a7d7f6536297e6ec9e632`.
- Immutable qualification checked 647 baseline and 651 candidate API files,
  the exact 16 changed files within the 17 approved overlays, 12 linked modules,
  unchanged native engine/verifier, and all 206 SDK files.
- Installed delivery checked 240 served files and health. An independent root
  check revalidated the 33 non-SDK served files, current source pins, healthy
  API/WEB, unchanged runtime/environment/mount semantics and five preserved
  services. Ports 5191, 5193 and 5180 returned HTTP 200. The new endpoint rejected
  unauthenticated access with its expected typed HTTP 401.
- The WEB copies only index/assets and the five changed runtime/inventory files;
  the unchanged SDK is inherited. The final image is 109,573,482 bytes smaller
  than the initial, uninstalled full-dist candidate.
- Current and rollback images, installation receipts and the private original
  configuration backup are retained. Temporary build output is operation-owned
  and cleaned separately; no model/store/volume or global image prune is used.

Close the old popup and reload the main page with Ctrl+F5 to load this build.

During delivery preparation a separate existing issue was found: the configured
managed browser-producer image `f58a7de167c85ccb9c98f71d43c49bfaebb86bf3c4f611cf394d72906db0342b`
is absent locally. Its old qualification cannot be transferred to a rebuilt
image. This delivery preserves that configuration and qualification; the new
human-viewer matching button does not use that helper. The missing-image evidence
is retained in the deployment directory for separate recovery.
