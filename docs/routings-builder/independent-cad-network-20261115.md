# Independent CAD network: implementation and actual acceptance

Superseded by [automatic CAD connectivity](automatic-cad-connectivity-20261115.md). The manual Independent route checkbox has been removed; current routing derives connected components using the project connection gap. This document records the historical preceding acceptance only.

Date: 2026-11-15. Source main `c61576b` plus the independent-network implementation. Acceptance targets only owned test project `ae17e968-d588-4e59-ad6b-2ceca9fd1e36` on 5181. No GVL244 or Aalborg business network/barrier/cable changes are part of this acceptance.

## Implemented behavior

- Draw trays offers an explicit Independent route choice. It can publish a saved connected CAD group without claiming a physical attachment to the existing model trays.
- Publication requires explicit version 2 input and zero base attachments. The server derives both genuine physical endpoint ports and the centerline from the approved SHA-pinned STEP, and verifies the actual native composite network before publication. Historical attached publication retains the original 1 mm/profile/orientation checks.
- Version 2 overlay payloads fail closed on old native workers. Independent pieces are separate graph components: neither distance fallback nor coincident compatible ports invent a connection to another route. Members inside one saved connected route remain connected. Endpoint approaches retain existing geometric/barrier checks. Isolation participates in memory and persistent graph identities and all routing variants.
- Add to Trays creates the ordinary catalog record. Base preparation recognizes the exact current-model persisted CAD export, retains its catalog/purpose dependency, and records its ID as deferred CAD geometry instead of assigning invented SDK objects. The UI identifies saved CAD geometry and prevents manual SDK assignment to it. Actual routing geometry enters only through verified publication.
- Successful publication and withdrawal record transactional geometry recalculation events, including when the catalog row already existed. Event-recording failure rolls back publication. Draft and color-only edits do not signal topology changes.
- The original prepared base is still required. Publishing against one base does not silently reauthorize its proof against a different subsequently regenerated base. Structural changes require deliberate withdrawal/republication. Separately saved independent groups do not implicitly join; connected components should be saved as one connected complete route.

## Automated verification

Native: 268 checks pass (82 constrained, including 10 new isolation checks; 42 graph reuse; 113 regression; 31 manual ordered). Nine actual ModelRunner process overlay checks and four shared payload checks pass. Native build has zero warnings/errors.

Application: 63 publication/CAD panel checks pass; 192 preparation/context/shared/overlay/panel checks pass; one additional deferred-CAD UI check passes. Existing useProjectPreparation hook checks passed in the combined run; an obsolete SQL string assertion in that run was corrected and the complete 21-check context suite passed afterwards. Client and server TypeScript, scoped ESLint, and whitespace checks pass. Independent read-only integration review found no remaining blocker.

## Actual owned data and real capture

- Imported the user's untouched actual 439112840-byte ZIP through the ordinary model import API. Package `cc477b02-e0f9-47bc-b965-7064e93404fe`, model `1c29125c-4ce8-4114-bb9c-c93a210a70c3`, fingerprint `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`; selected healthy/ready at revision 1.
- Added only actual source tray BC001 through normal HTTP, plus the owned CAD test row. Configured both purpose rules for Control; copied a real Materials cable type through its normal API.
- Saved actual Niedax KL 60.303 F STEP instance `6332378e-2d81-4437-b5e0-ff849061cb5e`, 6000 mm, at canonical world position (100,100,10) m. Its true centerline runs (100,100.03,10) to (100,100.03,16) m. Material asset `43480ed6-32cc-46ca-a6c5-fc642ff6baef`, SHA-256 `d381a3f4a09559e99119e3e591137f73780d16bf832019f93b20627adc5609cd`.
- Saved route group `08dd98e9-c722-4947-8fc3-80c4bd5ff9f7`, tag `WFC-CAD-E2E-001`, and exported ordinary Trays row `b7871a00-2258-4c8b-b931-c0f5870d8547` before base generation.
- Root used the built-in browser to discover real BC001 and generate the current network. Actual saved session `b15cdc61-e51e-4ade-a19a-fdd9a4689e8b`, aggregate `383ad78c-6ee3-4bee-8b61-972c2ee87d20`, artifact `880c7e1a-8c98-4ab3-a911-9d2b77a3522c`, frame `f8514b38-e9fa-4675-a98f-7deac664033b`. Nine real SDK objects, two physical leaves, six fragments, 2296 vertices, 2092 triangles. The saved requested scope includes only BC001 as SDK geometry and exactly the CAD row as `deferredCadTrayIds`. No copied/relabelled snapshot was used.
- Confirmed two fixed test points on the genuine CAD centerline: (100,100.03,10.25) and (100,100.03,15.75) m. No linked SDK object was asserted. Created one blank/unprotected/nonexecuted cable `da32ee6c-c06d-4894-89d8-1babce987eda`, tag `WFC-CAD-E2E-CABLE`.

## Actual automatic-routing PASS

Root registered and published the genuine `/ACS_JB` model selection as an Obstacle through the built-in browser. The accepted active mixed-mesh snapshot is `f476ed7f-17d1-4a3b-8d63-b7b09aed0f44`, revision 1, SHA-256 `89152776823a9692d7d73d354793d251c559ef49800451b8773afc85dc142578`, exact current model/frame. No empty-barrier declaration or fabricated geometry was used.

