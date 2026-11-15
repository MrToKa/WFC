# Stage 4 import/export PostgreSQL and HTTP verification

Date: 2026-11-15. Independent verification file: `server/routes/cablesRoutingImport.postgres.test.ts`. Only that test and this report were edited in this workstream.

## Actual boundaries exercised

The suite creates a newly named `wfc_routing_import_<random UUID>` database after inspecting `wfc-test-postgres` and verifying its sole PostgreSQL port binding is `127.0.0.1:55432`. The runtime configuration and pool connection are checked against the owned database before the first runtime query. A unique ownership marker is checked during cleanup. The database is dropped and its absence is verified after each run, including failed runs. No existing application database is used.

The owned database runs the full production `initializeDatabase`, including routing controls, execution triggers, revision triggers, history, material defaults and automatic-result projection tables. The test mounts the actual `cablesRouter` behind the same authentication, current account role, read/write role and project access middleware as the projects router. It uses real signed JWTs, a real localhost HTTP listener, genuine multipart `.xlsx` uploads, actual SQL transactions and the real Excel export writer. No runtime function, database binding, permission check, material resolver or route handler is mocked.

The test does not start a worker or geometry engine. It checks that imported route calculations are queued with the authenticated actor/login. It does not claim to have calculated the 5000 imported cable paths. Route engine/barrier acceptance remains in its separate stage.

## Cases

1. Missing authentication and a basic account are denied with no project mutations.
2. A JWT issued to an administrator cannot bypass a later database role change: an unassigned Engineer is denied; assigning that Engineer to the project permits the import.
3. Preview for both an existing changed cable and a new cable rolls back cable rows, routing controls, manual jobs, routing events, versions and materials. A second preview has the same revision digest. Committing the reviewed digest saves authenticated history/jobs.
4. A concurrent ordinary field edit advances the cable revision, causing the old preview digest to return 409 before imported changes are written.
5. Missing Routing header is a no-op with protection either OFF or ON.
6. Blank Routing with protection OFF preserves both protected manual routes and incidental current automatic values.
7. Blank Routing with protection ON clears the manual route/protection and retires its pending manual job. Repeating the clear is inert.
8. Filled Routing with protection OFF/ON updates an existing eligible row with the requested intent. Repetition does not write new versions, events, control revisions or job updates.
9. An initial workbook without metadata imports a route with default protection OFF and retains this intent on replay.
10. New executed rows retain the imported route and requested manual protection OFF/ON, while execution protection takes priority.
11. Every protected cable is named in partial import results. All five current execution facts and the retained execution-lock reason are covered, including a cable containing all five facts. Unrelated Delivery updates and a separate eligible cable proceed in the same import.
12. An existing cable accepts `/A` → `/B` with its first Pull date, counts the new execution lock and freezes `/B`. A later conflicting import keeps `/B` while accepting a date clear and unrelated fields; the retained lock remains after clearing the fact.
13. The same first execution report works through real PATCH. Later conflicting PATCH is atomic and writes nothing. Clearing the date alone does not release the lock.
14. Genuine formatted numeric Excel date cells roundtrip for both the 1900 and 1904 date systems, with all four execution dates checked.
15. An impossible calendar date rejects the entire workbook before any row is changed.
16. Selected execution columns export in the expected order. Installed length remains numeric; four dates are actual Excel date cells with `yyyy-mm-dd` formatting. Blue/green/gray/orange routing fills use the shared palette, and comments contain origin, used route and concrete diagnostics. Export does not mutate the stored project state.
17. Optional scale case imports 5000 rows, then reimports the same workbook. The second import reports 5000 unchanged rows; history/job counts stay at 5000.
18. Ordinary POST accepts the shared editor's explicit manual protection flag for a filled unprotected route, a filled protected route and an empty route. Both filled cases queue a manual calculation; the empty case does not. The response, persisted control and create history agree. The initial unprotected-route control audit correctly says `Cable creation`.
19. Ordinary POST/PATCH from a newly signed administrator login that has never visited Path Finder establishes its login binding before enqueue. The queued actor/login, exact expiry, current administrator revision and installation epoch match the authenticated account and current installation.
20. Ordinary POST and PATCH reject February 30 before writing any cable, routing control, job or history.
21. A full cable editor save containing unchanged empty manual Routing/protection OFF preserves the existing used automatic `/AUTO` while updating Delivery. A second full-form save with the first Pull date freezes `/AUTO`, preserving the empty manual field and leaving no manual job.

