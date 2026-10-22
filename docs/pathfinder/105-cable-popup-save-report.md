# PF-B15 — cable popup endpoint Save

Status: **SOURCE CHECKS AND FRONTEND DELIVERY PASS**. Inherited branch
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
Public sanitized receipts record exact checks and limits. Root built checked clean
source d140709feadeb12f030ac0286385e32870cb21dc, verified44 source pins and the
current rollback archive, and recreated only owned web on5191. New image:

`sha256:a0e6972c41356185cefc12a5781995a71820e5298ebb405ed34dc59a79270529`

The same running APIac0d16ab and all nonweb/original resources were conserved.
Health/index/static checks PASS; served ProjectDetails asset contains the new
Save/policy notices and three retained runtime modules match source exactly.
New archive52922880bytes SHA25652ae4929fc89e81693909bd90d1207a9ab0365d06b9a190d7c470fd5ab456d7e
and previous7841f910 archive remain available. No SQL/model/cable writes or API
restart. Actual browser/SDK/Aalborg remains blocked by saved refusal, with no
retry/bypass. Administrator notified to close old popup, refresh main tab and
reopen the cable. No actual UI/engineering acceptance is asserted.

Latest user steering: popup FIRST (now delivered), then investigate three actual
barrier errors: fragment cap, triangle cap and unsupported geometry for the supplied
29 GENPRI wall/floor objects plus REFGLN8/Grid-Aalborg. Treat exact names as test
anchors; do not silently drop an object or assume every REFGLN is a blocking
triangle wall. Source type and geometry extraction still require investigation.
Whole-parent barrier qualification/publication and later Preparer remain unfinished.
