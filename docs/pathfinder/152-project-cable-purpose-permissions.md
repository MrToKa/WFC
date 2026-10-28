# Project Cable types Purpose permissions

Routing permissions now display the distinct, normalized `Purpose` values from
the current project's Cable types. The Aalborg catalog currently contains
Control, Grounding, MV, Power and VFD. Other projects supply their own columns.

Each tray purpose independently permits those values. Power and VFD remain
independent even when their cables share an internal LV calculation category.
There is no automatic expansion of an old LV permission into new purposes.
Saved values absent from Cable types remain visible as a configuration notice;
selecting current purposes, Exclude or Reset replaces the affected row explicitly.

The policy read supplies the current purpose list and its hash. Saves check that
catalog as well as the tray catalog and policy revision. Purpose changes alter
routing scope, and linked cable type Purpose changes notify recalculation.
Names, diameters and normalization-equivalent Purpose edits do not notify it.
Linked cable/type identity and Purpose are read again after acquiring the routing
scope lock. A concurrent type edit or reassignment cannot authorize a result with
the Purpose from an earlier read. Individual, bulk and review/apply reads share
this check.

Invalid historical Purpose values are omitted individually and counted in a
visible diagnostic. Valid purposes remain usable. New manual and imported values
use the same validation; invalid material values cannot enter a project by copy.

Prepared geometry retains the existing native category representation. Every new
cable calculation freezes an exact Purpose and permitted route-code list, which
the native runner applies before nearest-tray, direct-secondary and capacity
decisions. Individual and bulk admission, review/apply currentness, historical
result reads, retained-design checks and shared computation reuse account for
this input. Standalone Find path also requires a project Purpose selection.
Result acceptance checks every returned tray code against the frozen permission
list and requires the saved route text to match those codes. Generated SECONDARY
approaches retain their existing independent strategy checks.

Native, API and web changes must be deployed together. Existing prepared networks
need a fresh preparation for the new routing scope; existing business permissions,
cable routes and lengths are not migrated by this change.

Verification covers policy/catalog conflicts, independent Power/VFD permissions,
scope changes, bulk/individual parity, workflow currentness, reuse, all three
native calculation lanes, direct-secondary ordering, capacity retries and graph
cache separation. The new PostgreSQL trigger was exercised with synthetic
objects in a rolled-back transaction. Native preservation qualification compares
the candidate runner's resolved IL with the installed runner while retaining
the installed Core, Model, Adapter, Barriers and Verifier modules byte for byte.

Build, installation and final validation evidence is recorded separately in
`D:/Codex-test-output/cable-purpose-permissions-20261027/`.

Revision 2 was installed on the local 5191 application on 2026-10-27. The live
project table was reloaded and verified with Control, Grounding, MV, Power and
VFD columns, 330 trays and the retained policy revision 1. Existing LV-only rules
show Needs configuration. No permission choices were submitted during verification.
API image: `sha256:e71b4b4e5428ee7cf061bd64df5be63b9b018e490a6ccf26cbb5fe822f556834`.
Web image: `sha256:7157f2b1efcf33557a171d8ba2bdc7bd2be8b978e478d5fa2e2544d56465b033`.

The final delivery retained every business and authority row exactly. Its named
overlay qualification retains the original v6 comparison and explicitly handles
only the two pristine-empty migration-reference checks for already populated
automatic-pair history tables. Each table retained all 3,118 rows and every schema,
raw-file, key and fencing fact exactly. Runtime transition checks are unchanged.
The separate Preparer service was already unavailable with LOCK_BUSY after the
Docker restart; its container, image, configuration, mounts and network were
preserved. That service is separate from manual Path Finder network preparation.
The manual flow uses the loaded protected Viewer SDK and this application's local
native runner; it has no request to the external Preparer on port 5193.
