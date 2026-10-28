# Nested raster paths

This carries the exact paths/profile runtime modules from upstream commit
a04e1099b9397784a55f275389bd547ad0a1d7c5 in MrToKa/routings-model-preparer.

Manifest-declared PNG and JPEG resources can remain in canonical subdirectories
below resources/output/0, including literal ASCII spaces. The original SVF URIs,
raw resources and hashes are preserved. Other asset types keep their existing
sibling contract. The verifier still checks resource closure, path safety,
case collisions, raster container signatures and integrity.

The vendored runtime inventory and its build/test pins are updated together.
Viewer HTTP decoding already preserves percent-encoded spaces for exact manifest
lookup; additional regression assertions cover this behavior and reject double
encoding, encoded separators and traversal.

Run the standalone verifier regression with:
`node --test scripts/tests/nested-raster-resources.test.mjs`

Validation in the pinned Node 24 Linux CI container passed:
- 32 standalone raster/verifier regressions.
- 25 viewer HTTP boundary tests.
- npm run server:build, including the pinned runtime copy/inventory check.
- The upstream Preparer passed 147 package, inspection, provider and adapter tests.

Desktop production completion remains a deployment/retry check.
