# Live APS zero-cost source and verification

The Stage 3 prerequisite was investigated before implementing a live capability.
On 16 October 2026 the user expressly authorized Autodesk requests, confirmed a
Free account with quota suspension, and authorized adding the verified existing
owned bucket to the original PoC `.env`. OAuth and OSS ownership checks returned
HTTP 200; no cloud object upload or conversion was performed by this preflight.

The authenticated APS Portal has one application in the WFC-3D hub. Its client
identifier fingerprint was independently compared with the authorized config
and matched. Hub settings identify the same team as the Autodesk Account's
active **APS Free** offering. No subscription, funding or billing setting was
changed. This is current account evidence, rather than an environment flag.

The supported operator source is Autodesk Account → Reporting → Resource and
API Usage → API Usage. The loaded usage-by-API report shows:

- Model Derivative basic interactions: one charged unit equals 300,000 calls;
  one of one units is available, and the latest renewed review observes 1,423 calls, all
  attributed to the single WFC-3D hub/application. Subtracting that observed
  total gives 298,577 calls before reporting lag and subsequent/concurrent
  consumption. The earlier 743/744-call observations are retained separately.
- Model Derivative complex jobs: one charged unit equals two jobs; nine of ten
  charged units are available; observed usage is two jobs. The next refresh is
  14 November 2026. Local grants must be much smaller than the observed balance.

Official policy confirms Free access costs zero within the applicable limits
and suspends API use at the limit until refresh or an explicit paid switch:
[Autodesk offering terms, updated 14 October 2026](https://www.autodesk.com/company/terms-of-use/en/offering-types-and-benefits).
The [current official rate sheet](https://www.autodesk.com/ae/products/autodesk-platform-services/product-details)
lists non-rated Data Management storage/upload/download interactions and
300,000 basic Model Derivative calls in Free. Actual team balances, rather than
a generic published maximum, govern an approval.

There is no invented plan/quota endpoint. Verification is an explicit trusted
operator review of the authenticated offering, team/hub/application binding,
loaded units and balance, with timestamped screenshots and redacted DOM evidence.
An approved source document is pinned by SHA-256 in server configuration. A
separate server-held signing key authenticates exact per-job grants; a checksum
or checkbox by itself is not account evidence. The browser cannot issue, change
or extend a proof or activate live mode.

The source document binds hashed application/team/destination identities and
region; grants additionally bind immutable captured source name/bytes/SHA-256,
conversion settings, support profile and submission/target identities. Grants
are bounded to one storage creation, one upload and one submission, with an
explicit bounded read allowance. Their expiry must not exceed the reviewed
source expiry. Missing, expired, altered or mismatched proof stays closed.
Durable reservations and the immediate pre-mutation gate remain authoritative.

Team consumption is shared. Review again after source expiry or material
account changes, and stop on quota or authorization refusal. Never upgrade a
plan, add funding, retry an uncertain submission, or convert Aalborg again only
for a demonstration. The current live acceptance should reuse the existing
object/derivative after comparing real OSS SHA-1/size with locally verified
snapshot hashes. Source proof does not invent remote SHA-256 or provider job IDs.

Machine evidence and screenshots are outside the image under the Stage 3
output's `evidence/` directory. Credentials and bucket values are absent from
reports, frontend payloads and logs. Real cloud acceptance remains separate
from local and simulated acceptance until actually executed.

## Renewing the operator review

Keep each reviewed offering/basic/complex screenshot and redacted full DOM
snapshot in a separate review directory, together with the safe preflight
record. Never overwrite artifacts of a proof that is still in use. Review the
loaded account data, binding, units and balance before invoking the trusted local
`tools/record-cost-review.mjs` utility. It packages the saved observations; it
does not log in, obtain a quota API or manufacture current account facts.

The utility takes the existing config path, review directory and output proof
path. Its optional fourth argument is an explicitly approved regular NWD path;
without it, the independently verified Aalborg input is used. It streams and
checks the source identity before writing its name/bytes/SHA-256 approval.
The current verifier is deliberately specific to the reviewed WFC-3D account
and observed allowance. Changed binding or observations require a new actual
review and a corresponding verified update. Reporting can lag consumption; the
balance is an observation before subsequent or concurrent team usage.

Apply the new proof path and SHA with explicit `-Mode live -Recreate`, then
explicitly approve the existing job again. Expired or superseded grants cannot
activate a new request. Existing checkpoints and submission history remain.

Delivery defaults to existing-artifact reuse. For a separately authorized new
source, `-AllowNewCloudPreparation` additionally requires a current pinned
source-bound review with explicit operator authorization. It is an operator
startup setting. The Aalborg Stage 3 acceptance omits this switch and performs
no new upload/conversion. Full new upload/submit transport mappings have fixture
coverage; they are not reported as real mutations executed in this stage.