## Results and evidence

- Latest complete functional suite after the ordinary-create/login fixes: **26 passed, 1 optional scale case skipped**, 11.34 seconds including full production database initialization and verified cleanup. Log: `D:/WFC-Test/validation/routing-control-20261115/import-http-create-final-tests.log`.
- Scale-enabled run: **18 passed**, including all then-present functional cases and the 5000-row case. The workbook was **282734 bytes**. The initial import plus unchanged replay completed in **103585 ms**; complete suite duration was 111.8 seconds. Log: `D:/WFC-Test/validation/routing-control-20261115/import-http-postgres-5000-tests.log`.
- The Engineer assignment, two new executed-row protection cases, three ordinary-create cases, fresh ordinary-PATCH login case and two invalid ordinary-date cases were added after the scale run. All passed in the latest functional run. The later automatic-route full-form regression also passed separately after its helper fix. There are **28 distinct passing test cases** across the runs.
- Server TypeScript check passed: `D:/WFC-Test/validation/routing-control-20261115/import-http-postgres-tsc-final.log` (empty).
- The latest server TypeScript check after the ordinary-create/login additions passed: `D:/WFC-Test/validation/routing-control-20261115/import-http-create-tsc.log` (empty). An intermediate check caught a required-property deletion in a peer-owned repository test; the owning backend workstream corrected that fixture before the passing rerun.
- Targeted ESLint passed after moving the guarded cleanup operation into its helper: `D:/WFC-Test/validation/routing-control-20261115/import-http-postgres-eslint.log` (empty).
- The ordinary-create/login test additions also passed targeted ESLint: `D:/WFC-Test/validation/routing-control-20261115/import-http-create-eslint.log` (empty). The strengthened create-audit cases passed **3/3**, log `D:/WFC-Test/validation/routing-control-20261115/import-http-create-audit-tests.log`.
- Latest narrow actual HTTP regression after preserving an unchanged empty manual field: **1 passed**, log `D:/WFC-Test/validation/routing-control-20261115/import-http-auto-fullform-tests.log`. It asserts both response and persisted `/AUTO` route, including its first execution freeze and absence of an accidental manual job. Its owned database `wfc_routing_import_05c50bedd0df40d9a4c0dd6a70f14be6` was dropped and verified absent.
- The strengthened export case additionally verified the full stored-state snapshot is unchanged after export: **1 passed**, log `D:/WFC-Test/validation/routing-control-20261115/import-http-postgres-export-readonly.log`. Its unique database was also dropped and verified absent.
- The first run had a test fixture JSON binding error before the export request. Binding a JSON string fixed the fixture. No runtime edit was made by this verification workstream.

Successful scale fixture `wfc_routing_import_42dd2305f6e24478be8459bbb010b2b6` and final functional fixture `wfc_routing_import_dd84f5aee6d946c1948c5e051a211011` were both dropped; nonexistence was verified by the suite.
The latest ordinary-create/login run used `wfc_routing_import_d5ed28d10bc44b85830f578d985c0d43`, also dropped and verified absent.

## Run again

From the repository root, set `WFC_ROUTING_IMPORT_POSTGRES=1`, then run `npx vitest run server/routes/cablesRoutingImport.postgres.test.ts --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=30000`. To include the scale case, also set `WFC_ROUTING_IMPORT_5000=1`. Without the first variable, the complete suite is skipped and no container inspection, database provisioning or application configuration occurs.

The optional scale case uses 150-second request bounds and a 250-second test bound. Its measured local time is evidence for this fixture, not a deployment performance guarantee. Browser review of the preview/toaster flow remains the parent's separate acceptance step.
