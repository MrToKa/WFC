# Removing a proposed CAD component

The deployed Materials/STEP PoC initially omitted instance deletion. This follow-up
adds **Remove selected component** below the saved-component count/zoom control.

1. Open Routings builder → Components and select a saved component in the list.
2. Choose Remove selected component.
3. Review its part number and XYZ position; confirm with Remove component, or Cancel.

Deletion removes only that placed instance and its connector relationships from the
proposal. Other placed parts, the Materials product, every STEP revision and the
original SVF remain available. The displayed mesh is removed through the existing
model-scoped CAD_REMOVE command. A renderer failure is reported separately from a
successful database deletion so the user can reload the view without retrying a deletion.

API: DELETE `/api/projects/:projectId/cad-design/designs/:designId/instances/:instanceId`,
strict JSON `{expectedRevision}`, success204. Project edit permission, UUIDs, proposed
status, active healthy model and instance revision are checked. The transaction locks
the design/model selection and instance before deletion. Existing FK cascades remove
its relationships and existing triggers advance the proposal revision. Concurrent or
stale edits are refused with409; missing instances return404. No schema change is needed.

Verified locally2026-11-10: TypeScript, full lint, real API/web Docker builds and51
focused API/UI/routing tests passed. This includes cancellation, successful removal,
stale revision rejection, renderer cleanup failure and15 backend HTTP tests.

Real browser validation opened the selected temporary part's confirmation dialog and
cancelled without a write. Real deployed API validation deleted two newly created,
owned temporary instances, including their mutual connection. The eight other current
instances, their connections and catalogue references compared unchanged. No source
5180 services/data or main checkout were changed. PoC5181 was updated independently.
