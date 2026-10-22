# PF-B12 — barrier extraction failure diagnosis

Baseline: `e42ccd69195d59ce0f40916636cb634721990bf7`, branch
`pf-b12-barrier-extraction-repair-local-20261022`, 2026-10-22. User priority is the
failed Save barrier set and ineffective Calculate routing on the real Aalborg
copy at5191. This report supersedes the assumption that selecting and saving the
two broad RVM groups could complete through the existing bounded v1 capture.

## Actual finding

Root read-only metadata check against the exact owned5191 PostgreSQL is PASS:
expected active model; fingerprint
`b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`;
seven pending capture intents, zero published snapshots, no current barrier head.
The newest intent has two selected parents and no capture allocation. No SQL
write, cable change or Apply was performed. Private operation:
`pathfinder-engine/.scratch/barrier-extraction-repair-4fcfd5a0-6906-413d-91be-8a36084e1898`.

Read-only source-driven decoding of retained converted metadata with that exact
fingerprint identifies unique requested parents. BIS has321834 hierarchy nodes,
249692 leaves and382095 render fragments; PIPE+GRID has60689 nodes,53748 leaves
and238736 fragments. Combined620831 fragments exceed the existing8192 capture
ceiling by about76 times. BIS also exceeds the65536-object hierarchy ceiling.
Hierarchy child/parent links are consistent; every geometry leaf has fragment
membership. The relevant property/fragment/tree resource hashes match the retained
manifest. This is metadata verification, not a fresh full-package or triangle,
topology, openings, current display visibility or engineering acceptance check.

The user's failure is therefore a real scope/capacity mismatch. The saved
requests exist, but their geometry never became a published obstacle set. Old
cable results without barrier proof cannot become checked results through Review
or Apply. Calculate currently directs the user to barrier configuration for that
reason. Merely enabling a button or restarting a container cannot fix this.

## Implemented repair

- Preserve eleven closed, safe barrier failure codes through the adapter and
  protected bridge; unknown SDK exceptions remain generic. No raw model names,
  paths or exception text travel as diagnostics.
- Recoverable capture refusals retain the loaded Viewer/session and no longer
  label the entire Viewer as stopped. Authority/resource/model changes remain
  terminal, including BARRIER_CAPTURE_MODEL_CHANGED in the parent Controller.
- Show bounded hierarchy/geometry progress and the specific capture reason.
  Preserve the exact saved intent and existing publication through failure.
- Fix duplicate accounting of pending siblings in hierarchy traversal. Existing
  hierarchy, fragment, vertex, triangle, byte, event, deadline and topology limits
  remain unchanged. No omitted fragments, partial publication, empty declaration,
  automatic Drill or fabricated bbox solid is introduced.
- Include the new diagnostic module in the explicit deployed import closure.

These changes improve diagnosis and recovery. They do **not** make the two whole
RVM groups fit the v1 pipeline. Large-group support requires the separately
versioned multipart/catalog/qualification work in plan96.

## Verification

At the working source inheriting e42ccd6:

| Check | Result and scope |
| --- | --- |
| Runtime extractor/adapter/bridge and actual module closure | PASS122 Node tests; includes wide parent32769 children, real overflow refusal, original opening triangles and closed error propagation |
| Host/authoring hooks | PASS108 tests in two files; exact command retry, safe reasons and bounded progress |
| ViewerController | PASS91 after correcting a new test's expectation: terminal disposal returns null rather than an object with ready=false |
| Initial three-file run | FAIL1/199;198 passed, only the above test expectation failed; retained as failure, not a successful full run |
| Exact web-only install planner | PASS16; current75187b0a baseline, API unchanged |
| Independent integrated source reviews | CLEAR; separate reviewers for extractor, error plumbing and root Controller/import closure |
| Full frontend/server typecheck | PASS after adding the exact new module declaration; initial missing-declaration typecheck FAIL retained, no type settings loosened |
| Scoped production lint and diff whitespace | PASS, zero warnings |
| Candidate build/install | Pending root execution/result below |
| Actual5191 metadata diagnostic and rollback archive prepare | PASS, read-only; same current model fingerprint, original published head absent |
| Actual browser/SDK capture and real cable reroute | BLOCKED by retained browser refusal; no alternate browser/native/CDP/origin bypass attempted |
| Complete broad-group capture, civil holes and engineering acceptance | NOT_RUN/UNRESOLVED; metadata proves existing v1 limits insufficient |

Runtime delivery must be web-only with a fresh exact-source operation and retained
B11 rollback archive. Keep APIac0d16ab in the same running container, original
5180/5190, databases, model storage and outside resources unchanged. Source and
private receipts remain separate; no business rows/secrets in Git.

## Continuation

Complete and record the diagnostic frontend delivery, then immediately execute
the next inherited local stage for versioned bounded large-barrier support. Root
remains the sole actual executor. Simplified Preparer diagnostics/backup source
are preserved in their separate worktree and queued behind this user's PF repair;
main5180 has not been updated. No full PF, Preparer or engineering completion is
claimed by this stage.
