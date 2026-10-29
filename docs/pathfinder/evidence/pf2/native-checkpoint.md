# PF-2 native oracle checkpoint

The unique oracle plugin and STA runner are implemented and compile for net48
x64 without package dependencies. Fourteen pinned calculation/capture files
remain byte-preserved under `pathfinder-engine/tools/PathFinder.NativeOracle/Pinned/`.
Build output is recorded in `native-build.log`.

The first actual native attempt is **BLOCKED**. Run
`native-20261017-204843-0c58fb21` failed after about 73 seconds inside
`new NavisworksApplication()`, before opening any model or loading the oracle.
The exact exception is `Failed to startup Navisworks: -2146959355`
(`0x80080005`). A matching System DistributedCOM event10010 says the registered
server did not register within the required timeout. Registry inspection found
`Navisworks.Document.24` points to the existing
`D:/Programs/Navisworks Manage 2027/Roamer.exe`; registration was not changed.
See `native-startup-diagnosis.json` for the exact event/error and process audit.

No geometry or route reference has been captured. Native/converted parity is
not established. Both original and owned copied NWD hashes remain
`11b2739d92020ee58a52a4e793cf8fd538fb30758eb42176aba93ac7319b048a`.
The failed run receipt is retained unchanged. Its null placeholder request
rows are not captured cases; the supervisor has been corrected to emit an
empty array for future failed attempts.

Bulk owned state remains under ignored
`pathfinder-engine/.scratch/pf2-native/`: hash-verified copied input, failed
stdout/stderr/specification, and a local Automation DLL metadata dump used for
read-only diagnosis. No owned native runner or Roamer remains at checkpoint.
No installed plugin, registry, startup configuration or original model changed.

A feasible **next-run candidate**, not attempted here, is a newly owned Roamer
process using its documented command-line switches: open the owned copy, load
the unique oracle assembly, execute `PathFinderNativeOracle.PF2L`, then exit.
This may avoid the failing DCOM constructor path while preserving isolation.
Autodesk documents external assembly loading and plugin execution in its
[Command Line Switches](https://help.autodesk.com/cloudhelp/2022/ENU/Navisworks/files/GUID-3891FB9F-7BF1-4510-A1EE-121E975C0ACE.htm)
reference. That retrieved reference is for2022; actual installed2027 behavior,
successful startup and licence availability remain to be verified. No save,
options-import, registration or licence/account interaction is authorized by
this candidate. Any next attempt still requires the same owned-process
deadline, no overwrite of earlier failures, and source/copy integrity checks.

Parent requested checkpoint after its computer-use session was stopped by a
policy guard. No further UI or native host attempt was made in this worker
turn. All independent converted/model work remains separate from this failure.
