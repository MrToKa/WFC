# Bounded read-only original-project source copy

This additive audit tool copies only the confirmed original HPU Aalborg project,
its current active model identity and five pinned property-resource references,
and ordered cable From/To/MTO/type inputs. It never imports application bootstrap,
copies credentials, writes business data, imports cables, creates jobs or applies
routes. The original checkout and running containers remain reference sources.
The actual project-identity observation confirmed the original screenshot UUID
`0c0007c9-d73f-4d13-bc87-601c544727b7`, full name `HPU Aalborg 2023` and exact
project number `P230039 / H.7500062`. Copy requires that same UUID, normalized full
name and exact number. The earlier omitted-year name assumption failed safely;
its failure receipts remain retained. No project is renamed or substituted.

Run the focused, fake-Client/no-DB controls first:

```powershell
node --test scripts/pathfinder-current-inputs/source-lib.test.mjs
```

The `inspect` mode connects to no database. It uses a closed Docker metadata
projection and a bounded metadata-only DNS/module probe inside the exact original
backend. The existing DATABASE_URL stays inside that backend; only its host,
port and database are returned. Source checkout revision and selected file hashes
must match the recorded original baseline. Use a new UUID in the work path and
a new receipt filename; outputs are exclusive and cannot overwrite evidence.
Both original-container exec processes clear NODE_OPTIONS only for that process,
preventing inherited preload hooks without changing the container configuration.

```powershell
node scripts/pathfinder-current-inputs/source-copy.mjs inspect --root C:/Users/todor.chankov/source/WFC-pathfinder-local --work-root pathfinder-engine/.scratch/current-inputs-<new-uuid> --receipt docs/pathfinder/evidence/current-inputs/source-inspection-<unique>.json
```

Only after independent review and the parent coordinator's explicit release,
run `copy` with the exact private binding path and SHA returned by `inspect`:

```powershell
node scripts/pathfinder-current-inputs/source-copy.mjs copy --root C:/Users/todor.chankov/source/WFC-pathfinder-local --binding pathfinder-engine/.scratch/current-inputs-<uuid>/binding.private.json --binding-sha256 <exact-binding-sha256> --receipt docs/pathfinder/evidence/current-inputs/source-copy-<unique>.json
```

If a copy refuses SQL identity before business reads, preserve its failure and do
not retry. With a separate explicit release, `identity` accepts the same binding
arguments in a fresh owner-marked inspection directory and returns only raw
`inet_server_addr()::text`, `host(inet_server_addr())`, port/database, read-only
settings, isolation and transport status. It performs no project/model/cable
SELECTs and does not evaluate or relax the existing copy identity guard. Its PASS
means the whitelisted observation was saved, not that the endpoint passed copy
acceptance. The parent is sole executor of this diagnostic and any subsequent copy.
The retained actual identity observation established raw inet text
`172.17.0.2/32` and SQL `host(inet_server_addr())` value `172.17.0.2`. Copy now
uses that SQL host value for the existing exact address guard and retains raw
inet text separately as transaction metadata. It performs no regular-expression
stripping or broad address acceptance; another host/port/database is still refused.

After a separately retained project-name refusal, the parent can explicitly release
`project-identity` with the same binding flags in another fresh inspection directory.
It first passes the unchanged strict canonical SQL endpoint/read-only checks, then
selects only id/project_number/name for the fixed target UUID and a parameterized
name-or-number Aalborg/HPU search, ordered and capped with LIMIT 11. Eleven results
are retained privately and refused as overflow of the ten-candidate budget. The
compact receipt contains only counts/hash references; project rows remain private.
No allowance, customer, model or cable columns are queried. This diagnostic does
not choose a new project or relax the existing exact copy name guard.

If existing project/model copy guards fail, the private error envelope now preserves
only already-selected project id/number/name or model identity/resource references.
It performs no additional query. Allowances and cable rows never enter that failure
projection; the public wrapper still returns only the sanitized failure code.

The private output is `current-inputs.private.json`, schema
`pathfinder.current-inputs.snapshot.v1`. Project allowance values remain the
original decimal strings or NULL. Cable text, NULLs, unknown MTO and PostgreSQL
microseconds remain unchanged. An all-NULL type triple can be transported as
unresolved data quality; original e1ef declares the type reference NOT NULL, so
this is not claimed to be a normal source schema state. A non-NULL type reference
with a missing or foreign joined type is refused. No category is inferred from
the cable type. Package UUID is provenance; the exact converted fingerprint and
five resource path/bytes/SHA entries establish retained model-content binding.

The observed Docker Desktop route is backend `host.docker.internal:5434` to the
exact original PostgreSQL container's published 5432 port, with SQL server
address `172.17.0.2`, port 5432 and database `wfc_app`. Backend and PostgreSQL have
different Docker networks. The tool does not replace this observation with an
assumption that Docker DNS or their IP addresses must be identical.

Each of three independent before/copy/after reads parses the private URI, rejects
alternate endpoints or option/file indirection, passes only the parsed config
with final read-only/timeouts to raw pg Client, and begins a repeatable-read,
read-only transaction. Read-only settings and SQL endpoint are verified before
project data SELECTs. Only fixed parameterized SELECTs, SET LOCAL, BEGIN,
COMMIT/ROLLBACK are executed. Statement/lock/idle timeouts are 15/2/20 seconds,
connection timeout 5 seconds. The inner process watchdog is 35 seconds and host
Docker-client timeout 45 seconds; the metadata-only probe uses 7/10 seconds.
The inner watchdog covers imports, connection, reads, rollback/end and stdout
completion. Host timeouts do not pretend that killing the Docker CLI itself
terminates an exec process inside a container.

Rows are capped at 100000 with LIMIT 100001. A capped count and conservative
sixfold text-escaping byte estimate run before materializing cable text; full
stdout is capped at 64 MiB and the child has a 256 MiB V8 heap limit. This is a
bounded engineering projection, not a full database backup or full memory bound.

Raw phase bytes are written and flushed privately before parsing or asserting;
compact failure receipts retain their exact paths/hashes and sanitized codes.
Full group comparison is persisted before equality checks. A mismatch is an
external or unexplained concurrent-change observation, not evidence that this
read-only tool wrote data. No automatic retry is permitted. The copied projection
checks project, selection, model and cables; the parent's separate preservation
audit covers the wider original containers and isolated application. This tool
does not claim an audit of all original database contents.

Business rows stay in fresh owner-marked ignored scratch. Only compact receipts,
source hashes and aggregate counts belong in Git. Needed private inputs and
failure evidence must be retained; do not delete denied scratch directories or
their parents. Candidate audit consumes the private snapshot and source receipt
only after verifying both SHA references and PASS status. No matching candidate
becomes a confirmed binding, category or engineering acceptance automatically.
