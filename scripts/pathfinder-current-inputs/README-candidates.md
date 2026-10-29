# Full-model From/To candidate audit

This offline tool consumes a successfully copied current-input snapshot and its
source receipt. It never queries a database or app, imports a model, creates a
location/job/proposal, or confirms a binding. Business keys, candidate names,
property values and raw MTO values stay in a fresh ignored owner-marked scratch
directory. The public receipt contains counts, identities and hashes only.

```powershell
node --test --test-reporter=tap scripts/pathfinder-current-inputs/candidate-lib.test.mjs
node scripts/pathfinder-current-inputs/candidate-audit.mjs --root C:/Users/todor.chankov/source/WFC-pathfinder-local --input pathfinder-engine/.scratch/<copy>/current-inputs.private.json --sha256 <raw-sha256> --source-receipt docs/pathfinder/evidence/current-inputs/<source-receipt>.json --source-receipt-sha256 <receipt-sha256> --output docs/pathfinder/evidence/current-inputs/candidates-<unique>.json
```

The caller supplies the actual source receipt and exact bytes from a successful
guarded copy. No current business result exists merely because controls pass.
Output paths are exclusive; parents must exist. Failures retain a sanitized
receipt and any previously saved private evidence. Unsafe/existing/unwritable
output paths fail without overwriting an earlier file. No cleanup runs in finally.

The tool reuses the frozen coverage verifier for all214 inventory parts, byte
hashes, offsets, IDs, hierarchy and fragment associations. That verifier also
checks its historical QA fixture; it is saved privately and is explicitly separate
from the current business endpoint audit. The five property files must match both
the copied active model manifest entries and pinned converted content. Every tree
object's external identity is joined to the property database, then only current
From/To normalized keys retain candidate rows. The mapping-only object is reported
separately and excluded from reachable-tree candidates.

The production compiled `normalizeLocation` and `objectMatchNames` modules are
hash-checked and reused. NFC, punctuation and leading zeroes remain unchanged.
The JSON v1 PDB decoder follows pinned7.130.0 worker semantics: append the offset
terminal slot, honor typed inline keys, follow instance sources, retain the last
instance source, omit inherited hidden properties, and shadow inherited values
by exact display name. Structural names are not property aliases; retained SDK
tree names provide object names. Unsupported encodings, malformed references,
cycles and bounded resource failures are explicit failures. This is source-backed
decoding, not an independent live SDK or native-equivalence proof.

Limits bound input/file bytes, inflated bytes, objects, property pairs, candidate
associations, inheritance depth, operation work, elapsed time and sampled RSS.
Time/RSS checks are cooperative and cannot interrupt one synchronous decompression
or JSON parse. Inflate and byte caps bound those operations; this is not a process
isolation or routing-capacity claim. Runtime capture/engine limits are unchanged.

Counts distinguish endpoint uses, distinct nonempty keys, reused keys, empty
inputs and missing/unique/ambiguous candidate identities. Exact raw MTO values are
kept privately. Public category counts preserve MV/LV/Control/Instrumentation,
null and unknown; Instrumentation maps to Control. Unknown values require
resolution, and type names never supply a category. Metadata matches establish
neither equipment role, native visibility, bottom-centre point, prepared geometry,
confirmed shared binding nor engineering acceptance. The52-object/26-leaf
computational capture remains a separate, partial scope.

The receipt separately reports normalized matching keys and the case-sensitive
Set of nonempty raw trimmed endpoint names used by Routes before capture NFC
deduplication. Case/Unicode variants can fit256 normalized keys while exceeding
the UI's256-name limit. Both untrimmed and trimmed maximum raw lengths are kept;
the UI applies its256-character check to trimmed names. The comparison covers all
copied cable endpoints only, excludes standalone drafts and selected-cable scope,
and proves neither route-rule feasibility nor a successful product capture.
