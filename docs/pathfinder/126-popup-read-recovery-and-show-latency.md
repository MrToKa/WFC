# Popup calculation recovery and Show latency

The popup could stop following an acknowledged calculation after a single
temporary diagnostic read failure. Its retained pending job then kept Show
disabled until a manual Refresh. A state/artifact refresh could also leave a
scope error after the popup had already read the new result.

The selected calculation now follows the existing exact job/item status endpoint
while work is pending. This is a progress hint only. Once that cable finishes,
the popup refreshes its owned state and verifies the full selected result, rather
than repeatedly loading barrier geometry during every progress poll. Shared
location siblings keep their existing calculation order and write policy.
Transient GET failures recover within the existing bounded read windows. No
Calculate, Save, Review or Apply is retried automatically by this recovery.

Endpoint context reads also retry temporary failures within their original
30-second deadline. A normal context refresh preserves a draft only when the
prepared model, cable, logical location and context owner still match. Access,
scope and evidence failures remain closed; unknown Save commands retain their
exact recovery identity.

After exact route metadata and From/To foreground checks make Show ready, Show
uses that checked payload directly. It does not repeat those reads on every
click. A new result, observed cable revision, model, preferences or history owner
invalidates it. Hide retains the hidden intent while allowing job progress to
refresh readiness. Review and Apply keep their independent current-proof gates.

The general cable-detail hook now forwards the original barrier policy intact.
The server state preview reuses common dependency verification only within one
authorized transaction and one exact project/options/dependency-version key.
Each cable, both endpoints, seal and authority are still checked separately.
There is no persistent geometry or authority cache.

Qualification logs are retained under
`D:/Codex-test-output/show-recovery-20261023`. Installation requires a separate
owned paired delivery; this source note does not by itself certify installation
or authenticated browser acceptance.
