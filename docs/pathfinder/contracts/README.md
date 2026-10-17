# Proposed PF-0 neutral contract examples

These files document future boundaries. They are **not implemented request/response types, native golden fixtures, registered endpoints or production model data**. The normative proposed meanings are in [the specification](../00-specification.md); the reference-case inventory is in [parity fixtures](../00-parity-fixtures.md).

[`examples.json`](examples.json) is an illustrative synthetic straight-path scenario. All IDs, hashes and revisions are invented. Hashes are syntactically shaped placeholders and do not attest to existing artifacts. No HTTP path is specified; final transport/schema bounds are a later implementation decision. The examples deliberately distinguish canonical project locations from model-version bindings, original text from normalized lookup keys, and a calculated proposal from an applied cable value.

Arithmetic shown only to make the proposed breakdown unambiguous:

- Straight path points0→3→30→31m give geometric length31m:27m graph physical length,3m From approach and1m To approach.
- Strict2m threshold flags only the3m From approach as SECONDARY.
- Project Details values are SECONDARY5m, connection reserve6m and percentage5%.
- Design length is `ceil((max(0,31-3)+5+6)*1.05) = ceil(40.95) = 41m`.
- This verifies neither the PF implementation nor native/converted-model equivalence. The simple supplied points intentionally omit real mesh extraction, adjacency construction and modeled equipment.

The apply example is a **proposed command**, not a receipt. It includes dependency expectations/idempotency and a separate server-owned cable write revision covering intervening manual/imported routing/design-length changes, and cannot establish that a proposal was reviewed/applied. The authoritative service would reread every dependency and require current administrator access before any write, protecting those checks through commit. No previous cable value is overwritten by merely loading these examples.

All illustrated geometry is in canonical right-handed Z-up world metres. The column-major `sourceToWorldMetres` matrix includes unit/axis/root transforms but excludes the display offset. `pWorldMetres = sourceToWorldMetres * pSource`; `pDisplayLocalMetres = pWorldMetres - globalOffsetMetres`. The already canonical example points must not be transformed again. The identity/zero-offset example illustrates the contract only; PF-2 must prove real SDK transform equivalence.

Required future validators include schema/version bounds, finite coordinates/numbers, project-scoped identities, fixed enum treatment, settings provenance, canonical-unit transforms, path consistency, artifact integrity, stale dependency rejection and idempotency. JSON syntax validation alone does not prove any of these runtime checks exist.
