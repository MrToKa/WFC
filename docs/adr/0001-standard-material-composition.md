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

Each owner column has a foreign key to its concrete owner table. Each assignment stores
its referenced material category and ID. All seven physical catalogs are selectable. Cable
owners default to Cable Installation Materials, trays and supports to Tray Installation
Materials, and instruments to Instrument Installation Materials. Load curves are not materials.

A category-qualified reference registry is populated and maintained by catalog triggers.
Composite foreign keys enforce reference integrity and prevent deleting referenced materials.
Existing assignments retain their original categories when the startup migration runs; changing
the default does not reclassify old references. The migration and full startup are repeatable.

Expansion follows references across catalogs, is cycle-checked and deterministic, and multiplies
quantities along each path. Database constraints reject direct self-references and duplicate
owner/category/material combinations. Units are retained without general unit conversion.

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
