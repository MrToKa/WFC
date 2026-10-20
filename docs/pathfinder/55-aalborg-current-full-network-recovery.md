# Aalborg — current full-network recovery

**IN_PROGRESS. No current full backup/restore result is claimed yet.**
Branch `pf-aalborg-current-full-recovery-local-20261020` inherits handoffa15721d
and verified trace-event deliverya625234. Actual5191 images remain the c68b443
delivery from report54; this stage initially changes local operator tooling only.

The recovery proof must cover the current330-tray/2965-object network, five
114,186,790B preparation parts and the230non-MV proposals. Historical report47
covered an earlier dataset. MV exclusion, paused policy and human Review→Apply
remain unchanged. Originals and5190 are outside the execution scope.

Root read-only discovery1 used the pinned, previously reviewed SQL-text inventory
body371e2826c52c4135750b9bb14ed56da9acbe0e6c5d0f36ae6181b8e65639a92c
in the existing owned API, with35s inner/45s outer/8s statement bounds and1MiB
output. PASS:126actual tables,44,395rows,124,663,397text bytes; read-only rollback
and connection close confirmed. Table row JSON remains PostgreSQL text; the
length-framed hashes preserve decimals/large integers. No new helper or write.

New opt-in Docker bounds add absolute deadlines, bounded streams, exact nonce
ownership and positive helper join/removal. Archive ownership is preserved only
for exact trusted archive commands/mounts, with the minimal required capabilities;
other helpers retain no added capabilities. Fixed PostgreSQL commands use a
terminal nonce witness without altering binary stdout or stdin. Unknown daemon
mutations or remote execution remain unconfirmed and prevent automatic recovery.
Existing callers outside the bounded scope preserve their prior behavior.
Portable operator bundles include the new sixth module.

The first actual source suite ended FAIL:180reported tests/179pass/1aggregate
file failure, zero cancelled/skipped. All54individual new controls passed, but
four late synthetic transport errors failed the file. Root retained the TAP;
independent review traced them to duplicate request destruction and a non-idempotent
fake. The narrow source/fake fix also asserts a single destroy invocation. Later
review fixes require actual close when request-end throws, join stderr failures
and refuse a second helper start after its first terminal wait. No blanket error
suppression or deadline/ownership weakening was used. Precise pre-fix working-file
hashes were not captured before that failed run; subsequent checks must pin the
frozen source checkpoint before execution. No actual Docker backup/restore ran
during these mock/control tests.

Scoped lint and nine syntax checks passed before the final narrow transport
fixes; current-checkpoint rerun is pending. Independent source review found no
remaining blocker. Four private recovery drivers and the pinned SQL body are
frozen; root-owned actual profile/preflight/outside guards are authored, with
syntax checks passed and runtime qualification NOT_RUN. Required actual gates
remain fresh headroom/disk/quiescence, cold archive, fresh5192 restore, normal
protected/API/UI checks and qualified retirement of only the new target.

Engineering acceptance, real cross-revision mappings and real Apply remain human.
Current non-MV calculation is already complete:1808selected,230calculated and
1578locations_required;332MVexcluded. This stage submits no calculations.
