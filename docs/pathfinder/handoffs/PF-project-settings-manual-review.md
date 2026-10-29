# PF-3–PF-8 continuation — Project gap and manual real-result review

Execute the user decision in ../20-manual-review-and-project-gap.md in the
isolated WFC worktree only. This is a revision of existing stages, not a newPF-9
and not a claim that manual user review already passed.

## Baseline

Current branch pf-manual-validation-settings-20261018, inherited commit
5485283eda397616ca99f9d41982d2ecd65dc36d; inspect actual live status/agents first.
Parent coordinates documentation/UI/evidence. Backend writer owns server/**;
frontend writer src/**; runtime writer own lifecycle cleanup helper/tests,
independent review and later isolated operations. Preserve concurrent edits;
do not launch duplicate source work or rebuild partial source.

Original WFC e1ef2020 and canonical PF45c24bf5 remain read-only; old dirty PF
and original13containers are preserved. Remote observations from05:38UTC are
in evidence/pf8/automation-wakeup-20261018T0538Z.json and retain their dates.
They are not proof of current unpublished local code CI/acceptance. No push/PR/
merge/deployment/native-host retry/original data update is authorized.

## Required work

1. Persist Project.connectionGap/SQLconnection_gap, default1m for existing/new
   projects, finite>0<=100; Details separate metre card and correct precision.
2. Resolve effective ConnectionToleranceMeters from current project settings
   for all calculations/lookup/dependency checks. Requests cannot override it.
   Gap changes force route recomputation/staleness; allowances keep design reuse.
3. Reuse existing formula card to distinguish legacy tray estimate and exact
   PathFinder formula/current three values. Never add measured gaps twice.
4. Replace the native/synthetic-only Apply block with existing explicit
   per-proposal manual review policy. Real engineeringAccepted remains false;
   acceptanceScope manual-review/provenance accurately records actual review.
   Preserve all auth/current-state/atomic/idempotent/installLength protections.
5. Run meaningful automated/API/SQL regressions and final computer-use on the
   separately rebuilt5190 installation. Actual user manual acceptance remains
   pending. Record failure/blocked/unperformed scopes honestly.
6. Retain demo/new verified backup/evidence; retire exact obsolete own resources
   only after replacement verification. Do not touch denied children/global
   Docker cache/original checkouts/app/data. Commit locally without secrets.
7. Prepare the next handoff for human manual route/length review and remaining
   scale/graph work. Stop repeated automation while actual human feedback is
   required, rather than resurrecting the superseded native-licence blocker.

Review checks in20-manual-review-and-project-gap.md and00-validation-matrix.md.
Do not run PF-0 receipt-writing validators for handoff. Historical frozen
reference tests remain unchanged; run affected tests on isolated scratch only.
