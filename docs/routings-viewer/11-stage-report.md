# Stage11 — Final integration report

17 October 2026. **Technical localhost candidate: PASS. Final user/environment acceptance: pending.** The [acceptance record](11-integration-acceptance.md), individual original-criterion rows appended to the [validation matrix](00-validation-matrix.md), and [office instructions](11-office-update.md) define the evidence and remaining gates.

## Preserved starting state and publication authority

The original WFC checkout was `stage10-operations-ghost-20261017` at `e4093109e7e10552f1f61093486b9b9fa9bce37b`, with both unpublished cable-export commits209cf911ba8045aa4c6b2ef2f9d8a0dfb21cc8ee/e409310 and the full dirty stages4–10 implementation. Initial live GitHub main was `d5454b3c4c547c24631e37e24d35f76739228867`. The new `stage11-integration-acceptance-20261017` branch preserved all of that work. No reset, clean, stash, clean-HEAD replacement or PathFinder merge was used. Synced project sources remained read-only.

The user's later direct instruction expressly authorized merge and publication to GitHub main, overriding the attachment's earlier no-push/merge restriction. The office installation uses the same app container names. No office host was selected or accessed. The final commit/main identity and actual GitHub observations are in `E11/evidence/publication.json` and the delivery manifest. Initial combined statuses were empty and the dirty candidate was unpublished; neither is CI PASS. No workflow directory exists in this candidate. An unrelated open PR#1 was reviewed only as repository context and was not merged or attached as this work.

`E11` is `C:/Users/todor.chankov/Documents/Codex/2026-10-17/wfc-acceptance-output`; `E10` is `C:/Users/todor.chankov/Documents/Codex/2026-10-17/wfc-operations-output`.

## Changes confined to demonstrated needs

An actual isolated HTTP/DB reproduction showed that a selection PATCH could wait behind the project row lock while the editor's assignment or role was revoked, then mutate using its earlier middleware decision. The fix requires authenticated `req.userId` through the service/repository and rechecks the current editor inside the selection transaction, after the project lock and before CAS/update. User/assignment row share locks retain the decision through commit. There is no optional actor/default/body-supplied actor bypass. Two new real HTTP held-lock regressions independently revoke assignment and role and assert403 with unchanged selection. Existing full model-readback/CAS/session behavior remains.

Other release corrections: `.env.*` is ignored with `.env.example` preserved; all six already tracked generated dist files were removed from the Git index while their working files remain available for builds; the final app Compose build disables the diagnostic Viewer harness. Trusted SDK/verifier distribution and225 byte-sensitive attribute rules remain. No geometry, route data, SECONDARY, engineering calculations, Change Orders business behavior or PathFinder code was changed by Stage11. Prior stage changes to shared WFC components were preserved and tested.

## Executed verification

| Check | Result and scope |
|---|---|
| Stage10 applicability baseline |783 source/4 documents/109 evidence/14 Preparer operations files SHA/size matched; source inventory SHA64e989e0aa4dac1af75d0186165c8df146f97998dac252e2eed7090558a9acbb; evidence index SHA04b566d57d0aa20bf71a938a9c5f5de73a1123e89f9fa0cc10a7d474c699a345. |
| Common WFC regression |1960 PASS,0 FAIL,4 explicit DB skips under nonroot Linux Node24.22/network none; existing cable export and137 engineering checks included. The four DB cases separately passed against a real isolated DB. |
| Final backend |27 PASS/0 SKIP actual PG/MinIO/HTTP, including both permission regressions; overlaps the earlier25, so it is not an extra52 unique cases. |
| Final TypeScript/lint/build |Frontend+server TypeScript and full lint PASS; production web and final server builds PASS; exact final app images built and tested. |
| Integration review |Frontend16-file and backend27-file bounded reviews plus Git/PathFinder/deployment review; no additional high-confidence actionable finding. |
| Fresh production browser |28/28 PASS on Chromium153.0.8010.12/final API/web:342 real resources, model/index/properties, both routes, Ghost both starting preferences, Manual/Cables/information/clipboard/layout, selection races, read-only ACL, logout/reopen.2284 requests/40workers; external attempts0/CSP0/unplanned business writes0. |
| Ghost visible proof |Same-camera nativeOFF control:478660 changed nonyellow pixels with yellow2060/2000; original tray colors and translucent background visibly inspected. New Clear/repeat proof is separated from reused Stage10 dispose-unit proof. |
| Existing full backup readback |All17 delivered file size/SHA checks PASS for working backup7587d0f5; no new working cold backup or long Preparer replay. |
| Old office schema drill |9/9 PASS: exact old d545 initializer/38 tables, modern-backup refusal before mutation, binary dump+cold raw storage, fresh restore preserving old values/object, current initializer adds10 tables without choosing a model. Same-host synthetic data and inert app placeholders; not an office or old-UI test. |
| Deployment/preservation |Only original app backend/frontend recreated with final images, healthy on5180; original credential settings retained. Final receipt compares all51 non-session table hashes, HPU active UUID/revision, original data mounts/states and unaffected service start times. |
| Publication hygiene |Complete candidate inventoried including untracked modules/vendor files; no real env/private model/archive/evidence path in Git, no matched current real runtime secrets. Git normalization is distinct from pinned vendor bytes. |

