# Automatic CAD connectivity: implementation and 5181 acceptance

## Fresh 5180 acceptance and final rollout

The identical frozen API and web images documented below are running on both 5180 and 5181. Both APIs and frontends passed their startup checks, preserving database, storage and converter configuration.

On 5180, a separate owned project `d8ec07b7-b2d8-4c4d-a6a7-89d3c3717aa0` imported the genuine source model through normal HTTP. Root used the built-in browser to discover BC001, generate a fresh base and capture `/ACS_JB` as an actual active Obstacle. Current frame `993708be-e874-4220-a145-f71cda7c1e25`, aggregate `0d4c69e2-116f-4176-8773-69a18c6360d2`, artifact `76713c05-ea48-4396-a925-0dc6467b4383`. The saved CAD row was explicitly deferred, without invented SDK assignment.

After fixed endpoint writes and a bounded automatic baseline, normal v3 publication of route `41469ad6-f339-4b2e-8d18-a6b8dd7cb0ff` triggered background job `3fdb3ee8-1d0d-4b2c-a566-65e04e1098d1`. It traversed only the genuine CAD centerline (5.5 m, no gap or SECONDARY edge), replaced the owned automatic `/SECONDARY` baseline with `/WFC-AUTO-CONNECT-5180-001` and wrote Design/automatic length 7 m. Proposal `00587211…`, automatic receipt `d5c15b8a-7b34-4200-973f-fee822c393eb`, current accepted/written workflow. Actual barrier snapshot `89dc14d7…`, revision 1, checked 1/1 segments clear with drilling false. No manual Calculate or Apply was used. The owned automatic period was then disabled normally.

Root verified both cable dialogs, current saved Routing/Design confirmations and Show→Hide in the built-in browser. Screenshots: `D:/WFC-Test/validation/automatic-connectivity-20261115/automatic-route-{5180,5181}.jpg`. Exact 5180 evidence: `5180-witness-1794767097166.json` in that directory. Both labeled test projects and their immutable evidence remain available; both test automatic periods are disabled.

The two actual acceptance paths demonstrate separate-component CAD traversal and automatic business writes. Inter-network joins and changed gap thresholds were tested by native/process fixtures, rather than claimed as part of those two live cable paths.

Final original-business audit: 5180 baseline comparisons pass. On 5181, the aggregate cable hash differs because exactly two original cable `updated_at` values changed during the session. A lossless original backup COPY versus fresh read-only dump comparison covers all 3825 original cable rows and all 23 baseline columns: the only differences are those two timestamps; Routing, Design/installed length, execution dates, From/To, material flags, change log and cable write revisions are identical, with no added/deleted original cables. This is consistent with the existing material-read bookkeeping path, but exact HTTP attribution was not established. No restore or timestamp rewrite was performed. Evidence: `D:/WFC-Test/validation/independent-cad-network-20261115/after-automatic-connectivity.json`. Do not describe the complete database as byte-identical.

2026-11-15. This supersedes the former Independent route checkbox. All runtime source was frozen before the coordinating root's successful build/deployment; subsequent edits changed tests/reports only.

## Implemented behavior

The checkbox is removed. New publication sends `wfc.cad.route-publication.write.v3` plus the expected saved revision. The server derives the approved STEP centerline and both genuine end ports; compatible base attachments are optional. Separate route components are routable, and connections use the actual project connection gap. Optional alignment remains available. Purpose, barriers, capacity and endpoint approach policies are unchanged. Historical explicit attachment requests still validate their requested physical ports.

Current computation derives every stored publication as a new version 3 overlay without the historical isolation flag. It does not mutate sealed publication JSON, old results or receipts. Native version 2 replay retains its historical meaning; old results become noncurrent under the new view/hash/engine. Legacy one-port publications remain readable without inventing a second port.

An atomic startup marker (`pf_recalculation_state.cad_connectivity_policy`) and `CAD_CONNECTIVITY_POLICY_CHANGED` event adopt this policy once for published-CAD projects only. Adoption runs after schema initialization and before workers. It preserves enabled/paused/control/finite authority and writes no sealed engineering records. Projects without published CAD are not dirtied. The marker/event roll back together; explicit CAD-off skips CAD tables.

Ownership: server CAD publication/group DTO, current overlay derivation, adoption initializer/startup wiring, route panel UI/tests; native/shared owner supplied version 3 and actual graph/process checks. Independent read-only review found no remaining blocker.

## Gates and deployed images

