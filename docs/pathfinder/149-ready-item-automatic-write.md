# Saving a ready item while its project job is still running

The first automatic-output deployment enrolled the writer but left a readiness
mismatch. Dispatch claimed sealed calculated items immediately, while the writer
used public Review/Apply applicability, which requires a whole-project job to be
complete. Each early claim therefore received a terminal
`PROPOSAL_NOT_APPLICABLE` refusal. The live test project had thirteen such
refusals, two reconciled uncommitted attempts, and no saved route/length pairs.
The subsequently cancelled job remains cancelled; its claims are not reopened.

The writer now has a separate internal applicability entry point. It shares the
full v8 sealed-item/result/proposal/dependency and barrier-strategy validation,
then revalidates the exact original immutable automatic-pair mandate. This permits
current explicit bulk, automatic-generation and shared-location outputs to save
each item before unrelated siblings finish. Public Review/Apply without a mandate
keeps its original semantics. The capacity-clear path has the same narrowly
scoped mandate option; its existing result, capacity, automatic-ownership and
write guards remain required.

The actual PostgreSQL regression runs the production writer with its default
applicability, authority, seal, ownership, history and receipt functions. It first
reproduces the public whole-job refusal, then verifies an empty-pair write, an
automatic-owned update and a capacity clear while other items remain unfinished.
Physical model and occupancy reads are synthetic fixtures. The entire database
transaction rolls back and the owned container is removed. This does not claim
a browser or real Aalborg engineering test.

Job details now read output disposition by the exact project/job/cable tuple and
distinguish route calculation from saving. Refusals expose their reason and no
longer imply that an empty cable was manually edited.

Evidence: `D:/Codex-test-output/automatic-write-followup-20261027/`.
