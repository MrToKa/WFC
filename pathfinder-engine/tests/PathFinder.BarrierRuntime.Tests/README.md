# Independent barrier runtime transport checks

Root executes this console harness against an actually built runner DLL:

```
dotnet run --project pathfinder-engine/tests/PathFinder.BarrierRuntime.Tests/PathFinder.BarrierRuntime.Tests.csproj --artifacts-path <owned-build-child> -- --runner <absolute-runner-DLL> --work-root <new-absolute-owned-child>
```

The work root must not exist. The harness creates and retains only synthetic
model snapshots and immutable-looking barrier fixture files inside that root.
It never uses a live WFC database, real account, project model, browser or SDK.
Production assemblies are referenced once; no production source is linked into
this test assembly. No frozen expected fixtures or old receipts are regenerated.

Fixtures reproduce the previously authored closed wall, actual tunnel and rotated
floor meshes. Each accepted raw mesh is independently run through the real
`BarrierCaptureVerifier`; the real child runner then independently requalifies it.
The synthetic B2 authority digest is deliberately different from the pure geometry
verification digest. It is test data, without a claim of actual protected SDK
enumeration or engineering approval.

Checks cover v1 regression; v2/v3 version pairing and refusal; ordinary wall,
opening, floor and offset local connectors; direct-blocked tray fallback and ledger;
reverse and underflow singleton occupancy; strict profile/policy/scopes; corrupted,
missing and cross-project files; open raw capture refusal; timeout; and actual
one-shot/session parity across alternating contexts, drilling and empty declarations.
Exact successful route points are independently rechecked against the qualified
triangle kernel, including one-point occupancy. Session cache checks modify only
fresh harness-owned immutable fixtures and retain them under the supplied root.
Every request and exact bounded stdout/stderr is retained in
`transport-diagnostics/` under that root, with process metadata and original framed
session payloads. A strict malformed-request process refusal with exit code 2 and
no stdout is recorded as a process refusal, never converted into a computed JSON
response. Valid protected contexts must return their typed v3 response.

These are small synthetic transport checks. They establish neither full-project
capacity, actual model capture, native Navisworks parity nor engineering acceptance.
