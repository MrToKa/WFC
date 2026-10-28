# PF-2 continuation — retained model coverage

SCOPED_TECHNICAL_PASS, with explicit completeness gaps. The actual retained
214-part inventory, current copied planning snapshot and three supplied QA cable/
location records were checked. This is a retained-file audit, not whole-plant
engineering acceptance. No runtime, database, planning selection or category
assignment was changed.

## Baseline

Worktree `C:/Users/todor.chankov/source/WFC-pathfinder-local`, branch
`pf-2-coverage-local-20261018`, implementation base
`25e49401a7eca4117bbb261208be00bc92a7b36a`, handoff
`f2f5e6ab33970d82dda660aac80d0cecfa80a59b`.
The [assignment](handoffs/PF-2-coverage-audit.md) records exact input hashes and
local/live-remote observations. Source remains unpublished; no remote candidate
CI/review or acceptance is inferred.

Worker [report25](25-private-worker-reuse.md) remains a partial technical delivery:
its final disposable-target data comparison is FAIL_NOT_RETAINED after a cleanup
sequencing error. This independent audit cannot repair that missing observation.
Primary5190 and original preservation have separate positive receipts.

## Checks

| Criterion | Current state |
|---|---|
| Actual214part integrity, identities, offsets and declared counts | PASS:152879123bytes,438155uniqueobjects,664556unique fragment associations; no unassociated SDKfragments |
| Whole retained hierarchy parents/roots/cycles/depth/child counts | PASS:1root,2top-levelgroups,maximumdepth14,343310terminalfragmentowners |
| Fragment ranges/associations and identity/name diagnostics | PASS at retained scope; external mapping has one additional exact identified record, runtime omission reason unproved |
| Selected52objects/26leaves join to retained whole hierarchy | PASS:all99fragments,34674vertices,35772triangles;10 selected route-root subtrees fully represented |
| Supplied3QA cable aliases/manual bindings and model-name candidate scope | PASS at retained-record scope;2real endpoints use manualbindings,2synthetic cables fenced from realinventory; unknown live matching/artifact gates retained |
| Meaningful malformed/integrity/project-fence controls | PASS43/43,0skipped; separate source-only review closed |

The [actual audit](evidence/coverage/audit-1792332295000.json) binds final source
`audit.mjs` SHA2567afc8b8f34b8304bce7c3e9d994a5cf6cbe833557598cb8aa12d4571dbebcc09,
exact inputs and six positive scoped gates. It completed in9.167seconds with
observed peak RSS604,778,496bytes. Its120second/1536MiB guards are cooperative
observations, not OS-enforced process limits or a routing-capacity measurement.
The CLI uses the exact retained production matching module and dependency after
pinned hash checks, not a rewritten normalization algorithm.

[Controls](evidence/coverage/controls-1792332191650.json) link full TAP, source
hashes and43actual positive/negative controls. An initial36case invocation failed
during fixture-directory setup before auditing; that historical setup failure is
recorded rather than relabelled. The [independent source review](evidence/coverage/independent-review-1792332289059.json)
records four resolved finding groups: failure-receipt preservation on output
overflow; exact category/bounds constraints; sparse-ID/root/registry bounded-work
costs; unknown unbound matching state when live rows are absent. Review is source
inspection; the reviewer does not claim independent execution of the43tests.

## What is actually covered

The complete root includes HPU389,962objects/625,153fragments and ACS48,192objects/
39,403fragments. These are model composition counts, not a count of eligible
trays. Names and external-ID duplicates remain diagnostics rather than merges.

The selected ten route roots are `/BC022-2`, `/BC025`, `/B002`, `/B107-1`,
`/B107-2`, `/B107-3`, `/DFB011`, `/DFB012`, `/DFB013`, `/DFB018-1`. Every object's
subtree under these roots is represented in the selected snapshot; all99fragment
associations match. The snapshot contains26routing leaves explicitly allowed for
Control+LV and26hierarchy nodes. It supplies no MV assignment or equipment-role
objects. All52effective native visibility states remain unknown. The438,103other
model objects are outside this chosen scope; they are not automatically missing
trays and must not be assigned inferred electrical categories.
All six selected capture proof flags remain false: inventory/geometry/units/
transforms/planningVisibility/sourceLink. Internal identity/coordinate consistency
does not silently promote these flags.

Both real QA endpoint names have no raw inventory-name candidate and no selected
automatic equipment candidate. Both are nevertheless resolved by their two
current recorded manual world-point bindings against the retained selected
artifact. A third real binding is stale. The other two supplied cables belong to
the synthetic project and are never compared to the real inventory; their current
artifact cannot be established from this copy. Two repeated endpoint aliases
reuse the same project location across From/To roles. Live artifact-purpose/status
and matching-row gates remain unavailable; no real business endpoint success rate
is calculated from these three QA rows.

