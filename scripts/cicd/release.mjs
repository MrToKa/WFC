import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function makeRelease({ repository, commit, compatibility, images }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid source identity.');
  if (!/^[a-z0-9-]{1,64}$/.test(compatibility)) throw new Error('Invalid compatibility contract.');
  const owner = repository.split('/')[0].toLowerCase();
  if (!images || !Object.keys(images).length) throw new Error('Release has no images.');
  for (const [service, image] of Object.entries(images)) {
    if (!/^[a-z][a-z0-9-]*$/.test(service) || !new RegExp(`^ghcr\\.io/${owner}/[a-z0-9-]+@sha256:[a-f0-9]{64}$`).test(image)) throw new Error('Images must use an owned registry path and immutable digest.');
  }
  return { schemaVersion: 1, repository, commit, compatibility, images };
}

async function main() {
  const [compatibility, output, ...entries] = process.argv.slice(2);
  const images = {};
  for (const entry of entries) {
    const [service, imageName, metadataPath, ...extra] = entry.split('=');
    if (extra.length || !service || !imageName || !metadataPath || Object.hasOwn(images, service)) throw new Error('Use SERVICE=IMAGE=BUILDX_METADATA_FILE.');
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    images[service] = `${imageName}@${metadata['containerimage.digest']}`;
  }
  const release = makeRelease({ repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA, compatibility, images });
  await fs.writeFile(output, JSON.stringify(release, null, 2) + '\n', { flag: 'wx' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
