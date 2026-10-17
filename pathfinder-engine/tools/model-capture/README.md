# PF-2 converted model capture checkpoint

This is a temporary isolated capture tool, not a WFC product API or a replacement for the protected Viewer bridge.
It serves a separately extracted, verified package at `http://127.0.0.1:5185`, reads the SDK from this isolated
worktree and writes only `pathfinder-engine/.scratch/pf2-converted/captures/`.

## Current verification and stopping point

- Current source ZIP: 439,112,840 bytes, SHA256 `e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922`.
- All 342 raw resources, 439,007,803 bytes, passed the existing package/profile/hash verifier.
- Content fingerprint remains `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`.
- The historical transport hash `8e11874a…` differs. The mismatch is retained explicitly in the new receipt;
  historical reports are not edited. Equal resource fingerprint does not establish native source/conversion equivalence.
- All 206 vendored SDK files matched their existing manifest hashes.
- Six local HTTP checks passed: isolated bootstrap, restrictive network CSP, missing write authorization,
  traversal name rejection, model resource allowlist, unrelated capture schema rejection.
- JavaScript syntax checks passed. Actual SDK initialization, rendered model, full hierarchy inventory and
  selected mesh/property capture are **NOT_RUN**.
- Parent computer-use could not confidently determine Brave's current URL for policy enforcement; its Ctrl+T
  action was refused. No browser input was retried and no alternative UI tool was used. This tool must not
  be used to bypass that refusal. Resume browser work only through an allowed computer-use session.

The separately extracted package and detailed package-verification receipt remain ignored inside the owned
scratch directory. No original container, database, storage, model source, plugin or checkout was modified.
The owned server was stopped at this checkpoint. The inherited PF-0 denied cleanup child was not touched.

## Resume

From the isolated WFC worktree:

```powershell
node pathfinder-engine/tools/model-capture/prepare.mjs
node pathfinder-engine/tools/model-capture/server.mjs
```

Preparation is resumable: retained extracted resources are rehashed, and a new timestamped reverification
receipt is written instead of replacing the earlier one. The server reads the original verified extraction
receipt. `PF_CAPTURE_PORT` can select another unoccupied loopback port. Existing capture byte usage is counted
on startup; concurrent request reservations preserve the 2 GiB aggregate ceiling. Files are never overwritten.

Use computer-use to open `http://127.0.0.1:5185`. The page attempts to load the local copied model automatically.
When ready, choose **Capture complete hierarchy inventory**, then **Capture both reference routes**. The first
action saves all hierarchy/fragment associations in independently hashed parts. It does not claim complete
mesh or property capture. The second action captures bounded selected route meshes and all properties returned
for those selected objects. Any missing geometry, ambiguity, cancellation or budget breach is explicit; a partial
capture is not a complete model result. The Cancel button stops future capture work and writes; prior parts remain
as incomplete evidence without a completion receipt.

The page pins SDK7.130.0 and WebGL before initialization, keeping the accepted Ghost renderer choice.
Its CSP permits same-origin connections/fonts/resources and blocks external requests. Capture writes require
a random server-instance token, exact same origin and a bounded schema/name/body. No existing WFC API is called.

Standalone local checks (server must be running):

```powershell
node pathfinder-engine/tools/model-capture/verify-local.mjs
```

## Artifact contract and remaining engineering gates

Raw artifacts use `pathfinder.converted.inventory-part.v1`, `inventory.v1`, `mesh-object.v1` and `mesh-capture.v1`.
Full inventory is distinct from the two selected reference case scopes `nwd-lookup-01` and `nwd-lookup-02`.
Each selected object retains SDK dbId, external IDs, complete leaf-to-root hierarchy, owner candidates, properties,
fragment-local sample and original/display/canonical matrices, full decoded canonical vertices and triangle indices,
world AABB, native-compatible bottom-centre candidate, and transform/inverse residual. These are raw capture formats;
the `PathFinder.Model` strict snapshot format is separately implemented by the model worker.

The mapping being tested is:

`canonicalVertex = displayToWorldMetres * SDK.getWorldMatrix(fragmentId) * decodedLocalVertex`

`displayToWorldMetres` scales actual SDK display units and adds its global offset once. SDK placement/root
transforms are already included in the world matrix and are not applied a second time. Capture refuses an
unrecognized up-vector/unit convention. The package's actual SVF metadata inspected before browser loading
declares distance unit metres, Z-up and identity `nwModelToWorldTransform`; runtime values and native pair
comparisons still must be captured before asserting equivalence.

SDK display hidden/off flags are retained as display evidence and **never** silently treated as native inherited
planning visibility. `nativeHidden` remains null and category assignments remain explicitly `unassigned` with
empty categories. The native PathFinder assigns categories by explicit user selection, not by a universal model
MTO property. A paired test may apply documented native-reference assignments; production eligibility remains a
later deliberate planning input. Source linkage, native visibility, units/transforms, fitted geometry and routes
must be compared against complete native oracle references before computational acceptance.

The tool does not claim a completed PF-2 stage, full model mesh capture, native/converted parity, or readiness for
engineering writes. Further fixes may be needed after the first permitted real browser execution.
