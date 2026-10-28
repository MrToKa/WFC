# PF-B27 — popup result synchronization and automatic cable values

This source change follows a confirmed From/To Save or explicit Calculate through
the exact selected cable job, proposal and hash. Earlier routing is withheld while
the replacement calculation, automatic cable write or display geometry is still
being checked. Show no longer relies on a second manual Refresh From/To and
Calculate sequence. Failed reads retain the last owned display without making it
write authority.

Shared logical locations continue to update every affected eligible cable. The
origin cable from the popup runs first; siblings wait until its item is terminal.
Matching an explicitly selected cable does not require unrelated project endpoint
locations to be prepared. A sealed, current origin item can finish its popup flow
while the shared job continues processing other cables.

## Cable value policy

- Auto calculated length remains an independently published, read-only calculated
  value. It updates after a successful checked calculation even for manually
  changed cables.
- Routing and Design length are written together when both fields are initially
  empty, or when the current pair is still owned by a proven automatic Path Finder
  receipt and has not been manually changed.
- Ownership requires the exact cable write revision, route, canonical Design
  length and latest audit history identity. Equal restored values cannot recreate
  ownership after a manual change. Clearing a previously written pair is also a
  manual change.
- Manually changed cables retain Review → Apply for Routing and Design length.
  A manually reviewed Apply does not reset this protection. This follows the
  user's clarification that only Auto calculated length should continue updating
  automatically for those cables.
- Missing historical evidence falls back to review; matching numbers or a
  Path Finder-looking route alone never establish ownership.

Legacy Save bodies, initial-fill policies, hashes and pending commands retain
their existing meaning. New authority is explicit: endpoint command v4, pair
command v2, impact record v3 and a separately versioned job policy outside
mathematical calculation options. Calculation-only grants gain no cable-write
authority. Shared Save authority keeps its original expiry.

The separate bounded writer checks the exact successful sealed result, length
ledger, barriers, current dependencies, current principal and original mandate.
The pair, audit row and immutable receipt commit atomically. The popup waits for
the matching write disposition and then verifies the new display. A proven own
write can advance the cable revision without making its own route undisplayable.

## Qualification and delivery boundary

The new additive tables are `pf_automatic_pair_mandates` and
`pf_automatic_pair_dispatch`. Explicit conservation profile
`post-b27-automatic-pair-additive-v6` permits only their exact pristine DDL and
conserves existing rows, keys, schema and sequences. The earlier V4/V5 qualifiers
are unchanged. V6 quiescence also observes automatic pair work.

SQL qualification runs only in a newly owned disposable PostgreSQL 18 fixture.
Project, authentication and engine observations in that fixture are synthetic;
production SQL handles the pair, history, receipt, claim and ownership operations.
Catalog qualification reads actual PostgreSQL definitions but uses an explicitly
simulated pre-addition baseline. It is not an installed-database migration.

Recorded checks on 23 October 2026 (suite counts overlap; do not sum them):

- 292 final client/popup/controller/transport tests passed across six suites.
- 234 workflow proof/repository/revision-result/shared-contract tests passed.
- 420 admission, endpoint, impact and priority regression tests passed.
- 89 automatic pair service/ownership/recovery tests passed.
- 198 distinct Results/Tab cases passed under frozen display sources. The slow
  Tab suite was audited as 33 recorded individual passes plus disjoint 21/20
  partitions, with no missing or duplicated cases. An earlier mixed-cache run is
  not counted as passing.
- The real PostgreSQL priority selector qualifier passed seven checks. The final
  automatic pair qualifier passed 13 checks, including exact receipt replay,
  manual edits and clear-both protection, rollback, lease recovery and exhausted
  unknown outcome reconciliation without a fourth cable write.
- The PG18 catalog qualifier passed four checks. It recognized both exact new
  table definitions and conserved the public catalog/rows/keys/sequences.
- V6/operator offline suites passed, including 85 final catalog/quiescence
  checks. Client/server TypeScript, scoped production lint, web/server builds
  passed. Existing Fluent provider test and bundle-size warnings remain.

Both newly created disposable database containers were retired by their exact
owned identities. Private raw inventories and SQL fixture receipts remain local;
only sanitized qualification summaries may be published.

The final automatic pair SQL receipt is
`automatic-pair-sql-qualification-779275cf-49e4-4bb9-a4b5-d3e4fe6ba10c.private.json`;
the actual-catalog receipt is
`automatic-pair-v6-catalog-qualification-d6a6e4fa-227e-41b5-b8b0-5778799249e2.private.json`.
These identify isolated fixture evidence and do not identify an installed build.

Browser acceptance on 5191 and an installed Aalborg UI test remain unconfirmed.
No installed cable, endpoint, barrier or route has been changed by these isolated
qualification runs. The source change must not be described as installed on 5191
without a separate successful owned delivery receipt.

The source was subsequently [installed on 5191 with Show location](125-popup-show-location-installed.md)
through a separate successful V6 owned delivery. The earlier isolated checks above
remain distinct from that installation and from live browser/SDK acceptance.

Historical proof is bounded to 512 receipts and 32 MiB. A limit or unverifiable
historical chain requires review; it is not evidence of a manual edit.
