# Retained model coverage audit

This standalone read-only CLI checks copied inventory, one explicitly selected
computational snapshot, and the supplied QA location/cable metadata. It makes no
application, database, container, selection, category, location or Apply changes.
All runtime and computational limits remain unchanged.

From the isolated WFC worktree, run:

```powershell
node --test scripts/pathfinder-coverage/coverage.test.mjs
node scripts/pathfinder-coverage/audit.mjs --root C:/Users/todor.chankov/source/WFC-pathfinder-local --output docs/pathfinder/evidence/coverage/audit-<unique>.json
```

The output directory must already exist. Output is a relative path under the
absolute root and is created exclusively. Every processing failure records its
phase, input, exact error and available preceding results before returning exit2.
An unsafe, linked, existing or unwritable output cannot receive a receipt and is
reported to stderr instead; no earlier file is overwritten. Success exits0 with
`PASS_WITH_GAPS`, keeping human engineering review and missing evidence separate.

`retained.mjs` pins all retained input SHA256 values and identities. Optional
`--manifest <relative-file.json>` accepts exactly the same
`pathfinder.coverage.input.v1` shape, with no extra members; it relocates copied
inputs for integrity controls and future retained captures. The matching code
must always have the exact reviewed production `matching.js` and `errors.js`
hashes, reside together, and export the four reviewed functions. Both files and
their ancestors are checked before dynamic import. The imported production
normalizer preserves NFC, punctuation and leading zeroes. This tool does not
create a second route-name parser or run native geometry code.

Audit-only caps are512parts,2MiBperpart,512MiBpartbytes,1millionobjects,
5millionfragmentassociations,512hierarchydepth,120seconds and1536MiBsampledRSS.
Selected snapshot limits remain4096objects/64MiB plus the existing production
mesh counts. The tool reads parts sequentially and retains structural/name/
identity indexes. It does not load full inventory meshes: none are present.
Output is bounded to2MiB. Parsing rejects duplicate JSON members and nonfinite
numbers; paths reject traversal and symbolic links/junctions.

The structural audit verifies all declared bytes/hashes, chunk order/offsets,
IDs, parents, cycles, child counts, fragments and selected-object joins. Root
and group names describe inventory composition only. They do not establish tray
eligibility, native visibility or MV/LV/Control assignments. Selected explicit
category evidence is reported independently. Vertices are already canonical
world metres; finite matrix declarations are compared without transforming any
vertex or applying the display offset again. This proves internal agreement,
not native/converted geometry equivalence.

Registry analysis is scoped by project/model/content and the supplied selected
artifact. It calls actual production matching and separately reports raw name
candidates, shared cable automatic candidates (visible `object` only), standalone
Path fallback candidates (`object` or `routing-leaf`, nonhidden), manual binding
reuse and stale/unknown states. It never matches another project's synthetic
rows to the real inventory. Copied metadata omits full live artifact purpose/
latest status and matching rows, so those gates are expressly unavailable.
Endpoint strings and point coordinates are represented by hashes in the receipt;
bulk model/registry data remains in ignored private copied storage.

Property-DB external mapping count and reachable instance-tree count have
different scopes. This CLI independently reports observed IDs and missing ranges.
A separate pinned mapping observation may explain the count difference, but
does not replace the part-integrity gate. A missing tree object is not
automatically corruption, a phantom object or a tray. Full plant computational
coverage, representative business endpoint coverage, global prebuilt graph,
native oracle and user engineering acceptance are not established here.
