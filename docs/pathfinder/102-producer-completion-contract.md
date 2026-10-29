# Protected producer completion contract v2

Frozen PF-B13e prerequisite, based on B13d product
`1e933725b7a8b64d78e3d063fa5b1a5fe7a06386` and handoff
`PF-B13e-producer-completion.md`. Four stored seals and every planned part may
exist even when the producer's final hierarchy/frame check fails after the last
upload. They are insufficient to infer completion. This contract adds a separate
durable witness after that final check; it grants no collision or publication
authority and does not alter the existing v2 session/status shape.

## Command and receipt

The fixed bookend profile is exported as
`BARRIER_MULTIPART_PRODUCER_BOOKEND_PROFILE` with value
`sdk7130-after-final-part-ack-hierarchy-frame-v1`.
All JSON objects below are exact, without optional members or foreign fields.
Hashes are exactly64 lowercase hexadecimal characters; UUIDs are exactly36
lowercase characters in the existing UUID format. Revisions retain the existing
canonical decimal int64 string format. Counts are safe unsigned integers without
signed zero; `partCount` is1…1048576, additionally bounded by actual admitted
reservation, stored receipts and plan totals at execution. Controls remain at
most65536 canonical UTF8 bytes. No actor, login, deadline, filesystem path,
ready flag or verification authority is client-selectable.

`barrierMultipartProducerCompletionRootsSchema` is the exact object
`{nodes,fragments,'geometry-ranges',plan}` with all four hashes non-null.
`barrierMultipartProducerCompletionContextSchema` is exactly:

```text
{intentId, contextSha256, scopeSha256, profileSha256, frameSha256, roots}
```

`contextSha256` is the immutable protected B13c context root. `frameSha256` is
the **full observed frame's contentSha256**, not the reduced capture-frame
projection. Scope/profile/four roots remain their existing distinct identities.

`barrierMultipartCompleteProducerCommandSchema` / type
`BarrierMultipartCompleteProducerCommand` is exactly:

```text
{
 schemaVersion:'wfc.pf.barrier-multipart-complete-producer.v2',
 intentId, expectedSessionRevision, idempotencyKey, scopeSha256, profileSha256,
 contextSha256, frameSha256, roots, partCount, partsSha256,
 bookendProfile:'sdk7130-after-final-part-ack-hierarchy-frame-v1'
}
```

Its exact command digest uses the unchanged
`barrierMultipartSessionCommandHashInput` domain
`wfc.pf.barrier-multipart-session.v2/command`. The mutation union gains this
command additively; the existing stage-command union and every existing command
hash remain unchanged.

`barrierMultipartProducerCompletionReceiptSchema` / type
`BarrierMultipartProducerCompletionReceipt` is exactly:

```text
{
 schemaVersion:'wfc.pf.barrier-multipart-producer-completion-receipt.v2',
 intentId, sessionRevision, commandSha256, scopeSha256, profileSha256,
 contextSha256, frameSha256, roots, partCount, partsSha256,
 bookendProfile:'sdk7130-after-final-part-ack-hierarchy-frame-v1',
 recordedAt, duplicate,
 completionProvenance:'protected-producer-reported',
 sdkSourceBytesVerified:false,
 qualification:'NOT_MEASURED', geometryValidation:'NOT_VALIDATED', authority:'none'
}
```

`recordedAt` is a server UTC datetime. The original receipt stores the one
post-increment `sessionRevision`; duplicate replay retains that original
revision, timestamp, digest and completion facts, changing only `duplicate`.
`barrierMultipartReadCompletionResponseSchema` is this receipt or literal null
when no completion row exists. An expired retained witness may be readable under
the repository's current read guards; neither its shape nor reading it grants a
fresh-use decision. Cancellation remains separately observable in the existing
session and invalidates future use of any retained witness.

## Constant-space ordered part receipt chain

Let `H(x)` be ordinary SHA256 of
`barrierMultipartCanonicalBytes(x)` (sorted compact canonical JSON, UTF8).
Let `D='wfc.pf.barrier-multipart-producer-completion.v2'`.
These helpers return hash inputs; they do not hash, access SDK/storage/SQL or
assert execution. They validate bounded strict inputs and detach returned data.
No caller supplies an array of all part receipts.

