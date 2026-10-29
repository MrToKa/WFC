# Copied-project recovery qualification

Operational tooling only: no routing, UI, schema or mathematical change.
`binding.mjs` pins the existing owned5191 source and the separately created5192
target. Original installations and the retained5190 demonstration are excluded.
Read README-auth.md and README-audit.md for their separate evidence scopes.

The parent operator alone performs actual operations after focused controls and
independent source review. Each drill uses a fresh direct scratch child named
`copied-recovery-<UUID>`. Private files inherit an account-only Windows directory
ACL. No secret or business row is written to public evidence or command arguments.

1. `drill.mjs init --work <fresh-work>` creates only a private ownership record.
2. `provenance.mjs prepare --work <work>` copies75 bounded, explicit files:
   immutable source inputs, source receipt, UUID plan, seed/import PASS receipts,
   capture provenance, import intent/owner and67 chained events. Byte hashes,
   chain/order/path/receipt links and absence of auth material are checked. It
   does not query any database or alter original files. Keep partial files on
   failure. The439MB portable ZIP is retained separately, not duplicated here.
3. Close source browser Viewer renewers. Prepare normal auth, capture lossless
   source baseline, and write a SHA-pinned `source-ready` proof referencing both
   PASS receipts. `drill.mjs backup --work <work> --proof <proof> --proof-sha256
   <SHA>` requires this fresh (<60s), quiet, exact-container baseline before the
   controlled cold backup. It resumes the source. Check the same source session
   immediately while valid; expiry is a failure, not evidence of revocation.
4. `provenance.mjs seal --work <work>` independently links the adjunct to the
   actual backupId/core manifest SHA. `verify` repeats byte/chain/link checks.
   It does not change the core exactly-eight-member archive or secret companion.
5. Write `backup-qualified` proof referencing backup, post-backup source-auth and
   sealed adjunct PASS receipts; then `drill.mjs restore` with those proof flags
   creates a fresh private target5192. Never call the older default drill here.
6. Capture target before login, using `restore-fence` against the source capture.
   Run target auth: old bearer401 and exact old session410 SESSION_REVOKED,
   fresh normal login/session/descriptor/resource positive. Compare targetT0→T1
   using `owned-auth` and its exact safe allowed-auth SHA. `drill.mjs audit-models`
   captures a separate full resource SHA audit on the target.
7. Use computer-use on target's copied project, observe saved scope, cable count,
   3D model and reload; never invent coordinates, Review or Apply. Save screenshots
   and browser receipt, close only that new target tab. Post-UI `business-only`
   compares all27 business/registry/PF tables and three buckets; authentication
   is explicitly NOT_CHECKED after UI and does not replace the earlier proofs.
8. Write `target-qualified` proof referencing all six required PASS roles.
   `drill.mjs approve-target`, then `retire-target`, requires the exact new
   target owner/path/project/port/restore identity and validated receipts before
   any stop/delete. Existing5191 is rejected even though it is itself a restore.
   Confirm source health/data/UI and original/5190 preservation afterwards.

Proof roles and required schema/identity are enforced by `drill.mjs`; a generic
passing unrelated receipt cannot qualify a destructive action. The private
record preserves `*_started` before backup/restore/retire. A failure leaves the
phase uncertain and forbids automatic retry. Restore records an accepted owner
before its subsequent metadata binding. Keep raw stdout/stderr/transport and
partial archives for explicit investigation, rather than replacing facts.

Core subprocess:12min internal watchdog installed before stdin,13min outer host
deadline,1MiB input,4MiB stdout,32KiB stderr. Killing a host child is not proof
that every Docker helper stopped; inspect uncertain operations, do not retry or
delete them automatically. Metadata binding has60s whole/15s command limits.
Provenance reads at most4MiB per member and75 fixed JSON files; scanning is bounded
to500000nodes/depth64. Actual model SHA verification belongs to core audits,
not metadata ETags or the provenance adjunct. Keep needed source demo/archive/
secret companion/adjunct; retire only the proven-owned new fixture. Do not touch
the seven previously denied scratch children or parents, or use general prune.

These checks establish local operational recovery at their recorded revisions.
They do not establish whole-plant network classification, real From/To bindings,
engineering acceptance, native parity or user acceptance of cable lengths.
