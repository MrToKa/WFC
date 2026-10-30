# Automatic deployment to the LAN Docker Desktop host

## What happens after a merge

`Publish tested deployment` runs the existing application and package checks,
tests the local updater with an isolated fake Docker/HTTP transport, and builds
the production API and web images. Pull requests validate without publishing.
Only `main` publishes commit-tagged images to GHCR. Both digests are recorded in
one `deployment.json`, published last in the `deploy-<40-character-commit>`
prerelease. A partial image publication cannot be selected by the updater.

In optional polling mode, the Windows host checks the current `main` commit and its exact deployment
release every five minutes. It does not deploy an older successful build while
newer `main` is still building or failing. WFC and Preparer publish independently.
All connections start from the host. No inbound webhook, public port, VPN or
router change is required. The existing LAN access rules remain in force.

## Availability and data compatibility

This is a controlled in-place update with a short application outage, not a
zero-downtime deployment. Images download before any service stops. PostgreSQL,
MinIO, their versions, networks and persistent volumes are not updated by this
pipeline. The updater targets only the configured application services.

The updater requires a private preparation hook. That hook must verify a
coherent backup and arrange an appropriate idle/maintenance period for WFC and
Preparer together when either service is being replaced. Exit **75** to postpone
because users, uploads, conversions or imports are active. Other nonzero exits
abort. The hook must clean up any temporary maintenance fencing itself, or tie
it to the updater process lifetime. This version does **not** add an application
admission/drain API. Do not claim that checking for idle once prevents a new job
from starting afterwards. Where an enforced maintenance period is unavailable,
do not enable unattended deployment during active use. Graceful shutdown can
interrupt a Preparer operation; its saved job may need explicit continuation.

The updater uses `docker stop --time -1`: it never forces SIGKILL for its own
deadline. A process that does not shut down leaves the update waiting with a
pending journal. Do not terminate that process without inspecting its state.

WFC currently runs schema initialization on startup. **Image rollback is not
database rollback.** Every automatic release must remain backward compatible
with the previous image and stored data. `wfc-v1` and `preparer-v1` are release
contracts, not automatic proofs of compatibility. Review changes to schema
initializers, SQL, stored job/WAL formats and the WFC/Preparer API before merge.
If a release breaks a contract, change the compatibility string in the workflow
and perform a reviewed migration/restore rehearsal and manual rollout. The old
local configuration refuses the new contract. Update both applications together
manually for incompatible protocol changes. Never silently leave the old
contract string on a breaking release.

After replacement, Compose health checks and the configured HTTP JSON checks
must pass. The updater checks exact image IDs and persistent mount identities.
If readiness fails, it attempts to restore the old image IDs and rechecks HTTP
readiness. It never restores a database backup automatically. If rollback also
fails, the pending record stays and further automatic attempts are blocked.
Full browser/login/model import coverage still needs an acceptance smoke test;
an HTTP 200 alone does not establish that every feature works.

## One-time host setup

These instructions target the existing `wfc-api`, `wfc-web`, `wfc-postgres`,
`wfc-minio` and `routings-preparer-preparer-1` setup. The example uses the current
desktop address `SERVER_LAN_ADDRESS`. It must be checked on the actual host before
activation. No registration or real deployment is performed by merging this PR.

1. Merge both CI changes and wait for successful `Publish tested deployment`
   runs. Require this check through `main` branch protection and use pull
   requests for changes, including workflows and compatibility contracts.
2. In GitHub Packages verify that both repositories' workflows have access to
   their respective GHCR packages. Publishing uses `GITHUB_TOKEN`, with
   `packages: write` limited to the publication job. Keep packages private if
   required. The Preparer image includes the existing trusted Autodesk SDK;
   check distribution rights before making a package public.
3. Install PowerShell 7.2 or later. In the **same Windows user account that runs
   Docker Desktop**, authenticate Docker to GHCR once using a suitably scoped
   read-only package credential. Use `docker login ghcr.io`; do not put the
   token in source, config JSON, workflow text or chat. Verify `docker version`
   and private image pulls under this account. Neither the app's `.env` nor
   Autodesk/database credentials belong in GitHub Actions.
4. Keep the updater in a stable local checkout, outside the active development
   branch/worktree. Copy `scripts/cicd/deployment.example.json` to a private
   path such as `D:\WFC-Deploy\deployment.json`. Review the Compose project,
   working directory, service names, image paths, health URLs and Preparer
   launcher arguments against the real installation. The `wfc-app` deployment
   has different service names and is deliberately **not** inferred from this
   `wfc` example. The updater refuses mismatched running container labels.
5. Implement the two private preparation hooks before `-Apply`. Start from
   `scripts/cicd/Prepare-Application.example.ps1`, which deliberately refuses
   deployment. Use the supported coherent backup tools for the installed
   versions, including source inventory/private configuration and all three
   Preparer volumes plus external inputs. Do not replace the hooks with `exit 0`
   or a database-only dump. Confirm a restore to an isolated target. Include
   cross-application idle/maintenance coordination in these hooks.
6. Run a read-only candidate check, then the first controlled deployment during
   a maintenance period. Verify login, project loading, 3D viewing, model import
   and a small Preparer job before registering the repeating task.

```powershell
# Run in PowerShell 7 from the reviewed, stable WFC checkout.
.\scripts\cicd\Update-Deployment.ps1 -ConfigPath 'D:\WFC-Deploy\deployment.json'
.\scripts\cicd\Update-Deployment.ps1 -ConfigPath 'D:\WFC-Deploy\deployment.json' -Apply
.\scripts\cicd\Register-DeploymentTask.ps1 -ConfigPath 'D:\WFC-Deploy\deployment.json'
```

