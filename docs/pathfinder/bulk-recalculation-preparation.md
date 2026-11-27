# Bulk recalculation preparation

## Observed failure (2026-11-27)

The three retained failed preparations in the local WFC database all had
`stage=validating`, `prepared=1223`, `total=1223`, `attempt=1` and
`failure=RECALCULATION_COLLECTION_DEADLINE`. Their creation-to-failure durations
were 120.894, 120.799 and 124.866 seconds. API logs also recorded no retry.

`jobs.create` started a 120-second deadline **before** prefetching accepted
receipts, then reused it for matching, endpoint recovery, dependency freezing,
revision admission and automatic output mandates. The prefetch retained raw
receipt/proposal JSON (only 16 MiB), not checked baselines. Admission therefore
repeated the historical proof checks while holding project/cable write locks;
cache overflow also repeated the large SQL reads. Even after baseline progress
reached 100%, the remaining mandate deadline check could roll back admission.
The recorded error is a preparation failure, not a calculation engine failure.

Two related bounds made bulk work unnecessarily fragile: automatic endpoint
candidate reads silently capped an explicit bulk deadline at 30 seconds, and
retry sizes 200/100/50 all became the same 22-cable historical SQL batch.

## Changes

- Check historical proofs during background snapshot transactions, in batches
  that release project/authority locks. Keep compact checked baselines, not raw
  proposal bodies. The process-local cache is bounded to the existing 64 MiB
  admission budget. Raw prefetch callers retain their 16 MiB limit.
- Before reusing a fact, compare the latest receipt and joined receipt,
  proposal, result and review identities/MVCC versions inside admission. Reload
  and revalidate changes. The marker is a process-local Symbol, never request
  or database JSON. Historical facts grant no current automatic write authority.
- Give background proofs a finite 30-minute budget, independent of the existing
  120-second atomic admission budget. SQL statements remain bounded to 15 seconds.
- Honor explicit endpoint collection deadlines up to the 120-second bulk ceiling;
  standalone reads still default to 30 seconds.
- Renew the fenced worker lease independently of progress; propagate Stop,
  lease loss and shutdown to subsequent reads, recovery and publication. A SQL
  statement already in flight completes or hits its statement timeout.
- Retry eligible transient failures at most three times, with actual historical
  batch sizes 22/11/5. Abandoned claims cannot cause unlimited computation retries.
- Explicit runs always freeze the whole requested cable scope with continuous
  exclusions disabled. Each new invocation creates a fresh forced job; retrying
  the same submission ID still reconciles the original job idempotently.
- Fresh successful results replace automatic Routing and Design length together.
  Current manual/execution controls, authority, dependency checks and final write
  comparisons remain authoritative. Install length is not overwritten.

## Validation and limits

Regression coverage includes 1223-cable preparation exceeding the old deadline,
compact caching, version invalidation, real protected manual proof checks,
cancellation, lease renewal, finite recovery attempts, concurrent assignment
during a snapshot, fresh repeated submissions and replacement of an automatic
route/length pair. Relevant dependency, endpoint, ownership, writer, dispatch
and UI suites run with Node 24. PostgreSQL queue/concurrency tests use a separate
disposable PostgreSQL 18 instance, not the application database.

This is not a production-scale geometry benchmark. Existing cable, byte,
statement and admission ceilings still apply; missing endpoints, unsupported
purposes and MV retain their existing handling. The final coherent admission
still needs bounded write locks; expensive historical verification is moved
outside that section. Changed or uncached history must still be checked live.
Worker restart repeats preparation within the finite attempt budget. This
change requires no schema migration and does not deploy the application or
automatically restart a failed user operation.