1. Actual independent Publish accepted the real native composite of two freshly captured BC001 pieces plus the genuine CAD segment. It reused the previously exported Trays row and advanced generation 19→20 (`CAD_ROUTE_PUBLISHED`, group revision 2).
2. Unused route withdrawal succeeded, retained the Trays record, and advanced generation 20→21 (`CAD_ROUTE_WITHDRAWN`, group revision 3).
3. Enabled a finite 30-minute automatic period only in the owned single-cable project, with explicit current active barriers, drilling false, secondary distance 2 m and automatic output policy. Baseline generation 23/job `7ec146ba-83f4-4d7c-8df5-c9180abf9364` wrote `/SECONDARY`, Design/auto length 7 m. This baseline is not claimed as CAD usage.
4. Republished the independent group (revision 4), advancing generation 23→24 solely through the publication geometry event. Without any manual Calculate, Review or Apply, the background scheduler created job `0de4dd10-acde-43f2-9fac-26dd15ba9b5d`, completed 1/1, and the automatic writer replaced the unchanged automatic baseline with `/WFC-CAD-E2E-001` and 7 m Design/auto length.
5. Exact native result: segment IDs contain `cad:08dd98e9-c722-4947-8fc3-80c4bd5ff9f7`; route codes contain only `/WFC-CAD-E2E-001`. Native points are the two saved centerline endpoints, raw length 5.5 m, zero approaches, zero connection gaps and no SECONDARY ends. Current overlay SHA is `1e915e7c6adbdab673817ada04d32782640580afeb32725a2a08bad56f6f5ffe`.
6. Actual mixed barrier proof is `clear-selected-scope`, `REGISTERED_SCOPE_CLEAR`, 1/1 segment checked, no blocking point and drilling false. The pure production proof recognizer returns valid barrier write evidence with status `clear`. Its canonical engine result SHA `fd6b94b348cd80cfe35946c3f63a50d560e89409dddb6ebf3e3e25e1b5ee298e` equals the receipt's sealed result SHA.
7. Proposal `5bb747f9-6f65-45c0-9dc1-06dc93fd3f7a`, hash `55d51051a4e372e0346574076fdd7504a218d3f3d6adea8a3593ac04a6c58f82`. Immutable automatic receipt `e279df38-0de8-4c76-a4e4-8163719a8ea7` has `validationMethod: automatic-owned-pair`, before `/SECONDARY`, after `/WFC-CAD-E2E-001`, Design 7. Business row readback and ordinary workflow API agree; workflow is current/accepted and automatic output status written. Manual protection and execution protection remain false.
8. Standard length ledger: 5.5 m raw + 10% bending (0.55) + zero end/secondary reserves = 6.05 m; ceiling gives 7 m. The route's full physical centerline is 6 m, while cable endpoints use 5.5 m of it.
9. A later attempt to withdraw this now-used route correctly refused with HTTP 409 `CAD_ROUTE_IN_USE`, without changing its published revision, generation or cable values.
10. Disabled only the owned automatic period normally. Final context: enabled false, status disabled, control revision 2, desired generation 24. Final route, cable, model, real barriers and immutable evidence are retained for inspection; no test data was deleted. Root verified the actual cable dialog and Show→Hide behavior in the built-in browser, screenshot `D:/WFC-Test/validation/independent-cad-network-20261115/automatic-cad-route.jpg`.

Exact evidence is `cad-routing-e2e-exact-witness.json` beside this report, plus normal HTTP stage receipts named `cad-routing-e2e-{points,enable,publish,status,disable,withdraw}-*.json`. The witness script is read-only, project-fenced, and asserts actual native CAD identity, business Routing/Design, immutable automatic receipt and production barrier proof. Ordinary project/model import and genuine browser capture preceded these checks; no source snapshot relabeling, direct SQL writes or manual calculation substitution occurred.

Result: actual CAD save → Trays export → fresh real base generation with explicit CAD deferral → native-verified independent publication → publication-triggered background calculation → automatic business write → browser Show **PASS** on 5181. Cleanup recommendation: retain the clearly labeled owned validation project and disabled period until the user finishes review, then remove it only through an explicitly requested project cleanup.

## Final ordinary-app rollout

The coordinating root deployed the exact tested API image `246dba85eeca128a3803da4caf5b0aee4880b8539451ca5017af13f7e28e0c0e` and web image `4b9040f84b86c1491b5ad115ba3ca568ed7dde060c690f0d908df5af13066a46` to 5180, waiting for backend health before replacing the frontend. Both ports return HTTP 200 health, API services are healthy, and both running web containers use the same tested image. Converter services remain healthy and unchanged. Previous 5180 images are retained under `wfc-rollback/*-5180:before-independent-cad-20261115`.

After-rollout integrity check across 22 original business-table comparisons on 5180 and 24 on 5181 reports zero mismatches. It compares original project ID scopes and original model/package records, excluding the new owned test project and transient background-job state. Evidence: `D:/WFC-Test/validation/independent-cad-network-20261115/original-business-integrity-after-5180-rollout.json`.

5180 browser smoke verification covers authenticated project loading and the ordinary Routings builder → Draw trays surface. The full automatic CAD acceptance above ran on 5181; it was not repeated against a real working project on 5180.

SDK Model Browser search results reveal/isolate without selecting an object. Actual tree-label selection was used for barrier capture; this is pinned SDK behavior, not a cleared application selection.
