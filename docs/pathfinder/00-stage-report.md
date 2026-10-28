# PF-0 — Contracts and compatibility baseline report

17 October 2026. **PF-0 technical deliveries: PASS. Owned temporary cleanup: BLOCKED.** Workstream: **PathFinder in WFC**, separate local development. Reference source: WFC `e1ef20202598bb4d3d78e4772cbbb9747ec23a00`, PathFinder `45c24bf5f433f13e102600b36f20327c77961d0a`.

Read [baseline](00-baseline.md), [specification](00-specification.md), [validation matrix](00-validation-matrix.md), [parity catalogue](00-parity-fixtures.md) and [proposed contract examples](contracts/README.md). PF-0 does not start PF-1 or change the working application.

## Delivery and boundaries

All deliveries are in **`C:/Users/todor.chankov/source/WFC-pathfinder-local`**, local branch **`pf-0-contracts-baseline-20261017`**, created from the exact WFC source commit above. Documentation, illustrative contracts and reproducible synthetic reference data are under `docs/pathfinder/` only. Fixture generator source is reference tooling, not a production service, dependency, migration or UI feature.

A scoped `.gitattributes` preserves raw fixture/evidence/parity-document hashes across Git text conversion. It does not alter repository-wide rules or hide the retained temporary folder.

The initial plain Git whitespace check treated pinned CRLF bytes/captured final blank lines as whitespace errors. The scoped attributes declare CR-at-EOL and preserve captured EOF newlines; immutable fixture/log/generator bytes were not rewritten. Final index integrity separately verifies that these raw bytes are actually staged, including the five required logs otherwise ignored by the existing repository-wide log rule.

The [Git index integrity receipt](evidence/04-git-index-integrity.json) records the final byte/required-log/whitespace checks. Its audit is reproducible with `node docs/pathfinder/evidence/audit-git-index.mjs`.

The original WFC checkout stays on main. The old PathFinder checkout at `35f4fb4` remains 24 commits behind the reference, with its two local host/build/UI edits and untracked VS Code file preserved. Its cached upstream is stale; this was not mistaken for live remote equivalence. No reset, fetch/update or merge was made in that checkout.

No new application installation, running model, test container, image build, database/storage writer, network or volume is required by PF-0. There is no push, PR, merge or deployment. Later local runtime work must use its own ports, containers, database and storage; the original runtime is not its target.

The PF-0 delivery commit is the local commit containing this report and the frozen reference data; its identity can be read with `git rev-parse HEAD` in the isolated worktree. The final response supplies the actual local delivery commit once the scoped documentation has been recorded. Reference source SHAs above do not change with the documentation commit.

## Accepted decisions and contracts

- New PathFinder tab and preparation/calculation/location/Apply operations are strictly administrator-only; broader engineer catalog/project-edit permissions are insufficient.
- All three design allowances come from Project > Details: SECONDARY replacement, end reserve and percentage. PF formula order, SECONDARY replacement and unrounded geometric input are retained.
- User-confirmed category mapping: MV -> MV, LV -> LV, Control -> Control, **Instrumentation -> Control**. Missing/unknown category remains unresolved.
- Project location identity is shared by From/To and all matching cables, with separate versioned model/object/coordinate bindings. Manual confirmed mappings take precedence and model changes trigger revalidation.
- Calculation produces immutable proposals. Review + Apply checks calculation inputs **and** a separate server-owned cable write revision, including intervening manual/import edits to routing/design length. Authorization/dependencies stay protected through commit; successful duplicate Apply is idempotent.
- Coordinates have a proposed explicit right-handed Z-up metre frame, affine source transform and single display-offset equation. Actual SDK equivalence remains a PF-2 proof requirement.
- Exact computed path points, model/load/session fences and the accepted Ghost/Clear behavior are preserved in the proposed Viewer contract. Runtime/protocol extensions are not implemented by these documents.

Independent document review identified the write-revision/atomic dependency and coordinate-composition ambiguities above; the specification and illustrative JSON were tightened before freezing. No current automatic-overwrite bug was claimed: the legacy auto-length helper is display-only and uses a different formula.

## Executed verification