1. `barrierMultipartProducerPartChainSeedHashInput(context)` returns
   `{domain:D+'/parts-seed',value:context}` for the exact completion context above.
   Initialize `previous=H(seedInput)` and `nextPartIndex=0`.
2. For each exact original stored part receipt, in ascending order0…N−1,
   `barrierMultipartProducerPartChainStepHashInput(previous,partReceipt)` returns:

   ```text
   {domain:D+'/parts-step',value:{previous,part:{
     intentId,scopeSha256,profileSha256,partIndex,planSealSha256,
     commandSha256,sessionRevision,stored:{blobId,sha256,bytes}
   }}}
   ```

   The full input must pass the existing strict part receipt schema first.
   The projection binds the ordinal, original staging command, its **stored
   receipt revision**, plan root, exact server blob ID, raw byte SHA and byte
   count. `duplicate`, fixed durability and fixed staging qualification fields
   do not enter the chain; exact duplicate replay therefore leaves its identity
   unchanged. Set `previous=H(stepInput)` and advance the next ordinal only after
   the exact positive part ACK.
3. After explicit ordered cursor exhaustion at exactlyN parts,
   `barrierMultipartProducerPartChainFinalHashInput(previous,partCount)` returns
   `{domain:D+'/parts-final',value:{previous,partCount}}`.
   `partsSha256=H(finalInput)`.

The surrounding caller must check every receipt's intent/scope/profile/plan
against the seed, exactly one index0…N−1, exact allocations/payload references,
increasing original receipt revisions, plan totals and explicit EOF. A helper
cannot infer those checks from a previous opaque digest. The server independently
recomputes this chain using bounded ordered keyset pages; it must not materialize
the whole model or trust the submitted count/root. The native writer derives its
chain from validated exact part ACKs. Unknown last ACK does not advance the
chain; explicit readback reconciles the exact retained command before proceeding.

## Final native event and durable execution

Only the packed producer may emit this one terminal event:

```text
{kind:'producer-complete',evidence:{
 contextSha256,frameSha256,roots,partCount,
 bookendProfile:'sdk7130-after-final-part-ack-hierarchy-frame-v1'
}}
```

Emit it after packed-parts iteration, after the last exact part ACK resumes the
generator, and only after final hierarchy/frame bookends and cleanup succeed.
The producer has no part receipts; `partsSha256` is derived separately by the
transport. Inventory-only iteration emits no event. The runtime rejects early,
duplicate or trailing events, requires all planned parts/four roots, and waits
for clean producer EOF before sending completion. EOF/counters alone never
synthesize completion. Local successful completion additionally requires the
durable exact completion receipt. Unknown completion retains its exact command
for explicit reconciliation; no automatic mutation replay is introduced.

In one existing locked transaction the server requires the current protected
actor/login/admin/Viewer/model-load/frame/head/context and original deadline,
four immutable stored seals/plan totals, no pending allocation, all exact ordered
part allocations and receipts, and the independently derived chain. A generic
repository without the protected completion-context adapter refuses completion.
Insert one immutable completion row and exact command receipt, incrementing the
session revision once, without quota or lease renewal. Recheck currentness and
deadline before COMMIT. Reject further staging after completion; cancellation is
still allowed. Exact same-command replay returns the retained receipt, changed
body/key conflicts refuse, and a second completion cannot replace evidence.
Reconciliation discriminates the command schema; allocation_id=null alone must
not classify this command as cancellation.

The server does not independently attest SDK execution from a same-cookie
request. This witness remains **protected-producer-reported** with
sdkSourceBytesVerified=false. B13d local byte validation remains STRUCTURAL_ONLY;
staging remains NOT_VALIDATED; capacity/topology/occupancy remain NOT_MEASURED;
authority remains none. A future publisher requires this witness plus independent
global geometry validation and fresh publication guards. No ready registry,
empty-registry certificate, drilling permission, route clearance, cable write or
real Aalborg/native engineering acceptance is established by this stage.

## Verification status

This document freezes the additive interface. Auth/currentness/idempotency,
actual native/server chain equivalence, isolated PostgreSQL/real-cookie HTTP,
positive process/storage cleanup and source/build checks must be executed and
recorded by root in report103. Schema parsing and authored tests are not PASS
evidence. B13d's prior checks do not substitute for B13e execution.
