# ADR 0001: Standard Material composition and snapshots

## Status

Accepted.

## Decision

The four physical master-material categories use separate assignment tables:

- `material_cable_type_standard_materials`
- `material_cable_installation_standard_materials`
- `material_tray_standard_materials`
- `material_support_standard_materials`

Each owner column has a foreign key to its concrete owner table. Every assignment references
`material_cable_installation_materials`, the existing canonical catalog for materials used as cable
and project defaults. Owner deletion removes only its master composition. Referenced-material
deletion is restricted while assignments exist.

Cable Installation Materials may themselves own Standard Materials. Expansion is recursive,
cycle-checked, deterministic, and multiplies quantities along each path. Units are retained from
the child assignment; no general unit conversion is attempted.

Project Cable Types and Change Orders store copied display fields and provenance. They never read
live master composition data for reporting or export. Catalog edits therefore affect only future
snapshots. Project Cable Type source changes replace inherited defaults only; manual project
defaults and customized cable materials are preserved. Cable-level synchronization remains an
explicit operation.

## Consequences

The explicit tables duplicate a small amount of schema and repository code, but enforce owner
integrity in PostgreSQL and avoid an unenforced polymorphic `owner_type + owner_id` relation. Load
Curves have Details pages but no composition capability because they are engineering data rather
than selectable physical material.
