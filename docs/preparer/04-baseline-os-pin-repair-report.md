# SP-0: Windows executable identity and qualified platform coverage

The OS pin repair began at af37b09334a20fecf695aaf9cf945dd495db91f2 on
sp-0-preparer-baseline-local-20261022. The fresh results below were reviewed at
00832078098f21d5e6e2b780c4c0d03bc3506086, with a clean worktree before these
documentation edits. SP-0 remains incomplete under the unchanged strict full-run
gate. The qualified platform coverage below does not assert full Linux coverage
or completion of the main WFC integration.

The full copied-source run fb9ede8f-8517-4406-a5f1-c9a4535ae52d finished at
2026-10-22T00:57:18.977Z. Guard18 was not its revision: that run had guard17 PASS
and package174 PASS, then Preparer286 cases:280 PASS,1 FAIL,5 platform SKIP,
0 cancelled. Parent/ports/source-copy bookends passed; worker exit coverage did
not. The failure is retained, not reclassified as a product pass.

The failed Windows filesystem-protection test encountered BASELINE_CONTROL_PATH
before PowerShell launched. Windows keeps the exact System32 PowerShell binary
as a hard link to its component store. The test preload incorrectly required a
single link for this OS executable, as it does for private test inputs.

The supervisor now pins the exact canonical System32 executable's device,
inode, positive link count, length and SHA256. The preload verifies this immutable
pin before the existing four fixed ACL arguments can execute. Generic private
input/control-file single-link checks, own scratch path and ACL stdin checks,
48 intentional denial controls, deadlines and terminal proof requirements remain.
Observation sidecars retain bounded safe test stages if a worker cannot report
its exit; sidecars never prove a join, successful test or released port.

Root verification after independent source review CLEAR:

| Check | Result | Scope |
| --- | --- | --- |
| Fresh guard a40f2200-3a0f-45c5-983c-093d2043a45e | PASS18 | Actual Windows OS ACL positive control and refusal controls; expected48 denials |
| Fresh ops47b1dd39-56fa-4da9-b321-b6e14f075241 | SUBSET_PASS14 | Copied test/ops.test.mjs; guard18 also PASS; no skips |
| Worker/child exits, closed ports, source/copy bookends | PASS | Both fresh runs; no killed worker, unexpected denial or unjoined child |
| Offline physical-seed finalization controls | PASS19 | Injected fake Docker only; includes pre/post lock-archive uncertainty |
| Earlier focused workspace998abcb5 | SUBSET_PASS5 | Actual copied local service/ephemeral loopback only,66.4s; no product performance claim |
| Corrected Windows full requested run d61022c2-9471-40b8-a2ba-ed25a95aa4c4 | Strict gate FAIL | Guard18 PASS, package174 PASS; Preparer286:281 PASS,0 FAIL,5 Linux SKIP,0 cancelled,0 todo |
| Linux store controls eab7c528-2c6b-43ee-93de-042050041e07, attempt2 | PASS5 | Actual Linux execution of exactly the five Windows-skipped lease controls; no skips |
| Full Linux package/Preparer matrix | NOT_RUN | The Linux check executed one test file and its two production dependencies only |
| Actual main5180 backup/update, WFC/APS flow | NOT_RUN | No original PostgreSQL start, actual backup, import or Autodesk call |

The corrected Windows run finished at 2026-10-22T01:51:45.003Z on Node24.19.0.
Every suite exited0 with its parent, workers and children joined, ports closed,
source/copy bookends unchanged and no killed worker. Guard retained exactly48
expected denials; package and Preparer had0 denials. The Preparer suite took
364253ms according to its supervisor. Its five skips are precisely the five
tests in model-preparer/test/store-linux.test.mjs. The unchanged terminalPass
requires positive equal test/pass counts and zero fail, cancelled, skipped and
todo; therefore both this suite and the full summary correctly remain FAIL.
Zero test failures does not override that gate.

The separate Linux attempt2 ran that exact test file under Node24.22.0 in an
owned, bounded, no-network helper using image
sha256:ac0d16ab1b0f4c92922c20d1a13a5ea142d4c6e92558de1870daf4db7fd60fcf.
Only copied source was mounted read-only; there was no WFC, APS, database, Docker
socket or browser access. Terminal TAP reports5 tests/5 PASS and zero fail,
cancelled, skipped or todo; child join, helper removal and source/copy bookends
passed. The five checks cover live Linux owner identity, reused PID/start ticks,
foreign boot/namespace refusal, conservative legacy owner recovery, and release
after owner identity changes. The test, store and contracts hashes match both
the Windows run's source/copy inventory and current files.

Linux attempt1 remains a reporter failure: its process exited0, but the default
reporter supplied no parseable terminal TAP totals, so the retained control says
FAIL. Attempt2 explicitly selected TAP and produced positive terminal proof.
The failed attempt was preserved; no missing totals, Windows skip or earlier
failure was relabelled as a successful full run.

Together these results establish scoped platform coverage of the Windows281
successful Preparer cases plus the exact five Linux-only controls on matching
source. They are separate executions with different Node patch versions, not a
single all-pass run or a complete Linux platform matrix. No harness gate,
timeout, isolation boundary or production source changed for this report.

Exact OS pin source hashes and earlier focused results remain in
evidence/sp0-os-pin-repair.json. New sanitized platform results, matching source
hashes and retained private-evidence digests are in
evidence/sp0-platform-matrix.json; raw logs and inputs remain private under
.preparer-work. The prior full, focused and Linux reporter failures remain there. The backup
contract also preserves a durable completion marker before releasing its source
lock, with explicit uncertainty if acknowledgement is lost; this is tested source,
not an executed backup or permission to skip the backup/restore gate.

Next: make an explicit stage decision using this qualified platform scope and
the retained strict-gate failure, without hiding skips or inferring a full Linux
run. SP-1 still requires an actual offline source seed and verification of a
fresh owned restore before any main update. Main5180 is the authorized integration
target; PF5191 is separate. Do not start the stopped original PostgreSQL for backup.
