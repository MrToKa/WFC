# SP-0 diagnostic checkpoint: Windows executable identity

Base revision af37b09334a20fecf695aaf9cf945dd495db91f2 on
sp-0-preparer-baseline-local-20261022. This checkpoint is source preparation and
focused verification; SP-0 and the main WFC integration remain incomplete.

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
| Full corrected Windows/Linux matrix | NOT_RUN | Five Linux lease checks require Linux; no skip is counted as PASS |
| Actual main5180 backup/update, WFC/APS flow | NOT_RUN | No original PostgreSQL start, actual backup, import or Autodesk call |

Exact source pins and sanitized check results are in
evidence/sp0-os-pin-repair.json; raw logs and inputs remain private under
.preparer-work. The prior full and focused failures remain there. The backup
contract also preserves a durable completion marker before releasing its source
lock, with explicit uncertainty if acknowledgement is lost; this is tested source,
not an executed backup or permission to skip the backup/restore gate.

Next: finish the qualified platform matrix without loosening isolation or hiding
skips, then prepare SP-1. Main5180 is the authorized integration target; PF5191
is separate. Capture an offline source seed and verify a fresh owned restore
before updating main. Do not start the stopped original PostgreSQL for backup.
