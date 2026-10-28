# PF-B26 — cable popup read recovery installed on 5191

Port 5191 now runs product commit
`798a562d2fcc018ee29d8ec6eacf7f6c1958bc4b`. Failed endpoint reads previously
made saved From/To appear empty. Some calculation admission conflicts were
classified as unknown submissions and left Calculate routing blocked.

The popup now retains its last owned endpoint display during a failed refresh,
offers visible read-only **Refresh cable status** and **Refresh From/To**
controls, and preserves confirmed Save feedback. Policy changes and a cable
leaving the Needs routing filter no longer discard the open editor. Retained
display never authorizes Save, Review or Apply after a failed/currentness read.

The calculation endpoint now supplies strict, versioned evidence when this
invocation returns HTTP409 without committing a calculation job. The client
releases that attempt and explains the required refresh/configuration action.
Matching may already have committed registry changes; the evidence does not
claim otherwise. Lost COMMIT acknowledgements, malformed responses and network
loss remain unknown. This change does not settle an earlier unknown command or
silently submit another calculation. Durable exact client-command recovery
remains separate work.

## Validation and delivery

- 372 distinct selected tests passed: 185 popup/transport/transaction checks and
  187 Results/Tab integration checks.
- Client and server types, scoped production lint, both builds and whitespace
  checks passed. The initial whole-directory lint exhausted its default heap;
  explicit production directories passed with an 8GiB heap. Existing React
  test warnings and web chunk-size warnings remain.
- Owned delivery operation `d050dc78-383e-4002-946f-0aa89b231986` passed
  initialization and all eight phases. Its quarantined target was retired.
- V5 compared 142 tables and 81,252 migration rows. No new tables or managed
  schema changes were required; both runtime windows also passed without
  managed changes. Existing business values were preserved.
- Final health and seven served-file comparisons passed against the immutable
  candidate web image. The stopped image reader was never started and was
  positively removed. Cleanup and receipt bookends passed.

| Installed component | Identity |
| --- | --- |
| API | `sha256:5caaaa42e30ef1c3eee2fca0298b4cfa49e3dd76c2ef8c3994f55a6553539fd9` |
| Web | `sha256:42d14c76cf336045890c0f99458d3e02f6ab75988aa43c029a03e1f28e37b739` |
| Calculation engine | `b3157008f42eced7281f7b093e4b898f23fe244e808da5a605c324f57ac58090` |

The [source checks](evidence/barriers/b26-popup-source-checks.json) and
[sanitized delivery receipt](evidence/barriers/b26-owned-paired-delivery.json)
record the bounded checks. The delivery receipt SHA256 is
`b46bd33d127806292255ee2460db2fe433fadc762e3cebfef7869f5ea67e6428`.

## Confirmed H1 inputs and remaining acceptance

The separate [Aalborg geometry diagnostic](121-confirmed-h1-geometry-diagnostic.md)
and [evidence](evidence/barriers/b26-confirmed-h1-geometry.json) use the exact
user-confirmed From coordinates. Drilling Off returns the expected reversed
tray sequence, including BC175, plus SECONDARY; calculated design length is
58m. Independent checking found no exact obstacle contact on its 115 final
segments. Drilling On returns 66m and six triangle contacts. Core routing was
not changed in B26.

The enclosing native test driver remains REFUSED because its complete resource
conservation check did not pass; an unrelated container's start time changed.
The separately audited intrinsic outputs and independent geometry checks do
not replace that refusal or certify both apertures from wall bounds.

No authenticated browser/SDK test, protected From object identity verification,
live frame acceptance or real cable Apply was performed. The retained browser
access refusal was respected. Whole-parent capacity, own-terminal entry/exit,
the complete Simplified Preparer stages and full engineering acceptance remain
unfinished. No saved endpoint, routing or length was changed by the offline
test. After loading the new page, existing cable values still require exact
Review and Apply; Save confirms From/To assignments.
