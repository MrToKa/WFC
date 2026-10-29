# PF-B25 — checked opening routing installed on 5191

B25 is installed on port 5191 from source commit
`743d73af2fd7b3f1402fa3eff60a88e88f6d9e13`. Paired delivery operation
`0ba258ed-2ce8-4449-bd6e-8e45178dd3aa` completed initialization and all eight
delivery phases with PASS. The temporary qualification target was positively
retired. The earlier [B25 routing report](119-shorter-checked-opening-routes.md)
remains an unchanged record of the checks before installation.

| Installed component | Exact identity |
| --- | --- |
| API image | `sha256:68938938120f20b4e877c6e6709ba44578dbe54c957fe7aa2b9cfc8190bfb8a5` |
| Web image | `sha256:06f072c8a0c88f8cda4baff8c72612715530c0cf0038689dab74db5e34e2f155` |
| Engine identity | `b3157008f42eced7281f7b093e4b898f23fe244e808da5a605c324f57ac58090` |

## Delivery and conservation evidence

Root completed backup, quarantined restore, candidate build, target migration
and runtime qualification, paired source update, source runtime qualification
and target retirement. Every phase retains its receipt hash, prerequisite chain
and exact candidate binding. Installation checked the expected source state and
environment hashes before replacing the image pair.

The V5 migration comparison verified 142 existing tables and 81,168 retained raw
rows, with no new tables or managed schema changes. Both runtime qualification
windows also passed with no managed schema changes. Source inventory,
history/globals/sequences, non-application services, data resources and foreign
resources passed their conservation checks. The source owner, project and
loopback port remained fixed. No cable values were reset or applied by this
delivery.

Post-delivery health and seven served files passed: the index, application entry,
ProjectDetails chunk, ViewerController chunk and three viewer-runtime adapters.
Each served file was compared byte for byte with the same immutable candidate
web image. The isolated image reader was never started, had no mounts or network
access, and was positively removed. Resource snapshots before and after these
reads were unchanged; bounded operation and command cleanup completed with PASS.
The new profile marker and existing popup messages were checked in those exact
served bytes.

The sanitized [owned delivery receipt](evidence/barriers/b25-owned-paired-delivery.json)
records the installed pair, engine identity, all nine phase results, qualified
comparisons, static hashes and cleanup evidence. Its SHA256 is
`aa0bc4ff90447e8fb4fd0c063eb30756f96264942ac548beff789494bdb3e308`.
It contains no private configuration, environment values or business rows.

## Routing scope and remaining acceptance

The delivered source passed 308 Core/transport checks, 282 selected TypeScript
checks, full types, scoped lint, both builds and native publish. Separate offline
Linux runs covered nine retained Aalborg cases and 874 independent final-segment
checks against the 28 original obstacles. The isolated `/C002/C107-1` case uses a
0.9474394581607366m checked route through the original opening; the retained real
H1 Off case has 241 clear final segments and design length 91m. The
[source](evidence/barriers/b25-opening-source-checks.json) and
[native/independent](evidence/barriers/b25-aalborg-opening-native-checks.json)
receipts remain the evidence for those pre-delivery results. No hole proxy,
geometry alteration or collision-tolerance increase was introduced.

Deployment checks used fixed public health/static reads. They did not use a
browser, authenticated project interaction, live SDK capture or real cable
Review/Apply. Live frame/currentness and full engineering acceptance therefore
remain separate. The real H1 inputs still use From X 81.6835m; the user's earlier
reference has X ≈51.26m and needs clarification before accepting the complete
reference route. No endpoint was substituted. Own-terminal exit/entry, full
capacity and Simplified Preparer remain unfinished.
