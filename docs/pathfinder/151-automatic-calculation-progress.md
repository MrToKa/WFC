# Automatic calculation and Cable list output progress

The previous `Ready` value counted cables whose input dependencies were available
at admission. In the Aalborg test, 1780 cables were immediately excluded and 360
were eligible. Consequently, overall progress of 1786/2140 meant six eligible
cables had been processed. It did not mean that 360 routes had been calculated
or written. The completed generation eventually saved all 360 eligible pairs.

The recalculation context now optionally includes an exact current-job progress
summary. One bounded metadata aggregate separates excluded inputs, waiting and
running calculations, processed outcomes, calculated routes and confirmed Cable
list outputs. Saved outputs require the matching project/job/cable dispatch and
a written/already-written disposition with a receipt reference. Pending writes,
manual review, refusals, expired output permission and stale results have separate
counts. Eligibility and automatic-length rows never substitute for a saved-pair
count.

The summary is available only for the current enrolled job and generation. Its
partitions are validated, and the context completion total comes from the same
aggregate snapshot to avoid a worker advancing between two reads. This is a
read-only reporting addition; it does not grant result applicability or change
calculation, review, automatic output or finite-authority rules.

The panel shows a spinner, eligible-cable progress bar, processed/calculated/saved
counts and explicit remaining dispositions. Calculation completion does not
imply saving completion. Paused or expired periods retain the last progress
without an active-work indication. Existing ten-second status polling refreshes
output-only progress changes as well as calculation changes.

Evidence and owned delivery artifacts:
`D:/Codex-test-output/automatic-progress-20261027/`.
