# PF-B8a — mixed model obstacle types

Product `7b6b74a2db46e59c2ccfcf4020758e7ee207a69a` on
`pf-b8a-mixed-obstacles-local-20261021`, inheriting B8 qualification/docs
`8770104` / `f7fcab5`. Eleven files,67 insertions/10 deletions.

Added **Obstacle** alongside Wall/Partition/Floor/Ceiling in administrator
authoring. Shared contracts, protected runtime capture and C# parser accept the
same strict kind. Unknown kinds still refuse; old captures remain valid. English
help describes pipes, tanks and mixed source groups. Explicit Model Browser
selection, Add and Save remain required. Registered hidden geometry remains a
barrier; original descendant triangles preserve real openings when qualified.

The checkbox remains **Drill through the walls**, defaultoff. Its explanation
now states that enabling it bypasses every registered obstacle for this calculation,
including pipes/tanks. The result remains labelled as bypassed. No change to
geometry algorithms, budgets, versions, identity/hash semantics, authorization,
Auto/Review/Apply, or source selections.

Root checks PASS: Vitest shared contract/Panel/Result89 across3 files; protected
capture Node41; fresh rebuilt C# capture verifier50. Tests cover original kinds,
unknown refusal, mixed-kind hash binding, explicit selection/save, descendant
geometry and opening/solid behavior. Client/server types, changed lint, Node syntax,
whitespace, server and separate production web builds PASS. Web's existing large
chunk advisory remains; no build error. Pinned Core11 and frozen fixtures3 hashes
remain unchanged. No PF0 receipt writers or unrelated full Tab tests were run.

Public hashes/results: `evidence/barriers/b8a-mixed-obstacles.json`. Raw owned
checks/builds are under
`pathfinder-engine/.scratch/mixed-obstacles-20261021-91bbe1e9-8556-4b90-9548-74f5a27ce9e4`.
Agent wrote source only; root executed checks. No test containers were needed.

Actual RVM groups `3D-Modell_BIS_20260304.rvm` and
`DB2401_DESIGN_01-PIPE+GRID_20260304.rvm` are identified by the user but **not yet
captured or qualified**. Whole-group capacity/topology is not proven; all existing
limits/refusals remain. Actual opening/collision acceptance stays BLOCKED. B8's
real Aalborg512MiB failure remains FAIL; no unchanged retry was made. Component
tests do not establish real browser access, native parity or human acceptance.
No5191/original runtime update or real-data Apply occurred.

Next: execute self-contained PF-B8b-actual-snapshot-memory.md immediately to remove
redundant large snapshot allocations with identical maths/guards, then repeat the
actual model test. B9 recovery/delivery and Simplified Preparer remain queued.
