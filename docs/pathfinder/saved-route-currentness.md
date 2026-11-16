# Saved routes after a calculation implementation upgrade

A saved cable path can remain valid when a newer implementation would search
more attachment candidates. The historical calculation itself is still tied to
its original engine identity and cannot acquire new Review or Apply authority.

The workflow uses the existing receipt-qualified `savedExactDisplay` evidence
(or an independently qualified `savedRoute` with `saved-exact` currentness) to
classify the saved cable as Updated. The calculation retains `changed`
currentness, `reviewable: false` and `acceptedMatchesCurrent: false`. The cable
window shows the verified stored pair without offering the old proposal for
Apply. Preview-only Cable list text without this evidence does not qualify.

## Compatible planning changes

The saved proof accepts only exact canonical mixed profile transitions
v6 to v7/v8 and v7 to v8, in addition to its existing v3 to v4 selection-limit
transition. The v6/v7/v8 changes expand candidate and pair budgets while keeping
geometry fitting, collision predicates and final route proof unchanged.
Unknown profiles, altered canonical fields, downgrades, changed semantic engine
policies, invalid hashes and upstream version changes remain refused.

The full receipt and immutable result proof still run. Stored route, length and
revision must match the receipt; the current model, locations, barrier
publication/storage/frame, route permissions, Purpose and length settings must
match the recorded engineering dependencies. Only the proven own-write cable
revision and the supported implementation/planning metadata are normalized in a
local comparison. No source snapshot, receipt or cable value is rewritten.

## Regression coverage

The supplied audit separated fifteen untouched old-profile saved pairs, one
current-profile saved pair, one manually changed protected cable and one cable
with a missing location. A synthetic eighteen-cable repository scenario checks
sixteen Updated and two Needs routing results. Separate proof tests exercise the
real mixed response, strategy, ledger and receipt verification across the
supported profile upgrades, with negative tests for engineering changes and
manual edits. UI tests preserve saved-path display without granting Review or
Apply. These checks do not claim a new live-server observation after deployment.
