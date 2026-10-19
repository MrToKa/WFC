# Path Finder: purposes, cable locations and model revisions

This guide describes the implemented local interface and its operating boundaries.
It accompanies [the accepted plan](32-purpose-and-revision-plan.md). At the time
of writing, PF-R9 has bounded technical verification recorded in report45;
PF-R10 final delivery checks are still pending. Instructions below do not declare
that those final checks passed or that the real engineering model has been accepted.
Use the final stage reports and their receipts for the verified revision and scope.

The candidate5 interface has loaded retained historical-v1 proposals and completed
a normal Calculate → Review → Apply flow on a controlled synthetic cable: an
18-metre design result, with installed length 44 metres unchanged. Real-data Apply remains
zero. Pending-request closing has source-test and actual HTTP evidence; a direct
browser demonstration of that close action is not claimed. These bounded checks
do not establish wholeplant routing coverage or human engineering acceptance.

## 1. Open the isolated demonstration

Use a current administrator account at:

<http://127.0.0.1:5191/projects/1af0f807-7653-40ea-8391-7eea6c54e7d4?tab=pathfinder>

This is the separate copied-project demonstration. Changes here do not update the
original application. Its engineering data still needs human review; successful
controlled test cases do not establish that every project cable can be routed.

The retained installation is identified by these saved descriptors:

| Item | Expected identity |
| --- | --- |
| Working copy | `C:/Users/todor.chankov/source/WFC-pathfinder-local` |
| Runtime directory | `pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600` within that working copy |
| Saved runtime descriptor | `runtime-state.json` in that directory |
| Docker project | `wfc-pathfinder-local-0cba87606e9b` |
| Owner | `8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46` |
| Project | `1af0f807-7653-40ea-8391-7eea6c54e7d4` |
| Browser address | `http://127.0.0.1:5191` |

The current saved descriptor and verified container/image pins must agree before
any maintenance. The table does not authorize operating a similarly named stack.
Port 5190 and the original WFC installation are outside this demonstration.

Only administrators can author these settings or use **Path Finder**, including
direct links and server operations. Ordinary authorized drawing readers can view
the resulting tray drawings without receiving Path Finder or model access.

## 2. Set the project inputs in Details

First check **Project → Details** and its active model version. Path Finder uses
that selected version; choosing a different model invalidates dependent work.

| Details value | Meaning for Path Finder |
| --- | --- |
| **Secondary tray length** | Replacement length for each endpoint approach flagged as SECONDARY. |
| **For end connection** | One connection reserve added to the cable calculation. |
| **Additional % for bending** | Percentage applied after SECONDARY replacement and the connection reserve. |
| **Connection gap** | Maximum permitted gap for connecting route geometry. The approved initial default is 1 metre. Actual accepted gaps contribute their measured lengths. |

A valid zero is different from a missing value. Enter the engineering values and
save them; the application does not invent missing allowances. The displayed
**Path Finder** formula explains its calculation. The existing **Automatic cable
length calculation** card also describes the separate established calculation in
the cable application; do not use that legacy formula in place of the Path Finder
component ledger.

For a successful Path Finder calculation, the final length is:

```text
ceil((max(0, geometric length − flagged From/To approach lengths)
      + Secondary tray length × number of flagged approaches
      + For end connection)
     × (1 + Additional % for bending / 100))
```

The original calculator's validation and clamp tolerance still apply; an invalid
geometry result is not made acceptable by this explanatory `max(0, …)`. Connection
gaps are already included in geometric length and are not added a second time.

The **SECONDARY trigger distance (m)** in the **Path** tool is a different value:
it determines when an approach is flagged. It does not supply the replacement
length. That replacement always comes from Details.

## 3. Choose routing permissions by tray purpose

Maintain the actual tray names and purposes in **Project → Trays**. These project
records are authoritative; historical purpose labels in the model do not silently
override the project catalog.

In Details, open **Path Finder routing permissions**:

1. Find each tray purpose and check the permitted **MV**, **LV** and **Control**
   categories. **Instrumentation** uses the Control rules.
