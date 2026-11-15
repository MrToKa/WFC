# Stored manual cable route display

Target: Aalborg cable `000610bb-94a5-4807-907e-ac068271f7f6`, `=L3=JL1+1=WDB1`.

The panel formerly selected the automatic proposal (121 m), and disabled Show when its proof was stale, even though a protected 26-code manual route (107 m) was stored. It now selects the stored route when it differs from the automatic result or no exact current automatic path exists. The automatic proposal remains separately labeled. Unchanged current automatic paths retain their exact display behavior.

Stored Show is read-only: refresh the exact cable routing/write revision, highlight current model trays and show an approximate ordered line. It does not calculate a new length, establish barrier clearance, modify protection, or grant Review/Apply authority. Missing and ambiguous trays remain explicit diagnostics. Replies are fenced by account/project/model/load/cable/revision/raw text; cancellation and delayed clear replies are covered.

Actual initial 5180 acceptance passed, while 5181 failed twice: the old viewer requested all project routing bindings and received HTTP 413. The final protected endpoint accepts a bounded exact normalized route-code query, retaining existing session, access, model, publication and payload limits. The frame requests only relevant bindings. Route-local display failures/timeouts preserve the loaded model; authentication/session/model loading failures remain terminal.

Verification: Workspace 165, panel 121, hook/helper 138 tests passed during initial implementation. Final scoped server 58 tests passed; bridge/controller suites and helper tests passed, including full controller regression coverage. Counts overlap between reruns. Client/server types, scoped lint and builds passed. Native routing was unchanged.

Final API image `4eaaf56407a06b729844212285bca515222af414f09c6b2475319ace8b94ef9d`, web image `5bfa5ea2e2fbcd0ef73f4815791b827878e3f6d0f9940be71dcceeb76f4aa5f4` deployed to both local ports. Environment/storage/converters preserved; rollback images retained.

Root verified final Show→Hide in the built-in browser on both ports without Calculate/Save/Apply: primary route is the exact stored sequence through B111/B122/BC138/BC136/BC135, primary Design 107 m, automatic proposal 121 m separately labeled. Both models remained loaded and the panel confirmed successful saved-route display. Screenshots `D:/WFC-Test/validation/manual-route-show-20261115/manual-show-{5180,5181}-final.jpg`.

Exact target before/after snapshots show Routing, Design 107, From/To, execution dates, protection/control, write revision 0, history and selected models unchanged. Only the 5181 cable updated_at timestamp differs (existing detail/material bookkeeping during panel opening); no value restoration was performed. Evidence and initial failure are retained in `D:/WFC-Test/validation/manual-route-show-20261115/`.
