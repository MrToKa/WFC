import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPackage } from '../../../server/vendor/routings-model-package/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = path.join(root, 'pathfinder-engine/.scratch/pf2-converted');
const input = process.argv[2] ?? 'C:/Users/todor.chankov/Documents/Codex/2026-10-16/routings-model-package-output/aalborg-svf-v1.zip';
await fs.mkdir(scratch, { recursive: true });
const destination = path.join(scratch, 'package');
let exists = false;
try { await fs.access(destination); exists = true; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const result = await verifyPackage(input, {
  expectedFingerprint: 'b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34',
  ...(exists ? {} : { extractTo: destination })
});
result.historicalTransportObservation = { sha256: '8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5', matched: result.package.sha256 === '8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5', note: 'Current archive and every raw resource are verified; a historical transport hash mismatch is retained explicitly and is not native/conversion provenance proof.' };
if (exists) {
  const crypto = await import('node:crypto');
  for (const resource of result.resources) {
    const copied = await fs.readFile(path.join(destination, resource.path));
    if (copied.length !== resource.bytes || crypto.createHash('sha256').update(copied).digest('hex') !== resource.sha256) throw new Error('Retained extracted resource differs: ' + resource.path);
  }
  result.retainedExtractionVerified = true;
}
let receipt = path.join(scratch, 'package-verification.json');
try { await fs.access(receipt); receipt = path.join(scratch, `package-reverification-${Date.now()}.json`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(receipt, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, bytes: result.totalRawBytes, resources: result.resourceCount, packageSha256: result.package.sha256, destination }));
