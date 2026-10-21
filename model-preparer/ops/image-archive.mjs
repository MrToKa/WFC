import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fail, noLinks, parseJson, relative, sameStamp } from './common.mjs';

const number = buffer => {
  const text = buffer.toString('ascii').replace(/\0.*$/, '').trim(); if (!/^[0-7]*$/.test(text)) fail('UNSAFE_IMAGE_ARCHIVE');
  const value = text ? parseInt(text, 8) : 0; if (!Number.isSafeInteger(value)) fail('UNSAFE_IMAGE_ARCHIVE'); return value;
};
/** Inspect only the outer Docker-save tar. Never extract it or accept saved tags. */
export async function inspectImageArchive(filename, imageId) {
  const before = await noLinks(filename); if (before.size > 32 * 1024 ** 3) fail('LIMIT_EXCEEDED');
  const handle = await fs.open(filename, 'r'); let offset = 0, count = 0, zeros = 0, manifest;
  const digests = new Map(), locations = new Map();
  const read = async (position, length) => { const buffer = Buffer.alloc(length), result = await handle.read(buffer, 0, length, position); if (result.bytesRead !== length) fail('UNSAFE_IMAGE_ARCHIVE'); return buffer; };
  try {
    if (!sameStamp(before, await handle.stat())) fail('INPUT_CHANGED');
    while (offset + 512 <= before.size) {
      const header = await read(offset, 512); offset += 512;
      if (header.every(byte => byte === 0)) { zeros++; if (zeros >= 2) break; continue; }
      if (zeros || ++count > 100000) fail('UNSAFE_IMAGE_ARCHIVE');
      const expected = number(header.subarray(148, 156)); let checksum = 0;
      for (let n = 0; n < 512; n++) checksum += n >= 148 && n < 156 ? 32 : header[n]; if (checksum !== expected) fail('UNSAFE_IMAGE_ARCHIVE');
      const text = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/, '');
      const prefix = text(345, 500), short = text(0, 100), rawName = prefix ? `${prefix}/${short}` : short;
      const name = relative(rawName.replace(/\/$/, '')), type = text(156, 157), size = number(header.subarray(124, 136));
      if (!['', '0', '5'].includes(type) || type === '5' && size !== 0 || offset + size > before.size || digests.has(name)) fail('UNSAFE_IMAGE_ARCHIVE');
      const hash = createHash('sha256'), chunks = []; let left = size, position = offset;
      if (name === 'manifest.json' && size > 1024 ** 2) fail('UNSAFE_IMAGE_ARCHIVE');
      while (left) { const chunk = await read(position, Math.min(left, 1024 ** 2)); hash.update(chunk); if (name === 'manifest.json') chunks.push(chunk); position += chunk.length; left -= chunk.length; }
      digests.set(name, hash.digest('hex'));
      locations.set(name, { offset, size, type });
      if (name === 'manifest.json') manifest = parseJson(Buffer.concat(chunks));
      offset += Math.ceil(size / 512) * 512;
    }
    if (zeros < 2 || !Array.isArray(manifest) || manifest.length !== 1) fail('UNSAFE_IMAGE_ARCHIVE');
    const item = manifest[0];
    if (!item || typeof item.Config !== 'string' || !Array.isArray(item.Layers) || item.RepoTags !== null && (!Array.isArray(item.RepoTags) || item.RepoTags.length)) fail('IMAGE_TAGS_REFUSED');
    relative(item.Config); for (const layer of item.Layers) { relative(layer); if (!digests.has(layer)) fail('UNSAFE_IMAGE_ARCHIVE'); }
    if (locations.has('repositories')) fail('IMAGE_TAGS_REFUSED');
    const configLocation = locations.get(item.Config);
    if (!configLocation || !['', '0'].includes(configLocation.type) || configLocation.size > 1024 ** 2) fail('UNSAFE_IMAGE_ARCHIVE');
    const config = parseJson(await read(configLocation.offset, configLocation.size));
    if (config.os !== 'linux' || !['amd64', 'arm64'].includes(config.architecture)) fail('WRONG_PLATFORM');
    let identityBasis = 'docker-config-digest';
    if (`sha256:${digests.get(item.Config)}` !== imageId) {
      if (!locations.has('index.json')) fail('WRONG_IMAGE');
      // Docker Desktop's containerd store exposes the OCI index as image ID.
      // Verify that exact index and its complete descriptor closure instead of
      // substituting a config ID or trusting a source tag.
      const jsonEntry = async name => {
        const entry = locations.get(name); if (!entry || !['', '0'].includes(entry.type) || entry.size > 1024 ** 2) fail('UNSAFE_IMAGE_ARCHIVE');
        return parseJson(await read(entry.offset, entry.size));
      };
      const rejectTags = value => { if (value.annotations && Object.keys(value.annotations).some(key => /(?:ref\.name|image\.name|tag)/i.test(key))) fail('IMAGE_TAGS_REFUSED'); };
      const index = await jsonEntry('index.json'); rejectTags(index);
      if (index.schemaVersion !== 2 || index.mediaType !== 'application/vnd.oci.image.index.v1+json' || !Array.isArray(index.manifests) || index.manifests.length !== 1 || index.manifests[0].digest !== imageId) fail('WRONG_IMAGE');
      const imageIndexType = 'application/vnd.oci.image.index.v1+json', imageManifestType = 'application/vnd.oci.image.manifest.v1+json';
      const visited = new Set(), runnable = [];
      const descriptor = async (entry, depth, platform = null, attestation = false) => {
        if (!entry || typeof entry !== 'object' || !/^sha256:[a-f0-9]{64}$/.test(entry.digest ?? '') || !Number.isSafeInteger(entry.size) || entry.size < 0 || depth > 8 || visited.size > 1000) fail('UNSAFE_IMAGE_ARCHIVE');
        rejectTags(entry);
        const hash = entry.digest.slice(7), name = `blobs/sha256/${hash}`, location = locations.get(name);
        if (!location || location.size !== entry.size || digests.get(name) !== hash || !['', '0'].includes(location.type)) fail('UNSAFE_IMAGE_ARCHIVE');
        if (visited.has(hash)) return; visited.add(hash);
        if (entry.mediaType === imageIndexType) {
          const value = await jsonEntry(name); rejectTags(value);
          if (value.schemaVersion !== 2 || value.mediaType !== imageIndexType || !Array.isArray(value.manifests) || !value.manifests.length || value.manifests.length > 100) fail('UNSAFE_IMAGE_ARCHIVE');
          for (const child of value.manifests) await descriptor(child, depth + 1, child.platform ?? null, child.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest');
        } else if (entry.mediaType === imageManifestType) {
          const value = await jsonEntry(name); rejectTags(value);
          if (value.schemaVersion !== 2 || value.mediaType !== imageManifestType || !value.config || !Array.isArray(value.layers) || value.layers.length > 1000) fail('UNSAFE_IMAGE_ARCHIVE');
          await descriptor(value.config, depth + 1); for (const layer of value.layers) await descriptor(layer, depth + 1);
          if (platform?.os === config.os && platform?.architecture === config.architecture && !attestation) runnable.push(value);
          else if (!attestation || platform?.os !== 'unknown' || platform?.architecture !== 'unknown') fail('WRONG_PLATFORM');
        } else if (!['application/vnd.oci.image.config.v1+json', 'application/vnd.oci.image.layer.v1.tar+gzip', 'application/vnd.oci.image.layer.v1.tar', 'application/vnd.in-toto+json'].includes(entry.mediaType)) fail('UNSAFE_IMAGE_ARCHIVE');
      };
      await descriptor(index.manifests[0], 0);
      if (runnable.length !== 1 || runnable[0].config.digest !== `sha256:${digests.get(item.Config)}` || runnable[0].layers.map(value => `blobs/sha256/${value.digest.slice(7)}`).join(',') !== item.Layers.join(',')) fail('WRONG_IMAGE');
      identityBasis = 'oci-index-closure';
    } else if (locations.has('index.json')) fail('UNSAFE_IMAGE_ARCHIVE');
    // GNU tar padding is permitted only when it is entirely zero.
    while (offset < before.size) { const bytes = await read(offset, Math.min(1024 ** 2, before.size - offset)); if (bytes.some(byte => byte !== 0)) fail('UNSAFE_IMAGE_ARCHIVE'); offset += bytes.length; }
    if (!sameStamp(before, await handle.stat()) || !sameStamp(before, await fs.lstat(filename))) fail('INPUT_CHANGED');
    return { imageId, configDigest: `sha256:${digests.get(item.Config)}`, identityBasis, os: config.os, architecture: config.architecture, entries: count, savedTags: 0 };
  } finally { await handle.close(); }
}
