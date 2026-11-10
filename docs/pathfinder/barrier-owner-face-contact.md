# Closed CAD panels touching along a face

The retained GVL244 refusal was reproduced from the exact supplied capture:
SHA256 `8b6c06116a1ce5f5d4589d7350105cadb72301062fa0fea062b86999fad48ac6`,
63,293 bytes, seven fragments, 852 original vertices and 756 triangles.
The customer capture is kept outside the repository.

Each of the seven fragments independently passes the unchanged closed-solid
verifier. The full capture previously failed with `NONMANIFOLD_EDGE`, attributed
to `dbid:29713`. The cause is its contact with `dbid:29711`, not an invalid
individual panel. The two end caps cover the same face but use opposite
triangulation diagonals. Their four rim edges each have four incident triangles,
two consistently opposing faces from each owner. Cutting all four edges detaches
the two-triangle caps from the ten-triangle panel bodies.

## Narrow fallback

The existing successful decomposition is retained. Only when an affected cut
component cannot close, the fallback examines original owner membership at the
overfull edges. An edge can reconnect same-owner faces only if **every** owner
on that edge contributes exactly two oppositely oriented original faces.
Ownership proposes adjacency; it does not establish solid occupancy.

Components are then rebuilt. Every component affected by the overfull contact
must still be closed and consistently oriented and must pass the unchanged
closed-solid fan, embedding and volume checks. An open part cannot be downgraded
to a surface to pass. Duplicate-triangle and nested-shell guards remain in place.
No coordinate, index, winding, triangle or tolerance is changed.

Additional topology scratch memory and work are charged to the existing limits.
Successful historical decompositions do not enter the fallback, retaining their
geometry and component membership hashes.

## Verification

The mathematical suite includes opposite-diagonal face contacts, separate owner
membership across multiple fragments, both solid interiors, the common face,
clear separation, retained openings, invalid owner incidence and resource bounds.
The runner suite stores a two-owner capture and manifest, independently reloads
and qualifies them in the actual calculation process, and checks blocked routes
inside each solid and on the contact face, plus a clear exterior route.

Local validation passed all 66 mathematical checks, including the retained
capture, and all 83 full runner integration checks. The retained capture qualifies
as seven closed solids with no surface fallback and all 756 original triangles.

The real capture can be checked without placing it in the repository:

```powershell
dotnet run --project pathfinder-engine/tests/PathFinder.MixedBarriers.Tests --configuration Release -- --retained-owner-contact <absolute-capture-json-path>
```

This verifies the retained original geometry and collision behavior offline.
It does not publish a new barrier set on the remote installation. Rebuild the
remote API image, then save the unchanged selection there to create its new
publication.
