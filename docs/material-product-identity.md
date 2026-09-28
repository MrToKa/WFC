# Material product identity

The Cable Types, Cable Installation Materials, Tray Installation Materials,
Instruments and Instrument Installation Materials catalogs identify a product by
**Manufacturer + Part No.**, independently in each catalog. Type (including the
Cable Types catalog's internal `name` field) can repeat.

The catalog action **Mark obsolete** hides a product from active lists and exports.
The row, its references and its history remain intact. Physical deletion stays
blocked by the database. Product identity uniqueness applies to active products;
obsolete products do not block a replacement with the same identity.

PostgreSQL enforces the combination with a unique expression index, or a trigger
backed by a unique identity registry while legacy duplicates await correction. Comparisons
ignore letter case and surrounding spaces. Manual create and edit operations
return HTTP 409 when the database rejects a duplicate product.

Excel imports validate duplicate combinations before writing any rows. An existing
combination updates that product, including its Type; a different combination
creates a new product. Blank prices retain the existing price on updates. Imports
are transactional and roll back all rows if a database conflict occurs.
An import matching multiple legacy records is rejected without updating any of them.

Manufacturer and Part No. remain optional for compatibility. An incomplete
combination does not identify an existing product, so importing such a row creates
a new record. Supply both identifiers for repeatable imports.

## Migration

API startup runs `initializeMaterialIdentity`, which creates the product identity
indexes and removes the former unique Type/name indexes in one transaction. It is
safe to run again. Existing duplicate combinations do not block startup and the
migration does not delete or merge material records. For conflicted catalogs,
database triggers maintain counts in a uniquely indexed product identity registry.
This prevents new duplicates, including concurrent inserts, while permitting
existing records to be edited, corrected or marked obsolete. Referenced materials
can be marked obsolete without breaking their assignments. When the
legacy conflicts have been corrected, the next startup replaces the temporary
trigger protection with the normal unique index.

For each affected table, this read-only query identifies conflicting rows:

```sql
SELECT lower(btrim(manufacturer)) AS manufacturer,
       lower(btrim(part_no)) AS part_no,
       array_agg(id) AS material_ids
FROM material_instruments -- replace with the affected catalog table
WHERE nullif(btrim(manufacturer), '') IS NOT NULL
  AND nullif(btrim(part_no), '') IS NOT NULL
GROUP BY lower(btrim(manufacturer)), lower(btrim(part_no))
HAVING count(*) > 1;
```

The PostgreSQL integration tests create and clean up their own isolated test schema.
Set `WFC_MATERIAL_IDENTITY_TEST_DATABASE_URL` to a
PostgreSQL connection and run
`npx vitest run server/services/materialIdentitySchema.test.ts`.
