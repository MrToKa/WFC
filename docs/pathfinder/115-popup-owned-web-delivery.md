# PF-B22 — popup correction installed on the owned runtime

The popup calculation changes from commit
`89503dce1fd825baaa0bf8b179d8f5b83cbad02d` are installed on the isolated copied
runtime at port 5191. Calculate reads fresh saved endpoint state before submitting
one job; confirmed refusals and unsent requests no longer leave a false pending
job. Exact-result review is independent of the drilling preference for the next
calculation. Report114 records implementation and source checks.

Root executed operation `a41eb0a3-85f4-4df5-8cd1-aa742762a4e6`: prepare, immutable
web build, guarded installation and served-static verification all passed. The
rollback image was exported and verified before installation. All tracked source
bytes and the three private operators were pinned through delivery. The API kept
the same running container and start time; non-web resources were conserved.

Installed web image:
`sha256:0e66627494908c41490ee5a542da1d75dea70f2ed8a616a209c48ffd0296afcb`.
Unchanged API image:
`sha256:a43cac0dce21c81760c865f5cce81b774a07ecb3aa0f15963b530afe20c152dd`.

Health and index checks passed. Four exact served assets matched their expected
hashes, including the project page bundle and barrier-capture modules. Resource
identity checks passed before and after the static probes. The sanitized receipt
is [b22-owned-web-delivery.json](evidence/barriers/b22-owned-web-delivery.json).
The earlier 197 selected Vitest and 40 Node checks are recorded separately; the
71 historical Tab cases were deselected rather than claimed as rerun.

The saved browser refusal was not retried or bypassed. These fixed health/index/
static probes establish delivery, not live interaction or engineering acceptance.
No real cable Apply was performed.

## Aalborg comparison and remaining verification

The user accepts coordinate differences up to **0.1 metres inclusive** when
comparing the retained planning snapshot with original model geometry. This is a
comparison threshold only: it does not change wall/floor collision checks, move
vertices or authorize an otherwise blocked crossing. Previous exact-bit witness
differences remain recorded. A conservative Euclidean bound from all compared
vertex residuals will be checked against this explicit threshold.

The requested real-cable test is continuing with the unchanged retained Aalborg
snapshot, the latest saved endpoints for both selected cables, and the original
28 supplied wall/floor objects. Its offline results, live SDK/current-frame
acceptance, authenticated own-object exit/entry, whole-model capacity and the
subsequent Simplified Preparer work remain separate unfinished checks.
