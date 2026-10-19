import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { assertCanonicalPath } from './operations/archives.mjs';

// tsc consumes .d.mts declarations but does not emit the accompanying runtime.
const directory = fileURLToPath(new URL('../server/dist/viewer-runtime/', import.meta.url));
await assertCanonicalPath(path.dirname(directory), { directory: true });
await fs.mkdir(directory, { recursive: true });
await assertCanonicalPath(directory, { directory: true });
const copied = [];
for (const name of ['preparation-input.mjs', 'capture-evidence.mjs']) {
const source = fileURLToPath(new URL('../viewer-runtime/' + name, import.meta.url));
const destination = path.join(directory, name);
await assertCanonicalPath(source);
try { await assertCanonicalPath(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const temporary = path.join(directory, randomUUID() + '.tmp');
await fs.copyFile(source, temporary, constants.COPYFILE_EXCL);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = digest(await fs.readFile(source));
if (digest(await fs.readFile(temporary)) !== expected) throw Error('PATHFINDER_CONTRACT_COPY_INTEGRITY');
await fs.rename(temporary, destination);
await assertCanonicalPath(destination);
if (digest(await fs.readFile(destination)) !== expected) throw Error('PATHFINDER_CONTRACT_COPY_INTEGRITY');
copied.push({ name, sha256: expected });
}
// Import the compiled producer now, while a missing transitive runtime can still fail the build.
await import(new URL('../server/dist/server/pathfinder/preparationPublisher.js', import.meta.url).href);
await import(new URL('../server/dist/server/pathfinder/geometryTraceRepository.js', import.meta.url).href);
await import(new URL('../server/dist/server/pathfinder/endpointBindingRepository.js', import.meta.url).href);
await import(new URL('../server/dist/server/pathfinder/revisionComparisonRepository.js', import.meta.url).href);
await import(new URL('../server/dist/server/pathfinder/revisionComparisonEndpointAdapter.js', import.meta.url).href);
await import(new URL('../server/dist/server/pathfinder/recalculationRepository.js', import.meta.url).href);
await import(new URL('../server/dist/server/pathfinder/recalculationProducer.js', import.meta.url).href);
await import(new URL('../server/dist/server/pathfinder/calculationEngineIdentity.js', import.meta.url).href);
console.log(JSON.stringify({ module: 'pathfinder-computational-contracts', files: copied.length, modules: copied }));