2. Use **Exclude** when that purpose must intentionally allow no cable category.
   **Reset** returns it to **Unconfigured**, which also allows no routing.
3. Resolve missing purposes, duplicate names or identity diagnostics in the
   project data. Do not treat the first similar model name as a confirmed match.
4. Select **Save routing permissions**. The table and **Permission history** show
   the saved revision. A matching network preparation is needed after changes.

Unsaved changes are drafts. If another administrator saved first, refresh the
current state and deliberately reapply the intended changes. When a response is
unknown, **Retry the same save** reconciles the retained command; creating a new
command is not a substitute for finding out whether the first one committed.

## 4. Choose drawing sides separately

The Details card **Cable positioning** controls tray cross-section drawings. Its
columns are **MV**, **Power**, **VFD** and **Control**, for each tray purpose. These
drawing categories are separate from the MV/LV/Control routing permission mask.

1. Keep **Use default layout** to preserve the established arrangement.
2. Select **Left** or **Right** for a category that needs an explicit override.
   Those choices are mutually exclusive. **Reset all to default** clears the
   purpose's overrides.
3. Select **Save cable positioning**, then inspect the resulting tray drawings.

Compatible cables assigned to the same final side are packed together into
bundles. Phase, trefoil, diameter, grounding and clamp constraints still apply;
MV positioning includes grounding, which retains its separate packing rules.
Two occupied sides produce an automatic divider. One occupied side does not.
The divider is a 2-pixel drawing mark, not an assumed physical thickness. Missing
dimensions or overflow remain visible problems rather than a fabricated fit.

These choices do not offset cables in the 3D Viewer and do not change a Path
Finder route or design length. A genuinely changed route can change which cables
appear in a tray drawing, even when the positioning policy stays the same.

## 5. Prepare the network in Routes

**Path Finder** contains three tools:

| Tool | Use |
| --- | --- |
| **Routes** | Prepare and inspect the routing network, captured geometry and revision comparisons. |
| **Path** | Resolve shared From/To locations, calculate cable proposals, inspect results, then review and apply. |
| **Path lookup** | Display an already ordered list of route identifiers from the active model. It does not calculate a cable design length or permit Apply. |

In **Routes**, use **Project tray purposes** for the project catalog workflow:

1. Wait for the protected model to be ready, then select **Discover project tray
   candidates**.
2. Inspect tray coverage and diagnostics. Where ownership is ambiguous, inspect
   the actual objects, enter a resolution reason and **Save confirmed roots**.
   This confirms object ownership; it does not grant routing permissions.
3. Once the requested scope is resolved, select **Freeze reviewed preparation
   plan**. The plan records its exact model, catalog, permissions and input scope.
4. Use **Resume collection** to collect the frozen parts. **Pause local collection**
   retains committed parts; it is not a successful publication.
5. Enter **Preparation command reason** and select **Validate and publish complete
   network** when all required parts are ready.

Publication is atomic for the requested scope. A missing part, changed input,
exceeded limit or lost authorization must be resolved before that scope can be
published. A small diagnostic network is not a complete project network.

**Manual diagnostic capture** and the advanced canonical snapshot import are
separate diagnostic options. They do not configure the persistent Details
permissions or prove full project coverage. Do not rerun seed or model import to
repair an unresolved location.

## 6. Resolve From/To once and reuse the shared location

In **Path**, expand **Project cables and shared locations**:

1. Select **Match all locations**, then search for and select a cable.
2. Inspect both From and To statuses. A missing or ambiguous match needs a
   deliberate decision. Blank endpoint names and unsupported categories must be
   corrected in the cable data first.
3. Select **Resolve From** or **Resolve To**. Check whether **Saved location**
   already contains the intended shared location before creating another one.
4. In **Shared endpoint**, verify the location name and aliases. Enter one alias
   per line only when it identifies that same physical location.
5. Choose an available point behavior, inspect its evidence, enter a reason and
   select **Confirm shared endpoint**.

The registry is shared across both cable ends and all cables in the project.
Confirmed aliases reuse the same binding; they are not independent copied points.

