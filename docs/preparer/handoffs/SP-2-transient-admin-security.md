# SP-2 — administrator authorization and transient page credentials

Prepared with prepare-stage-handoff24 October2026. Execute immediately under the
human's sequential implementation authorization. Worktree:
C:/Users/todor.chankov/source/WFC-preparer-local-20261020. Inherit SP-1 completion
commit on a new local sp-2-transient-admin-security-local-20261024 branch. Recheck
HEAD/status/active agents and docs/preparer/automation-progress.md; preserve edits.
Root alone runs actual tests/HTTP/SQL/Docker. No push/PR/merge or PF5191 changes.

Accepted contract supersedes persistent APS settings: current admins only;
two empty Client ID/Secret fields; page-memory leases until closure/expiry;
no product .env/legacy/global/browser-storage fallback. .env permitted only in
tests. No new real conversion, including startup/resume/restart. WFC login alone
may be encrypted durably. Fresh /api/users/me on protected uses; exact trusted
owner/login/page/revision/epoch binding; logout must revoke locally during outage.

Implementation already prepared in model-preparer/app/{workspace-security,
page-credentials}.mjs and tests at product543ae7a. Current complete Linux329/329
PASS receipt docs/preparer/evidence/transient-full-linux-20261024.json pins116
source/runtime inputs before/after. Reuse that verified scope when hashes match;
rerun only for changed source or unresolved concerns. Legacy encrypted data must
stay unclaimed. Two-admin same/different keys, demotion/expiry/outage/logout,
closure/epoch/restart and no secret disclosure must be covered, not inferred.

SP-1 cold+audited restore and unchanged primary health repair PASS; candidate
deployment still gated. Record exact current source hashes, evidence and any
limits (real browser/cloud NOT_RUN). Make local verification/report commit,
prepare self-contained SP-3 owner-bound lifecycle prompt using the same skill,
then execute it immediately. Do not pause for routine continuation approval.
