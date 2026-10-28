# PF-R2 — persistent routing permissions by tray purpose

Status: **TECHNICALLY COMPLETE / PASS at the recorded local scope**. Human
engineering acceptance remains separate. Worktree
`C:/Users/todor.chankov/source/WFC-pathfinder-local`, branch
`pf-r2-purpose-policy-local-20261019`, inherited HEAD
`8f0888527ca31fdf864912d1d2ad1514033a28f0`; exact uncommitted sources are hash-bound
by the build, actual-control, web-patch and closure receipts. The technical commit
following this report records the complete delivery.

## Result

Project Details now has an English **Path Finder routing permissions** card,
strictly for current administrators. The actual copied catalog has330trays and
6distinct purpose keys. Each purpose supports MV/LV/Control, explicit exclusion,
reset to Unconfigured, persistent history, revision conflicts and safe retry of
the same uncertain command. Instrumentation follows Control. No real purpose
mask has been selected on behalf of the user.

Two actual purpose keys differ by internal whitespace. NFC/trim normalization
preserves that difference; the card preserves spacing and shows distinct spacing
variant labels, including in accessible control names. It does not silently merge
these keys or alter the authoritative Project Trays data.

Catalog snapshots have immutable bounded manifests/pages and exact decimal text.
Routing revisions/hashes cover tray identities, names, purposes and routing
diagnostics; dimensions, declared lengths, materials, grounding, layout and
trefoil inputs update separate drawing/full provenance. Dimension diagnostics do
not prevent authoring an otherwise valid routing rule. Purpose incarnation
tombstones prevent remove/re-add and ABA changes from reviving an old rule.

Writes validate strict bounded contracts and duplicate-safe JSON. Current
role/login/project authorization stays locked through commit. CAS, exact-key
historical replay, changed-payload rejection and append-only history are enforced
server-side. Header-only oversized requests receive the correct authenticated
JSON errors through nginx. Ordinary engineer project editing is retained, without
granting permission authoring or Path Finder access.

Old prepared artifacts have no catalog/policy preparation scope. Calculation,
preview reuse and Apply therefore fail closed. Calculation/preview report
`ROUTING_PREPARATION_REQUIRED`; Apply rejects the proposal as `PROPOSAL_STALE`.
Automatic workers preflight before creating
replacement jobs or rematching locations. R2 does not supply a producer or claim
that the historical13-object diagnostic network is the full project graph.
R3 supplies the trusted, catalog-scoped preparation producer. Ordered diagnostic
lookup remains available. The exact C# calculation sources are unchanged.

## Verification

| Check | Result and scope |
| --- | --- |
| Frontend/server TypeScript | PASS |
| Targeted lint | PASS |
| Pure/mocked regression | **164/164 PASS in10files**; includes existing preview checks, new catalog/schema/policy/API/hook/card and routing-scope fences |
| Actual PostgreSQL rollback controls | PASS; migration/normalization/revision behavior in the explicitly owned database |
| Wrong-context refusal | PASS; refusal before mutations, no cleanup SQL |
| Actual SQL/HTTP controls | **21/21 PASS**, including concurrent CAS/idempotency, authorization/login locks/revocation/expiry, historical replay, ABA, bounded pages and transport errors; exact owned fixtures cleaned |
| Actual computer-use | **13/13 PASS**: real330/6 catalog, spacing variants, synthetic save/reload/reset/exclude/conflict/discard/history, engineer boundaries, restored demo login and protected model/three tools |
| Full business preservation | **45/45 tables unchanged**, including all2143existing cables; real selected2140cables,330trays,51types,0rules/0bindings/0scopes/44historicaljobs |
| Storage/resource preservation | Three-bucket object metadata inventory unchanged; all18protected containers retain identities/images/starttimes/state; networks/volumes retained |
| Native parity / full project graph / real engineering Apply / user acceptance | NOT_RUN; not implied by the checks above |

Component tests use native-control stubs to isolate behavior. Actual Fluent
controls were separately exercised through computer-use. Historical C#105/43
counts have not been relabelled as new results. Storage inventory compares keys,
sizes, ETags and timestamps; it is not a fresh byte-by-byte digest of all objects.
The pre-migration backup separately includes model-byte verification.

