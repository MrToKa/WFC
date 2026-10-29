# Barrier implementation validation matrix

StageB0 baseline: plan78, parent57d2694, branchpf-w0-barrier-contracts-local-20261021.
Each later receipt must name the actual checked revision/scope; every unexecuted
row below is NOT_RUN. A contract example is not a geometry, routing or real-model
PASS. Expected outcomes are design requirements, not generated current results.

| ID | Required case | Expected result | Stage |
| --- | --- | --- | --- |
| BC-01 | Fresh admission omits checkbox | drillThroughWalls=false; frozen historical reader has no default | B0 |
| BC-02 | Unknown fields, actor/path injection, foreign identity/frame | strict refusal, no authority inferred | B0/B2 |
| BC-03 | Nonfinite points, invalid indices, singular matrix, incomplete fragments | refusal/unavailable, never ready or clear | B0/B1/B2 |
| BC-04 | Hole in real triangles while bbox overlaps route | bbox overlap alone cannot block passage | B1/B3 |
| BC-05 | Empty registry | unavailable; explicit empty declaration is distinct from walls checked | B0/B2/B6 |
| BC-06 | Drilling true | explicit bypass proof, never a clear certificate | B0/B3/B6 |
| BG-01 | Solid wall crossed by a segment | blocked | B1 |
| BG-02 | Segment through rectangular through-opening in connected closed mesh | clear | B1 |
| BG-03 | Floor/ceiling crossed outside opening | blocked | B1 |
| BG-04 | Same floor through actual opening | clear | B1 |
| BG-05 | Edge/vertex/coplanar surface contact | conservatively blocked under numeric policy | B1 |
| BG-06 | Start/end/whole segment inside closed solid | blocked | B1 |
| BG-07 | Zero-length point inside/on/outside | blocked/blocked/clear; no added route length | B1 |
| BG-08 | Reversed winding, translated/rotated mesh, negative transform determinant | same physical outcome after verified transform | B1/B2 |
| BG-09 | Open/nonmanifold/degenerate/incomplete/self-intersecting mesh | explicit unsupported/refusal, no hole-filling repair | B1/B2 |
| BG-10 | Cancellation/work/node/triangle/byte/time budget | bounded refusal, never partial clear | B1/B2 |
| BG-11 | Repeat build/query/order and cache/session run | deterministic qualified result | B1/B6 |
| CP-01 | Parent with own fragments and nonleaf descendants | complete union, exact selected parent identity | B2 |
| CP-02 | Overlapping selected parents | shared fragments once, membership/provenance retained | B2 |
| CP-03 | Hidden/Ghost registered object after publication | still a physical barrier | B2/B5 |
| CP-04 | Model/load/selection/role changes during capture | cancel/refuse atomic publication | B2 |
| CP-05 | Units/global offset/fragment transforms | canonical metres exactly once; actual converted check separate | B2 |
| RT-01 | Nearest tray behind wall; farther accessible tray | choose valid candidate before search | B3 |
| RT-02 | Vertical preference would cross a slab | no impossible floor approach | B3 |
| RT-03 | Internal tray edge/cross-tray gap crosses barrier | remove before search; find valid alternate or no path | B3 |
| RT-04 | Direct SECONDARY wins distance comparison but crosses wall | constrained decision tries valid tray route; does not bypass | B3 |
| RT-05 | Drilling enabled for same case | old unconstrained strategy, visible bypass, original formula | B3 |
| RT-06 | Offset opening requires approach detour | bounded planner finds exact validated connector or explicit unsupported | B4 |
| RT-07 | Search sampling misses narrow opening | no fabricated free-space certificate | B4 |
| RT-08 | Detour path simplified/shortcut by ledger or display | no barrier crossing; exact path points/length retained | B3/B4/B6 |
| DP-01 | Barrier snapshot/policy change | new frozen dependency and full route recalculation | B6 |
| DP-02 | New/off UI resumes old drilling-enabled impact | refuse resume/mismatch, no silent bypass | B5/B6 |
| DP-03 | Design-only reuse after barrier change | refuse unsafe reuse | B6 |
| DP-04 | New dependency version | v7 per-item supersession/cancel/seal/initial-fill semantics retained | B6/B7 |
| DP-05 | Background producer/browser closed | exact server-owned current scope; explicit frozen choice | B6 |
| WR-01 | Historical unverified calculation | inspectable, not newly applicable as obstacle checked | B7 |
| WR-02 | Barrier/model/policy changed after Review | atomic Apply refuses stale input through commit | B7 |
| WR-03 | Both cable fields empty with exact current proof/mandate | guarded initial fill; installLength unchanged | B7 |
| WR-04 | One/both cable fields populated | compare old/new routing/length; human approval required | B7 |
| WR-05 | Role loss/import/manual intervening edit | refuse writes, preserve exact idempotent receipts | B7 |
| WR-06 | Recalculate an already populated cable in its detached popup | exact old/new routing and length comparison plus explicit Review/Apply replaces both fields; no manual clearing; installLength preserved | B7 |
| WR-07 | Popup switches cable or waits for selected calculation | old proposal cannot be reviewed/applied as the new cable/result; bounded observation, no automatic resubmit or Apply | B7 |
| AL-01 | Exact successful current PF calculation before Apply | Auto calculated length receives exact PF length immediately; existing Design stays unchanged | B7a |
| AL-02 | Manual Design edit / API or import Auto injection | Design remains editable; Auto is server-owned and cannot be edited or copied from manual Design | B7a |
| AL-03 | Failed/cancelled/stale/older calculation | no false fresh Auto value or older-job overwrite; prior successful value has honest source/currentness | B7a |
| AL-04 | Both Routing and Design blank after location Save | preserve authorized automatic fill, exact PF value and installLength | B7a |
| AC-01 | Actual photographed civil partitions and openings | real retained triangle/transform evidence; no synthetic substitute | B8 |
| AC-02 | =H1=KF1=TAC1=WGA1 with drilling off/on | physically valid or blocked / explicitly bypassed | B8 |
| AC-03 | Representative real geometry +2140 cables | measured bounded capacity, no extrapolated PASS | B8 |
| OP-01 | Original11 Core files and frozen baseline fixtures | unchanged hashes; legacy regression/parity remain exact | B3/B8 |
| OP-02 | Owned5191 backup/restore/rollback | actual receipts, no original5180/5190 mutation | B9 |
| OP-03 | Actual UI/model access unavailable | BLOCKED real check, independent work continues, no bypass | all |

Numerical contact tolerance is an implementation policy, not a physical cable
clearance. Initial triangle kernel qualification is centreline-only. Cable diameter/
capsule qualification must be explicit before claiming diameter-safe opening fit.
Closed topology checks likewise do not imply native/model completeness or whole
plant coverage. Published scope contains only deliberately registered objects.
