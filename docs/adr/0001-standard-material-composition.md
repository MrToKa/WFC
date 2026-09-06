# ADR 0001: Standard Material composition and snapshots

## Status

Accepted.

## Decision

The seven physical master-material categories use separate assignment tables:

- `material_cable_type_standard_materials`
- `material_cable_installation_standard_materials`
- `material_tray_installation_standard_materials`
- `material_instrument_standard_materials`
- `material_instrument_installation_standard_materials`
- `material_tray_standard_materials`
- `material_support_standard_materials`

Each owner column has a foreign key to its concrete owner table. Tray Installation Material
assignments reference `material_tray_installation_materials`. Instruments and Instrument
Installation Materials reference `material_instrument_installation_materials`; the other categories
reference `material_cable_installation_materials`, the canonical catalog for cable and project
defaults. Owner deletion removes only its master composition. Referenced-material deletion is
restricted while assignments exist.

Cable, Tray, and Instrument Installation Materials may themselves own Standard Materials. Expansion is
recursive within the corresponding installation-material catalog, cycle-checked, deterministic,
and multiplies quantities along each path. Direct self-references are also rejected by database
constraints. Units are retained from the child assignment; no general unit conversion is attempted.

Project Cable Types, Change Orders, and Internal NCRs store copied display fields and provenance. They never read
live master composition data for reporting or export. Catalog edits therefore affect only future
snapshots. Project Cable Type source changes replace inherited defaults only; manual project
defaults and customized cable materials are preserved. Cable-level synchronization remains an
explicit operation.

For Change Orders, a Cable Type row represents one cable line while its commercial quantity is
the cable length in metres. Standard Material quantities on that row are therefore copied once per
cable line and are not multiplied by design or spare metres. Piece-based material categories keep
the general parent-quantity multiplication rule.

## Consequences

The explicit tables duplicate a small amount of schema and repository code, but enforce owner
integrity in PostgreSQL and avoid an unenforced polymorphic `owner_type + owner_id` relation. Load
Curves have Details pages but no composition capability because they are engineering data rather
than selectable physical material.
