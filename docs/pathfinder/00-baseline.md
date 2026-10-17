# PF-0 — Source and isolation baseline

17 October 2026. This is the first stage of the separate **PathFinder in WFC** workstream. It does not resume or rewrite the earlier Routings viewer stages. Read [the specification](00-specification.md), [validation matrix](00-validation-matrix.md), [parity catalogue](00-parity-fixtures.md) and [stage report](00-stage-report.md) together.

## Authority and scope

The user authorized PF-0 with an additional mandatory condition: develop in a separate local working copy and local branch; subsequent runtime work must use a separate localhost installation, containers, database and storage. The original installation is read-only reference material. Push, PR, merge and deployment require a later explicit user decision. PF-0 itself delivers documentation, contract examples and reference data only.

The accepted functional direction is an admin-only project tab, the selected project model, all active PathFinder calculations, automatic From/To resolution with reusable project locations, automatic proposals and explicit Review + Apply. SECONDARY replacement, end reserve and increase percentage all come from Project > Details. During PF-0 the user explicitly selected **Instrumentation -> Control**; MV, LV and Control retain their corresponding categories. Missing/unsupported categories require resolution.

Applicable instructions: the supplied global instructions, `C:/Users/todor.chankov/.codex/AGENTS.md`, the project mirror `AGENTS.md`, and the `prepare-stage-handoff` skill. The checked WFC/reference PathFinder source trees have no additional applicable repository instructions. Synced `sources/` remains read-only.

## Observed repositories

Initial local observations were made on 17 October at approximately 23:05–23:07 Europe/Kiev (UTC+03:00). Live GitHub observations were retrieved at **20:08:01–20:08:04 UTC / 23:08:01–23:08:04 Europe/Kiev**. Exact observations are in [start state](evidence/00-start-state.json) and [GitHub observations](evidence/01-github-observations.json).

| Checkout | Branch / HEAD | Working state and comparison | Use in PF-0 |
|---|---|---|---|
| `C:/Users/todor.chankov/source/WFC` | `main`, `e1ef20202598bb4d3d78e4772cbbb9747ec23a00` | Clean; cached and live GitHub main agree; initially 0 ahead / 0 behind | Original application source; read-only |
| `C:/Users/todor.chankov/source/WFC-pathfinder-local` | `pf-0-contracts-baseline-20261017`, created from the exact WFC commit above | New local worktree; PF-0 deliveries are confined to `docs/pathfinder/` | Sole WFC writing destination |
| `C:/Users/todor.chankov/.codex/.chatgpt-projects/g-p-6ad0a317833c8191bf8e4e8c824a1056/work/review-pathfinder` | `master`, `45c24bf5f433f13e102600b36f20327c77961d0a` | Clean; cached and live GitHub master agree; 0 ahead / 0 behind | Canonical algorithm reference, read-only |
| `C:/Users/todor.chankov/source/repos/MrToKa/PathFinder` | `master`, `35f4fb46f7762503576bdacd9668f34a1be2b0ed` | Two modified tracked files and one untracked VS Code file; 0/0 only against stale cached origin/master; 0 ahead / 24 behind the live reference | Preserved older local work, not the reference build |

Creating a Git worktree adds a local branch/ref and a worktree registration in the shared WFC Git repository. It does not switch the original checkout away from main. The working copy is source-only: no original `.env`, `node_modules`, application data or writable runtime volume was copied into a running installation.

The older PathFinder is a separate repository, not another worktree of the reference clone. Its `35f4fb4` ancestor was compared with `45c24bf` using the reference clone's object history; no fetch or update was made in the older repository. Its local changes are:

- `AddinRibbon/AddinRibbon.csproj`: Navisworks 2023 reference/output/post-build paths changed to local Manage 2027 paths.
- `AddinRibbon/ClAddin.cs`: Out Properties UI disabled and the legacy Algo tab enabled.
- `.vscode/settings.json`: untracked; its content was not inspected. SHA-256/size are retained only to verify preservation.

These changes are relevant host/build/UI work and are not silently discarded. They do not change the `45c24bf` core reference. The legacy Algo UI is not evidence that its excluded legacy algorithms belong to the active reference build; the parity catalogue distinguishes those surfaces.

## Remote branches, reviews and CI

The read-only GitHub connector returned five WFC branches and six PathFinder branches; the exact names/SHAs are retained in the observation JSON. Neither collection contained the new local PF-0 branch, which has not been published.

