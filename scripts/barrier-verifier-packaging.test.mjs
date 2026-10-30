import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production API ships and configures the complete standalone barrier verifier and runs both native lanes at build time', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const builder = dockerfile.split(/FROM mcr\.microsoft\.com\/dotnet\/runtime:/)[0];
  const api = dockerfile.split(/ AS api-runtime\r?\n/)[1].split(/\r?\nFROM /)[0];
  // ModelRunner's project reference alone does not configure the server's separate
  // verifier executor or guarantee the executable's own runtime/dependency files.
  assert.match(builder, /dotnet publish src\/PathFinder\.BarrierVerifier\/PathFinder\.BarrierVerifier\.csproj[^\r\n]*--output \/barrier-verifier[^\r\n]*--no-self-contained/);
  assert.match(api, /PF_BARRIER_VERIFIER_DLL=\/opt\/pathfinder\/barriers\/PathFinder\.BarrierVerifier\.dll/);
  assert.match(api, /COPY --from=tray-engine-build \/barrier-verifier \/opt\/pathfinder\/barriers/);
  assert.match(api, /COPY scripts\/barrier-verifier-container-check\.mjs/);
  assert.match(api, /USER node\s+(?:#[^\r\n]*\s+)?RUN node scripts\/barrier-verifier-container-check\.mjs/);
});
