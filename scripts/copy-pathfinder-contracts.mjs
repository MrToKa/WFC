import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { assertCanonicalPath } from './operations/archives.mjs';

// tsc consumes .d.mts declarations but does not emit the accompanying runtime.
const source = fileURLToPath(new URL('../viewer-runtime/preparation-input.mjs', import.meta.url));
const directory = fileURLToPath(new URL('../server/dist/viewer-runtime/', import.meta.url));
const destination = path.join(directory, 'preparation-input.mjs');
await assertCanonicalPath(source);
await assertCanonicalPath(path.dirname(directory), { directory: true });
await fs.mkdir(directory, { recursive: true });
await assertCanonicalPath(directory, { directory: true });
try { await assertCanonicalPath(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const temporary = path.join(directory, randomUUID() + '.tmp');
await fs.copyFile(source, temporary, constants.COPYFILE_EXCL);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = digest(await fs.readFile(source));
if (digest(await fs.readFile(temporary)) !== expected) throw Error('PATHFINDER_CONTRACT_COPY_INTEGRITY');
await fs.rename(temporary, destination);
await assertCanonicalPath(destination);
if (digest(await fs.readFile(destination)) !== expected) throw Error('PATHFINDER_CONTRACT_COPY_INTEGRITY');
// Import the compiled producer now, while a missing transitive runtime can still fail the build.
await import(new URL('../server/dist/server/pathfinder/preparationPublisher.js', import.meta.url).href);
console.log(JSON.stringify({ module: 'pathfinder-preparation-contract', files: 1, sha256: expected }));
