# JB_PROD20_03: accessible attachment outside the retained window

The supplied diagnostic for cable `-WG-JB_PROD20_03-1`, job
`48e25e89-da7d-4541-841f-ae41c11a7e94`, used profile v7 with drilling disabled.
It exhausted 264 pair attempts with `candidatesTruncated=true`, 6,616 collision
queries, 3,556,624 work units, two local plans and 5,407 local edge checks.
Increasing the pair allowance alone had not expanded its 16 attachment candidates
per endpoint.

## Geometric diagnosis

In the replay, registered floor `dbid:176150`, fragment `194802`, component
`component:000141` cuts a continuous `/C003` riser edge between
`[6.499998219775819,65.84049990102272,15.374999968424259]` and
`[6.499998219775819,65.84049990102272,19.300000212564882]`.
The original connected graph has 647 reachable nodes. Barrier filtering separates
the initial endpoint components into 592 and 55 reachable nodes. The nearest
`/BC901` connection is clear; ignoring that floor would hide the real problem.

The accessible From attachment on `/BC025` is ranked 42nd (zero-based rank 41).
Its 23.91850760917161 m approach reaches the upper connected component without
crossing the floor. A 32-candidate diagnostic still fails; a 64-candidate search
finds this attachment at pair 91, retaining the original time/work/query/local
budgets. The route is:

`/SECONDARY/BC025/C003/BC029/BC030/BC901`

The replay's physical length is 52.15762187894076 m. The existing configured
SECONDARY length formula yields a 46 m design length; the correction does not
change that formula. All 148 original obstacles remain enabled. Independent fresh
kernel checks confirm all 17 final segments clear, including the long From
approach, and confirm exact binary64 From/To coordinates.

## Correction

New authenticated runtime profile v8 retains up to 64 candidates per endpoint and
allows 4,104 pair attempts (eight straight preflight attempts plus 64 x 64 local
pairs). Fresh server calculations and engine identities select v8. Historical
v1-v7 profiles, digests and execution domains remain supported unchanged. Core
defaults remain 16/264; the larger domain requires explicit limits.

Candidate ranking, category/Purpose permissions, geometry fitting, registered
obstacles, collision predicates, fresh final checks, 30-second deadline, 20M work,
100k collision queries, eight local plans and 16,384 local edge checks are
unchanged. No obstacle is removed and no material-crossing exemption is added.
The expanded candidate domain is still bounded; exhaustion or other resource
limits do not prove that no physical route exists.

## Replay provenance

The supplied JSON contains dependency/result references rather than raw model
geometry. A retained same-model 229-object snapshot was used locally; its source
SHA is `972c6c7d1aeb161c29f8e16b5e937613e7cdc37e98982808ae85c4fc0ac8f55a`,
whereas the supplied job references artifact SHA
`3c3bb3a4ace8605d7e1ed680c0c709acea27bdd15ce83b8419546e8c7e74e0d3`.
The CAD overlay's base identity was explicitly rebound to that retained snapshot,
keeping every CAD coordinate and permission unchanged. Both prepare 198 segments,
and the original-profile replay reproduces every supplied diagnostic counter
exactly. This is a semantic replay, not a claim of byte-identical model artifacts.

The original barrier capture was recovered byte-for-byte (changing only its
retained capture ID reproduces the required SHA):
`7589ff38b32bc18454ecc3f36cb4b21af94feb72d2333fc432beb076bdb6c851`.
Private replay requests, result JSON, rejected-connection traces and independent
checks reside in `tmp/jb-prod20-replay-20261116/`. Diagnostic hooks remain confined
to its private copied engine; production collision code has no tracing changes.
No live application deployment or cable data write is part of this correction.

## Verification (2026-11-16)

- LocalConnectors: 60 passed; Constrained: 98 passed. A real solid-floor fixture
  fails with 16, 32 and 40 candidates even when given 4,104 pairs, then succeeds
  with 64 through the farther free upper entry. Independent checks cover every
  returned segment. All 4,096 pair ranks enumerate once; invalid larger limits are
  refused and historical defaults remain fixed.
- ManualOrdered: 31 passed; legacy BarrierRuntime: 39 passed; mixed BarrierRuntime:
  106 passed, including v7/v8 candidate-window recovery, exact measured preparation,
  warm sessions, altered-profile refusal and genuine material refusal.
- Seven TypeScript contract/scope/identity/write/history suites: 514 passed. The
  affected 72-test shared suite was rerun after correcting fixture tuple types.
- `npm run typecheck` and `git diff --check` passed. Runner and transport projects
  build without warnings. Independent review found no actionable issues.

Total: 848 unique passing test checks, plus the real semantic replay and its
independent original-geometry verification.

The normal compiled runner with canonical v8, without private tracing changes,
reproduces the successful route at pair 91: 6,721 queries, 2,918,719 work units,
two local plans and 5,592 local checks. Its separate independently requalified
original-capture check again confirms 17/17 clear segments and unchanged endpoints.
Evidence: `canonical-v8.request.json`, `canonical-v8.result.json` and
`canonical-v8-independent-check.json` in the private replay directory.
