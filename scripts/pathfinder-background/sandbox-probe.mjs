import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { encodeProducerFrame, PRODUCER_WIRE_VERSION } from './producer-process.mjs';
import { PRODUCER_LIMITS } from './container-profile.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const forbidden = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu-sandbox', '--single-process', '--no-zygote', '--remote-debugging-port'];
export function assertSafeBrowserArguments(arguments_) {
  if (!Array.isArray(arguments_) || arguments_.length > 512 || arguments_.some(value => typeof value !== 'string' || value.length > 65536)) fail('PRODUCER_SANDBOX_ARGV_INVALID');
  if (arguments_.some(value => forbidden.some(flag => value === flag || value.startsWith(flag + '=')))) fail('PRODUCER_SANDBOX_DISABLED');
  return true;
}

export function parseSandboxStatus(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) fail('PRODUCER_SANDBOX_STATUS_INVALID');
  const yes = label => new RegExp('(?:^|\\n)' + label + '[\\t \\r\\n]+Yes\\b', 'i').test(text);
  const result = { pidNamespaces: yes('PID namespaces'), networkNamespaces: yes('Network namespaces'),
    seccompBpf: yes('Seccomp-BPF sandbox'), seccompTsync: yes('Seccomp-BPF sandbox supports TSYNC') };
  if (!result.pidNamespaces || !result.networkNamespaces || !result.seccompBpf || /not\s+adequately\s+sandboxed/i.test(text)) fail('PRODUCER_SANDBOX_NOT_QUALIFIED');
  return result;
}

const fields = text => new Map(text.split('\n').filter(Boolean).map(line => { const at = line.indexOf(':'); return [line.slice(0, at), line.slice(at + 1).trim()]; }));
const digest = value => createHash('sha256').update(value).digest('hex');
function mountSize(options) {
  const value = /(?:^|,)size=([0-9]+)([kmg]?)(?:,|$)/i.exec(options);
  return value ? Number(value[1]) * ({ '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[value[2].toLowerCase()]) : null;
}
async function isolationFacts() {
  if (process.platform !== 'linux' || process.getuid?.() !== 1000 || process.getgid?.() !== 1000) fail('PRODUCER_SANDBOX_USER');
  const status = fields(await fs.readFile('/proc/self/status', 'utf8'));
  if (status.get('NoNewPrivs') !== '1' || status.get('Seccomp') !== '2') fail('PRODUCER_SANDBOX_PROCESS_POLICY');
  const interfaces = await fs.readdir('/sys/class/net');
  if (interfaces.length !== 1 || interfaces[0] !== 'lo') fail('PRODUCER_SANDBOX_NETWORK');
  const mounts = (await fs.readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').map(line => {
    const [before, after] = line.split(' - '), a = before.split(' '), b = after?.split(' ') ?? [];
    return { target: a[4], flags: a[5]?.split(',') ?? [], kind: b[0], superOptions: b[2] ?? '' };
  });
  const root = mounts.find(row => row.target === '/'), temporary = mounts.find(row => row.target === '/tmp'), shared = mounts.find(row => row.target === '/dev/shm');
  if (!root?.flags.includes('ro') || temporary?.kind !== 'tmpfs' || shared?.kind !== 'tmpfs' ||
      mountSize(temporary.superOptions) !== PRODUCER_LIMITS.temporaryBytes || mountSize(shared.superOptions) !== PRODUCER_LIMITS.sharedMemoryBytes ||
      !['nosuid', 'nodev', 'noexec'].every(flag => temporary.flags.includes(flag))) fail('PRODUCER_SANDBOX_MOUNTS');
  return { uid: 1000, gid: 1000, noNewPrivileges: true, dockerSeccompFilter: true,
    loopbackOnly: true, readOnlyRoot: true, temporaryBytes: PRODUCER_LIMITS.temporaryBytes, sharedMemoryBytes: PRODUCER_LIMITS.sharedMemoryBytes };
}
async function processes() {
  const names = (await fs.readdir('/proc')).filter(value => /^[1-9][0-9]*$/.test(value));
  if (names.length > PRODUCER_LIMITS.pids) fail('PRODUCER_SANDBOX_PID_LIMIT');
  const rows = [];
  for (const name of names) {
    try {
      const [status, stat, cmdline] = await Promise.all([fs.readFile(`/proc/${name}/status`, 'utf8'), fs.readFile(`/proc/${name}/stat`, 'utf8'), fs.readFile(`/proc/${name}/cmdline`)]);
      if (status.length > 65536 || stat.length > 65536 || cmdline.length > 65536) fail('PRODUCER_SANDBOX_PROC_LIMIT');
      const values = fields(status), start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
      rows.push({ pid: Number(name), parent: Number(values.get('PPid')), start, argv: cmdline.toString('utf8').split('\0').filter(Boolean) });
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error?.code)) throw error; }
  }
  return rows;
}
async function joinedProcesses(owned) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const current = await processes();
    if (!owned.some(row => current.some(value => value.pid === row.pid && value.start === row.start))) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  fail('PRODUCER_SANDBOX_BROWSER_JOIN_UNKNOWN');
}
async function hashBrowser(filename) {
  if (!filename.startsWith('/ms-playwright/') || await fs.realpath(filename) !== filename) fail('PRODUCER_SANDBOX_BROWSER_PATH');
  const before = await fs.lstat(filename, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1n || before.size > 1024n ** 3n) fail('PRODUCER_SANDBOX_BROWSER_PATH');
  const sha = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(filename)) { bytes += chunk.length; if (BigInt(bytes) > before.size) fail('PRODUCER_SANDBOX_BROWSER_CHANGED'); sha.update(chunk); }
  const after = await fs.lstat(filename, { bigint: true });
  if (BigInt(bytes) !== before.size || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key])) fail('PRODUCER_SANDBOX_BROWSER_CHANGED');
  return { sha256: sha.digest('hex'), bytes };
}

