import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { applyBaseline } from './001-baseline.js';
import { applyMaterialFoundations } from './002-material-foundations.js';
import { applyTraySupportSnapshots } from './003-tray-support-snapshots.js';
import { applyMaterialRetirementProjectAccess } from './004-material-retirement-project-access.js';
import type { Queryable, SchemaShape } from './schemaInspection.js';

export type Migration = { version: number; name: string; checksum: string; apply: (client: Queryable) => Promise<void> };
const sourceChecksum = (name: string): string => createHash('sha256')
  .update(readFileSync(new URL(name, import.meta.url), 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex');
export const migrations: Migration[] = [
  { version: 1, name: 'baseline', checksum: sourceChecksum('./001-baseline.ts'), apply: applyBaseline },
  { version: 2, name: 'material-foundations', checksum: sourceChecksum('./002-material-foundations.ts'), apply: applyMaterialFoundations },
  { version: 3, name: 'tray-support-snapshots', checksum: sourceChecksum('./003-tray-support-snapshots.ts'), apply: applyTraySupportSnapshots },
  { version: 4, name: 'material-retirement-project-access', checksum: sourceChecksum('./004-material-retirement-project-access.ts'), apply: applyMaterialRetirementProjectAccess },
];

export const loadBaselineShape = (): SchemaShape => JSON.parse(
  readFileSync(new URL('./baseline-schema.json', import.meta.url), 'utf8'),
) as SchemaShape;