- A **fixed-world** point is an explicit X/Y/Z point in metres in the current
  capture frame. Enter coordinates or use **Pick surface point in 3D**. A surface
  pick is evidence for that point, not proof that it is the electrical terminal.
- An **object-derived** point uses the exact saved object's bounding-box bottom
  centre. This is an approximate anchor and needs engineering review.
- An **object-attached** point requires verified object-local frame and durable
  attachment evidence. The current interface keeps this choice unavailable when
  that evidence is absent; it does not promise automatic Follow from a name or
  bounding box alone.

A new model can make a binding stale. **Review carry to the current model**
requires an explicit supported decision. Fixed-world coordinates do not silently
move with equipment, and equal names or database IDs do not establish physical
identity between two model revisions.

## 7. Inspect geometry and compare model revisions

In Routes, **Traceability → Create trace for published network** saves immutable
measurement evidence. Inspect object identity, bounding box, units, transforms,
geometry and diagnostics in **Saved geometry traces**. Keep project declared tray
lengths as audit data; they do not replace measured routing geometry.

In **Model revision changes**:

1. Choose **Old saved revision** and **New saved revision** from recorded scopes.
2. Inspect their model identities, coverage and capture frames before creating
   the comparison with a reason.
3. Inspect changed, missing, ambiguous, split or merged candidates and the saved
   object geometry. Resolve only supported frame and correspondence decisions
   that you have actually checked.

A captured frame is not automatically a common engineering frame. An observed
hash, bounding-box or purpose change is evidence of a recorded difference; it is
not proof that the physical plant moved. Old captures and decisions remain
history. Unresolved correspondence or frame questions can block carry-forward
and calculation without losing that history.

## 8. Calculate and read Cable revision results

In **Path**, verify the routing preferences, shared locations and current
published network. Use **Calculate selected cable** or **Calculate all cables**.
These operations create proposals; they do not change the cable list.

Open **Cable revision results** and choose a **Calculation scope**. Admissions are
saved even when a generation is blocked and has no job. **More calculations** and
**Next cable page** navigate stable pages of at most 100 rows, rather than showing
only the first portion of a large project. Use **Refresh revision results** for a
new read of the selected scope.

Choose **Inspect _cable tag_** and distinguish these records:

| Record | How to read it |
| --- | --- |
| **Current cable at admission** | The cable values captured when that calculation was admitted, not a claim that the cable has never changed since. |
| **Last accepted Path Finder result** | Historical accepted provenance. It supplies an old measured baseline only when its link to the admitted current cable is valid. |
| **New calculated result** | The new immutable proposal, its exact model and route, geometric/design lengths and available deltas. |
| **Exact length components** | The C# decimal calculation ledger: approaches removed, SECONDARY replacement, reserve, percentage, clamp and ceiling. |
| **Recorded provenance** | The input and result identities used to relate the baseline, dependencies, ledger and proposal. |

Read unavailable old geometry or deltas as **unavailable**, not zero. The
application does not reverse-engineer an old geometric length from a rounded
design length. Historical proposals without a component ledger remain historical
records; the interface does not manufacture one. A design-only recalculation can
reuse an eligible recorded route when only project length settings changed.

Check **Revision reasons** and currentness before acting. Recorded reasons do not
by themselves prove a physical change. Settings, model, policy, catalog, location,
comparison, routing preference or cable edits can invalidate an older proposal.

## 9. Review and Apply the exact proposal

1. In the selected result, choose **Open exact proposal in Viewer**.
2. Check the actual route, endpoint approaches, connection gaps, model scope,
   warnings and exact length components. The selected route retains original
   colours, a yellow path and a filled Ghost background.
3. Select **Confirm proposal review** only after checking that exact displayed
   proposal. A review of an older hash does not approve a newer result.
4. Select **Apply reviewed result** only when you intend to write it to the cable
   list. Apply writes routing and design length together and preserves install
   length. Keep the resulting receipt/history as the acceptance record.

Current administrator authority, exact review and all dependent revisions are
checked again at Apply. An intervening manual edit or import can block Apply even
if values were later changed back. A stale result needs recalculation and a new
review. A new login also requires a fresh review before a new Apply. An unknown
response must be reconciled rather than treated as either success or a safe
rollback.

