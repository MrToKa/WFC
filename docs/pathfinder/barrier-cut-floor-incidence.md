# Exact vertex incidence in cut floor barriers

The supplied diagnostic bundle contains two complete original captures from
GVL244. The originals stay outside the repository and are read without changing
the live project or its published barriers.

| Capture SHA256 | Original fragments | Original triangles | Previous refusal |
| --- | ---: | ---: | --- |
| `1eacfb49a5108d0468ddf9ce68640513bd73634a0ac3f21a245e0cf99aa39441` | 17 | 892 | `DUPLICATE_TRIANGLE` |
| `fb6040f47acaefebf4f9a1b028cee5727116f1bed706faca687dab0ea3380626` | 11 | 860 | `CLOSED_SOLID_QUALIFICATION_REFUSED`, `self_intersection`, `dbid:29669` |

The first capture qualifies with the identical contact-face fix. Four pairs of
triangles belong to the shared caps of separate closed owners `dbid:29644` and
`dbid:29650`. No triangle is removed or merged.

## False self-intersection in the second capture

Owner `dbid:29669`, fragment 1961, contains 82 original vertices (36 distinct
coordinate triples) and 68 triangles. Local triangle pairs 6/8 and 25/29 share
one vertex each. Their XY projections occupy opposite sides of a line through
that shared vertex, so they cannot intersect elsewhere in 3D.

The segment/triangle contact calculation recomputed a plane distance for a
segment endpoint that was exactly one of the target triangle's vertices. A
floating-point cancellation residual of approximately `1e-18` in the plane
numerator was amplified by an almost coplanar segment. The resulting phantom
contacts were 0.293 and 0.127 micrometres from the shared vertex, beyond the
embedding check's 0.1 micrometre tolerance.

## Correction

Use a zero signed plane distance when an endpoint exactly equals one of the
target triangle's supplied vertices. The equality is exact, without a proximity
threshold. All other plane calculations, endpoint contacts, edge contacts,
embedding checks and collision tolerances remain in force.

Coordinates, vertex indices, winding, provenance and every original triangle
remain unchanged. No opening is filled, no invalid solid is converted into an
open surface, and no global tolerance is increased. The production module
digests change automatically with the implementation; the protocol is unchanged.

Replaying the exact original capture bytes after this correction qualifies all
17 and 11 closed components respectively, with zero surface fallback and all
892 and 860 original triangles retained. This is an offline geometry check;
it does not publish new barriers on the remote installation.

## Regression coverage

The shared test fixture retains the affected owner's exact 82 vertices and 68
triangles, plus its transform and source identity. Tests cover an unchanged
opening, material crossing, solid interior, exact vertex contact, reversed and
cyclic winding, reordered vertices/triangles and split source fragments. Real
crossings, overlaps, duplicate same-owner faces and nonmanifold vertices still
refuse. Both native mixed-verifier modes accept the complete original captures.

The actual routing process reloads and independently qualifies the fixture in
one-shot and warm-session modes. The direct material crossing is blocked; when
the synthetic tray network provides a valid detour, every final route segment
is checked against the retained geometry. A point inside the material remains
blocked. The focused runtime checks also run in GitHub CI.

Local checks passed: 94 base collision-kernel tests, 50 legacy verifier tests,
75 mixed geometry/native tests, 31 packed-capture tests and all four focused
runtime checks. The existing 84 full runtime checks also passed. An offline
derived union of the captures' 18 distinct owners qualifies with all 960
triangles; it is not a new live model observation or publication.
