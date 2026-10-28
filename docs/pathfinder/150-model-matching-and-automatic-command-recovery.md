# Model matching and automatic command recovery

The read-only snapshot of the Aalborg automatic test project found five confirmed
128-name assignment pages in each interrupted run, with no sixth receipt. The
same later names had completed in an earlier run. This is not a 640-name limit.
Project-wide write locks could also block preliminary HTTP authorization before
the saved command reached its ledger. A separate read-only authorization snapshot
now checks current administrator access without acquiring the project write lock.
Actual commands retain their original project mutex, current-login checks,
revision checks and exact immutable-command replay.

Model matching retains its verified complete scan and confirmed page cursor in
memory. Typed temporary-busy responses receive at most two retries of exactly
the same body and key. Confirming a saved page continues the remaining names and
keeps cumulative results. After reload, the exact pending page is reconciled
before a fresh complete model scan; no cropped scan or inferred prefix counts
are trusted. Model, account and viewer ownership changes stop the operation.
Manual assignments and the missing/ambiguous/hidden-object rules remain intact.

Automatic calculation and automatic Cable list output have separate finite
authority. In the observed project the output permission expired at 12:01:45Z;
a historical v1 Retry at 12:04:08Z renewed calculation only. The snapshot already
contained 85 saved route/design-length pairs and 360 automatic-length results.
It would be incorrect to describe all writes as missing or to revive expired
output permission silently.

New v2 Resume/Retry requires the original active output authorization and its
Enable command/receipt, with a final expiry check before the command receipt is
stored. It never extends output permission. A fresh Enable remains the way to
authorize another 30-minute output period. Historical v1 command semantics and
exact successful receipt replay are preserved. The UI retains unknown-command
diagnostics through status polling and retries only typed busy failures with
the same saved command.

Evidence and owned deployment artifacts:
`D:/Codex-test-output/model-match-contention-20261027/`.
The PostgreSQL contention qualifier uses two connections to an isolated database:
preliminary access succeeds while a project write lock is held, while the real
endpoint and recalculation transactions still refuse to enter their callbacks.
This does not constitute a live browser or Aalborg engineering calculation test.
