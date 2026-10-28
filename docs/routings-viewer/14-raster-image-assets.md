# Manifest-declared raster images in offline SVF

The offline profile accepts Autodesk.CloudPlatform.Image assets when they reference direct sibling PNG or JPEG files (.png, .jpg or .jpeg, case-insensitively) declared in the embedded SVF manifest. Original resource bytes, sizes and SHA-256 values are preserved through discovery, download, packaging and WFC import. No image is dropped or converted to work around validation.

The portable manifest validator, JSON schema, Preparer download-plan validator and WFC vendored verifier accept these suffixes together. The preview/resource HTTP routes return image/png or image/jpeg for verified image resources. Other model resource responses retain application/octet-stream.

## Validation boundary

- A raster file must be declared as Image and present in the verified resource closure. Missing, duplicate or unreferenced resources remain errors.
- Scheme-bearing, absolute, encoded, traversal and nested image references remain outside this direct-sibling profile. SVG, executable content, arbitrary extensions and gzip-wrapped images are not accepted.
- PNG validation checks its signature, bounded chunk layout/CRC, initial IHDR shape, basic color/depth methods, dimensions, IDAT presence and final IEND. JPEG validation checks SOI/EOI, bounded marker segments, 8-bit SOF0/SOF1/SOF2 frame headers, dimensions and scan structure. These are container/header checks, not pixel or entropy decoding.
- Raster bytes count against the existing maxNestedBytes and maxNestedTotalBytes budgets. The decoded RGBA dimension estimate is also capped by maxNestedBytes.
- Existing manifest, producer-version, type-tuple, metadata, size, hash and resource limits remain enforced. Material texture maps are still required to be empty; accepting an Image asset does not infer compatibility with an unknown material/texture schema.

Technical references: [PNG specification](https://www.w3.org/TR/png/), [JPEG T.81](https://www.w3.org/Graphics/JPEG/itu-t81.pdf), [Node zlib CRC32](https://nodejs.org/docs/latest-v24.x/api/zlib.html#zlibcrc32data-value).

## Tests and limits of verification

The new image suite covers raw PNG/JPEG, progressive JPEG marker containers, uppercase suffixes, one-byte streams, portable ZIP verification, bad signatures, corrupt PNG CRC, truncation, dimension budgets, missing/undeclared assets, type mismatch, SVG and unsafe references. All 22 tests passed against the upstream and WFC source verifiers and the copied WFC runtime.

The adapter accepts PNG plans through the durable checkpoint boundary and still refuses SVG plans. Its complete PNG download test is included, but the sandbox blocked rename of the first ordinary 0.pf resource with EPERM before the image could be written. Existing hardlink/publication tests have the same sandbox filesystem restriction. These protections were not bypassed.

Synthetic PNG bytes are generated with zlib and correct chunk CRCs. JPEG fixtures exercise marker/header structure and do not prove actual pixel rendering. The real GVL244 image bytes and material schemas were not available in this environment; model download, rendering and WFC import still require desktop verification.

From routings-model-package:

```powershell
node --test test/image-assets.test.mjs
```

In WFC:

```powershell
node scripts/copy-model-verifier.mjs
node --test scripts/model-registry/image-assets.node-test.mjs
```

Update and rebuild both WFC API and Preparer, then resume the latest existing generation. An additional model schema outside this profile must be diagnosed rather than silently skipped.
