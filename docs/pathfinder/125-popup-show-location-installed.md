# Popup Show location and automatic cable updates installed on 5191

The paired API/web release was installed on 23 October 2026 through owned
operation `4b76c6d4-a30c-4b12-a87b-99737152d14c`. The release is identified by
its frozen build context, not a Git commit: the implementation was uncommitted
when the immutable images were built.

The release includes the [popup synchronization and automatic value policy](123-popup-result-and-automatic-pair-updates.md)
and [Show location beside Assign From/To](124-popup-show-location.md).
Close any old cable popup and reload the main page before testing the new code.

| Installed component | Identity |
| --- | --- |
| API | `sha256:47d824236f432d52856de9e6afc17c333aeb24b5ce948e1ecb20b2767ebed1c0` |
| Web | `sha256:180ea5d9faf3e197f856fbfefe5f00ff2d9e0b8a8b881b0a14a9ecc202b6a2ca` |
| Frozen build context | `d9407691747f9b6782daa1eae9518e724f37405b0e6ecc9917060c14ce343378` |
| Barrier implementation identity | `6645167242829ff18e841149855b7d62526854a40e7b598f3ad4923a2d46e2ee` |

All eight delivery phases passed, following initialization: owned backup,
quarantined restore, paired image build, migration qualification, test runtime,
source update, source runtime qualification, and positive test-resource retirement.
V6 checked 142 existing tables and 81,518 rows at migration. Only the two declared
automatic-pair tables and their exact supporting declarations were added. Existing
cable, endpoint, barrier and result data were preserved.

The broader implementation identity changed from
`b3157008f42eced7281f7b093e4b898f23fe244e808da5a605c324f57ac58090` because
its projection includes the deliberately changed `worker.js` and `jobContracts.js`.
A separate bounded probe of both immutable images verified identical bytes for
all six native calculation modules, identical policy versions, and identical
ordered membership of all 44 projection files; only those two JavaScript files
differed. Historical results retain their original identities. V6 verified five
engine-observer control transitions and five corresponding events in each runtime
window; these are recorded control changes, not recalculated or rewritten cables.

Final health, exact served bytes for ten image files (including the popup bundle,
ViewerController and protected adapter/bridge/protocol), receipt bookends and
positive temporary-reader cleanup passed. The image reader was never started.
The quarantined target's containers, volumes and networks were retired; the
source backup remains retained.

The [sanitized delivery receipt](evidence/barriers/b28-owned-paired-delivery.json)
records the image pair, source/build pins, qualification counters and cleanup.
Its private post-delivery receipt SHA256 is
`fee6d5c4fac1402390ed149995e2c02aea84a296ff5e159ef893cc6bbec154e2`.

This confirms installation and served-file identity. Authenticated browser/SDK
interaction, a fresh live Aalborg route calculation and real cable Apply were not
performed by this delivery; the user can now test the installed interface.
