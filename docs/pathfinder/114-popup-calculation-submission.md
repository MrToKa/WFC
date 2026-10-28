# PF-B22 — calculate after saving endpoint locations

Saving From/To increments the location registry revision. The cable popup used
the earlier cached revision for Calculate, then treated the resulting refusal as
an unknown submission and kept the button locked.

The popup now reads authenticated current state before sending one calculation.
It checks the same project, model, selection and fingerprint, then uses the fresh
registry revision and project settings. An unchanged model keeps its Viewer.
The generic calculation interface remains compatible.

The dedicated submission result separates positively unsent work and narrowly
audited server refusals from an acknowledged job or an unknown outcome. Lost or
malformed acknowledgements never trigger an automatic retry. The workspace keeps
up to 128 unresolved attempts without eviction across cable selection changes,
including late acknowledgements. This retention belongs to the current workspace
session; it does not provide durable recovery across a full reload.

Review and Apply follow the exact recorded result and its existing current-proof
gates. Changing the drilling checkbox for the next calculation no longer disables
approval of an earlier explicitly bypassed result. Unsaved endpoints, pending
commands and stale or unverified results retain their existing restrictions.
Shared-location Save continues to use drilling disabled.

Root executed 195 affected API, hook, workspace and panel checks plus two selected
Tab integration checks. The other 71 historical Tab cases were deselected, not
claimed as rerun. Forty Node installer checks, full type checking, scoped lint and
the frontend build passed. One new panel fixture initially omitted its checkbox
callback; its failure is retained and the complete 39-case panel file passed
after correction. The exact source/log pins are in
[b22-popup-source-checks.json](evidence/barriers/b22-popup-source-checks.json).

A new, explicitly frozen web-only planner accepts the installed B21 API/web
baseline. Its predecessor remains byte-unchanged. The new planner preserves the
private environment bytes except the web image value and requires exact resource,
image and compare-and-swap checks. Actual guarded delivery is still pending at
this checkpoint; this report does not claim the corrected UI is installed.

The requested real-cable Aalborg test is in progress using retained original
planning and barrier inputs. Live SDK/current-frame acceptance, authenticated
own-object exit/entry, full multipart capacity and Simplified Preparer remain
separate unfinished work. No real cable Apply was performed.
