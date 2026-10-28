# Popup Show location

The cable popup includes **Show location** beside **Assign From** and **Assign To**.
The action reveals the corresponding object in the current 3D model and fits the
camera to it. It uses an unsaved assignment first, then the saved assignment or
current automatic candidate. The separate window and inline panel use the same
handler.

Showing a location does not assign or save an endpoint, submit a calculation,
replace the displayed route, change the Model Browser selection, or enable Ghost.
A fixed-world assignment can show its recorded display object. A point without
an associated model object leaves Show location disabled with an explanation.
Retained labels from a failed context refresh cannot supply a display target.

The button waits for the protected viewer acknowledgement and offers a retry on
failure. Context and viewer checks bind the object ID to the current model,
selection revision, and fingerprint; late UI feedback is ignored after the cable
or model changes.

Verification covers saved and draft From/To assignments, automatic candidates,
fixed-world display hints, unavailable objects, stale model evidence, retries,
and the separate popup document. The protected viewer command additionally checks
the current load and preserves route and selection state.

Validation passed: 204 client test cases, 103 runtime tests, 115 viewer controller
tests, four module integrity checks, client TypeScript, scoped lint, and the web
production build. Client totals combine the three focused suites with the separate
popup case; repeated verification runs are not counted again.

The implementation was subsequently [installed on 5191](125-popup-show-location-installed.md)
through a separate qualified delivery. A live Aalborg browser/SDK interaction test
has not been performed by that delivery.
