# PF-B15 — cable popup endpoint Save

Status: **SOURCE CHECKS PASS; FRONTEND DELIVERY PENDING**. Inherited branch
pf-b15-cable-popup-save-local-20261022 at handoff8d980e6. B14 identity/diagnostic
repair is already delivered on5191, report104. This stage follows the user's
second immediate priority, after the misleading loading message repair.

The dead end was an undefined initial-fill policy when route/barrier preferences
were unavailable. The hook correctly rejected an omitted policy, while Calculate
correctly required saving the changed endpoint first. Workspace now passes
explicit calculation:null/initialFill:null for an endpoint-only Save, which the
existing server already supports. A changed From can be saved with the unchanged
To context still checked. Saved locations remain reusable by logical location.

Calculate becomes available after the endpoint receipt and context refresh. It
opens configuration when barriers/settings are unready; it does not invent an
unchecked calculation. Endpoint-only impact remains blocked preferences-required
and has no initial-fill mandate. After configuring barriers a fresh calculation
is required; this earlier Save is not silently resumed. The configured Save path
still requests affected calculations and when-both-empty initial fill. Existing
Routing/Design require exact Review/Apply, and installed length stays untouched.

Popup and hook notices now distinguish those two paths. Recovery wording uses
the original retained command rather than current preferences. Compact search,
click/hover, native separate window, selection display, Show/Hide and ownership
semantics are preserved. No server production/API/schema/mount changes.

Root executed429 unique Vitest cases in12 suites plus16 installer guard cases.
These include changed From/saved To exact null-policy command, positive receipt,
both contexts/CAS, unknown-command recovery after preference changes, blocked
impact/no mandate/no job, ready-policy path and popup persistence. Server pair
checks use synthetic SQL; no claim of actual PostgreSQL pair execution. Full
frontend/server types, scoped lint, both builds and diff check PASS; independent
source review CLEAR. Existing FluentProvider test warnings and build chunk-size
advisories are retained in logs. No failures in this stage's executed matrix.

Private operationc120e085-0e32-4a98-b8fb-82a54d45536c retains logs/source pins.
Public sanitized receipt records exact checks and limits. Current installer
baseline is corrected to the actual web7841f910. Next build a clean checked
revision, verify rollback and recreate only owned web on5191, preserving the same
running APIac0d16ab and all nonweb/original resources. Actual browser/SDK/Aalborg
remains blocked by saved refusal, with no retry/bypass. Whole-parent barrier
qualification/publication and later Preparer integration are still unfinished.
