# PF-4 local protected Viewer and admin workspace

Status at 18 October 2026, 05:30 Europe/Kiev: **implemented with automated checks and actual isolated-browser evidence; stronger yellow overlay and native one-point candidate awaiting final browser retry**. This is a technical checkpoint, not user acceptance or real-model engineering acceptance.

Workspace: `C:\Users\todor.chankov\source\WFC-pathfinder-local`; branch `pf-4-viewer-local-20261018`; base HEAD when checked: `c95ad56ebbd6b020966fa0690c98c37516df1db1`. The changes below were still uncommitted at this checkpoint and are being integrated by the parent task.

## Delivered behaviour

- The English PathFinder tab is gated by `user.isAdmin` at the project tab button, deep-link selection, navigation event and mount. A non-admin never mounts the PF hook or protected frame. Server operations independently require the current database admin role.
- The existing protected Viewer owns its SDK instance. New closed-schema operations carry exact computed metre points in acknowledged 128-point chunks, one-shot cancellable surface picking, bounded metadata pages and selected-model geometry capture. Complete envelopes remain at most 65,536 UTF-8 bytes; no arbitrary URLs, credentials or parent SDK handles were added.
- Exact path display uses the C# point sequence, separate from the immutable legacy JavaScript route fitter. Filled Ghost, original tray colours, yellow path and preference/material restoration remain covered. Canonical points are finite and bounded to the engine's ±1e9 metres; raw SDK display units can be larger before conversion.
- The exact yellow overlay now uses bounded merged 8-sided capped cylinders with the proven MeshBasic render pattern. Each axis follows exactly one supplied consecutive point pair; 0.02 m radius is visual thickness only. Geometry is rebased to the first point and split at 2,000 segments into Uint16-indexed meshes (at most ten draw calls for the 20,000-point budget). It performs no fitting, smoothing or cable-length calculation. This replaces the single-pixel-sensitive WebGL line observed as too weak in actual lookup preview.
- A successful native result can legitimately have one point and zero geometric length. That one point now passes the unchanged identity/session fences and is displayed as a small yellow sphere with visual fit bounds. No second mathematical point, equipment approach or nonzero length is invented; the server's original design allowance result remains authoritative.
- Computed paths without model dbIds now place the full context in the filled Ghost pass using the pinned SDK visibility manager. Clear restores its exact prior default and per-object visibility, render pass, preference and material opacities. No fabricated object IDs are used. This fixes the issue observed in the first actual synthetic browser preview; the corrected candidate still needs its actual retry.
- Every PF operation checks the fixed cookie-bound session `pathfinder-authorization` endpoint. Picking, metadata and capture check again after SDK work. Origin/source, instance/project/model/load/request identity, selection, session, cancellation and replay fences remain active.
- Selected model preparation is available in the product UI: explicit logical network codes and allowed categories, plus cable From/To equipment names. Protected capture preserves binary64 matrices, real units/offset evidence, hierarchy and triangle meshes; native visibility/source/engineering proof remains unknown. The strict assembler produces the canonical snapshot accepted by the backend. Existing canonical JSON import is also available.
- Capture has explicit 24 KiB inner-event, 64 MiB aggregate, 3,000-event and 300-second limits. A fresh capture reserves sufficient room within the unchanged 4,096-command lifetime replay budget. Long SDK reads report bounded progress without consuming new request IDs. Oversized/partial work fails rather than truncating.
- Shared locations support either endpoint, aliases, explicit canonical coordinates, reviewed picks and candidate bottom centres. An explicit **Use as manual coordinates** action drops object binding when a picked object is absent from the prepared snapshot while retaining coordinate derivation.
- The UI wires automatic/selected/all-cable proposal jobs, progress/cancellation, immutable proposal details, exact path preview, explicit review and a separate idempotent Apply. Real-model Apply remains disabled while engineering acceptance is unavailable; the isolated synthetic-fixture path is clearly labelled. Installed length is preserved by the server contract.
- Ready cables always generate proposals automatically. Only explicit Calculate buttons request a forced new job; automatic requests retain server deduplication. Preview loading remains visible until the protected Viewer acknowledges the complete exact path, then review becomes available. Proposal text groups have separate block spacing.
- Manual ordered lookup and Reverse preview use the unchanged C# lookup through its fenced diagnostic job endpoint. The user explicitly supplies route codes and connection tolerance. Exact returned points are displayed without invented equipment approaches, SECONDARY allowances or design length; original cable From/To labels remain visible and unchanged. Lookup results cannot be applied and stale results are not displayed.
- Blank From/To and unsupported categories link to existing cable editing. Blank endpoint resolution is disabled until an explicit name is saved. The original Details tray-list formula remains unchanged, with an English note explaining the separate PathFinder formula.
- Existing cable history labels `pathfinder` writes as **PathFinder apply**. The manual Routings input now reflects its existing 8,000-character server/protocol limit.