The [independent identity observation](evidence/coverage/identity-count-observation-1792331728988.json)
reconciles exact identity sets using the retained, package-hash-checked property
database. PDBmapping has438156records; reachable root-inclusive inventory has
438155. Sole mapping-only dbId388764 is a STRUCTURE record beneath architectural
ZONE /2025-03-14_N001-Arkitektfagmodel.ifc. All438155retained external IDs agree
exactly with PDB. The root is present; an omitted root is not the explanation.
The SDK contains a compatible no-child/no-fragment pruning path, but the actual
runtime reason is unproved. The CLI alone lacks the PDB input and retains its
own narrower BLOCKED mapping-reconciliation flag; this separate observation
explains the set difference, not the runtime cause or engineering significance.

## Interpretation boundary

An inventory of names, hierarchy and fragment IDs is not a complete computational
mesh/property/visibility capture. The current planning snapshot contains26routing
leaves and26hierarchy objects, without equipment-role geometry. Whole-model object
counts must not be treated as routing eligibility or category assignment. The
three supplied QA cables do not establish representative business endpoint
coverage. Name-only misses cannot exclude property aliases or valid manual points.

Source units, finite matrix declarations and identity joins can establish internal
converted consistency. They cannot prove native equivalence or engineering
tolerance. Native comparison is not mandatory under the user's revised acceptance
choice; actual human route/length review remains pending.

The exact unchanged Core still builds an endpoint-dependent graph per query.
Persistent fitted geometry and worker reuse do not meet literal globally prepared
graph reuse. Any later faithful topology/query-overlay optimization needs a
separate contract and parity scope; this audit makes no code change to the engine.

## Independent graph-reuse assessment

Read-only source assessment by pf_runtime_map, after the bounded worker delivery;
no new code, build, runtime operation or performance measurement is implied.

- `RouteCalculator.cs:57,99` inserts From/To projections before contact creation.
  `AddParallelAttachmentContacts:687` uses these initial stations. A finished
  endpoint-independent graph with simple edge splitting would change legitimate
  parallel-tray contacts.
- `ContactGraph:633,752` uses insertion order, exact station equality and bounded
  allocations. Dijkstra accepts strict improvements at525, and heap ties use node
  indices at903. Different allocation/contact/edge order can change tied routes
  or resource-limit outcomes. Edge collapse can also change floating sums/points.
- `PathFinder.Model/Contracts.cs:118` explicitly describes graph-per-calculation;
  fitted geometry and bounded mutable clearance proof caches already exist.
  The runner calls the original calculators directly. No current prepared-graph
  consumer API exists. An additive Core partial file would still be a new engine
  execution contract, even if the eleven historical file bytes stayed unchanged.
- Ordered lookup searches `(node, route-step)` states and needs separate evidence;
  caching its endpoint-free graph would not prove automatic From/To graph reuse.

A credible later experiment would reuse ordered endpoint-independent candidate/
contact recipes, then reconstruct query stations/contacts in the exact historical
order. Keys include snapshot/rules identity, category and connection tolerance;
query guards, budget/failure precedence, vertical preference and SECONDARY flags
remain exact. This is candidate preparation, not a fully reused finished graph.
It requires dedicated parallel-contact/tie/endpoint/order/budget parity against
unchanged Calculate before any integration. No such experiment is claimed here.

Existing calculations are functional at the documented selected-network scope.
The retained one-real-QA-cable workload does not establish a need for an additional
cross-cable memo, pool or alternate Core execution path. Full engineering/business
acceptance and complete category/equipment inputs remain separate from this
architectural optimization. Further changes should follow the actual coverage
findings and a justified contract/performance scope.

## Cleanup and next proof

No Docker resource was created in this audit. Retained inventory, selected
snapshot, compiled matching module and final control fixtures/results remain
needed reproducible evidence. A fresh failed-setup child
`pathfinder-engine/.scratch/coverage-controls-14b7cdcb-10cb-4ad5-a8d4-a1962a8f0ea7`
contained only a406-byte marker. Automatic approval review rejected its one
removal attempt with `blocked by policy` before process creation. The
[refusal readback](evidence/coverage/cleanup-refusal-1792332352021.json) confirms it
remains; no retry, parent removal or bypass is authorized. This is a seventh
denied child in addition to the six inherited ones. A proposed cleanup-result
file was never created and must not be cited as successful cleanup.

The next useful independent work investigates the earlier disposable post-UI
comparison on a fresh isolated restored target. It must save before, post-mount,
post-preview and Clear results/differences before any assertion or retirement.
This produces new evidence; it cannot reconstruct or relabel the lost historical
observation. Source inspection suggests initial automatic cable computation may
legitimately publish proposals on mounting Path Finder, so that behavior must be
measured separately from standalone preview and Review/Apply/cable-write safety.