/** Fixed diagnostic only: no argument accepts a URL, script, executable or model.
 * This verifies Chromium/WebGL isolation; it does NOT qualify SDK extraction. */
export async function runSandboxProbe() {
  if (process.argv.length !== 2) fail('PRODUCER_SANDBOX_ARGUMENTS');
  const isolation = await isolationFacts();
  const require = createRequire(import.meta.url), packageFile = require.resolve('playwright-core/package.json');
  const package_ = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  if (package_.version !== '1.64.0') fail('PRODUCER_SANDBOX_PACKAGE_VERSION');
  const { chromium } = await import('playwright-core');
  const implementation = await hashBrowser(chromium.executablePath());
  const initial = new Map((await processes()).map(row => [row.pid, row.start]));
  let browser, context, owned = [], blockedRequests = 0, cancelled = false;
  const html = '<!doctype html><meta charset="utf-8"><title>WFC producer isolation probe</title><canvas id="canvas" width="64" height="64"></canvas><output id="result"></output><script src="/probe.js"></script>';
  const script = "const c=document.getElementById('canvas');const gl=c.getContext('webgl2')||c.getContext('webgl');document.getElementById('result').textContent=JSON.stringify({webgl:Boolean(gl),version:gl?gl.getParameter(gl.VERSION):null,renderer:gl?gl.getParameter(gl.RENDERER):null});";
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; object-src 'none'; base-uri 'none'");
    if (req.method !== 'GET' || !['/probe', '/probe.js'].includes(req.url)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', req.url === '/probe.js' ? 'application/javascript' : 'text/html');
    res.end(req.url === '/probe.js' ? script : html);
  });
  const stop = () => { cancelled = true; void browser?.close().catch(() => undefined); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const wall = setTimeout(stop, PRODUCER_LIMITS.wallMilliseconds); wall.unref();
  let result;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true, timeout: 45000,
      ignoreDefaultArgs: ['--disable-dev-shm-usage'],
      args: ['--disable-background-networking', '--disable-quic', '--no-first-run', '--no-default-browser-check', '--lang=en-US'] });
    context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await context.route('**/*', route => {
      const request = route.request(); let value;
      try { value = new URL(request.url()); } catch { return route.abort('blockedbyclient'); }
      if (request.method() === 'GET' && value.origin === origin && ['/probe', '/probe.js'].includes(value.pathname) && !value.search && !value.hash) return route.continue();
      blockedRequests++; return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('popup', popup => void popup.close());
    await page.goto(origin + '/probe', { waitUntil: 'load', timeout: 45000 });
    await page.locator('#result').filter({ hasText: 'webgl' }).waitFor({ timeout: 15000 });
    const webgl = JSON.parse(await page.locator('#result').textContent());
    if (webgl.webgl !== true || typeof webgl.version !== 'string' || typeof webgl.renderer !== 'string') fail('PRODUCER_SANDBOX_WEBGL_UNAVAILABLE');
    await page.goto('chrome://sandbox/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const sandbox = parseSandboxStatus(await page.locator('body').innerText({ timeout: 15000 }));
    const current = await processes();
    owned = current.filter(row => initial.get(row.pid) !== row.start && row.pid !== process.pid);
    if (!owned.length) fail('PRODUCER_SANDBOX_PROCESS_EVIDENCE');
    owned.forEach(row => assertSafeBrowserArguments(row.argv));
    if (!owned.some(row => row.argv.some(value => value === '--remote-debugging-pipe'))) fail('PRODUCER_SANDBOX_PIPE_REQUIRED');
    if (cancelled) fail('PRODUCER_SANDBOX_CANCELLED');
    result = { status: 'PASS', scope: 'Actual Chromium isolation/WebGL probe only; SDK/model extraction is not performed.',
      packageVersion: package_.version, browserVersion: browser.version(), browserImplementation: implementation,
      sandbox, isolation, webgl, ownedProcessesObserved: owned.length,
      browserArgumentsSha256: digest(JSON.stringify(owned.map(row => row.argv))), blockedRequests };
  } finally {
    clearTimeout(wall); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    if (context) void context.close().catch(() => undefined);
    let browserCloseUnknown = false, closeTimer;
    if (browser) {
      try { await Promise.race([browser.close(), new Promise((_, reject) => { closeTimer = setTimeout(() => reject(new Error('close')), 10000); })]); }
      catch { browserCloseUnknown = true; }
      finally { if (closeTimer !== undefined) clearTimeout(closeTimer); }
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (owned.length) await joinedProcesses(owned);
    if (browserCloseUnknown) fail('PRODUCER_SANDBOX_BROWSER_JOIN_UNKNOWN');
  }
  if (cancelled) fail('PRODUCER_SANDBOX_CANCELLED');
  return result;
}

async function main() {
  const attemptId = process.env.WFC_PRODUCER_ATTEMPT_ID;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(attemptId ?? '')) fail('PRODUCER_SANDBOX_IDENTITY');
  let sequence = 0;
  const write = async (type, payload) => {
    const bytes = encodeProducerFrame({ schemaVersion: PRODUCER_WIRE_VERSION, attemptId, sequence: sequence++, type, requestId: null, payload });
    if (!process.stdout.write(bytes)) await once(process.stdout, 'drain');
  };
  await write('ready', { kind: 'sandbox-probe', protocolVersion: PRODUCER_WIRE_VERSION });
  try { await write('done', await runSandboxProbe()); }
  catch (error) {
    const code = typeof error?.code === 'string' && /^PRODUCER_[A-Z0-9_]{1,95}$/.test(error.code) ? error.code : 'PRODUCER_SANDBOX_PROBE_FAILED';
    // The fixed probe has no model/session credentials. Keep bounded launch
    // diagnostics here so an actual sandbox refusal is distinguishable from
    // a protocol or WebGL failure; never expose this field in product APIs.
    const diagnostic=String(error?.message??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,8192);
    await write('error', { status: 'FAIL', code, diagnostic }); process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => { process.exitCode = 1; });
}
