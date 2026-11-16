# Full retained candidate pair search

The shared 64-pair allowance could stop routing before a valid retained endpoint
combination was visited. The Core default and ceiling now cover 264 attempts:
eight straight preflight attempts followed by every pair in the retained 16 x 16
local domain. Straight-only search fits too, including a legacy first pair outside
that retained domain (at most 257 attempts). Explicit smaller caller limits remain
supported and still report incomplete search when exhausted.

Fresh mixed calculations use runtime profile v7 with maxPairs 264. Its profile
digest and engine identity distinguish the expanded allowance. Historical profiles
v1 through v6 retain their exact data and explicitly execute with 64 attempts.
Measured fitting, preparation keys and collision policies remain those of v6.
Transport diagnostics accept up to 264 only when the admitted profile permits it.

Collision geometry, material occupancy, fresh final polyline checks, candidate
ranking and the 16-candidate endpoint ceiling are unchanged. Time, work, query,
graph and local-planner limits remain enforced. Search returns on a verified route;
otherwise the pair allowance permits the entire retained Cartesian domain. This
does not imply that every physical route is representable or that another
independent resource limit cannot stop the calculation.

## Verification (2026-11-16)

- LocalConnectors: 58 passed. A real-kernel fixture fails with explicit 64 and
  succeeds at exactly 264 attempts with fresh final checks. Both scheduling orders
  exhaust all 256 local pairs against material without producing an unsafe route.
- Constrained: 97 passed. A separating wall exhausts all 256 retained straight
  pairs and reports blocked rather than candidate-pair exhaustion.
- ManualOrdered: 31 passed; CapacityRouting: 16 passed; InterTrayManeuvers:
  33 passed; GraphReuse: 42 passed.
- Legacy BarrierRuntime transport: 39 passed, retaining historical profiles.
- Mixed BarrierRuntime transport: 94 passed. The same retained interior-pair
  fixture refuses at 64 under v6 and calculates at 264 under v7 through the runner.
  One-shot and warm-session checks preserve measured preparation and final proofs;
  altered profiles, digests, incompatible rules and actual material are refused.
- TypeScript contracts, scope, engine identity, writes, historical workflow proof
  and routing scope: 511 passed across seven test files.
- `npm run typecheck` and `git diff --check` passed.

Total: 921 passing tests (410 .NET checks and 511 TypeScript tests).

These are synthetic Core and runner regressions, not a replay of the screenshot's
project cable. No running application was redeployed and no cable data was written.