| Check | Result / precise scope |
|---|---|
| Live source-control observations | PASS: 12 selected GitHub observations plus both open-PR searches at 20:08:01–20:08:04 UTC; exact source heads unchanged. No published CI statuses/checks/Actions at those heads; functional CI NOT_RUN. |
| Current pure core regression | PASS: **105/105** checks, isolated Release run using installed .NET SDK **9.0.319**, exit 0. Optional private 327-name Excel input was not supplied. This is not a new 106-test or native run. |
| Synthetic reference extraction | PASS: **43** cases calling unchanged reference core; 17 automatic calculations, 5 lookups, 5 parses, 10 design-length cases, 2 name cases, 2 fallback geometry cases and 2 measured geometry/route cases. |
| Repeat extraction | PASS: second actual-core extraction is byte-identical to the retained expected file; source/input/generator hashes bind the result. |
| Fixture schema | PASS: existing AJV 6.15.0, draft-07 inputs/expected validation, 43 + 43 records and six negative schema controls. No dependency was installed or added. |
| Contract examples | PASS for JSON syntax and illustrative arithmetic only: the invented 31m geometry/allowance example gives 41m. It is explicitly not a captured PF or native result. |
| Final document/integrity/preservation checks | PASS: all 10 technical checks in `evidence/02-final-validation.json`: JSON/documents/links/source bounds, example invariants, frozen artifact/source hashes, original repositories/dirty-file bytes, scoped deliveries and all 13 original container identities/images/status/start times. Separate cleanup check BLOCKED; overall audit explicitly BLOCKED rather than falsely all PASS. |
| Web UI/API/security/apply/real converted-model parity | NOT_RUN: future implementation criteria, not PF-0 execution. |

The core regression and generator run only against a copied source tree in an owned `.pf0-work/` child of the isolated WFC worktree. Neither PathFinder checkout was built. `DOTNET_CLI_HOME` was redirected to the private copy; `NUGET_PACKAGES` was not overridden, so global SDK/cache side effects outside the observed repositories are not comprehensively audited. Full logs, source hashes, manifest and replay/schema receipts accompany [the parity catalogue](00-parity-fixtures.md). Successful silent geometry capture has an empty stdout log; measured inputs and actual returned geometry are the evidence, not empty stdout alone. [Independent review](evidence/03-document-review.json) records the contract findings and their resolutions.

## Readiness and remaining evidence gaps

PF-0 establishes the contracts and synthetic algorithm reference needed to start **PF-1: extracting the independent core** in a separate authorized stage. It does not establish native-versus-converted geometry equivalence.

The remaining gates are explicit:

1. **PF-2:** prove real converted model mesh/fragment/hierarchy completeness, unit/axis/root/display transforms, effective planning visibility and stable/version-aware identities.
2. **PF-2/PF-7:** supply paired full-precision real inputs/outputs with endpoints, categories and allowances. Historical rounded Aalborg lookup totals are insufficient; referenced private raw logs are unavailable in the checked source trees.
3. **PF-2/PF-5:** measure real-model graph/batch resource use and define justified limits and performance targets.
4. **PF-4–PF-8:** implement and test admin access, shared locations, exact visualization, jobs, Apply concurrency/history and isolated operations. Their matrix rows remain NOT_RUN.
5. **User decision:** inspect the future local demonstration before authorizing publication, merge or updating the existing installation.

There is no unresolved category decision blocking PF-1: Instrumentation -> Control was explicitly answered. Remaining real-model evidence does not block source extraction/synthetic core work, but blocks any claim that the actual converted model produces equivalent engineering results.

## Cleanup and preservation

Only owned temporary source/build/replay material may be deleted after evidence is retained. The isolated worktree, documentation, contracts, reference fixtures and necessary logs are deliverables and remain. Existing containers, original model packages, backups, old PathFinder modifications and historical evidence are retained.

[Final integrity/preservation receipt](evidence/02-final-validation.json) records unchanged original source heads/branches/statuses, the three old PathFinder local-file hashes and all 13 existing containers. No database-content audit or unobserved environment acceptance is inferred. Validation is reproducible with `node docs/pathfinder/evidence/validate-pf0.mjs`; it emits a nonzero blocked result while the known cleanup restriction remains, even when every technical check passes.

Automatic approval review rejected the one recursive removal of the owned temporary source/build copy with the reason **`blocked by policy`**. The command did not execute; there were zero deletion mutations and no alternate-tool retry. The exact retained path is:

`C:/Users/todor.chankov/source/WFC-pathfinder-local/.pf0-work/core-1f723e37-f152-4a60-9b1e-46adc6c3179c`

The read-only inventory records **162 files, 51 directories, 3,586,733 bytes**, no reparse entries. This folder remains untracked and is not a delivery or hidden by an ignore-rule change. The cleanup criterion is BLOCKED, not complete. No stage/test containers were created, so there are no such containers to remove. The restriction does not prevent using the frozen documents/reference corpus for PF-1; no attempt to delete this target should be retried as a workaround.

**Stopping condition:** finish and report PF-0. No core extraction, runtime startup, PF-1 implementation or automatic merge follows this stage.