- **94 application checks:** 75 focused server checks (publication, chain/material/geometry validation, overlay/current-view derivation, adoption transaction and recalculation schema), 19 complete CAD route panel checks. All pass.
- **106 native/shared checks:** 89 constrained native checks, 12 actual ModelRunner process overlay checks, 5 shared versioned-contract checks. All pass. Includes within/beyond configured gap, changed-gap/cache identity, real barrier admission and historical v2/current v3 separation.
- Native build, client/server TypeScript, scoped ESLint, whitespace checks and combined Docker build pass. Three obsolete UI disabled-button expectations were updated after removing optional-attachment gating; runtime was not changed to satisfy them.
- Actual 5181 API image: `sha256:0b863d2d9dc00dc155623ec9a888b15453a855f22e905c582b557501d97f890a`.
- Actual 5181 web image: `sha256:ccc06856365ee0a196d3ce1f1e45f78128c1b38fcf6c5fae7fc4ef0fff252268`.

## Actual 5181 adoption and automatic save

Owned project `ae17e968-d588-4e59-ad6b-2ceca9fd1e36`, cable `da32ee6c-c06d-4894-89d8-1babce987eda`, route `08dd98e9-c722-4947-8fc3-80c4bd5ff9f7` (`WFC-CAD-E2E-001`). Its real model was imported normally; base geometry was freshly captured through the built-in browser during the preceding stage. No existing GVL244/Aalborg network, barrier or cable was altered by these acceptance operations.

Actual startup: generation 24→25 for the single CAD policy adoption event, then 26 for the new engine identity. Automation remained disabled, control revision 2. The old publication stayed revision 4, payload v2 with historical `independent: true`, canonical SHA `ccdf8e3a181ca5631b6cd54932a47c7081d3f6efffa1f5f82970447aa57a6cda`. Artifact `880c7e1a-8c98-4ab3-a911-9d2b77a3522c` and aggregate `383ad78c-6ee3-4bee-8b61-972c2ee87d20` stayed unchanged. The production current-scope reader successfully derived v3/no isolation, new SHA `8d04da8d3d31a5a2f24f7e4e1828accaffa923e64760b82909d36f53f3fe40e4`. No republish or recapture was performed.

A new finite automatic period produced generation 27/background job `1036b61e-8487-46a6-9b94-4674c59e7222`, proposal `26e9c84d-cd18-44d5-832d-81d5a82f1fa5`, immutable automatic receipt `c3fdb33f-9caf-494f-9243-ab0c3ac9654a`. No manual Calculate/Review/Apply/Publish was submitted. Native result names exactly `cad:08dd98e9-c722-4947-8fc3-80c4bd5ff9f7`, route `/WFC-CAD-E2E-001`, raw 5.5 m, zero approaches/gaps/SECONDARY ends. Its current dependency envelope is v3. Standard 10% bending gives 6.05 m, rounded to **7 m**, automatically written as Routing, Design and automatic length (write revision 3).

The genuine active barrier snapshot `f476ed7f-17d1-4a3b-8d63-b7b09aed0f44`, revision 1, remained current. Native proof is `clear-selected-scope`, 1/1 checked, drilling false. The production proof recognizer accepts the clear evidence; its canonical engine result hash equals the immutable receipt seal. Workflow readback is current/accepted/complete/written, manual and execution protection false.

The owned period was disabled normally: enabled false, control revision 4, desired generation 27. Root then restarted the 5181 API. Actual readback still has generation **27**, control **4**, enabled **false**, exactly **one** policy adoption event, unchanged publication/base/current-overlay hashes and the same completed job. This proves actual SQL startup idempotence in addition to the transaction tests. No further 5181 mutations followed.

## Evidence and limits

Exact evidence under `D:/WFC-Test/validation/ordinary-cad-20261115/`: `cad-automatic-v3-adoption.json`, `cad-automatic-v3-exact-witness.json`, `cad-automatic-v3-restart.json`, enable/status/disable logs, and test logs `automatic-cad-focus.log` / `automatic-cad-ui.log`. Read-only witnesses use the production current-scope/proof functions; business/control writes use normal authenticated HTTP. The earlier independent-mode reports are explicitly marked superseded.

Current limitation: a genuine prepared base is still required; this does not bootstrap a CAD-only empty base or restamp an old publication against a newly regenerated base. Connection-gap links use the existing computational routing policy, not a new physical fitting certificate. Actual 5181 migration and automatic write **PASS**. Root owns the separate fresh 5180 acceptance and combined final evidence. Retain the labeled test project and disabled period until the user requests cleanup.
