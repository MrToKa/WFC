# Local component rotation and pivots — 2026-11-10

## Usage

In Routings builder → Components, select a saved part. Uppercase X/Y/Z and their
movement buttons translate in model/world millimetres. Lowercase Local x/y/z ±
rotate around the part's current local axes. Choose Rotation point: Start, Center,
or End; set Rotation step (degrees), then click an axis button and Update saved
position. The chosen pivot stays fixed in model space. A connected component must
be disconnected before it can rotate. The Vertical (model Z) shortcut for the
approved straight part also preserves the chosen pivot. Orientation fields are
read-only resulting absolute XYZ angles, preventing the old ambiguous world/local
angle editing. Changes appear in 3D after saving.

Start/end use the verified STEP connector centres. Straight centre is halfway
between its current cut ends; fitting centre is the centre of its local mesh
bounding box. Unverified start/end anchors are disabled. A product without verified
anchors may use its geometry centre once its mesh loads. These anchors do not
certify engineering fit or clearance.

## Implementation

Local increments postmultiply the saved quaternion. Changing orientation about a
local pivot uses `pNew = pOld + Rold*pivot - Rnew*pivot`. Saved XYZ may therefore
change during rotation to keep the requested pivot fixed. STEP sources and
geometry are unchanged. Existing quaternion storage, model coordinate conversion,
STEP assembly export and optimistic revision guards are reused.

The former Euler extraction could change the represented orientation at ±90°.
The new matrix-based extraction preserves equivalent orientation at singular and
near-singular angles; existing XYZ convention remains unchanged.

## Verification

- 41 shared rotation tests; 15 placement/length UI tests: all 56 passed.
- 7 Viewer scene tests passed, including full nonidentity quaternion forwarding,
  unchanged anchor/mesh and isolation from neighboring instances/source model.
- Frontend/server typecheck and ESLint of changed TypeScript files passed.
- Web image built and deployed only to the isolated PoC on port 5181.
- Real browser selected a temporary 1500 mm part at quaternion (0.5,0.5,-0.5,0.5),
  rotated local y around Center, saved, chose Vertical (model Z), saved and focused.
  Read-back verified identity quaternion and unchanged world centre
  (100030,9250,10000). Temporary fixture was then removed, preserving user parts.
- Screenshot: local `.data/rotation-pivot-vertical.jpg`.
- Original WFC containers retained 16:26:41 UTC start times and zero restarts.
  Main and port 5180 were not changed.
