# GVL244: current-model endpoints within 0.25 m

User authorization on 2026-11-15: first run automatic recalculation, then ensure cables with clear From/To receive automatic length and saved Routing. Later clarification explicitly permits reuse across model versions when the NEW location is at the same position or within 25 cm.

## Evidence before this extension

Project `da667921-1f13-4c1d-9f87-063d127b98ce`, local isolated 5181, 1223 cables. First automatic generation admitted only 2. Saved bindings pointed to earlier preparation of the same November model. Strict same-model/frame recovery restored 704 locations through supported authenticated commands; 164 cables became calculation-ready. Of 270 cables with both saved heads, 106 remained unready: 99 have an old August-model RIO endpoint, seven were valid same-model recovery attempts interrupted by database contention. Do not mislabel all 106 as changed-model cases.

Automatic enrollment recovery was fixed and deployed, with 109 distinct passing cases across recorded runs, clean server types/lint, independent review and an actual PostgreSQL batch test under full rollback. Current generation 2292, job `c987d4d7-9523-40cd-b1ea-410d819a72bb`, is calculating the 164 ready cables with 148 active barrier parents, drilling off. Let it complete before introducing a new generation when practical. Preserve all original 80 nonblank Routing/Design pairs and all protection rules.

## Required implementation

1. Match the old logical name/tag to a unique grouped object in the NEW selected model, using existing verified native candidates or a fresh authenticated viewer scan. Proximity to an unrelated object is insufficient. Existing preserved receipts without candidates are not a not-found proof.
2. Compare actual canonical world-metre points using Euclidean 3D distance, inclusive threshold 0.25 m. Reject ambiguous candidates, missing evidence, different frames without conversion proof, or greater distance. Preserve old binding and provide a concrete diagnostic.
3. A confirmed old-model saved binding may be replaced with the verified NEW point within this threshold. Retain immutable old revision, source/target evidence and audit. Do not override same-model manual bindings, manufacture coordinates, or promote legacy points without current evidence.
4. UI scans only relevant old-model names and genuinely missing names; it keeps already-current saved assignments without searching them again. Shared binding changes update all dependent cables.
5. Automatic enrollment uses the same strict acceptance and original finite administrator authority. Changed heads settle before fresh admission. Existing active barriers, ordered/manual route protection and execution locks continue to apply.

## Verification and completion

Test exact equality, exactly 0.25 m, just over threshold, 3D diagonal, normalized tag matching, ambiguity/group identity, malformed provenance, current-model manual preservation, replay/revision conflicts, and mixed valid/refused cables. Run scoped server/client types and tests; document actual scope rather than summing overlapping gates. Rebuild isolated API/web only. Use the in-app browser for the fresh targeted scan and verify accepted shared locations and final saved values. Audit all project cables against authoritative current bindings and exact calculation receipts. Report unresolved names/cables honestly; never force a route through a barrier or infer a current location solely from an old saved coordinate.
