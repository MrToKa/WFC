# Temporary LAN HTTP access to the 3D viewer

WFC can explicitly allow protected model sessions over HTTP on an exact private
IPv4 server address. This mode needs no certificates, client installation or
corporate DNS change. It is disabled by default. It does not encrypt login
credentials, cookies, API requests or model data. The application origin allowlist
does not restrict a client's source network; enforce that with the host firewall
and keep the application without public port forwarding or tunnels.

## Configuration

Use the real desktop IPv4 address and current published web port. For example,
if WFC is reached at `http://192.168.5.55:5173`, set these entries in the existing
Compose `.env` file, preserving all existing credentials:

```dotenv
WFC_HTTP_PORT=5173
WFC_HTTP_BIND_ADDRESS=192.168.5.55
WFC_VIEWER_ALLOWED_ORIGINS=http://192.168.5.55:5173,http://localhost:5173,http://127.0.0.1:5173
WFC_VIEWER_ALLOW_HTTP_LOOPBACK=true
WFC_VIEWER_ALLOW_INSECURE_LAN_HTTP=true
WFC_VIEWER_TRUST_PROXY=true
```

These addresses are examples. An origin includes scheme, host and port, with no
trailing slash or path. LAN HTTP accepts literal addresses in `10.0.0.0/8`,
`172.16.0.0/12` and `192.168.0.0/16`, only when individually allowlisted. Public
IP addresses, wildcard hosts, DNS names, link-local and IPv6 LAN addresses are
not supported by this exception. Loopback permission remains independent.
If the server address changes, update the allowlist and binding before recreating
the containers. `WFC_VIEWER_TRUST_PROXY=true` assumes the API is reachable only
behind WFC's configured Nginx, which overwrites the forwarded protocol header.

The root `docker-compose.yml` web service already publishes its configured port
on host interfaces. `docker-compose.app.yml` now supports the explicit bind
address above, retaining `127.0.0.1:5180` as its unchanged default when those
settings are absent. Configure both the allowlist and publication; either alone
is insufficient. A process environment variable takes precedence over `.env`.
For Vite development, configure the viewer environment on the API process and
use the existing same-origin `/api` proxy.

## Deploy into the existing installation

Start in a clean checkout and fetch the branch:

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
```

After updating the existing `.env`, rebuild
**both API and web**. Do not replace the working installation with another
Compose template.

For the root stack with services `api` and `web`:

```powershell
docker compose build api web
docker compose up -d --no-deps --no-build --pull never --wait --wait-timeout 180 api web
```

For the existing `wfc-app` stack with `backend` and `frontend`, use its existing
credential-preserving update procedure:

```powershell
.\scripts\update-local-app.ps1
```

See [portable deployment](PORTABLE-DEPLOYMENT.md) for backup and rollback
procedures. No database migration, bucket change or volume deletion is introduced
by this change. API startup prints a warning when the insecure LAN mode is on.

Allow the actual port from the actual colleague subnet in Windows Firewall.
For the example above, in an elevated PowerShell:

```powershell
New-NetFirewallRule `
  -DisplayName "WFC HTTP LAN" `
  -Direction Inbound -Protocol TCP -LocalPort 5173 `
  -LocalAddress 192.168.5.55 -RemoteAddress 192.168.5.0/24 `
  -Action Allow -Profile Domain,Private
```

Existing broader Allow rules must be considered separately. This example does
not revoke them. Firewall administration on the host is required if access is
currently blocked. No router forwarding or colleague-side installation is needed.

## Session behavior and acceptance

The opt-in changes the transport policy only. Project access, authenticated
creation/renewal/revocation, exact origin/port checks, available Fetch Metadata
checks, session expiry, logout invalidation and model-integrity checks remain.
Cookies remain host-only, path-scoped, `HttpOnly` and `SameSite=Strict`. HTTP
cookies omit `Secure`; HTTPS cookies retain it. These flags do not protect
against interception of HTTP traffic. The iframe still receives no Bearer token.

Browser UUID generation is shared through `src/utils/generateId.ts` and
`viewer-runtime/generate-id.mjs`. It uses Web Crypto `getRandomValues` and UUID v4
version/variant bits, with no `Math.random` fallback. The static runtime packager
includes the shared module. Path Finder panels, saved commands and the isolated
geometry producer use the same helper. Server-side UUID generation is unchanged.

Content and command SHA-256 verification is shared through `src/utils/sha256.ts`
and `viewer-runtime/sha256.mjs`. It uses native `crypto.subtle.digest` when present
and the same SHA-256 algorithm in JavaScript when LAN HTTP makes SubtleCrypto
unavailable. Native digest failures still propagate. Catalog, location, geometry
and receipt hashes are checked against the same server values; no integrity
check is skipped. Both web and server runtime packaging include the helper.

`VIEWER_ORIGIN_DENIED` means the server refused the browser address, independently
of the user's administrator role. Check the exact scheme, IP address and port
in the configuration above; do not add a wildcard or remove the origin check.
Other known loading failures display a diagnostic code with the retry message.

On a second computer, open the exact configured LAN URL, sign in freshly and
open a project with a healthy selected model. Check model loading, manual and
cable routes, hide/show, logout and loss of project access. Reload the browser
after deployment. UUID and transport compatibility do not enable other
secure-context-only browser APIs such as service workers. The automated HTTP
tests use a local listener with explicit LAN Host/Origin headers; they do not
prove reachability from a second physical machine or render a production model.

To disable the exception, set `WFC_VIEWER_ALLOW_INSECURE_LAN_HTTP=false`, remove
HTTP LAN entries from the allowlist and recreate the API container. Non-loopback
HTTP entries are rejected at startup when the exception is off. HTTPS origins
continue to use the existing certificate/proxy setup.

## Automated checks

```sh
node --test viewer-runtime/test/*.test.mjs
npx vitest run server/viewerSessions/http.test.ts server/viewerSessions/resources.test.ts src/viewer/ViewerController.test.ts src/pages/ProjectDetails/hooks/useRoutingsViewer.test.ts
npx vitest run src/api/httpCryptoCompatibility.test.ts src/pages/ProjectDetails/EndpointBindingPanel.test.tsx
npm run typecheck
npm run lint
npm run build
npm run server:build
```
