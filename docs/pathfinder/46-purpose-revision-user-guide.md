# Path Finder: purposes, cable locations and model revisions

This guide explains the separate local demonstration at **127.0.0.1:5191**.
It accompanies [the accepted plan](32-purpose-and-revision-plan.md) and
[the R10 delivery record](47-r10-final-delivery.md). The complete current cold
backup, fresh isolated restore, authentication checks and bounded offline
demonstration have recorded technical passes. The disposable target has been
retired, and the source preparation service was resumed and confirmed ready.
The local delivery commit is identified in the closeout record. These checks do
not accept the real engineering model. Use report47
and its receipts for the final verified revision and remaining limits.

The current R10 candidate1 includes the corrected Word report images and honest
descriptions where an optional catalog image is unavailable. Normal application
exports of the controlled LV and MV examples have each produced a seven-page
report; all fourteen rendered pages were inspected. A separate controlled
mathematical example has calculation, exact length components, explicit
Review → Apply, idempotent replay and request-closing evidence. These examples
demonstrate the features; they do not establish complete routing for Aalborg.
No real project routing or design length has been applied for the user.

## 1. Open the isolated demonstration

Use a current administrator account at:

<http://127.0.0.1:5191/projects/1af0f807-7653-40ea-8391-7eea6c54e7d4?tab=pathfinder>

This is the separate copied-project demonstration. Changes here do not update the
original application. Its engineering data still needs human review; successful
controlled test cases do not establish that every project cable can be routed.

Sign in through the normal application login. Use your copied account if it has
current administrator access in this installation, or the retained local demo
administrator account. Its credentials are stored only in the protected local
`demo.private.json` beside the saved runtime descriptor; passwords and tokens
are not included in this guide or Git. The temporary ordinary-reader QA account
was removed after its checks and is not a demonstration login.

The copied project contains **2140 cables, 330 trays, six tray purposes and 1527
location names**. Its real routing permissions are unconfigured and its retained
prepared model scope is a **13-object diagnostic network**. It is not yet a
complete network for those 330 trays. Configure real permissions, resolve model
ownership and shared locations, then prepare and review the intended network
before accepting real cable results. Complete-network capacity is unverified.

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

### Try the retained drawing and report examples

The separate project **PF-R10-DRAWING-8609c3e8-e73** contains clearly labelled
synthetic drawing inputs. It is retained as a useful demonstration, not as real
cable engineering data or an example of a prepared 3D routing network.