The task runs as the current interactive Windows user, without administrator or
SYSTEM privileges. Docker Desktop must be running; the computer must be awake
and the user signed in. Configure Docker Desktop startup at sign-in. This does
not provide unattended cold-boot availability before login. A dedicated Linux
host/VM with a service-managed Docker daemon is a future improvement for that
requirement; Kubernetes is not needed.

The release metadata transport currently supports these **public repositories**.
Private GHCR images are supported using Docker's existing credential store.
An optional `WFC_DEPLOY_GITHUB_TOKEN` in the task user's environment raises the
GitHub API rate limit. Use a read-only token and never print it. This updater
does not implement private GitHub release-asset downloads; review that transport
before changing repository visibility. Five-minute checks for two applications
normally use about 48 API calls/hour plus changed-release requests.

## What is deliberately fixed locally

The updater never runs `git pull`, downloads a remote PowerShell script, builds
on the production host, runs a public-repository self-hosted GitHub runner,
changes firewall rules, prunes images or invokes `compose down -v`. The trusted
Compose files and Preparer launcher stay local. Review local configuration and
launcher updates separately; an image-only deploy cannot apply newly required
mounts, environment settings or infrastructure changes.

The updater retains two working version sets in `workingVersions`: current and previous. Each WFC set includes API and web; Preparer is tracked independently. After successful acceptance, only explicitly recorded older rollback tags are released. Failed candidates never rotate history. Unrelated images, GHCR tags, legacy pins and failed/interrupted attempts are not pruned, so total Docker disk usage is not capped at two images. Protect the state directory and local config/hooks
from other users. Schedule backups independently of deployments as well.

## Failure handling

Task Scheduler's last result is nonzero on a failed check. The per-application
JSON state in `stateDirectory` records accepted commits, previous image IDs,
failed candidates and an in-progress transaction. Run the updater manually to
see its controlled diagnostics. Keep deployment/backup monitoring in place;
this version does not send notifications or collect central logs.

- Failed build or missing release: keep running the current version.
- Missing backup/maintenance hook: do not begin deployment.
- Busy hook (75): postpone to the next check.
- Candidate readiness failure with successful rollback: block the same commit
  until an operator inspects the issue and uses `-RetryFailed` explicitly.
- Interrupted deployment or failed rollback: retain `pending`; inspect the
  containers, mounts, data and saved old/new images before manually reconciling
  the state. Do not delete `pending` as a routine retry mechanism.

Local tests: `node --test scripts/cicd/release.test.mjs` and
`pwsh -NoProfile -File scripts/cicd/Update-Deployment.tests.ps1`. Docker and HTTP
are replaced by in-process fixtures in the latter. They prove transaction and
refusal behavior, not real Docker Desktop availability or database rollback.


## GitHub-triggered deployment (preferred instead of five-minute polling)

Publication now supports an optional `request-lan-deploy` job. It sends a
`repository_dispatch` only after the complete publication job succeeds on main.
No deployment command runs on a public repository's self-hosted runner.

1. Create a **private**, owner-controlled operations repository, e.g.
   `MrToKa/wfc-deployment`, with default branch `main`. Put
   `scripts/cicd/private-deploy.yml.example` there as
   `.github/workflows/deploy.yml`. Never add PR-triggered jobs or untrusted
   collaborators to this production execution repository.
2. Register a repository-specific Windows x64 self-hosted runner ONLY there,
   with label `wfc-lan-deploy`. Run it under the signed-in Docker Desktop user.
   It makes outbound HTTPS connections to GitHub; no inbound firewall port or
   router forwarding is needed. Protect runner files and local trusted scripts.
3. Install the reviewed updater at
   `D:\WFC-Deploy\trusted\Update-Deployment.ps1`, alongside the separately
   reviewed private configuration and backup/maintenance hooks. The workflow
   executes this fixed local path without checking out application code or
   accepting command text, paths or images from event payloads.
4. In each application repository, set Actions variable
   `LAN_DEPLOY_REPOSITORY=MrToKa/wfc-deployment`, and Actions secret
   `LAN_DEPLOY_TOKEN` to a fine-grained PAT restricted to that operations
   repository with Contents: write (required for repository dispatch). Keep it
   only in secrets, expire/rotate it, and avoid broad account access. The normal
   repository `GITHUB_TOKEN` cannot dispatch into a separate repository.
5. Complete the same GHCR login, coherent backup, maintenance coordination and
   first controlled deployment described above. Use Run workflow in the private
   repository for that first event-mode test. Check both source publication and
   private deployment results; dispatch acceptance does not mean deployment
   succeeded. Do not register the five-minute task for event-only mode. Disable
   an already-registered polling task after the first verified event deployment.

Both source events invoke the same updater, which independently revalidates the
latest main manifests for both configured applications. Concurrent deployments
are serialized by the private workflow and the local filesystem lock. Stale
signals cannot inject older versions or shell commands. Intermediate main
versions may be skipped in favor of the latest fully published main commit.

A stopped runner queues jobs; GitHub queue/run limits still apply. A busy hook
or local lock makes the event job **fail** visibly with `-FailIfBusy`, preserving
running services. Rerun the private deployment workflow after work is idle;
event-only mode does not automatically retry a busy deployment. A second merge
can also trigger a later attempt. Keep optional polling only if that explicit
reconciliation behavior is wanted. Runner offline, PAT expiration, dispatch
failure and backup failure require operational monitoring. GitHub's finite job
timeout may interrupt a hung stop; the pending journal then blocks unattended
retries, as with any other interrupted deployment.

References: https://docs.github.com/en/actions/reference/runners/self-hosted-runners
and https://docs.github.com/en/actions/reference/security/secure-use