The common suite captured412 source/config files before the backend correction; only the six corrected backend files differ. Those received the final27-case DB run and final build/typecheck/lint. This reconciles executions with the final candidate instead of claiming that a different image ran the complete suite. Package/Preparer/operations suites were reused only where their source groups are unchanged and receipts are present.

The original working project remains **HPU Aalborg 2023**, ID `0c0007c9-d73f-4d13-bc87-601c544727b7`, active model `9dbe511d-9c51-49e8-bb4a-b52033b98f35`, selection revision1. Selection/cable/rights mutation checks used owned fixtures. Stage10 working-data restore and Stage11 synthetic production-browser checks are complementary executions, not the same restored-data browser test.

## Reused operations and release images

Final app images are API `sha256:481326351dbfa8acc86afe4d2543a1b96a05d523dd95a4715928f7f25418854f`, web `sha256:4fd723d0a02a742c7f9c0fda0592573abf14cec587b801a20fa0eaea24d0f326`; final operations helper remains `sha256:6b358690a5fc4c26776c48f5cd193ff268d6f593c2896b7db966c689b2860dc7`. The old Stage10 API17b3/web9c1 archive and restore evidence retain their actual historical image IDs. The selector authorization fix and disabled diagnostic web route are not falsely treated as byte-identical old images. Operations/schema/session/storage algorithms are otherwise unchanged; the corresponding historical raw-resource/restoration/Preparer proof is retained.

The original verified working backup remains2317652394 bytes, ID `7587d0f5-13d8-40a9-ad72-461229d3675d`, manifest SHA `ee9c33eca9a6e78ea798918f27558304b99ead30477e67ffec3bfb3582e67868`. Original ZIPs, model resources, private protected operator configuration, Preparer state and all rollback images were preserved. New app image rollback tags are recorded in the deployment receipt/log. The application-only office kit contains verified ID-only API/web/helper archives and no home business DB or MinIO dataset.

## Preserved failures, cleanup and limits

The first Windows common runner stalled before useful test completion; an offline-build cache miss and a read-only Vite-config temporary-file error were retained. The corrected isolated Linux observer completed the full suite. Initial DB totals parsing expected TAP while Node24 emitted its spec summary; immutable successful logs were correctly classified without fabricating a rerun. The first new browser observer expected `found` for a database status whose actual contract is `exists`; its failure remains alongside the corrected final28-case run. A raw expected CAS conflict case contains HTTP `status:409`; the compact receipt separately identifies it as a passing409 assertion. No failed artifact is overwritten or counted as a successful execution.

Stage11 cleanup is scoped to its owned disposable resources; Docker ownership/foreign-mount checks precede removal. Working app/helper/rollback images, delivery, input and evidence remain. Historical Stage10 blocked negative-clone deletion (24 files/982529770 bytes) and the older blocked native probe were not retried or bypassed. They remain a separate inherited cleanup limit, so this report does not claim all temporary host files from every stage were removed.

Final retained-fixture teardown removed25 containers/17 volumes/9 networks,6 synthetic archive/restore directories with1470175826 bytes, and one unreferenced owned456848246-byte logical test image. Shared layers/cache were retained; exclusive image freed bytes were not measured. Remaining owned fixtures:0. Final original count:13. The51 non-session canonical table hashes, full selection-table hash, original credentials, mounts/ports/networks and unaffected service IDs/start times match. `E11/evidence/final-preservation.json` is the measured result. The final office operator additionally passed its exact-source three-command workflow and4 uniform-image guard tests; its receipt is `E11/handoff/legacy-drill/legacy-office-delivery-proof.json`.

PathFinder is unchanged clean master45c24bf5f433f13e102600b36f20327c77961d0a. Viewer has no direct PathFinder types/imports/graphs/services/algorithm dependency. Shared future WFC edit surfaces include ProjectDetails/hooks/styles, AuthContext/http, server app/db/middleware/routes and package/Docker/Nginx/Vite/operations. No incoming WFC PathFinder integration branch was identified; exact conflicts are UNKNOWN.

The local technical, offline-runtime, operations-applicability and independence gates are PASS. Another machine, a fresh Docker engine, LAN/VPN HTTPS/other architectures/browsers and user acceptance remain NOT_RUN. Non-loopback HTTP is refused. FINAL_ACCEPTANCE is BLOCKED pending those original environment requirements or an explicit scope decision and the user's visual acceptance. [The acceptance scenario](11-integration-acceptance.md#user-acceptance-scenario) gives exact address/project/model/actions; automated success is not user approval.
