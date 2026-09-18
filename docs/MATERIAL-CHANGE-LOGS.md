# Material change logs

Every material details page includes a Change log: cable types, cable installation
materials, tray installation materials, instruments, instrument installation
materials, trays, supports, and load curves. Entries show the saved author name,
time, and previous/new values. Administrators can export the history using the
existing change log export control. All histories are collapsed expansion panels
by default and display ten entries per page, with page selection and previous/next
controls inside the expanded panel.

Tracking starts when the updated API first starts. Existing historical edits
cannot be reconstructed; existing materials initially have an empty history.
`initializeDatabase` installs the audit table and triggers automatically.

The database records material properties, Standard Material assignments, and load
curve points in the same transaction as each change. Excel imports use the same
tracking. Timestamp-only updates are ignored, and point replacements are compared
by their order so importing unchanged points does not appear as a change.

Material routes use `materialAuditPool` (or `withMaterialTransaction` for
composition edits). The authenticated request identity travels through
`materialAuditActor` and is set on each database transaction with `set_config`.
The setting is transaction-local and cannot leak to another pooled request.
Keep new material mutations on this pool. Changes from migrations or direct
database maintenance have the author `System`. Saved author names and audit
events survive removal of referenced users or materials.

History is read at `GET /api/materials/change-logs/:category/:materialId`, under
the existing catalog access permissions. The UI reloads history after edits,
composition changes, imports, or a details refresh.

For a reproducible API/database integration check, start a disposable PostgreSQL
database named `wfc_audit_test`, then run:

```powershell
$env:WFC_MATERIAL_AUDIT_TEST_DATABASE_URL='postgres://USER:PASSWORD@127.0.0.1:PORT/wfc_audit_test'
npx tsx scripts/check-material-change-logs.ts
```

The script refuses other database names, initializes the schema, and adds test
data. It checks every category, Standard Materials, Excel imports, curve point
replacement, no-op edits, author attribution, rollback, and read access. Remove
the disposable database after the check.
