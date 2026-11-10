# STEP management from existing Materials trays

Materials → Trays now provides a **STEP file** action on every row when the CAD
feature is enabled. It opens a dialog scoped to that tray's existing canonical
straight component. No project-specific product or duplicate catalogue is created.

- An administrator chooses a .step/.stp file (nonempty, up to 8 MiB), then **Add STEP
  file** for the first asset or **Upload replacement STEP** for an existing one.
- Replacements create immutable CAD revisions. All earlier revisions remain
  downloadable; identical current bytes reuse the active revision.
- Non-administrators can inspect/download history but cannot upload.
- Dialog closure is blocked during upload. The tray list's filters and pagination
  remain in place when closing the dialog.
- Missing canonical mapping is reported explicitly, without creating an arbitrary
  replacement product. Existing schema migration/trigger maps current/new trays.
- Materials → Components and Routings builder use the same component and assets.
  Existing proposed instances continue to reference their pinned CAD revisions.

No backend schema/API change was required. The existing canonical revision API,
file validation, conversion limits and permissions are reused. Load curves,
images, prices and tray dimensions are preserved.

## Verification on 2026-11-10

- 8 component-section tests passed, including four new scoped-tray cases covering
  correct product resolution, first/replacement upload, retained revision history,
  read-only permissions and missing mapping.
- 17 complete Materials navigation/filter/return-state tests passed.
- Frontend/server typecheck passed; changed TypeScript files passed ESLint.
- Built/deployed only PoC web on 5181.
- Real browser filtered KL 60.303 F, opened its row action and uploaded its known
  current STEP. The backend reused revision 3. API read-back proved the complete
  three-revision history unchanged, avoiding an unnecessary test revision.
- Screenshot: local `.data/tray-step-dialog.jpg`.
