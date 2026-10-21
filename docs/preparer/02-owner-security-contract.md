# SP-2 / SP-3 personal Autodesk security contract

Status: accepted implementation direction; **design only**. This document does not
claim implemented isolation, passing tests, live APS conversion or deployment.
SP-0 baseline qualification and SP-1 recoverable backup gates remain required.
Root is the only build, test, browser, SQL, HTTP and Docker executor. Preserve the
existing integration and other writers' changes; do not modify the original WFC
or PF installations while implementing this contract.

The selected destination is the main WFC on 5180. Preparer is available only to
current WFC administrators. Each administrator explicitly enters their own APS
credentials; another administrator has no override allowing their use. UI text
is English. The trusted server WFC origin is configured separately from the
public browser origin; neither an HTTP body nor a browser Host value selects it.

## Current source boundaries

These are source observations, not accepted final behavior:

- `model-preparer/app/workspace-security.mjs:32–44,150–158` validates current
  `/api/users/me` but admits engineers and can interpret `role:admin` as admin
  when `isAdmin` is false. Its encrypted v1 state has one global settings record.
- `workspace-security.mjs:191–203` has global masked settings and an unscoped
  synchronous `privateSettings()` accessor. Existing WeakMap authentication
  branding is useful and must not be replaced with caller-supplied user objects.
- `model-preparer/app/workspace-service.mjs:59–89,122–164` seeds global settings
  from environment, shares access/inner/provider state, and allows another admin
  to read a generation. Its generation-list route also has an admin bypass.
- `model-preparer/lib/engineer-cost-provider.mjs:76` requires synchronous
  `getAuthorization`. Its durable reservations intentionally survive renewed
  approval; changing a configuration must not erase an uncertain submission.
- `model-preparer/lib/aps-provider.mjs:159–164,198–200,340` requires synchronous
  mutation guards, including multipart PUT, and opens the request without an
  intervening await after the final guard. Preserve this boundary.
- The workspace security/service tests predominantly use one account and
  currently expect engineer admission and global seed configuration. Extend
  them with two-owner regressions; existing expectations must change explicitly.
  Dependency-import baseline repairs belong to SP-0 and are not part of SP-2/3.

## Trusted identity and personal storage

The owner is the exact user ID returned by a fresh, bounded WFC `/api/users/me`
request against the trusted origin. Require `isAdmin === true`; reject
contradictory or malformed role DTOs. Do not trust a JWT role, email, submitted
owner ID, configuration ID, path, job record or `freePlanConfirmedBy` as authority.
Record the owner at normal login and require later refreshes to identify that
same account. All protected settings, project, upload, generation and ZIP uses
require current administrator authorization.

Derive `ownerKey` from a versioned domain, canonical trusted WFC origin and exact
WFC user ID. It is a storage identifier, not an authorization token. Include owner
and origin in validated personal settings and their configuration identity.
Configuration revisions are monotonic within that owner. Two administrators who
enter identical keypairs must still have distinct owner/configuration bindings,
provider instances, access state, OAuth caches and private stores.

Use a strict, versioned encrypted personal-store schema. Preserve existing v1
encrypted/global settings as **UNCLAIMED** private evidence; never assign them to
the first admin or infer ownership from a prior Free-plan confirmation. Preserve
legacy ownerless artifacts and jobs as unclaimed too. There is no legacy-claim
endpoint or implicit global/environment fallback in the workspace. A blank
client secret can retain only that same owner's existing secret; it cannot
initialize personal settings from an unclaimed record. First personal setup
requires explicit credentials from that administrator.

Keep credentials and WFC tokens encrypted server-side. Passwords exist only for
the normal login exchange. Public settings expose a masked personal record and
`clientSecretSet`, never the secret, token or ciphertext/key material. Preserve
bounded reads, safe paths, private permissions, authenticated encryption and
durable serialized writes. Backup must include personal stores, keys and journals;
restored authority is fenced separately in SP-5.

## SP-2 interface supplied to SP-3

Retain the existing async public operations `authenticate`, `getSettings`,
`saveSettings`, `listProjects`, `requireProject` and `request`, with current-admin
checks and personal settings semantics. Agree the following trusted server-only
interface before service edits:

```js
const binding = await security.bind(auth, {
  projectId,
  expectedConfigurationId,
});
await security.refreshBinding(binding); // returns this binding, or revokes/throws
const identity = security.assertBinding(binding); // synchronous, no Promise
const settings = security.privateSettings(binding); // synchronous private copy
```

- `auth` must be branded by this security instance. `bind` derives its owner from
  refreshed WFC identity, verifies project permission and the exact selected
  personal configuration, then returns an opaque frozen object branded in a
  private WeakMap. HTTP bodies and deserialized records cannot mint a binding.
- `assertBinding` returns only frozen trusted metadata:
  `{ownerId, ownerKey, configurationId, revision, expiresAt}`. It synchronously
  verifies the session, binding expiry, local revocation epoch, exact owner and
  configuration. `privateSettings(binding)` applies the same check. An unscoped
  accessor, copied object or binding from another/restarted security instance
  fails closed. Metadata alone never authorizes a request.
