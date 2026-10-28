# SP-4 — WFC browser entry and retained archives

Prepared via prepare-stage-handoff24 October2026. Execute immediately in
C:/Users/todor.chankov/source/WFC-preparer-local-20261020 on a new local
sp-4-wfc-browser-archive-local-20261024 branch inheriting the SP-3 report commit.
Read live Git/progress/agents,00-plan.md and08-owner-lifecycle-verification.md.
Root sole actual executor; source-only SP5/SP6 agent work must be preserved.

Current product543ae7a already contains the admin WFC launcher, fixed-origin
server handoff and retained-original-ZIP support. Inspect server/routes/
preparerRoutes.ts,modelRegistryRoutes.ts,src/api/preparer.ts,PreparerPage and
AuthContext. Current WFC admin is required at gateway admission and rechecked;
ZIP download rechecks after verification. No APS key goes through WFC or URLs.
Native HTTP preserves the exact public Host (fetch ignored Host override).
Separate tab preserves the normal WFC tab. No iframe/direct viewer/global keys.

Existing fresh WFC54/54 focused PASS and full typecheck PASS apply to unchanged
product543ae7a; source-bookend receipt pins the relevant source state. Verify
English UI, empty page key fields, durable archive count/SHA/import transaction,
streaming cleanup and existing Viewer access preservation. No real new conversion.
Record source/verification scope and browser/deployment NOT_RUN honestly, local
commit. Prepare SP-5 isolated synthetic integration prompt using the same skill
and execute immediately. Candidate API/web/Preparer images are built but must not
be deployed to5180 before isolated verification and old-data migration/rollback.
No push/PR/merge, PF5191 or denied-path changes; cleanup owned fixtures only.
