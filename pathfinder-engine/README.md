# Independent PathFinder engine

PF-1 extracts the unchanged calculation source from PathFinder `45c24bf5f433f13e102600b36f20327c77961d0a` into a separate .NET library. Running calculations needs .NET 9; it does not need Autodesk assemblies, Navisworks, COM, WFC, PostgreSQL or MinIO.

## Projects

- `src/PathFinder.Core`: eleven byte-identical source files and separate assembly metadata.
- `src/PathFinder.Adapter`: strict versioned input, geometry fitting, calculation and exact decimal transport.
- `tools/PathFinder.LocalRunner`: one request over stdin; bounded child process with a hard deadline.
- `tests/PathFinder.Regression`: original 105 checks referencing the extracted DLL.
- `tests/PathFinder.Parity`: 43 frozen cases, valid production DTO replay, boundary controls and real CLI subprocess checks.

Source identities are recorded in `source-provenance.json`. The original namespaces remain deliberately unchanged. Only the two named test assemblies have access to internal test helpers; the production adapter cannot construct synthetic route results.

## Verify

From any directory, using installed .NET 9 and Node.js:

```powershell
node C:/Users/todor.chankov/source/WFC-pathfinder-local/pathfinder-engine/verify.mjs
```

The script builds the runner and runs both harnesses sequentially. New logs and receipts go into a timestamped `docs/pathfinder/evidence/pf1/runs/` child, leaving the recorded PF-1 delivery evidence intact. It uses a private CLI home and disables SDK certificate generation. It does not install packages or start containers. The optional private Excel fixture remains separate and is not included in the 105-check claim.

The recorded final PF-1 run has 105 regression checks and 215 parity/boundary checks, including 43 golden cases, 33 valid DTO fixture replays and 14 CLI scenarios. These counts describe that recorded revision, not every future invocation.

## Calculate

After verification builds the runner, pipe the synthetic request example to its executable:

```powershell
Get-Content C:/Users/todor.chankov/source/WFC-pathfinder-local/docs/pathfinder/contracts/pf1/calculate.example.json -Raw | & C:/Users/todor.chankov/source/WFC-pathfinder-local/pathfinder-engine/tools/PathFinder.LocalRunner/bin/Release/net9.0/PathFinder.LocalRunner.exe
```

See the [contract](../docs/pathfinder/contracts/pf1/README.md) for the actual example filename, input fields, limits, statuses and exit codes. Geometry is canonical right-handed Z-up metres; no display transform is applied here. All three allowances are explicit snapshots. Future WFC orchestration must load their authoritative values from Project > Details. This offline worker does not authenticate project access or validate settings provenance.

The in-process adapter is cooperatively cancellable. Use the default runner coordinator when a hard worker lifetime is required. Direct `--worker` invocation is internal IPC and does not provide the coordinator watchdog.

## Evidence boundaries

PF-1 proves detached-core synthetic behavior. Real native/converted geometry parity, graph preparation from the model, shared locations, admin UI, jobs and Review + Apply belong to later stages. No current WFC runtime or database is changed by these projects.

`node pathfinder-engine/verify-source.mjs` is a separate local baseline audit: it checks frozen bytes and the three original checkout/container states against PF-0 and writes the PF-1 source-preservation receipt. It is tied to this machine and historical environment, unlike the portable calculation harnesses.
