# Stage11 — Integration checks and acceptance

17 October 2026. Technical scope: Windows host, Docker Desktop Linux/amd64, Node24, production WFC at localhost HTTP. Human acceptance and untested deployment environments are separate gates.

The release revision is the commit containing this report on GitHub `MrToKa/WFC` main. Exact local/remote commit IDs, publication observations and CI status are recorded in the external Stage11 publication receipt and office delivery manifest. The candidate inventory includes the complete previously uncommitted stages4–10, both existing cable-export commits, offline SDK/runtime, verifier and operations tools. It does not identify the implementation by the old HEAD alone.

Evidence root `E11`: `C:/Users/todor.chankov/Documents/Codex/2026-10-17/wfc-acceptance-output`. Historical root `E10`: `C:/Users/todor.chankov/Documents/Codex/2026-10-17/wfc-operations-output`. Evidence is retained outside Git; private configuration and real credentials are excluded from public evidence. The [Stage11 section of the validation matrix](00-validation-matrix.md#stage11--final-integration-and-acceptance-17102026) records every one of the168 original criteria individually, with implementation, evidence, new/reused scope, inventory/revision, environment, result and limitation. Historical rows and their134831-byte prefix remain unchanged.

## Final gates

| Gate | Result | Exact scope and outstanding condition |
|---|---|---|
| TECHNICAL_CANDIDATE_LOCALHOST | PASS | Full common WFC regression plus final affected real-DB regression, TypeScript, production builds, lint, reviewed integration, actual production browser and preserved working data. |
| OFFLINE_RUNTIME | PASS | Chromium153.0.8010.12, fresh contexts, local model/index/properties,2284 observed requests/40workers, no external request attempts, boundary denials or CSP violations. No Preparer in the fixture. |
| OPERATIONS_EVIDENCE_APPLICABILITY | PASS | Exact Stage10 evidence checked, all17 delivered backup files rehashed, unchanged operations/Preparer groups reused. New release images have separate source/test bindings; old restore results are not relabeled as new-image executions. |
| PATHFINDER_INDEPENDENCE | PASS | Separate clean PathFinder master45c24bf5f433f13e102600b36f20327c77961d0a; no direct imports, graph/types/service/algorithm dependency. Exact future WFC integration-branch conflicts UNKNOWN because that branch was not identified. |
| OTHER_MACHINE_RESTORE | NOT_RUN | No other physical target was provided/authorized. Office instructions and application-only delivery prepared; own-machine fresh volumes are not another computer. |
| FRESH_ENGINE_PORTABILITY | NOT_RUN | Archive closure/platform/ID proof exists on this cached engine. No empty independent Docker engine was exercised. |
| LAN_HTTPS_OTHER_ENVIRONMENTS | NOT_RUN | Only localhost HTTP was checked. Viewer rejects non-loopback HTTP; changing an allowlist alone cannot enable it. LAN/VPN HTTPS, other OS/CPU and other browser families need their own checks. |
| USER_ACCEPTANCE | NOT_RUN | The scenario below awaits the user's observation and explicit response. Automated screenshots are evidence, not approval. |
| FINAL_ACCEPTANCE | BLOCKED | Await user acceptance and a decision/proof for the original external-environment criteria. Technical localhost completion does not close those criteria. |

The whole original ARC-09/AUTH-13/OPS-08 requirements remain NOT_RUN where they require the untested environments; their successfully checked localhost/same-host parts are recorded individually. PREP-02 also remains NOT_RUN for a new real upload/conversion. No APS request, conversion, price check or proof renewal was performed in Stage11.

## Candidate and execution binding

| Artifact | Binding |
|---|---|
| Final API | `sha256:481326351dbfa8acc86afe4d2543a1b96a05d523dd95a4715928f7f25418854f` |
| Final web, diagnostic harness disabled | `sha256:4fd723d0a02a742c7f9c0fda0592573abf14cec587b801a20fa0eaea24d0f326` |
| Unchanged operations helper | `sha256:6b358690a5fc4c26776c48f5cd193ff268d6f593c2896b7db966c689b2860dc7` |
| Unchanged route geometry | SHA256 `4d10d66dca31f10b82926693a0e7438e68f448047f3f991baabb82f6ed2573fa` |
| Full source inventory | `E11/evidence/final-source-inventory.json`; current working-tree bytes, all nonignored candidate files, vendor pins and per-group changes. Git text normalization is distinguished from225 byte-sensitive files with text unset. |
| Publication and transport | `E11/evidence/publication.json`, `E11/office-update-kit/manifest.json`; actual commit/main binding and application-only file hashes. |

The common Node24.22 Linux suite ran in a nonroot container with network none/read-only root:1960 PASS,0 FAIL,4 optional material-DB skips. Those four named tests separately passed against an explicitly isolated PostgreSQL database:4 PASS,0 SKIP. The common image predates the narrow six-backend-file permission correction;406 of its412 captured files remain byte-identical. Final server build/typecheck/lint and27/27 real PG/MinIO tests, including both new HTTP permission races, bind the changed scope. These overlapping results are not added into an invented unique total. No changed frontend/runtime source escaped that common-suite snapshot.

The production browser used a different, explicitly owned fixture and the final API/web images, with no compiled-source replacement of the browser's production API. It imported the original439112829-byte Aalborg ZIP, SHA256 `8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5`, and loaded342 resources/439007803 raw bytes, fingerprint `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`. Loaded model observations:664556 fragments,438156 nodes and6 property samples.

All28 production cases passed. They cover explicit UUID/null/reselect/no-op, actual stale CAS409, a lost committed PATCH reply followed by GET reconciliation, project-A late metadata after navigation, both Ghost initial states and both routes, independent DB/model misses, late cable A→B/null routing, hover/keyboard/pin/copy/fallback/refresh/deletion/layout, read-only access, real ACL revocation, and the unified Details→Manual→Cables→information→Clear→logout/reopen flow. Seven intentional selection PATCH requests and one login-specific revoke were separately allowed. Unexpected browser business writes:0. Direct fixture setup/control changes were confined to synthetic projects and are recorded separately.

Fresh contexts and the whole-browser/worker exact-origin boundary remained active until closure. Resource-model sessions were retired on selection/null, project/Details unmount, ACL revocation and logout. Logout returned204; the previous resource cookie returned410; fresh login created a new load/instance. This proves the observed Chromium profile, not a complete browser matrix.

New visible Ghost proof compares a settled route/camera against the native Ghost-OFF positive control:478660 changed nonyellow pixels,2060/2000 yellow pixels. The translucent surrounding geometry and original tray colors are visible in retained screenshots. New browser checks prove repeated Show/Clear and restoration of the initial OFF/ON preference before teardown. Exact material/preference restoration inside a disposed instance is covered by unchanged Stage10 Node tests; it is not asserted observable after destroying that iframe. Geometry, SECONDARY handling and engineering lengths were not rewritten.

## Evidence catalogue

| Key | Concrete artifact / result | Mode and applicability |
|---|---|---|
| BASELINE | `E11/evidence/stage10-applicability-baseline.json` | New SHA/size verification of783 source files,4 documents,109 evidence files and14 Preparer operations files. |
| SOURCE | `E11/evidence/final-source-inventory.json` | New complete candidate and source-group comparison; source inventory describes working bytes and release receipt supplies commit identity. |
| COMMON | `E11/frontend/linux-evidence/regression.json`, `vitest-linux.json` | New1960PASS/4SKIP; raw report SHA1511ad3173da90a8062cabb9a3aaeff4f101f750eb4254cb9c838ac9b270091a. |
| MATERIAL_DB | `E11/backend/material-db-result.json`, `material-db-vitest.json` | New4/4 actual DB cases, no skips; unchanged schema source remains applicable. |
| FINAL_DB | `E11/backend-final/server-db-tests.json`, `server-db-tests.log` | New27/27 actual DB/storage/HTTP cases; log SHAa300cc663271ce6249b6c9820d5e0bb8d50197c465353d521f28460dfe5d3f96. |
| BUILD | `E11/evidence/typecheck-final.log`, `lint-final.log`, `production-build.log`, `server-build-final.log`, `docker-build-api.log`, `docker-build-web.log` | New host Node24.19 TypeScript/lint/build and exact final Docker images. Cached dependency layers were used; default build networking is not offline runtime proof. |
| REVIEW | `E11/frontend/frontend-lifecycle-review.json`, `E11/handoff/backend-integration-review.json`, `pathfinder-git-deployment-audit.json` | New bounded source reviews and PathFinder/Git observations; no additional concrete defect beyond the corrected selection race. |
| BROWSER | `E11/browser/production-browser-final-summary.json`, `stage11-browser-1792235285515-3780ad38-production.json`, `execution-1792235670496.json` | New28/28 actual production cases; raw report SHA907cb0ce4a3b184accfb803cf26cf5eafdedb81bbd10f0dbe023335b9debee0e. |
| OLD_OPERATIONS | `E10/evidence/stage10-gates.json`, `restored-working-final-1792230560792.json`, `restore-sessions-1792230080946.json`, `negative-abeb1c46-b480-4415-a5fe-d23ca59a88cb.json`, `ghost/ghost-change-evidence.json` | Reused exactly identified original-data restore/session/raw342-resource/negative/Ghost results. Old API17b3/web9c1 executions are historical. |
| BACKUP_READBACK | `E11/evidence/stage10-backup-readback.json` | New read-only complete file SHA/size check of existing7587d0f5 backup; manifest SHAee9c33eca9a6e78ea798918f27558304b99ead30477e67ffec3bfb3582e67868. No new working cold capture. |
| OLD_PREPARER | `E10/preparer/evidence/preparer-final-summary.json` and its referenced receipts | Reused exact14 operations source files, original backup/restore/resource proof; no Stage11 Preparer restart or cloud operation. |
| PACKAGE_PREPARER_SOURCE | `E11/evidence/package-preparer-source-applicability.json` | New read-only24/24 Package source match;65/72 Stage3 Preparer files unchanged and all5 approved English runtime files match their English-followup inventory. Remaining changed test/docs are explicit; unchanged core and Stage10 operations proof are reused. |
| LEGACY_OFFICE | `E11/handoff/legacy-drill/legacy-drill-ca82638f-0bca-4c3e-a568-13b3fbc440a0.json`, `legacy-office-delivery-proof.json` | New exact old d545 initializer→fresh restore→current initializer drill;38 old tables/old fields/object preserved,10 new tables created. Final delivered operator SHA95ed500d1135b4a80e1efcd357a6ad29664a7bd7de4ddf00a4a207396bd018e6:backup/verify/prove-restore3/3PASS, uniform-worker-image guards4/4PASS. Inert old app placeholders are not an old-UI runtime test. |
| PRESERVATION | `E11/evidence/deployment.json`, `final-preservation.json`, fixture cleanup receipts | New exact tested images deployed only into original app roles; credentials/data/mounts retained,51 non-session table hashes and HPU selection checked. |

Every original criterion's detailed record is also retained in `E11/evidence/original-criteria-final.json`. Status is PASS, FAIL, BLOCKED or NOT_RUN, with historical-only PASS explicitly distinguished from a new execution. The evidence index binds the final records rather than overwriting failed attempts.

## User acceptance scenario

Open [the working application](http://127.0.0.1:5180), sign in normally and open **HPU Aalborg 2023** (project `0c0007c9-d73f-4d13-bc87-601c544727b7`). Its active model remains `9dbe511d-9c51-49e8-bb4a-b52033b98f35`, selection revision1. This original project was not used for mutation fixtures.

1. In Details, confirm the active3D version and that saving an unchanged choice is disabled. Use a separate test project for changing/removing/reselecting a model. No latest version should activate automatically.
2. Open **Routings viewer**, immediately between **Cables list** and **Trays**. Check the English UI,320px desktop panel, light3D view, usable remaining height and a smaller window.
3. In **Manual routing**, show `/DFB018-1/DFB011/DFB012/DFB013/B002/B107-1/B107-2/B107-3/BC025/BC022-2/SECONDARY`. Inspect the continuous yellow line, original tray colors, close connections and final segment. SECONDARY does not become geometry.
4. Show `/DFBC002-2/DFC001/DFC002/DFC003/C002/C107-1/C107-2/C107-3/BC025/BC023-4/SECONDARY`. Inspect DFC003→C002 and the complete BC023-4 end. Zoom and Clear should use the current result.
5. Start with native Ghost OFF, Show a route twice and confirm the surrounding model becomes translucent. Clear should restore OFF. Repeat with Ghost ON; Clear should restore ON. Visual feedback about the density/clarity is still welcome.
6. In **Cables**, search while typing and select a real tagged cable. Confirm its current route loads. A cable without routing clears the previous line. Duplicate tags remain separate cable identities.
7. Hover a cable for about one second, move onto the information panel, inspect original **From**, **To**, **Routing**, then Pin, select text, Copy/Copy all and Close. Keyboard access and manual copying remain available if the browser refuses clipboard permission. These information actions should leave the displayed route unchanged.
8. Clear the route, switch project/tab and sign out. Reopen and sign in; no old route/panel should return from the previous login. Report observations before the USER_ACCEPTANCE gate is changed.

## Office handover and remaining limits

Use the Bulgarian [office update guide](11-office-update.md). Copy the application-only kit and the existing portable model ZIP before leaving this machine. The kit contains exact app/helper image archives, verified operator modules and a manifest; it contains no home business database or private runtime configuration. A pre-Viewer office needs a verified **pre-migration legacy cold rollback**, because the modern model-aware backup requires tables and staging it does not yet have. Do not start the new API merely to manufacture that prerequisite. Keep the office's own data and choose its project UUID explicitly.

The verified local backup and original Preparer backup remain available. Image rollback alone does not undo database migrations. Keep rollback images and verified data archives until acceptance. No RPO/RTO or automatic deletion deadline is invented. Historical blocked host-directory deletions were not retried by another tool and are not claimed removed.

Final fixture teardown removed25 retained fixture containers,17 volumes and9 networks, with no owned fixture resources remaining. Temporary archive-helper invocations had their own finally-removal. One unreferenced owned test image (456848246 logical bytes; exclusive freed space not measured) and6 synthetic legacy directories/1470175826 bytes were removed. The13 original containers remain, with only the two authorized app replacements; all51 non-session table hashes and the full selection-table hash match. See `E11/evidence/final-preservation.json`, `cleanup-test-image.json`, both backend fixture state receipts, browser fixture cleanup and `handoff/legacy-drill/legacy-own-cleanup.json`.
