# Model Browser name and Tag search

The existing Autodesk Model Browser search field searches node names and Tag
property values. It keeps the SDK's result list, keyboard navigation and result
actions. No additional search panel or model changes are required.

`viewer-runtime/model-browser-search.mjs` attaches to the panel after it becomes
available. Native name matches remain synchronous. Property-worker candidates
are checked against actual properties named `Tag` (raw or displayed name), then
merged per model without duplicate object IDs. Tag matches display the original
name followed by the full Tag value. Other property values cannot introduce a
result. Pending replies cannot replace a newer query or reopen a cleared search.

The integration uses the pinned SDK 7.130.0 Searchbox callback and delegate
contracts. These are internal UI details: review the integration and run its SDK
contract tests before changing the SDK version. Vendor SDK files are unchanged.

Validation: the focused search, adapter and module-closure suites pass. A local
copy of the real GVL244 model was opened with SDK 7.130.0 in the built-in browser.
Searching `15-VS-52071` returned `ACPPPIPEINLINEASSET — 15-VS-52071` under
`01-50_ROHR_VETOH.dwg`. Native name search and clicking the Tag result also worked.
This local check does not update the separate installation at 192.168.5.55.