Final evidence: [build](evidence/purpose-policy/candidate-build-1792363588403.json),
[runtime reconciliation](evidence/purpose-policy/runtime-upgrade-1792363695614.json),
[SQL and refusal preflight](evidence/purpose-policy/actual-preflight-1792363729167.json),
[21actual controls](evidence/purpose-policy/actual-controls-1792363829250.json),
[web spacing patch](evidence/purpose-policy/web-spacing-patch-1792364180288.json),
[browser fixture cleanup](evidence/purpose-policy/browser-fixture-cleanup-1792364442072.json),
[owned unused-image cleanup](evidence/purpose-policy/cleanup-1792364510042.json),
[45-table/storage/resource preservation](evidence/purpose-policy/final-preservation-1792364617873.json),
[remote observations](evidence/purpose-policy/remote-observations.json).
The browser and final closure receipts are in the same evidence directory.
Screenshots, raw business rows, backup and credentials remain private/ignored.
Final whitespace inspection removed four surplus EOF blank lines only; the
separate EOF-normalization receipt binds before/after hashes. No executable
behavior changed and no runtime rebuild was needed for that formatting correction.

## Retained failures and corrections

- The first post-upgrade audit compared network arrays by order and reported
  FAIL after a healthy lifecycle. Read-only reconciliation proved identical
  name/identity sets. No lifecycle was repeated.
- The first actual HTTP harness stopped after7checks with ECONNRESET from a
  header-only client. Its own fixture cleanup passed. Correcting only the client
  to flush headers/close the connection produced the21-control PASS.
- The spacing web build initially passed a tag to an inspector requiring an
  exact image ID. Resolving the already-built owned tag to its exact ID allowed
  source/owner inspection. No build was repeated and no runtime was changed by
  the failed inspection.

All three failed receipts remain available. None is an ignored product failure
or an invented passing run. Independent review also closed startup backfill
locking, supporting drawing-input dependencies, trusted-scope worker preflight
and side-effect-free refusal cleanup before the final actual checks.

## Runtime, recovery and cleanup

Only the owned5191 demonstration API/web were upgraded. Runtime owner
`8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, Docker project
`wfc-pathfinder-local-0cba87606e9b`, runtime directory
`pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600` and selected
project `1af0f807-7653-40ea-8391-7eea6c54e7d4` are retained.

- API image: `sha256:2097b386515435d50aa1e095e4c12e340b2d2bab71c44707fc85bc89340ad476`.
- Final web image: `sha256:77611de13845a691984a784b4e4d5a7642412ea656b33bb97f4218b9a9cae845`.
- PostgreSQL/MinIO and exited storage-ready container retain their prior images
  and identities. Storage-ready intentionally still uses the earlier API image.
- Verified pre-migration backup ID
  `89f25359-4b21-4c8b-b88c-9268a9806522`, manifest SHA256
  `4de72d4f61467841d7282022da23372c9a6f3dbd63b7796660bc354153d884b5`.
  [Backup receipt](evidence/purpose-policy/pre-migration-backup-1792362626867.json).
- Private work/profiles/backup/screenshots are retained under
  `.scratch/tray-catalog-f135b9e0-02e8-40e2-9ae6-5c98b67c1a8a`.
  `r2-approved-runtime2.private.json` is the current explicit image/role binding;
  older R1 image guards correctly refuse the updated API/web.

Actual SQL/HTTP and browser fixtures were removed, including their users/login
state. Exactly three newly built unused images and the closed fixture credential
file were removed after reference/ownership checks. No broad Docker prune or
denied historical-path cleanup was attempted. The demonstration, archives,
model packages, private companion and required proofs remain.

Original WFC/PathFinder checkouts, dirty legacy PathFinder files, original/5190
containers and working data remain unchanged. No push, PR, merge or deployment.

## Next

Prepare and immediately execute **PF-R2a: separate Left/Right drawing rules** on
a new inherited local branch. Keep route permissions, C# calculations, project
allowances, design/install lengths and protected3D behavior independent. Resolve
the source-reviewed browser-only bundle overrides, mixed drawing reads,
export self-invalidation and divergent free-space calculations explicitly in
the handoff. R2a authoring is admin-only; existing drawing viewers receive the
same bounded read-only server layout snapshot through their existing rights.