### If an Apply response is lost

**Pending Apply** retains the exact command for the same account and project in
this origin's browser session storage. It contains the original proposal, review,
cable write revision and request key, without a bearer token or password. A model,
settings, tool or displayed cable change does not replace that command. Reloading
the page recovers it in the same browser session. Another account or project cannot
replay it, and the application never retries it automatically. Keep this browser
session until the outcome is reconciled.

While the command is pending, new Review and Apply actions are blocked. Choose
one of these explicit actions:

- **Retry pending Apply** sends exactly the original request body and key. If it
  already committed, the authenticated server returns the original receipt before
  considering whether the current cable or model has changed. Only a matching
  receipt confirms that the original Apply succeeded and clears the pending state.
- **Close pending request** resolves an obsolete or unwanted pending command.
  The server first checks for the original receipt. If already applied, the result
  confirms that prior Apply; closing does not undo it. Otherwise, the server
  atomically records an immutable closed key, preventing a delayed original request
  from applying later. The confirmation explicitly states that no cable values
  were applied by that request. This is not a replacement Apply or a local discard.

After signing in again as the same administrator, you can explicitly reconcile or
close that account's retained request. A new Apply still needs a new review in the
current login. A closed request also clears the local review confirmation; inspect
and review the intended current proposal before applying anything new.

A lost close response, transport failure or mismatched receipt leaves the command
pending. Repeat the same retained action rather than creating another key. If
session storage is unavailable, invalid or full, the application refuses a new
Apply before sending it; ask the operator to reconcile retained recovery state.

Use **Clear** or **Restore view** to restore model visibility. **Background
transparency to apply (%)** adjusts the current displayed path's background;
**Opaque background** removes that transparency. Drawing Left/Right settings do
not affect this view.

Real project routing and length acceptance remains your engineering decision.
Automated technical checks and controlled fixture reviews do not make that
decision on your behalf.

## 10. Use Path lookup for an existing ordered route

In **Path lookup**, enter exact tray identifiers separated by `/` in **Ordered
route**, or select **Use cable routing for lookup**. Use **Reverse route order**
when needed, then **Show route**. Inspect geometry diagnostics and fallback
warnings as well as the displayed line.

Lookup uses the active model and Connection gap. It is independent of unsaved
Routes category drafts. It does not assign From/To, use SECONDARY allowances,
calculate cable design length, or provide Review/Apply. A successful lookup is
therefore not an accepted calculated cable proposal.

## 11. Enable calculation while the browser is closed

Expand **Background model recalculation**. Set the intended Path preferences and
**Background calculation timeout (ms)**, check **Automatically recalculate model
revisions**, then **Save background calculation setting**.

The saved authorization covers this project and its active model. It permits
bounded preparation and calculation work while this page is closed, when the
qualified local preparation service and application are running. Its grant
revision, saved preferences and producer status are displayed. It never confirms
locations, accepts comparison decisions, reviews proposals or applies cable data.

**Enabled** and **Model preparation ready** are separate conditions. Saving the
checkbox does not qualify an unavailable producer. An unqualified, blocked or
stopped producer leaves geometry pending. Read the displayed reason and use
**Refresh background status** after the condition has actually been resolved.

To stop future automatic work, uncheck the setting and save. Expired operation
leases, revoked administrator authority, changed grant or installation identity,
or an unconfirmed engine shutdown can block work. Unknown outcomes retain exact
private recovery state instead of starting duplicate work. Use **Retry saved
background command** only for the retained setting command; an operator must
reconcile quarantined execution state with positive shutdown evidence.

After a restore, historical grants remain available for audit but are
**restore-fenced**. Sign in with the restored installation's current credentials,
inspect settings and current model, then explicitly enable again if appropriate.
The restored producer must separately be qualified for its own installation and
exact image; do not copy an old host key or remove the fence manually.

## 12. Retain, verify and restore the local installation safely

The source code checkout alone is not a complete backup. Retain the verified
database, model blobs, immutable Path Finder files, staging state, pinned images,
archive manifest, and the separately protected private companion. A qualified
background producer additionally needs its matching helper image and host
provenance/qualification materials. Keep credentials and business rows out of Git.