| Example | Open |
| --- | --- |
| Project settings and separate drawing-purpose rules | [Synthetic drawing project Details](http://127.0.0.1:5191/projects/c6613d65-7170-451d-9530-08999b31ebb2?tab=details) |
| **BC001 — LV**: compatible Power and Control bundles | [LV tray drawing](http://127.0.0.1:5191/projects/c6613d65-7170-451d-9530-08999b31ebb2/trays/8b295c09-6de4-4b0e-9a4f-0f7a99f70423) |
| **BC002 — MV**: trefoil arrangement and clamp diagnostics | [MV tray drawing](http://127.0.0.1:5191/projects/c6613d65-7170-451d-9530-08999b31ebb2/trays/f1bb86bc-f984-47f2-990e-7a31fff863d8) |

In this synthetic project's **Cable positioning** card, assign Power and Control
to the same side to inspect compatible pooling, then opposite sides to inspect
the automatic divider. **Use default layout** returns each category to its
established default side. Save the settings and refresh the tray drawing.

On either ready tray page, **Generate report** saves the load-curve image,
bundle image and Word report, then downloads the report. The retained project
also contains its generated files. The Word bundle picture is intentionally
rotated onto a portrait page; its separate bundle image remains horizontal.
Missing optional catalog images or unavailable engineering facts are described
as missing rather than supplied with guessed values.

The MV example is retained with clamps **off**. Enabling a clamp that does not
fit makes the drawing visibly blocked and prevents exporting a valid report.
Do not treat a recommended clamp as an installed clamp. Restore the example's
clamps-off setting after inspecting that diagnostic.

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

The copied Aalborg demonstration currently uses **Secondary tray length 7 m**,
**For end connection 5 m**, **Additional % for bending 10%** and **Connection gap
1 m**. These are this project's retained values, not settings to copy blindly
into another project. Each proposal records the actual Details inputs it used.

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

For the real copied project, review coverage against the actual project tray
catalog. Confirm units, transforms and the engineering coordinate frame before
using fitted geometry or entered endpoint coordinates as length evidence. An
imported and visible model is not, by itself, a prepared routing network.

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
Once a physical location is confirmed, the same saved location can satisfy other
cables' From and To names. Review ambiguous aliases instead of creating a second
location or choosing the first candidate automatically. The demonstration has
not invented bindings for the 1527 real location names.

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

Closing the page does not stop an already authorized background calculation.
The local application and its separately managed preparation service must still
be running. The service is deliberately stopped and joined for a cold backup;
the checkbox does not start it again. At R10 closeout the source service was
resumed in a fresh private work directory, binding10/PID14196, and normal status
reported **ready**. The launcher timeout was reconciled against that exact
process and its start receipt, without launching a second worker. Existing
diagnostic grant revision3 was preserved; no real-project grant was enabled.
Future computer/Docker shutdowns still require the qualified recovery workflow.

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
from the matching delivery receipt. The older R8 archive is historical recovery
evidence; it is not a backup of the current R10 application and new history.
The complete current archive **r10-final2** is verified, with backup ID
`3daea574-2d70-4f06-b714-3a8890c28798`. It contains eight payload members:
the database dump, MinIO files, staging files, Path Finder files and four pinned
application/service image archives. Its cold SQL-text inventory covers all
**126 tables**, including nonempty proposal, review, Apply and closed-request
history from the explicitly synthetic calculation example.

Keep these matched local items together. The three companion files are outside
the archive directory by design; do not copy them into Git or expose their
contents:

| Retained item | Absolute local path |
| --- | --- |
| Verified archive directory | `C:/Users/todor.chankov/source/WFC-pathfinder-local/pathfinder-engine/.scratch/tray-catalog-5f489050-d469-4ae0-9972-868b33a4d8e3/r10-final2` |
| Private runtime settings | `C:/Users/todor.chankov/source/WFC-pathfinder-local/pathfinder-engine/.scratch/tray-catalog-5f489050-d469-4ae0-9972-868b33a4d8e3/r10-final2-runtime.private.json` |
| Private producer/host provenance companion | `C:/Users/todor.chankov/source/WFC-pathfinder-local/pathfinder-engine/.scratch/tray-catalog-5f489050-d469-4ae0-9972-868b33a4d8e3/r10-final2-host-companion.private.json` |
| Separate qualified producer image | `C:/Users/todor.chankov/source/WFC-pathfinder-local/pathfinder-engine/.scratch/tray-catalog-5f489050-d469-4ae0-9972-868b33a4d8e3/r10-final2-producer-image.tar` |

After changing to the working-copy directory as above, verify this exact retained
archive with the read-only operation:

```powershell
node scripts/pathfinder-local/runtime.mjs verify-backup --backup 'C:\Users\todor.chankov\source\WFC-pathfinder-local\pathfinder-engine\.scratch\tray-catalog-5f489050-d469-4ae0-9972-868b33a4d8e3\r10-final2'
```

The private backup receipt is `r10-final2-result.private.json` in the same parent
directory. It identifies the matched archive, companions, images and cold
inventory. Verification does not itself restore or reactivate background work.

The current candidate1 application pins, recorded before the final cold archive,
are:

| Operator identity | Recorded value |
| --- | --- |
| Local branch | `pf-r10-final-delivery-local-20261019` |
| Technical delivery commit | `7b36306fb19d304d6c926b5fd6958a5bc3ac63fc`; subsequent closeout changes only documentation/evidence |
| Inherited handoff commit | `05429d1f03163332505a328b56d5659eff875644`; this is not a final R10 delivery commit |
| Candidate source context | 1560 files, SHA256 `a603cdab2540f3c21861dbcffc7f38112750d0c74c9e21a2c3366c61b4a9737e` |
| API image | `sha256:abac7d3e41f3b6888ac0d1d69c8fdfe9b9f9bcf3ba51256fa8f67893b0e672d1` |
| Web image | `sha256:b6f6b3a1a5183c7855d06862d53b3303f7f26c22b61a848944a2eea1a3ea4d1b` |
| Post-backup source resource record | `r9-source-runtime4.private.json`, matched profile18; the same source container identities resumed after the cold backup |

These pins identify the recorded local build. The final source commit is recorded
in report47 and the human-review handoff. Always check current resources before
maintenance; these records do not authorize replacing the original app.

### What the fresh restore proved

A new, separately owned **5192 verification installation** was restored from
this archive. It is a disposable recovery check, not the retained demonstration
address. The original 5191 data and resources were preserved during the drill.

| Check | Recorded result |
| --- | --- |
| Complete database before restore fencing | All126 table inventories equal the cold source using exact PostgreSQL row text and column metadata. |
| After fencing | Only the three qualified field sets for resource-session revocation, login-binding revocation and installation epoch/timestamp differ; the two authentication groups are revoked. Operational lease rows remain exact. |
| Restored authority | JWT secret rotated; all seven producer configuration variables blank; copied grants remain audit history subject to the restore fence. |
| Normal authentication and history |28 HTTP checks passed, including fresh administrator access, exact retained synthetic history, old unexpired source JWT401 and old source control-key401. |
| Protected model resource lifecycle | Normal protected resource returned206; access after closing its session returned410. An old source resource cookie by itself was not separately exercised, so that narrower check remains NOT_RUN. |

These checks are retained in `r10-restore5192-final1-result.private.json` and
`r10-restored-auth2-result.private.json` beside the backup receipt. They establish
the stated recovery and authentication boundaries. They do not automatically
qualify a restored preparation service, enable a grant or accept real cable data.

### What the bounded offline demonstration proved

Only the owned verification stack's web-container default route was removed;
its internal service network stayed connected. Through normal browser actions,
the protected model loaded **664556 fragments and438156 identifiers**. An ordered
real diagnostic lookup produced **35.30345579516123 m**, including four gaps
totalling **0.9840583861033791 m**. The yellow path, filled Ghost background and
Clear/restore behavior were checked. This is visualization/lookup evidence, not
an accepted cable design length or a complete routing network.

In the same bounded state, two new synthetic calculation results were produced
through the normal UI: **10 m geometric length →18 m design length**, using that synthetic
project's Details values S5/E6/P10. No Apply was performed, and the cable rows
remained unchanged. These synthetic settings differ intentionally from the copied
Aalborg project's S7/E5/P10; each project uses its own Details values.

The check used a new browser tab and requested a hard reload, but did not create
a virgin browser profile or disconnect the host's Internet connection
(`hostInternetDisabled:false`). It proves operation under the recorded owned-stack
egress restriction; it is not an air-gapped-host or empty-browser-cache claim.
The private `r10-restored-ui1-result.private.json` and
`r10-offline-math-read1-result.private.json` record that exact scope. Final
verification-target retirement passed with zero owned containers, volumes or
networks and closed port5192. The source5191 service is retained and ready;
report47 records the separate exact lifecycle evidence.

Backup/restore are operator maintenance, not routine browser actions:

1. Check exact runtime ownership, paths, ports and image identities, including the
   separately managed producer host. Close model/drawing activity in the browser
   and establish that writers and owned engine processes have joined before
   capturing cold state. Closing a browser tab alone is not that proof.
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

Maintenance acts only on the separately identified local stack. Do not restart
or update the original WFC application to make this demonstration reflect a
change. If the local page is unavailable during the cold-maintenance window,
wait for that operation's recorded completion and reopen the 5191 address.
Restoring an archive never authorizes automatic producer/grant reactivation or
automatic application of real cable results.

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
engineering review. The current saved real comparison covers eight old and nine
new diagnostic objects, with seventeen unresolved changes and no automatically
accepted correspondence. It is not a comparison of every tray or consumer.

For the real project, the next engineering sequence is: save the intended purpose
permissions; review and prepare the required tray network; confirm shared From/To
locations in the correct frame; inspect the old/new model correspondence; then
calculate, review the exact paths and length components, and explicitly apply
only accepted proposals. Installed length remains unchanged by Apply. Final
PF-R10 checks will state the exact technical scope; human engineering acceptance
and any merge or deployment remain separate user decisions.