WFC [PR #1](https://github.com/MrToKa/WFC/pull/1), **Add Roxtec routing filters and matching cables table**, remains open and unmerged at head `fc81f5e250625afec76ed38f877ad7b790447dbb`; mergeability was `false` / `dirty`. Its two reviews are `COMMENTED`, not approvals. It is unrelated reference context, not a dependency or an integration delivery. PathFinder has no open PR in the returned collection.

For exact WFC `e1ef202` and PathFinder `45c24bf`, commit statuses, check runs and Actions runs were all empty. A combined status of `pending` with zero entries is **not** evidence that a job is running. Functional CI is `NOT_RUN` / no published evidence, not PASS. Local PF-0 execution is recorded separately.

## Existing implementation and evidence boundaries

WFC already has a private immutable model registry, active model selection, protected local SDK/resource sessions and the Routings viewer. Its current route string renderer derives an approximate display polyline; this is not a reference for engineering cable length. There is no implemented PathFinder graph/location/job/Apply domain in this source revision.

The existing `calculateAutoCableLength` helper sums full tray lengths, adds SECONDARY tokens, applies the percentage and then adds the end allowance. It is displayed separately in Cable Details; source inspection found no automatic persistence from that helper into design length. The future integration must reconcile the legacy explanatory display, not claim an observed automatic-overwrite defect.

The accepted Ghost appearance is preserved: the prior follow-up selects WebGL before SDK initialization and uses translucent context while retaining original tray colors. Historical broader browser/environment limits in the old reports remain their recorded limits. The user's visual acceptance is limited to the demonstrated Ghost result; it is not blanket acceptance of the new PathFinder feature.

Relevant existing documents are [Viewer specification](../routings-viewer/00-specification.md), [historical validation matrix](../routings-viewer/00-validation-matrix.md), [Stage 11 acceptance](../routings-viewer/11-integration-acceptance.md) and [Ghost follow-up](../routings-viewer/11-ghost-renderer-parity.md). They remain unchanged.

Reference PathFinder `docs/Validation.md` reports historical pure/native/lookup results. The referenced private raw result files are not present in either checked PathFinder checkout. Rounded lookup totals alone cannot prove exact endpoint/design-length parity. Current pure execution and newly extracted synthetic expected data are documented separately in the parity catalogue; conversion/native equivalence remains `NOT_RUN`.

## Isolation and runtime observations

The initial read-only Docker inventory contained **13 existing containers**. Only identity, image, status and start time were read; container environments and credentials were not read. No PF-0 container, image build, network, volume, application process or runtime installation is required or started.

Original databases, MinIO buckets/objects, writable volumes, credentials, model selection and application business data are not PF-0 mutation targets. Preservation evidence is based on source status/hashes, container observations and the bounded operations performed; it does not pretend to be a database-content audit.

The only executable calculation check uses copied reference source under an owned `.pf0-work/` temporary directory in the isolated worktree. It does not build either original PathFinder checkout. SDK/version, copied-source hashes, commands, outputs and cleanup are retained with the parity evidence. `DOTNET_CLI_HOME` was explicitly private to that temporary copy, with process-only telemetry/first-use switches. `NUGET_PACKAGES` was not overridden; there are no third-party package references, but no blanket absence of all global SDK/cache side effects is claimed.

The local `docs/pathfinder/.gitattributes` keeps frozen fixtures, evidence and the hashed parity catalogue byte-identical in Git despite checkout newline settings. Source inventory hashes describe the observed reference working-file bytes and their exact isolated copies; a future checkout with different text normalization must reconcile blob/working-byte provenance explicitly rather than treating a newline-only difference as an algorithm change.

## Evidence vocabulary and next-stage dependencies

`Planned`, `implemented`, `verified` and `accepted` are distinct. A passing source inspection proves only the inspected source claim. `PASS`, `FAIL`, `BLOCKED` and `NOT_RUN` apply to a named revision, scope and environment. Historical results are never relabeled as new execution.

PF-1 may extract the frozen pure core and construct a local-only service/worker contract using synthetic inputs. Before PF-2 can claim real-model routing, it must prove transformed mesh/fragment/hierarchy completeness, stable object binding and paired conversion/native geometry cases. Performance targets need measurement on the real model; they are not inferred from unit tests. No new stage starts automatically after PF-0.
