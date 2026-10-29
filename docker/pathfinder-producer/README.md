# Owned managed browser helper

Source packaging only. No browser/SDK isolation qualification is asserted here.
The root executor generates and reviews the separate lock for exact
`playwright-core` 1.64.0, resolves the official
`mcr.microsoft.com/playwright:v1.64.0-noble` digest and records the exact helper
image ID before use. No root WFC package or unrelated installed project is used.
The Docker build intentionally refuses a missing/mutable base and a missing lock.

The image carries only fixed first-party background `.mjs` modules and the pinned
Playwright package/browser from its base. Test modules, SDK/model/business data,
credentials and private runtime records are excluded. The root-owned managed
runner/fixed-loopback broker must be supplied before profile mode `run` is used.
Mode `probe` verifies actual Chromium sandbox/WebGL facts; it does not perform or
qualify Autodesk SDK/model extraction.

Create a fresh profile through `createProducerProfile`, supplying verified actual
Docker-default seccomp bytes and their independently pinned SHA. The profile adds
only clone/setns/unshare allowances. It fixes network none, user 1000:1000,
read-only root, no-new-privileges, all capabilities dropped, private IPC,
512 MiB `/tmp`, 512 MiB `/dev/shm`, 8 GiB memory, 256 PIDs, two CPUs and a
15-minute process-controller wall limit. No original mounts, host ports, host IPC,
Docker socket, privileged mode, SYS_ADMIN or no-sandbox option is supported.

Root supplies Docker-demultiplexed attach/stdin adapters. Wire transport is a
four-byte big-endian length followed by bounded UTF-8 JSON; it never consumes
Docker logs. Unknown create/start/stop/join outcomes retain their exact resource
identity in quarantine; only confirmed wait+inspect joins permit explicit removal.
The host workflow must not release a quarantined attempt or start a replacement
against the same resources. Retain its private receipt for exact root reconciliation.
