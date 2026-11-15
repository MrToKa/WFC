# Aalborg preparation capacity and capture transport — 2026-11-11

The normal Docker API deployment defaults to the versioned `wfc.pf.bounded-512m-capture-and-model.v3` profile: 512 MiB of staged geometry input and aggregate projection input. An explicitly configured environment value still overrides this default. Existing frozen plans retain their original 32 or 128 MiB limits; their hashes and receipts are not reinterpreted.

A definitive geometry capacity refusal retires only the exact collecting session. The next explicit Discover starts a fresh preparation using the configured profile. Unknown write outcomes retain their existing reconciliation workflow. Saved tray assignments and the published network are retained.

Model capture advertises optional batch transport. A supporting host reads up to 32 unchanged capture events per packet, bounded by a 60 KiB payload and the existing 64 KiB envelope. Legacy single-event transport remains supported. Geometry, event order, hashes, per-event limits, total capture limits and model access checks remain in place. Access is checked before and after each packet.

This removes repeated request and access-check overhead; it does not simplify geometry or load additional model objects. A progress count of data batches is a transport count, not a count of selected 3D objects.

Historical full Aalborg preparation recorded 114,186,790 bytes, which exceeds the normal installation's former 32 MiB default. The latest three updates did not widen the selected geometry scope. Tray catalog or routing permission changes can require fresh preparation even when the model itself is unchanged. The exact error code from the reported remote failure was not available, so the capacity mismatch is a demonstrated configuration problem rather than a confirmed diagnosis of every reported failure.

The new profile changes input capacity only. Existing geometry counts, 64 MiB per-part input, 120-second union validation deadline, worker heap and RSS safeguards remain bounded. A 512 MiB input ceiling is not a promise that every such model fits those independent processing limits.

Manual tray assignment saves the selected objects without starting network preparation. Use Discover project tray candidates explicitly to prepare and publish the network.

Deployment requires rebuilding/recreating API and web from the same revision, then reloading the page. No database reset or volume removal is required. Real-model timing after this deployment must be measured separately; synthetic packet counts do not establish an end-to-end latency.
