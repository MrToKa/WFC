# Isolated protected Viewer acceptance

This directory contains test tooling, never an HTTP test endpoint. It reuses the Stage 4 public package verifier/import path and disposable PostgreSQL/MinIO conventions. Node 24, Docker Desktop and an explicitly supplied local Playwright module/browser are required. No installer, cloud call, real `.env`, Preparer or original Viewer process is used.

```powershell
node scripts/viewer-sessions/run-stage5.mjs init --run-dir C:/stage5-evidence/run-01
node scripts/viewer-sessions/run-stage5.mjs build --run-dir C:/stage5-evidence/run-01
node scripts/viewer-sessions/run-stage5.mjs start --run-dir C:/stage5-evidence/run-01
node scripts/viewer-sessions/run-stage5.mjs contracts --run-dir C:/stage5-evidence/run-01
node scripts/viewer-sessions/run-stage5.mjs integration --run-dir C:/stage5-evidence/run-01
node scripts/viewer-sessions/run-stage5.mjs browser --run-dir C:/stage5-evidence/run-01 --playwright-module C:/local/node_modules/playwright/index.mjs --browser-executable C:/local/chrome.exe
node scripts/viewer-sessions/run-stage5.mjs regression --run-dir C:/stage5-evidence/run-01
node scripts/viewer-sessions/run-stage5.mjs stop --run-dir C:/stage5-evidence/run-01
```

Only a unique labelled project and three new volumes are mutated. PostgreSQL, MinIO and two API workers have no host ports and share an isolated internal backend network. Production nginx is exposed only on `127.0.0.1:18085`; the development Vite proxy only on `127.0.0.1:15185`. Both paths preserve the browser origin and port. The public diagnostic harness is included only by the explicit fixture build argument `VITE_VIEWER_HARNESS=true`. A normal build leaves this feature disabled. The delivered runtime and exact SDK are prepared and verified by the ordinary WFC build, rather than supplied by a model package.

The explicit disposable credentials/database/buckets retain the Stage 4 names so its existing consumer tests run unchanged. They have no relationship to the working WFC environment. Both pinned ZIPs are individual read-only bind mounts, without extra copies or model bytes in images. `contracts` selects compiled Stage 4 and Stage 5 Node tests against real fixture PostgreSQL/MinIO; `integration` reruns the existing real import/dedup/readback and restart driver with distinct evidence names. `regression` uses actual immutable test images with no network, nonroot uid, two CPUs/4 GiB and one Vitest worker, retaining normal assertions/timeouts.

The browser preparation driver receives random synthetic login credentials through stdin. It imports the real Stage 3 ZIP through the actual Stage 4 API into two separate projects and explicitly selects each version. Only safe fixture IDs are saved; passwords, JWTs and cookie values remain in memory. Every browser mode starts a fresh context with empty cookies/storage and disabled cache/service workers. An exact-origin allow-only HTTP proxy applies to the whole browser including dedicated workers; external HTTP and CONNECT are denied before forwarding. Chromium's development WebSocket tunnel is allowed only to the exact configured `127.0.0.1` fixture authority; other loopback authorities and ports remain denied. Page/worker request observations supplement that boundary. Evidence records origin/path/status/type/counts only, never headers or URL query values. A separate worker positive-control script verifies the enforcement mechanism with a same-origin HttpOnly-cookie fetch and a reserved external address that must be denied locally.

Browser checks use the authenticated, compile-gated `/projects/:projectId/viewer-harness`, the fixed runtime frame and protected imported model. Reports and screenshots distinguish production Docker and development proxy modes, and retain failed attempts. They are actual test results only when run; source presence is not a PASS. LAN, HTTPS, other browsers and another physical client require their own runs.

`stop` checks the exact run label on every project container/network/volume before deletion. It preserves evidence and input ZIPs and does not remove images, shared build cache, base images, existing services or earlier blocked cleanup targets. Unreferenced images from this exact run may be deleted separately after all required checks finish.
