# Complete CAD routes and Path Finder publication — 2026-11-11

## User workflow

1. In Routings builder, place the individual Materials components and connect the
   intended pieces with Connector snap. Save their positions.
2. In Complete routes select the member checkboxes; enter Route name, unique
   Route tag, Purpose and colour. Save complete route. Members remain individual
   pinned STEP instances and reload with the saved group colour.
3. Select the saved group. After the original Path Finder network is prepared,
   choose a free group end and an existing verified network port. Use Align whole
   route to network point to move the connected group rigidly, preserving source
   assets, lengths, rotations between parts and connector identities.
4. Select the connection again and Add to routing network. Publication verifies
   geometry, permissions, Materials identity and the actual private routing engine
   before creating the ordinary project tray and immutable CAD overlay.
5. Calculate cables through normal Path Finder. The group Tag becomes /TAG in
   route text, cable Apply, drawing membership and capacity lookup. Colour can be
   changed while published; structural changes require withdrawal. Withdrawal is
   refused while a cable still uses the route.

Project readers may view groups/colours; group edits require project edit access.
Network attachment/publication/alignment follow existing Path Finder admin/current
login authorization. Removing a draft group preserves its individual components.

## Data and geometry

Additive cad_route_groups/cad_route_group_members tables retain Name, Tag, Purpose,
colour and optimistic revisions. Group membership is project/design scoped and an
instance belongs to one group. Publication pins instance revisions, catalogue asset
revisions, source hashes and cut lengths. Published members/connections are frozen;
whole-route alignment is an atomic draft-only rigid transform with rollback.

Grouping accepts up to 200 instances. Computational publication currently accepts
1–32 components in a verified connected open chain, with at least one linked
300×60 straight Materials product and only the two approved SHA-pinned samples.
Unknown fittings may be grouped/coloured but cannot acquire invented routing
geometry. One or two explicit base-network attachments are allowed; the total
CAD overlay is limited to 32 route segments and 384 KiB derived geometry.

Straight paths use their saved cut length. For the supplied bend, source STEP
cylindrical radii 500/800 mm share centre (-500,0,-145). Its centreline uses R650
at Y30 with 145 mm straight legs, not a port chord or an R795 arc. The SHA-pinned
centreline is approximated with 256 arc subdivisions (less than 0.002 mm length
error per bend). This is software geometry verification, not manufacturer fit or
structural certification. Materials originals are never edited.

## Path Finder integration

The original SVF and immutable prepared artifact remain unchanged. A server-owned
CAD overlay is separately versioned and hashed, merged into the actual C# runner.
Its hash participates in routing scope, calculation dependency geometry identity
and graph cache keys. Existing purpose exclusions, length ledger and Apply remain
in force. Preview uses exact route points and never fabricates SVF dbIds for CAD.

Composite currentness verifies that every non-CAD catalog row still matches the
original prepared projection and that each owned generated tray still matches its
publication snapshot. Changes in model, base geometry, permissions, metadata or
member revisions cannot silently authorize a stale computation. Retirement keeps
proof of the unchanged base; no old artifact is restamped with current tokens.

Publication is two-phase: validate/freeze an intent under current login + project
and design locks, release SQL locks during the bounded private engine proof, then
reacquire authorization/locks and compare the exact intent before committing.
No worker queue is awaited while holding the project mutex.

## Verification and actual acceptance boundary

- Core group HTTP tests: 19 passed, including published colour-only edits.
- Route UI tests: 9 passed; placement regression tests also passed.
- Whole-route alignment: 17 geometry/HTTP rollback tests passed.
- Publication/overlay/routing-scope/actual .NET tests: 60 passed, including 15 HTTP
  two-phase/auth/currentness tests and 5 actual C# runner tests.
- Actual engine example: a disconnected base network has no path; adding the CAD
  bridge produces /CAD001, 20.5 m raw geometry and 21 m final design length under
  the standard rounding/allowance ledger. Purpose exclusion rejects the route.
- Existing affected PF regression suites: 160 passed. Eight jobs-state-read
  fixture failures reproduce with the unchanged HEAD dependency module; these are
  pre-existing missing cable-purpose SQL expectations, not claimed as passing.
- Viewer colour protocol/scene/bridge tests: 110 passed; controller CAD tests passed.
- Real disposable PostgreSQL migration/isolation/concurrency/freeze checks passed.
  New FK/guard cascade behaviour was isolated from a pre-existing legacy CAD
  project-delete FK issue; no production legacy FK was changed to fix that issue.
- Frontend/server typecheck, lint, .NET build and Docker API/web builds passed.
- The existing PoC currently has a healthy active SVF model but zero PF artifacts,
  project trays, cables and locations. Real publication must therefore refuse until
  the original network is prepared. No live cable calculation on that unprepared
  dataset is claimed. The engine bridge test uses an explicit synthetic fixture.

The PoC changes target port 5181 and the feature branch only. Original WFC5180,
source model files and user placements are preserved. CI and the local validation
script now include engine, overlay, publication, alignment and group UI checks.

### Deployed Linux engine proof and browser acceptance

The rebuilt PoC API image was exercised on Linux using the real protected
runEngine process and RSS monitoring, not the Windows preparation test fallback.
An isolated synthetic snapshot in a temporary /tmp directory had no base path;
its immutable CAD overlay produced /BC001 → /CAD001 → /BC002, raw20.5m and final
21m. Native preparation returned prepared with3segments. The original snapshot
hash was unchanged and all temporary engine files were removed. This verifies
the deployed runner/monitor integration without registering fake model evidence
or changing the user's project/model/network records.

In the real browser two temporary1500mm parts were grouped, named, tagged, saved
and reloaded. A replacement group colour persisted through the canonical API.
The UI correctly reported that the PoC's original PF network must first be
prepared, instead of claiming a physical publication. Own test parts/groups are
removed after checking; existing user parts are preserved.

Owned CAD meshes now use the SDK's verified UnlitMaterial with opaque depth tests
and fog disabled. Route colours therefore remain distinct without changing the
original model's materials, global lighting or depth occlusion. Users can choose
colour with the picker or enter the RGB hex value.

Final browser evidence: .data/complete-cad-route-green.jpg shows the restored group
name/tag and its vivid green CAD geometry after the unlit material correction.
Browser error log was empty. The temporary group and two temporary components
were removed through their scoped APIs, preserving all five pre-existing user
instance IDs. The disposable PostgreSQL test container was stopped/removed.