The existing operator tool is `scripts/pathfinder-local/runtime.mjs`. This exact
read-only inspection command selects the retained 5191 runtime explicitly:

```powershell
Set-Location -LiteralPath 'C:\Users\todor.chankov\source\WFC-pathfinder-local'
node scripts/pathfinder-local/runtime.mjs info --runtime 'C:\Users\todor.chankov\source\WFC-pathfinder-local\pathfinder-engine\.scratch\batched-capture-runtime-20261018-1600'
```

Its `verify-backup --backup` operation verifies an existing archive's completion
marker, hashes and image members. Supply the **actual retained archive directory**
from the matching delivery receipt. Final R9/R10 archive paths and image/source
hashes are pending; this guide does not supply an invented final archive path.

Backup/restore are operator maintenance, not routine browser actions:

1. Check exact runtime ownership, paths, ports and image identities, including the
   separately managed producer host. Close Viewer activity and establish that
   writers and owned engine processes have joined before capturing cold state.
2. Use the existing matched archive/private-companion workflow. The generic runtime
   backup stops and resumes its own application services, but does not itself
   manage the separate producer host or produce its companion evidence.
3. Verify the archive before restore. Restore into a **fresh owned** directory,
   containers, database, storage and volumes with an explicit unused loopback port
   such as the controlled 5192 fixture. Never omit the target port or select the
   retained 5191 runtime as a disposal target.
4. Check complete source/pre-fence inventory equality before restore fencing, then
   validate the expected rotated authentication and installation identity. Old
   Viewer sessions and grants must not remain live. Producer credentials and
   qualification must not be silently reused.
5. Demonstrate the restored application using normal authentication and the
   protected resource path. Keep the source demonstration and qualified backup.
   Retire only the new, positively identified disposable fixture after verification.

Do not use the old default drill commands from earlier 5190-era instructions, a
general Docker prune, or manual database changes to bypass a refusal. The generic
`stop` action also does not prove that the separate producer host has stopped.
Final source/target lifecycle commands belong in the qualified stage runbook,
with its exact descriptors and host cleanup receipts.

## 13. When something is blocked

| What you see | Next action |
| --- | --- |
| Path Finder is unavailable to this account | Check the current administrator role and sign-in. A stale token or engineer permission does not grant administrator access. |
| Unconfigured/excluded purpose or tray identity diagnostic | Correct project catalog data or save intentional routing permissions; then prepare a matching network. |
| Missing/ambiguous From or To | Confirm the correct shared location and point, including aliases, rather than entering separate guesses per cable. |
| Stale location after a model revision | Inspect the old/new frame and object evidence; perform supported carry review or confirm the new point. |
| Changed dependencies or outdated proposal | Refresh, calculate with current inputs, inspect and review the new exact result. |
| Missing geometry, exceeded capacity or incomplete capture | Inspect the retained plan/parts and actual scope. Resolve the reported condition; do not treat truncated data as a complete network. |
| Unknown Apply result | Use **Retry pending Apply** for the exact original command, or **Close pending request** to obtain its existing receipt or a server-confirmed closed key. A close is not an undo. |
| Unknown other save, publication or execution result | Reconcile the retained exact command or private owned execution intent. Do not repeatedly create replacements. |
| Model preparation not qualified or stopped | Restore the exact qualified local service/host through the operator workflow. The checkbox cannot repair or qualify it. |
| Restored grant disabled or fenced | Review restored state, sign in normally and explicitly reactivate after separate producer qualification. |
| Missing historic ledger or old geometric length | Keep it unavailable. Recalculate current inputs for a new recorded result; do not invent an earlier measurement. |

The two actual converted Aalborg revisions provide recorded comparison inputs.
Their existence does not establish a verified common engineering frame, a complete
equipment mapping or native Navisworks parity. No Navisworks licence is assumed;
the agreed acceptance route is converted-model evidence plus your manual
engineering review. Final PF-R10 checks will state exactly what was verified and
what remains unresolved.