## Actual automated checks

| Check | Result | Scope |
|---|---|---|
| `npx tsc --noEmit` | PASS, exit 0 | Frontend compile including new UI, API DTOs and controller |
| `node --test viewer-runtime/test/*.mjs` | PASS, 104/104 | Existing rendering/protocol regression plus exact merged-cylinder axes/radius/reversed/vertical/maximum budgets, one-point zero-length marker and bridge framing, zero-ID Ghost and exact visibility restoration, picking, metadata, capture framing/budgets and the runtime worker's capture/strict C# interop tests |
| `npx vitest run src/api/pathfinder.test.ts src/pages/ProjectDetails/hooks/usePathFinder.test.tsx src/pages/ProjectDetails/PathFinderTab.test.tsx src/viewer/ViewerController.test.ts src/pages/ProjectDetails/RoutingsViewerTab.test.tsx` | PASS, 71/71 | API4, hook6, PF tab14, controller17 and existing Routings30: integer cable IDs, exact revisions, current-role/scope refusal, point provenance/reuse, explicit preparation, one-point zero-length review, review acknowledgement/Apply gates, forced-only-explicit retries, native diagnostic lookup/reverse and stale suppression |
| Targeted ESLint of 11 new/changed frontend files | PASS, exit 0 | API, hook, tab/results/lookup UI and tests, legacy Details note, protected controller and tests |
| Overlay/one-point follow-up: affected frontend tests, compile and ESLint | PASS, 31/31 plus both exit0 | PF tab14 and controller17 include exact single-point transport and zero geometric length / 7m allowance review. The native unchanged C# result was independently demonstrated by the parent task. |
| Runtime preparation before capture module was added | PASS | 217 files, original pinned SDK hashes verified; final candidate must rerun preparation/build with the new capture allowlist entry |
| Initial actual localhost PathFinder browser flow | PASS with two observed failures awaiting incremental retry | Parent computer-use verified admin/engineer access, 664556-fragment Aalborg, selected capture52 objects, actual surface pick/manual-coordinate save and reload, shared From/To resolution, synthetic automatic proposal/review/Apply/history and settings-only recalculation. Empty-ID Ghost and review spacing failed in that first image and are corrected in source; final retry remains pending. See the exact image identities, screenshots and individual results in `evidence/pf7/computer-use-20261018T0211Z.json`. |
| Native/converted engineering parity | BLOCKED | Existing PF-2 licensed-reference blocker is unchanged; real-model Apply remains gated |

## Changed implementation areas

`src/api/pathfinder.ts` and tests; `src/api/types/cable.ts`; `src/pages/CableDetails.tsx`; `src/pages/ProjectDetails.tsx` and `.forms.ts`; `src/pages/ProjectDetails/PathFinderTab.tsx`, `PathFinderResults.tsx`, `PathFinderLookup.tsx`, tab tests and `hooks/usePathFinder.ts`/tests; `DetailsTab.tsx` explanatory note; `RoutingsViewerTab.tsx` input limit; `src/viewer/ViewerController.ts`/tests; `viewer-runtime/protocol.mjs` and `.d.mts`, `bridge.mjs`, `adapter.mjs`, new `pathfinder.mjs`, new capture module/declaration and tests; runtime preparation allowlist.

The capture module and its tests were implemented by the runtime worker; server/admin authorization, registry, jobs and Apply were implemented by the backend worker. These independently owned changes are part of the integrated candidate, not duplicate standalone implementations.

## Final local visual verification

The parent checked the final API `562e8073…` / web `81bb13b4…` image through
computer-use. `evidence/pf7/computer-use-final-20261018T0237Z.json` records the
real selected-network lookup/Reverse35.30345579516123m, original tray colors,
bright yellow tube and filled Ghost. Synthetic empty-object-ID Ghost and
readable review blocks now pass. Single-point0m geometry/design7m completed
its Viewer acknowledgment and explicit review; that result was not applied.
The shared TO point was restored toX10 and both automatic10m/design18m
proposals completed. Clear restored original opaque colors/visibility on this
same final image. These fresh observations resolve the two first-image failures
without rewriting their historical receipt. Camera restoration is not claimed.

## Remaining acceptance work

Complete the PF-8 combined-state backup/restore and real child-crash evidence.
Native paired geometry, complete plant capture/capacity and engineering Apply
acceptance remain unavailable. Do not mark PF-2/native engineering parity
complete or enable real-model Apply without its missing evidence.

No original WFC/PathFinder checkout, synced `sources/`, original application containers, database, storage or volumes were modified by this Viewer work. No publication, push, PR, merge or deployment to the original installation was performed. The two previously denied cleanup directories were not touched.
