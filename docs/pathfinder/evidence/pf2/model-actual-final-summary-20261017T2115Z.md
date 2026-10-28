# Final SDK mesh-decoder capture → normalized snapshot → Core diagnostic

The final UI capture code, including the SDK mesh-index helper correction, was
exercised through both full selected-geometry diagnostic pipelines. Both new
snapshots passed their supplied SHA256 check, strict Model validation, cold
fit, in-memory cache read, disk restoration and original ordered route lookup.
Fresh cache directories and new receipts preserve all earlier observations.
The explicit diagnostic tolerance remains **1.0m**; no Core threshold changed.

| Final diagnostic | Route 01 | Route 02 |
| --- | ---: | ---: |
| Physical leaves / fragments | 68 / 257 | 26 / 99 |
| Vertices / triangles | 91,934 / 93,738 | 34,674 / 35,772 |
| Lookup length [m], exact round-trip | 107.55007443085563 | 37.050260813690024 |
| Exact path points / ordered segment IDs | 156 / 63 | 59 / 23 |
| Validated / fallback straights | 27 / 24 | 10 / 9 |
| Validated / fallback bends | 0 / 17 | 0 / 7 |
| Diagnostic gaps / total gap length [m] | 8 / 4.0474224489976445 | 4 / 1.4685352921601158 |
| Cold fit [ms] | 763.9874 | 470.6375 |
| Memory cache read [ms] | 3.0469 | 1.1887 |
| Disk restore [ms] | 275.3283 | 247.3212 |
| First lookup [ms] | 940.8879 | 354.24 |
| Worker through calculation [ms] | 2841.5662 | 1537.8962 |
| Worker peak working set [bytes] | 151,674,880 | 96,251,904 |

Both diagnostic processes exited **0 / completed_route**. Memory reuse and disk
restoration reproduced exactly the path, fitted segments, counters and
diagnostics. Raw route JSON, fitted-segment JSON and count JSON also matched the
previous successful binary64 capture runs exactly; the new snapshot/cache
hashes changed because the final capture/provenance artifacts are new. These
are separately supervised workers run concurrently on the same local machine,
not a whole-plant performance claim. Each had a 120-second hard budget.

Final Route 01 snapshot SHA256:
`878b5e78703e3e9b250078828a71eb45739af091ca6e1b2f9194bac4ba7bfccb`.
Input:
`pathfinder-engine/.scratch/pf2-converted/normalized/1792271660578-d4729278-097a-4ebb-9d77-5370a266abae/snapshot.json`.

Final Route 02 snapshot SHA256:
`0c6350c86c1ef0165fa8920383fccb92d66bd52ce864ba46d0bab7856441889d`.
Input:
`pathfinder-engine/.scratch/pf2-converted/normalized/1792271660583-44de0ca7-c833-43fb-8917-3a87577595a9/snapshot.json`.

Full exact requested route strings, all output path points/metrics and `R`
companions, fitted points/ports and readiness metadata are retained in:

- `model-actual-final-converted-lookup-01-20261017T2115Z.json`
- `model-actual-final-converted-lookup-02-20261017T2115Z.json`
- `model-actual-final-pipeline-consistency-20261017T2115Z.json`

The consistency receipt binds earlier/final result SHA256 values and records
each exact cross-run comparison. Fresh owned caches remain under ignored
`pathfinder-engine/.scratch/modelcheck-actual-final-20261017T2115-case01` and
`pathfinder-engine/.scratch/modelcheck-actual-final-20261017T2115-case02`.

**Readiness remains `needs_review`.** All 68/26 objects retain unassigned
planning categories and unknown native visibility; these selected snapshots
remain partial and their native/source correspondence proof flags remain
false. Reported fallback geometry is retained, not promoted to native fitting.
Lookup ignores SECONDARY tokens and produces no equipment From/To approaches,
Project Details allowance values or design length. The Core graph is rebuilt
per lookup. Native comparison remains blocked by the observed missing licence
entitlement; no full-precision native pair, native parity or engineering
acceptance is claimed.

Only new owned diagnostic cache/receipt files were created for this final run.
No source/engine code, product installation, database, container, old receipt
or denied cleanup directory was changed. No other tests were rerun.
