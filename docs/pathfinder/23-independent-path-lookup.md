# Independent Path lookup tab

User request18October2026: add the third addon tab and its functionality.
Implementation is in progress on local branch pf-path-lookup-local-20261018,
inheriting9e6561e33ccf9ab535fb2184c858ecd20240071d. Original WFC/PathFinder,
synced sources/, original13containers and working data remain reference-only.
No push, PR, merge, deployment or original-installation update is authorized.

## Canonical functionality and accepted scope

Canonical PathFinder45c24bf5 constructs Path lookup in
AddinRibbon/Ctr/PathFinderControl.cs272–352. RoutingSession.Lookup.cs20–94
searches requested visible logical owners independently from the Routes session.
It collapses nested same-name wrappers, rejects separate-branch ambiguity, and
uses pinned RouteNameResolver/RouteCodeParser and RouteLookupCalculator.

The third web tab therefore does more than relocate the existing accordion.
It must work without a planning snapshot and while Routes has unprepared drafts,
without replacing that snapshot or staling saved cable locations/proposals.
It accepts one ordered route, displays exact path/geometric length/gap metrics,
distinct used leaves and prepared-network approximation diagnostics, and supports
Restore/Cancel. Web Reverse is retained as an additional diagnostic control;
there is no native batch workflow to reproduce. No equipment legs, SECONDARY
replacement, spare, percentage, cable design length or Apply belongs to lookup.
The user's Project Details gap (default1m) supersedes the native historical0.25m.

## Implementation contracts

- POST /lookups/plan returns distinct canonical routeCodes, exact selectionRevision
  and current Details connectionGap. The private C# parser supplies codes; no
  logical owner/parser implementation is copied into JavaScript.
- Protected capture accepts lookupRouteCodes with no equipment names or planning
  assignments. It captures bounded current-display-visible candidate geometry and
  full hierarchy. Native visibility/completeness/engineering proof flags remain
  false. C# resolves logical owners and exact eligible leaves before fitting;
  missing and ambiguous owners fail explicitly.
- POST /lookups accepts a canonical snapshot as a strict alternative to the
  compatible legacy planning-artifact request. Artifact purpose is server-owned;
  lookup snapshots cannot enter planning/preview/calculation. Same lookup-scope
  snapshot SHA can be reused under the project mutex with stored-file verification.
- Lookup dependencies pin their own artifact, current model/selection/fingerprint,
  current gap/settings and current administrator/login authority. Planning state,
  registry, location bindings and cable values are not promoted or modified.
- Large lookup snapshots use the existing scoped256MiB pre-body authorization;
  plan remains on the small parser. No global parser/permission expansion.
- One Viewer serves three persistent panels. Switching tools fences late responses
  and review eligibility. Inputs/results invalidate on edits and dependencies;
  explicit cancellation handles pre-job capture and accepted durable jobs.

## Evidence status

Source checks are being recorded; new images/API/browser/operational acceptance
remain NOT_RUN until coordinated freeze and actual execution. Historical passes
from report22 are baseline evidence only. All UI text is English.

Whole-plant completeness/capacity and reusable graph remain unproved at the prior
scopes. Native comparison is NOT_PERFORMED/NOT_REQUIRED_BY_USER; human engineering
acceptance is PENDING. Exact standalone-preview crash recovery remains NOT_RUN
from the previous PARTIAL extension and is not silently retried or relabelled.
The three previously denied cleanup children remain untouched without bypass.