- `refreshBinding` obtains fresh current WFC admin/project authority asynchronously
  and rechecks the exact owner/configuration after its await. It cannot silently
  substitute a new configuration or another login. On refusal, demotion, expiry,
  logout, WFC outage or configuration change, revoke affected local bindings before
  awaiting persistence and propagate a safe error. Credentials/login state may be
  retained for explicit recovery after an outage; cloud authority may not.
- Bindings are finite and process-local; persist no live capability or provider
  authority. A restart requires fresh authorization and an own-user APS access
  check. A late/out-of-order response must not resurrect a revoked binding.
- A store write failure or uncertain logout/rotation remains fail closed; do not
  re-enable old authority because the previous encrypted file still exists.

## Asynchronous preflight and the final synchronous guard

Do not make `getAuthorization` or `assertMutationAllowed` async. Both current
libraries deliberately reject a Promise. Checking only once at Generate is also
insufficient when OAuth, signing, file reads or another cloud request await.

SP-3 composes a trusted async authority preflight **before** opening each protected
provider request. For APS calls, use one narrowly scoped optional server-only
preflight seam where required, including cached-token requests and multipart PUT.
It refreshes the exact operation binding and rechecks the active owner/configuration
ticket after the await. It is not an HTTP/environment option or a new generic
network transport. Standalone explicit provider modes retain their behavior.

The request order is:

1. Await bounded fresh WFC authority for the same binding and operation ticket.
2. Recheck cancellation, owner, configuration, current APS check and durable cost
   authority synchronously, including the existing cost/mutation guard.
3. Open the APS request immediately, with **no await** between that final guard and
   request creation. Never repeat a POST/PUT after an unknown outcome.

Preserve the core's immutable submission WAL, reservation counts, idempotency and
uncertain-submit reconciliation. New access checks do not authorize another submit
or waive Free-plan confirmation. APS access is not proof of remaining quota.
No startup network calls or automatic cloud submissions are introduced.

## SP-3 ownership, caches and the global operation bound

Remove admin cross-owner exceptions from generation lookup/list, resume and ZIP
routes. Foreign IDs return 404 before private inner work, even for another admin.
Bind uploads, request receipts, generations, inner jobs and packages to exact
trusted owner/configuration metadata; validate it when reading persistent data.
Do not reconstruct ownership from a source fingerprint, shared keypair or filename.

Partition data/work/output, access results, `inner`/`innerOpening`, provider and
OAuth caches by trusted owner/configuration as appropriate. Preserve owner-scoped
cost keys/WAL budgets across approval refresh; moving to a fresh configuration
directory must not clear a reservation or bypass an uncertain old submission.
Keep APS's required application namespace binding; use an owner-scoped logical
account and owner-prefixed remote object keys instead of the workspace's shared
hardcoded Aalborg object-key override. Never fall back to another owner's runtime.

There is still **one active operation globally**, outside all per-owner runtimes.
Acquire its synchronous ticket before any await that admits upload, APS check,
Generate/resume or import work. Include owner, operation identity, binding and
cancellation; release only that exact ticket in `finally`. A per-owner provider
or pending `innerOpening` promise cannot multiply the original concurrency bound.
Unrelated safe owner-filtered reads need not acquire mutation authority.

Local verified ZIP download and import-only retry do **not** require enabled,
unchanged or currently reachable APS settings. They still require fresh WFC admin,
exact owner/project and verified package identity. Open only that owner's existing
closed/local store; do not retrieve credentials or create a live provider merely
to read its ZIP. Import retries retain the exact original package and WFC import
idempotency key. No cloud upload or conversion is repeated.

## Ownership and meaningful checks

- SP-2 writer: `model-preparer/app/workspace-security.mjs` and its test file;
  any new encrypted-store helper must be agreed with root first.
- SP-3 writer: `model-preparer/app/workspace-service.mjs`, workspace service/live
  tests and the agreed narrow provider-preflight seam/tests. Core/provider shared
  files have one designated writer; coordinate before crossing that boundary.
- Root owns integration, actual checks, private runtime resources, backup/restore,
  stage evidence and local commits. This contract does not bypass SP-1 or authorize
  a main-runtime update before its qualified backup/restore and delivery gates.

Required regressions must cross the real boundary they claim:

1. Two admins: A's settings/upload/job/ZIP cannot be read, changed, resumed or used
   by B. Explicitly entering identical APS pairs still gives independent authority
   and caches; forged/cloned bindings and submitted owner fields fail.
2. Legacy v1/global credentials remain unclaimed byte-preserved evidence; first
   login does not activate them. New personal blank-secret setup cannot borrow them.
3. Current admin admission/use, session expiry, logout, demotion, identity change,
   outage and config rotation invalidate final synchronous authority. Pause async
   preflight/signing/storage work, revoke while paused, then prove zero subsequent
   mutation requests and no async final-guard acceptance.
4. A pending upload/provider opening or conversion blocks B's competing operation
   through the same outer gate. Restart retains interrupted/uncertain work without
   launching it or changing owners; stale capability objects cannot be restored.
5. Own verified ZIP/import-only recovery works after APS disable/rotation/outage
   with zero APS calls; a foreign admin still receives 404. Durable cost/WAL
   reservations and WFC import identity survive the retry.
6. No secret/password/token in public DTOs, URLs, logs or Git; safe bounded failure
   responses. Report simulation, retained-package and live APS checks separately.

None of these checks has been executed by authoring this contract. Record exact
revisions, scope and terminal results during the implementing stages.
