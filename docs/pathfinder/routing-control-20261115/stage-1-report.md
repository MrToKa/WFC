# Stage 1 report

Implemented shared/cableRoutingControl.ts and tests. Baseline cf7c64d + preserved dirty working tree. No database or deployed app mutations.

PASS: `vitest run shared/cableRoutingControl.test.ts --pool=forks --maxWorkers=1 --minWorkers=1`: 17 tests, 2026-11-15. Covers ON/OFF import blanks/absence, sticky execution facts, all five causes, explicit release after facts cleared, immutable execution route, no automatic fallback for executed unknown route, manual edit/uncheck/clear, preserved order/repetition, input limits and warning palette priority.

Public contracts: CableRoutingControl (schemaVersion/manualRouting/manualProtected/executionLocked/executionRouting), CableExecutionFacts, applyCableRoutingMutation, latchExecutionRouting, releaseExecutionRouting, automaticRoutingWriteAllowed, effectiveCableRouting, routingSegments/routingTextsMatch, CABLE_ROUTING_PALETTE/cableRoutingTone.

Integration NOT_RUN (stage 2+). Unknown-tag/barrier/manual length validation is NOT implemented by the parser. Facts must already be boundary-validated. Raw controls rejected; slash occurrence order retained. Execution unlock requires a reason and no current execution facts; recorded facts always retain priority.

Repository findings used for next prompt: controls currently inferred from automatic receipt/cable revision and history; imports omit existing execution fields; one monolithic cablesRoutes owns all manual+Excel operations. Existing ordered lookup explicitly omits equipment approaches and cannot serve as manual design length. Stage 2 must integrate current contracts, keep exact result authority/concurrency, and avoid reclassifying future auto values on repeated startup.
