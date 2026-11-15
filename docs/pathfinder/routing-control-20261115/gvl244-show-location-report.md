# GVL244 Show location repair — 2026-11-15

## Cause and implementation
Five numerical point corrections had retained correct fixed-world coordinates but lost SDK presentation identity. The verified predecessor/model-match ledger still identifies the original equipment. New numericalLocationMatchDisplay.ts recovers presentation only through at most eight exact verified generic-command/history links, same model/frame and <=1µm cumulative displacement. Existing per-end display clears and invalid evidence are hard boundaries. No bindings, coordinates, proposals or business values are written.

Current model pump mappings verified by authenticated HTTP200 endpoint context reads after deployment:

|Location|Restored SDK object|
|---|---:|
|15-P3070|105280|
|15-P5075|105312|
|15-P5170|105318|
|15-P5815|105330|
|15-P5870|105332|

15-P3820 retains SDK105296 and its centre-fallback head. RIO1 intentionally has no verified SDK cabinet object: the user-approved common RIO point is shown as a blue marker, with point-only status text. A dedicated point-display scene/message uses exact current model/frame checks and the existing units/offset conversion; it preserves route overlays, Ghost, selection and isolation. Marker replacement, object-show cleanup and unload disposal are covered.

## Verification completed
- Backend103/103 scoped display/model-match/centre-fallback checks PASS; server typecheck and scoped lint PASS.
- Frontend/runtime647 distinct focused checks PASS: runtime168, panel120, hook127, controller160, PathFinderTab72. Client typecheck, scoped lint and whitespace checks PASS. Detailed commands/logs: D:/WFC-Test/validation/routing-control-20261115/location-point-frontend-verification.md.
- Independent read-only backend and frontend review: no remaining material findings.
- Docker api+web build PASS. Runtime first deployed API sha256:88fe56e7d617a91e9e33b57efdcd597ada1047f68624d4e85ab4af0f9374205b, web sha256:2c0cf1852e3c34162b3912eb48b84f5f8b499973b9e9d510ac3ff9a93bf01974. Only isolated5181 changed.
- Actual in-app browser: reproduced both disabled buttons on3070; after deployment/reload Show To reveals/focuses real pump15-P3070. Show From focuses RIO1 blue point and receives exact success status. Repeated To replaces/removes point marker. Existing15-P3820 centre-derived object Show also works; its route Show produces yellow path. Showing RIO1 point leaves yellow route visible and Hide pressed. No assignment Save/calculation submitted.
- Six-table before/after hashes identical: cables1223, endpoint revisions3443, endpoint commands920, aliases1205, proposals2247, routing controls1223. Endpoint head IDs and points unchanged.
-271-cable audit unchanged:271 current/complete/calculated with saved automatic lengths;191 actual automatic pairs;80 protected manual pairs;0waiting/failed/mismatched/missing successful writes.3070 retains /C001/C002/C003/BC025/BC026/SECONDARY and Design80.

## Follow-up found during live acceptance
3070 route Show has a separate Workspace gate inconsistency when its parent automatic batch failed at the finite period expiry despite that item's successful recorded write. With current barrier48 intent, the server confirms currentness CURRENT and acceptedMatchesCurrent TRUE. Existing Results already supports this read-only accepted path; Workspace rejects the parent status independently. gvl244-expired-batch-display-prompt.md records the narrow frontend-only follow-up. Backend/shared proof expansion is excluded. Follow-up integration/live acceptance is pending at this report checkpoint.

## Evidence
D:/WFC-Test/validation/routing-control-20261115/gvl244-show-location-before.json and -after.json; -contexts-before.json and -contexts-after.json; -audit-before.json and -audit-after.json; -build.log and -deploy.log. These are local test artifacts, no production acceptance claim. Unrelated engine/native tests were not rerun for this display-only repair.

## Follow-up completion — saved route after batch stop
PASS. Actual current-barrier workflow evidence confirms3070 is current/accepted; only Workspace's independent stopped-parent display gate needed correction. No workflow schema, Results verifier or backend write/proof contract was broadened. The ready Results handoff must include an explicit verified current accepted complete/calculated row; exact Routing, canonical Design, job/proposal/hash, scope and revision checks are retained. Unaccepted or mismatched stopped results remain refused. Review/Apply permission is unchanged.

Additional308/308 Workspace/Results tests PASS, client typecheck/scoped lint/whitespace PASS. Full verification log and11 new success/refusal cases: D:/WFC-Test/validation/routing-control-20261115/route-show-stopped-frontend-verification.md. Web-only Docker build and deployment PASS; final web image sha256:ee417b2ee2f7906b84885823d28127af0d076fe735e283988533c25ba09c82eb. API remains88fe56e7d617a91e9e33b57efdcd597ada1047f68624d4e85ab4af0f9374205b and healthy.

Final actual IAB acceptance after a fresh reload: model ready,147 saved barrier parents revision48, search/open3070, Show From/To both enabled, calculated design80, route Show enabled without a new calculation. Show displays yellow route and changes to Hide pressed. Show To focuses actual15-P3070 pump while yellow route remains. Save is correctly disabled because no endpoint assignments were edited. The browser tab is left on this verified cable with collapsed panel and visible pump/route.

After all final browser actions, six-table hash comparison against15:32 UTC baseline PASS again (gvl244-show-location-final-state.json): all1223 cable rows,3443 binding revisions,920 binding commands,1205 aliases,2247 proposals and1223 routing controls are byte-equivalent in their canonical JSON read. No calculation or source write was required. The earlier pending follow-up checkpoint is superseded by this completed acceptance.

Final independent read-only review of the stopped-batch Workspace change: PASS, no material findings. Exact verified receipt/value/scope/revision fences and independent Review/Apply gates remain intact.
