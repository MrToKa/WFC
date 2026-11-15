# SVF toolkit compatibility — 28 October 2026

The offline SVF-v2 validator now explicitly accepts producer strings `LMVTK 5.0.26.0` and `LMVTK 5.0.43.0`. This removes the first confirmed refusal reported for the GVL244 model. Manifest version must remain 2, the package profile remains `svf-local-7.130.0-v1`, and Viewer SDK remains 7.130.0.

This is a producer-version allowlist extension, not acceptance of arbitrary SVF variants. Unknown producer versions, different manifest schemas, unsupported geometry type tuples, external/unsafe resource references, missing dependencies, nonempty textures, unknown metadata, executable content, byte/hash/CRC differences and existing size limits remain enforced. Original Autodesk resource bytes are not rewritten.

Both Preparer and the WFC import verifier must be updated. WFC's vendored runtime profile is copied unchanged from the same upstream revision; its provenance records and pinned build-copy inventory are updated together. Updating only Preparer would leave WFC rejecting the completed package.

## Validation

Synthetic tests cover inspection and full resource closure for both producer versions and reject modified structures even when the version is allowed. Independently assembled portable ZIP fixtures are accepted by both the upstream public verifier and WFC's vendored public verifier; their invalid variants are rejected. These fixtures are not the actual GVL244 geometry.

The focused inspection/profile suite passed 85 tests; the upstream portable verifier suite passed six tests. The WFC portable verifier suite passed six tests and its exact runtime inventory/copy check passed. The two pack/readback/extraction tests could not complete in the sandbox: atomic no-overwrite publication returned EPERM for both the old and new toolkit. The filesystem protection was not weakened or bypassed.

The real GVL244 download, rendering, publication and import must still be verified on the desktop. Another unsupported structure can produce a later explicit diagnostic; toolkit metadata alone does not prove complete model compatibility.

## Tests

From the upstream Preparer repository's routings-model-package directory:

```powershell
node --test test/inspection.test.mjs test/profile.test.mjs test/toolkit-portable-verifier.test.mjs
node --test test/toolkit-compatibility.test.mjs
```

In WFC:

```powershell
node scripts/copy-model-verifier.mjs
node --test scripts/model-registry/toolkit-compatibility.node-test.mjs
```

Build/update the WFC API and Preparer images before resuming the existing generation. No new cloud conversion is required just to deploy this source change. Prefer Continue on the latest existing generation; verify the resulting package, successful WFC import and model display afterwards.
