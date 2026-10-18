# PF-R validation matrix

R0 inherits `916256f` and the accepted plan32. Historical checks retain their
original scope/revision. Statuses below distinguish contract checks from future
implementation and human acceptance. Actual receipts are linked from the R0 report.

| ID | Observable outcome | Owning stage | Current status |
| --- | --- | --- | --- |
| R0-BASE | Isolated branch, originals preserved, active automation bound to current plan, actual remote observations recorded. | R0 | PASS; local/remote evidence, scoped actor operations |
| R0-CATALOG | Fresh guarded read-only counts distinguish copied catalog and missing type facts; no business writes. | R0 | PASS; catalog-counts receipt |
| R0-CONTRACT | Catalog/policy/drawing/parts/aggregate/object/binding/comparison/proposal/Apply contracts are versioned, consistent and source-aware. | R0 | PASS for contract/source scope only |
| R0-FROZEN | Eleven core sources and existing 43-case data/manifest/generator/drawing assertions retain locked bytes; no expected regeneration. | R0 | PASS; reference-lock/document-validation, no new engine run |
| R0-EXAMPLES | New synthetic examples parse, obey shared revision/identity/side/coordinate invariants and remain explicitly proposed. | R0 | PASS for documented invariants/parse only; production enforcement NOT_RUN |
| R0-REVIEW | Independent review closes cross-module scope, authority, grounding default and finite/decimal ambiguities. | R0 | PASS for source/document review only |
| R1-COPY | Exact source snapshot → mapped catalog/dependencies/type enrichment → bounded transaction → lossless readback; source unchanged. | R1 | NOT_RUN |
| R1-CONFLICT | Partial target, changed minimal type, foreign FK/shared material collision and replay with another plan refuse atomically. | R1 | NOT_RUN |
| R1-FILES | Referenced reports/images are copied by bytes/hash into owned storage; no functioning foreign keys/paths are assumed. | R1 | NOT_RUN |
| R2-POLICY | Reload-persistent exact-purpose MV/LV/Control policy; Instrumentation→Control; Unconfigured differs from explicit Excluded. | R2 | NOT_RUN |
| R2-AUTH | Current admin authoring with revoke/expiry/deep-link/cross-project refusal and locked commit boundary. | R2 | NOT_RUN |
| R2-ABA | Catalog/policy A→B→A advances revision, invalidates old proposals and conflicts with stale expectedRevision. | R2 | NOT_RUN |
| R2A-DEFAULT | Full-input legacy side resolution including grounding-on-right; explicit overrides then joint side packing. | R2a | NOT_RUN |
| R2A-PACK | Two compatible purposes on one side share bundle allocation; phase/trefoil/profile/grounding incompatibilities remain enforced. | R2a | NOT_RUN |
| R2A-DIVIDER | One divider for occupied Left+Right, including MV/three purposes; no false TooManyTypes solely by count, no overlap/free-capacity fiction. | R2a | NOT_RUN |
| R2A-READ | Ordinary authorized viewer/export receives same read-only server layout/revision; no new PF/model API right or silent legacy fallback. | R2a | NOT_RUN |
| R2A-SCOPE | Drawing-only policy changes leave path, design length and 3D selected route/yellow line/filled Ghost unchanged. | R2a | NOT_RUN |
| R3-ATOMIC | All server-requested parts are complete/hash-verified/deduplicated; one immutable aggregate published atomically; no partial latest artifact. | R3 | NOT_RUN |
| R3-BOUNDARY | Cross-part connections, ancestor ownership, duplicate roots, stale/cancelled/reordered/missing parts and quota boundaries checked. | R3 | NOT_RUN |
| R3-CAPACITY | Full actual catalog requested scope accounted for; time/RSS/bytes/cancellation measured. No sample is labelled full-plant success. | R3 | NOT_RUN |
| R4-FRAME | Declared source units, hierarchy, axis/root/instance transforms and display offset applied exactly once; finite/mirror/rotation controls. | R4 | NOT_RUN |
| R4-ID | Version-local dbId separated from qualified stable identity; duplicated names/external IDs and one tray/multiple fragments retain provenance. | R4 | NOT_RUN |
| R5-REUSE | One confirmed location serves From and To across cables; aliases, ambiguity, blank endpoints and manual precedence remain explicit. | R5 | NOT_RUN |
| R5-MOVE | Object-attached points follow a verified frame; fixed-world coordinates remain fixed; no rotation inferred from AABB or unsafe deformation migration. | R5 | NOT_RUN |
| R6-DIFF | Old/new comparison distinguishes purpose, move/shape/length/connectivity/add/delete/split/merge and unresolved identity. | R6 | NOT_RUN |
| R7-SHORTCUT | Newly added/changed formerly unused tray triggers appropriate category/component/project recalculation. | R7 | NOT_RUN |
| R7-JOBS | Durable progress/cancel/recovery; changed dependencies cannot publish current-looking stale results. | R7 | NOT_RUN |
| R7-MATH | Exact core/rounding/SECONDARY/one reserve; Details S/E/P-only recalculation reuses valid geometry, gap forces route reevaluation. | R7 | NOT_RUN |
| R8-PRODUCER | Browser-independent producer qualified against protected capture and declared support; separate calculation-only grant, no Review/Apply authority. | R8 | NOT_RUN |
| R8-FAIL | Missing support/grant/frame/identity remains visibly pending/blocked; no native-equivalence or autonomous-apply claim. | R8 | NOT_RUN |
| R9-APPLY | Explicit review, old/new/delta/reasons; routing+designLength atomic/idempotent with current auth/dependencies/write revision through commit; installLength preserved. | R9 | NOT_RUN |
| R10-REAL | Both actual converted models exercised; measured identity/geometry/purpose differences and unresolved cases disclosed; user manually reviews engineering results. | R10 | NOT_RUN |
| R10-SECURITY | Cross-project/access-revocation/concurrency/malformed/oversize controls plus existing Viewer/Ghost/Details/Cables/drawings regressions. | R10 | NOT_RUN |
| R10-OPS | Owned local demonstration, offline calculation, lossless backup/restore of new data/policy, explicit safe target retirement. | R10 | NOT_RUN |
| HUMAN-ACCEPT | User accepts measured routes/lengths and separately decides merge/deployment. | Human | NOT_RUN |

## Capacity and numeric gates

Current source limits are in capacity-and-catalog.md. They are layered: a 250 MiB
file control does not widen a 64 MiB bridge or engine geometry limits. R3 records
actual total catalog, covered/missing roots, hierarchy/object/fragment/vertex/triangle
counts and UTF-8 bytes across **all** parts. A bounded failure is reported as such;
silently dropping geometry is never a successful completion.

Record cold preparation and warm calculation wall time, process/container memory
scope and sampling method; median/max of a few samples is not p95 or a user SLA.
Run count/byte boundary, repeated/corrupt/missing/reordered part and cancellation
controls before the real whole-scope run. If new limits are needed, introduce an
explicit versioned profile and prove it; do not just raise one browser threshold.

Synthetic exact geometry stays distinct from real converted tolerances. The
43-case corpus uses its locked source tolerances and exact discrete/decimal
fields. R0 does not establish an engineering tolerance for the old/new factory
models. Native parity is not required by the user's later decision and is not
claimed by any converted test or manual review.
