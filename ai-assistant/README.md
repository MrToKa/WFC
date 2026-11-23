# WFC document analysis for GVL244

The local Docker service prepares the supplied documents and holds the project evidence. The document job sends each supplied page to the OpenAI Responses API with text and an image when available. A local review then compares the document evidence with the full WFC facts snapshot. The normal service has an internal network, a private volume, and read-only application files. Only a one-shot job started with the OpenAI overlay receives the key and an outbound connection.

## Stage 1 on Windows

Run these commands from the repository root in PowerShell.

```powershell
docker compose -f compose.ai.yml up -d --build --wait
.\scripts\Sync-GvlWfcFacts.ps1
.\scripts\Invoke-GvlDocumentAnalysis.ps1 -Documents @($drawingPdf, $pumpImage)
.\scripts\Invoke-GvlDocumentAnalysis.ps1 -Preflight -CorpusId $corpusId
```

Use the actual paths for the files you give the agent. Preparation prints the corpus ID, source hashes and page counts. PDF, PNG, JPEG, UTF-8 text, CSV and TSV are supported. The preparer stops the entire import if a supplied file is unsupported or cannot be read. PDF pages retain a page image and text with layout padding removed. Input files are mounted read-only. The prepared set and subsequent analysis receipts stay in the local Docker volume.

The snapshot script runs under the local Docker operator's existing access to the GVL244 test backend on port 5181. The database enforces a repeatable-read, read-only transaction. The snapshot contains the actual From/To rows, registry, binding status and current model context. The CLI verifies the project's ID and the full inventory before accepting it. Refresh this snapshot when WFC changes. The separate optional `compose.ai.wfc-read.yml` overlay supports the bounded WFC HTTP read client using a current user's token file; it does not confer future binding permissions.

## Stage 2 and the project key

Create an OpenAI project API key in the platform and enter it locally in the masked prompt. The setup script stores it in a Windows file accessible to the current account. The analysis wrapper mounts it as a Docker secret for that one job. Calling the setup script alone makes no request.

```powershell
.\scripts\Set-WfcOpenAIKey.ps1
.\scripts\Invoke-GvlDocumentAnalysis.ps1 -Analyze -CorpusId $corpusId
```

The model is `gpt-6.1-terra`, which supports image input and structured output. A page request includes its source identifier, text and artwork. WFC cable and binding data stay local. The client uses `store: false`, a fixed HTTPS destination and no tools. The original extraction profile allows 12,000 output tokens per attempt. SQLite tracks usage by corpus, model and prompt and enforces a shared conservative ceiling of USD 70 for this GVL244 trial. Billing exhaustion stops dispatch. [Model reference](https://developers.openai.com/api/docs/models/gpt-6.1-terra)

The job produces a report ID. Read the report on demand:

```powershell
docker compose -f compose.ai.yml exec -T ai-agent node cli.mjs report $reportId
```

The report covers every page, cites text or graphic regions, and keeps different signal tags pointing at the same equipment distinct. Valid cache entries and recorded completed responses are reusable. An unreadable or failed page produces an incomplete report. Conflicting parents and unsupported relationships in an otherwise complete set are retained for review. A lost response after dispatch blocks automatic replay of that request. A current WFC binding is preserved in the combined review.

Stage 3 will check candidate identity and bounds in the current 3D model. Stage 4 will assign eligible missing/obsolete endpoints through WFC and its existing routing workflow. Stage 1 and the document-analysis job have no endpoint write command. See the [stage plan](../docs/ai-assistant/gvl244-architecture-and-stages.md).

### GVL244 document trial

The one-shot `review-diagrams.mjs` job takes a mode and the primary report ID. It checks the approved PDF and pump image hashes against the local corpus. In `compact` mode it examines each PDF page without an accepted primary result, combining the full drawing and text with a numbered literal-tag dictionary. In `pump` mode it examines page 16 and the pump image for the structural relationships between pump, motor, controls and signals. Both modes share the grant ledger and keep their own evidence and cache keys. The focus report supplements the general page report.

After the jobs finish, `scripts/export-gvl-stage2-report.mjs` reads validated page receipts by report ID. `scripts/recover-stage2-evidence.mjs` exports the usable observations from rejected outputs separately. `scripts/merge-stage2-evidence.mjs` combines the local exports with the original WFC snapshot and produces the evidence report and CSVs. These three tools operate offline.

The image build runs the offline test suite under Node 24 with Poppler and synthetic fixtures. On a workstation with those dependencies, use `node --test ai-assistant/server.test.mjs ai-assistant/test/*.test.mjs`. The service exposes read-only health and capabilities on port 8091 inside its private network.
