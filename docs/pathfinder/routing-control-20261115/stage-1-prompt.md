# Stage 1 — executable prompt

Implement the shared routing-control domain contract described in plan.md without database writes or live application changes. Baseline cf7c64d plus existing dirty working tree; preserve all prior edits. Authorize automatic continuation per user 2026-11-15 request.

Own only new shared/cableRoutingControl.ts and its tests plus this stage's documents. Define explicit manual protection, sticky execution lock/frozen route, automatic result fallback, import presence/protection/blank semantics, precise execution reasons, route discrepancy parsing preserving order/repeats and a shared pastel palette. Date fields are validated by boundary APIs; policy must recognize any recorded execution fact. Distinguish incoming facts from existing lock so a first execution report can atomically accept its legitimate route then freeze it. No color may grant write authority.

Tests must cover every accepted decision and conflicting conditions: empty vs missing imports, ON/OFF protect option, manual checkbox and edit/clear, no automatic overwrite under execution protection even after dates cleared, conflict only affects route field, automatic output retention independent of write guard, repeated route segments, color priority. Reject invalid route/control values without inventing endpoints. Do not change historical source attribution or limits.

Run targeted Vitest. Fix failures, report exact commands/results and unimplemented integration. Generate stage-2-prompt.md from actual resulting public contract and repository map, then execute stage 2 automatically. No approval gate is introduced by this document.
