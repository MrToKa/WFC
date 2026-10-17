import { open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform, pipeline } from 'node:stream';
import { createInflateRaw, crc32 as updateCrc } from 'node:zlib';
import { PackageError, fail } from './errors.mjs';
import { DEFAULT_LIMITS, resolveLimits } from './limits.mjs';
import { validateArchivePath, assertNoCaseCollisions, assertLocalNoLinks } from './paths.mjs';

// Directory records are inspected incrementally. This is a parser memory/work
// guard, independent of the portable manifest and raw resource size limits.
export const MAX_CENTRAL_DIRECTORY_BYTES = 100 * 1024 * 1024;
export const MAX_LOCAL_PADDING_BYTES = 64 * 1024;
const CHUNK_BYTES = 64 * 1024;
const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, END = 0x06054b50;
const ZIP64_END = 0x06064b50, ZIP64_LOCATOR = 0x07064b50, DESCRIPTOR = 0x08074b50;

function invalid(message, details = {}) { fail('INVALID_MANIFEST', `ZIP: ${message}`, details); }
function limited(message, details = {}) { fail('PACKAGE_LIMIT_EXCEEDED', `ZIP: ${message}`, details); }
function checkWork(signal, startedAt, limits) {
  if (signal?.aborted) fail('PACKAGE_ABORTED', 'ZIP operation was aborted.');
  if (Date.now() - startedAt > limits.maxMs) limited('processing time limit exceeded.');
}
function safe64(buffer, offset, field) {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid(`${field} is not a safe integer.`);
  return Number(value);
}
function extraFields(bytes) {
  const fields = new Map();
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) invalid('truncated extra-field header.');
    const id = bytes.readUInt16LE(offset), size = bytes.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + size > bytes.length || fields.has(id)) invalid('invalid or duplicate extra field.');
    const field = bytes.subarray(offset, offset + size);
    // These Unix records can encode link/device targets; alternate Unicode path
    // declarations could make other consumers interpret a different filename.
    if ([0x000d, 0x756e, 0x7075].includes(id)) fail('UNSAFE_PATH', 'ZIP contains a link/device or alternate-path extra field.');
    fields.set(id, field);
    offset += size;
  }
  return fields;
}
function decodedName(bytes, isDirectory) {
  if (bytes.length === 0 || bytes.some(byte => byte > 0x7f)) fail('UNSAFE_PATH', 'ZIP entry names must be nonempty ASCII.');
  const name = bytes.toString('ascii');
  validateArchivePath(name, { allowDirectory: isDirectory });
  return name;
}
function checkFlags(flags, method) {
  if (method !== 0 && method !== 8) invalid('unsupported compression method.', { method });
  // Some Autodesk ZIP writers retain deflate option bits 1/2 even on their
  // zero-byte stored directory records. They do not alter stored-byte decoding.
  const allowed = 0x080e;
  if (flags & ~allowed) invalid('encrypted or unsupported general-purpose flags.', { flags });
}
function checkAttributes(attrs, directory) {
  if (attrs & 0x400) fail('UNSAFE_PATH', 'ZIP reparse-point attributes are forbidden.');
  const kind = (attrs >>> 16) & 0xf000;
  if (kind && kind !== 0x8000 && kind !== 0x4000) fail('UNSAFE_PATH', 'ZIP links, devices and special files are forbidden.');
  if ((kind === 0x4000 && !directory) || (kind === 0x8000 && directory) || ((attrs & 0x10) && !directory)) {
    fail('UNSAFE_PATH', 'ZIP file/directory attributes contradict its filename.');
  }
}
function normalizedLimits(limits) { return resolveLimits(limits ?? DEFAULT_LIMITS); }

/** Open a bounded, seekable archive. No full file-backed archive is buffered. */
export async function openZip(pathOrBuffer, { limits: suppliedLimits, signal } = {}) {
  const limits = normalizedLimits(suppliedLimits), startedAt = Date.now();
  let handle = null;
  let size;
  const memory = Buffer.isBuffer(pathOrBuffer) ? pathOrBuffer : null;
  try {
    checkWork(signal, startedAt, limits);
    if (memory) size = memory.length;
    else {
      if (typeof pathOrBuffer !== 'string') invalid('input must be a local path or Buffer.');
      await assertLocalNoLinks(pathOrBuffer);
      handle = await open(pathOrBuffer, 'r');
      const stat = await handle.stat();
      if (!stat.isFile()) fail('UNSAFE_PATH', 'ZIP input is not a regular file.');
      size = stat.size;
    }
    if (size > limits.maxArchiveBytes) limited('archive byte limit exceeded.', { size });
    if (size < 22) invalid('missing end-of-central-directory record.');
    const readAt = async (offset, length) => {
      checkWork(signal, startedAt, limits);
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) invalid('read extends outside the archive.');
      if (memory) return memory.subarray(offset, offset + length);
      const result = Buffer.allocUnsafe(length);
      for (let done = 0; done < length;) {
        checkWork(signal, startedAt, limits);
        const { bytesRead } = await handle.read(result, done, length - done, offset + done);
        if (!bytesRead) invalid('archive was truncated during reading.');
        done += bytesRead;
      }
      return result;
    };

    const tailStart = Math.max(0, size - 22 - 65535);
    const tail = await readAt(tailStart, size - tailStart);
    let endOffset = -1;
    for (let offset = tail.length - 22; offset >= 0; offset--) {
      if (tail.readUInt32LE(offset) === END && offset + 22 + tail.readUInt16LE(offset + 20) === tail.length) {
        endOffset = tailStart + offset;
        break;
      }
    }
    if (endOffset < 0) invalid('missing, truncated or trailing end record.');
    const end = await readAt(endOffset, 22);
    if (end.readUInt16LE(4) || end.readUInt16LE(6)) invalid('multi-disk ZIP is unsupported.');
    let count = end.readUInt16LE(10), cdBytes = end.readUInt32LE(12), cdOffset = end.readUInt32LE(16);
    if (end.readUInt16LE(8) !== count) invalid('disk entry counts do not agree.');
    let centralEnd = endOffset;
    if (count === 0xffff || cdBytes === 0xffffffff || cdOffset === 0xffffffff) {
      if (endOffset < 20) invalid('missing ZIP64 locator.');
      const locator = await readAt(endOffset - 20, 20);
      if (locator.readUInt32LE(0) !== ZIP64_LOCATOR || locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) invalid('invalid or multi-disk ZIP64 locator.');
      const zip64Offset = safe64(locator, 8, 'ZIP64 end offset');
      const record = await readAt(zip64Offset, 56);
      const recordBytes = safe64(record, 4, 'ZIP64 record length') + 12;
      if (record.readUInt32LE(0) !== ZIP64_END || recordBytes < 56 || recordBytes > MAX_CENTRAL_DIRECTORY_BYTES || zip64Offset + recordBytes !== endOffset - 20) invalid('invalid ZIP64 end record.');
      if (record.readUInt32LE(16) || record.readUInt32LE(20)) invalid('multi-disk ZIP64 is unsupported.');
      const diskCount = safe64(record, 24, 'ZIP64 disk count');
      const actualCount = safe64(record, 32, 'ZIP64 entry count');
      const actualBytes = safe64(record, 40, 'ZIP64 central size');
      const actualOffset = safe64(record, 48, 'ZIP64 central offset');
      if (diskCount !== actualCount || (count !== 0xffff && count !== actualCount) || (cdBytes !== 0xffffffff && cdBytes !== actualBytes) || (cdOffset !== 0xffffffff && cdOffset !== actualOffset)) invalid('ZIP32 and ZIP64 end records disagree.');
      count = actualCount; cdBytes = actualBytes; cdOffset = actualOffset; centralEnd = zip64Offset;
    }
    // The resource-file cap excludes the root manifest. A separately bounded
    // number of directory records is permitted; directories have zero payload.
    if (count > 2 * limits.maxFiles + 1) limited('entry count limit exceeded.', { count });
    if (cdBytes > MAX_CENTRAL_DIRECTORY_BYTES) limited('central-directory metadata exceeds 100 MiB.');
    if (cdOffset + cdBytes !== centralEnd || count * 46 > cdBytes) invalid('invalid central-directory bounds.');

    const records = new Map(), folded = new Set();
    let cursor = cdOffset, declaredTotal = 0, resourceFiles = 0, directories = 0;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > centralEnd) invalid('truncated central-directory record.');
      const header = await readAt(cursor, 46);
      if (header.readUInt32LE(0) !== CENTRAL) invalid('invalid central-directory signature.');
      const needed = header.readUInt16LE(6), flags = header.readUInt16LE(8), method = header.readUInt16LE(10);
      checkFlags(flags, method);
      if (needed > 45) invalid('unsupported ZIP extraction version.');
      const crc = header.readUInt32LE(16);
      let compressedBytes = header.readUInt32LE(20), bytes = header.readUInt32LE(24), offset = header.readUInt32LE(42);
      let disk = header.readUInt16LE(34);
      const nameLength = header.readUInt16LE(28), extraLength = header.readUInt16LE(30), commentLength = header.readUInt16LE(32);
      if (nameLength > 1024 || cursor + 46 + nameLength + extraLength + commentLength > centralEnd) invalid('invalid central-directory name or variable fields.');
      const variable = await readAt(cursor + 46, nameLength + extraLength);
      const nameBytes = variable.subarray(0, nameLength);
      const isDirectory = nameBytes.at(-1) === 0x2f;
      const name = decodedName(nameBytes, isDirectory);
      const fields = extraFields(variable.subarray(nameLength));
      const zip64 = fields.get(1);
      const needs64 = bytes === 0xffffffff || compressedBytes === 0xffffffff || offset === 0xffffffff || disk === 0xffff;
      if (needs64) {
        if (!zip64) invalid('missing ZIP64 entry size/offset field.');
        let position = 0;
        const take = field => {
          if (position + 8 > zip64.length) invalid('truncated ZIP64 entry field.');
          const value = safe64(zip64, position, field); position += 8; return value;
        };
        if (bytes === 0xffffffff) bytes = take('uncompressed size');
        if (compressedBytes === 0xffffffff) compressedBytes = take('compressed size');
        if (offset === 0xffffffff) offset = take('local-header offset');
        if (disk === 0xffff) {
          if (position + 4 > zip64.length) invalid('truncated ZIP64 disk number.');
          disk = zip64.readUInt32LE(position); position += 4;
        }
        if (position !== zip64.length) invalid('unexpected ZIP64 entry field data.');
      } else if (zip64) invalid('unexpected ZIP64 central entry field.');
      if (disk !== 0) invalid('multi-disk entry is unsupported.');
      checkAttributes(header.readUInt32LE(38), isDirectory);
      const lower = name.replace(/\/$/, '').toLowerCase();
      if (records.has(name) || folded.has(lower)) fail('UNSAFE_PATH', 'ZIP contains duplicate or case-colliding entries.', { name });
      folded.add(lower);
      if (bytes > limits.maxFileBytes) limited('entry byte limit exceeded.', { name, bytes });
      if (name === 'manifest.json' && bytes > limits.maxManifestBytes) limited('root manifest byte limit exceeded.');
      if (isDirectory && (bytes !== 0 || crc !== 0)) invalid('directory entry has content.', { name });
      if (isDirectory) directories++;
      else if (name !== 'manifest.json') resourceFiles++;
      if (resourceFiles > limits.maxFiles || directories > limits.maxFiles) limited('file or directory count limit exceeded.');
      if (method === 0 && compressedBytes !== bytes) invalid('stored entry sizes disagree.', { name });
      if (bytes > compressedBytes * limits.maxExpansionRatio) limited('declared expansion ratio exceeded.', { name });
      if (!isDirectory && name !== 'manifest.json') declaredTotal += bytes;
      if (declaredTotal > limits.maxTotalResourceBytes) limited('total resource byte limit exceeded.');
      if (offset >= cdOffset) invalid('local header overlaps central directory.', { name });
      records.set(name, { name, compressedBytes, bytes, crc32: crc, method, isDirectory, flags, needed,
        dosTime: header.readUInt16LE(12), dosDate: header.readUInt16LE(14), offset, nameBytes: Buffer.from(nameBytes) });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    if (cursor !== centralEnd) invalid('central-directory record count/size mismatch.');
    assertNoCaseCollisions([...records.keys()]);

    const ordered = [...records.values()].sort((a, b) => a.offset - b.offset);
    let expectedOffset = 0, totalPadding = 0;
    const checkPadding = async (from, to, name) => {
      const bytes = to - from;
      if (bytes < 0) invalid('overlapping local records.', { name });
      totalPadding += bytes;
      if (totalPadding > MAX_LOCAL_PADDING_BYTES) limited('zero alignment padding exceeds 64 KiB.');
      if (bytes && (await readAt(from, bytes)).some(value => value !== 0)) invalid('nonzero hidden bytes between local records.', { name });
    };
    for (let index = 0; index < ordered.length; index++) {
      const entry = ordered[index], nextOffset = ordered[index + 1]?.offset ?? cdOffset;
      if (entry.offset !== expectedOffset) invalid('overlapping, hidden or gapped local records.', { name: entry.name });
      if (entry.offset + 30 > nextOffset) invalid('truncated local header.', { name: entry.name });
      const local = await readAt(entry.offset, 30);
      const nameLength = local.readUInt16LE(26), extraLength = local.readUInt16LE(28);
      if (local.readUInt32LE(0) !== LOCAL || local.readUInt16LE(6) !== entry.flags || local.readUInt16LE(8) !== entry.method ||
        local.readUInt16LE(4) !== entry.needed || local.readUInt16LE(10) !== entry.dosTime || local.readUInt16LE(12) !== entry.dosDate) invalid('central/local headers disagree.', { name: entry.name });
      entry.dataOffset = entry.offset + 30 + nameLength + extraLength;
      if (entry.dataOffset + entry.compressedBytes > nextOffset) invalid('entry data overlaps the next record.', { name: entry.name });
      const variable = await readAt(entry.offset + 30, nameLength + extraLength);
      if (!variable.subarray(0, nameLength).equals(entry.nameBytes)) invalid('central/local filenames disagree.', { name: entry.name });
      const fields = extraFields(variable.subarray(nameLength));
      let localCompressed = local.readUInt32LE(18), localBytes = local.readUInt32LE(22);
      const local64 = localCompressed === 0xffffffff || localBytes === 0xffffffff;
      if (local64) {
        const field = fields.get(1);
        if (!field || field.length !== 16) invalid('invalid local ZIP64 sizes.', { name: entry.name });
        localBytes = safe64(field, 0, 'local uncompressed size');
        localCompressed = safe64(field, 8, 'local compressed size');
      } else if (fields.has(1)) invalid('unexpected local ZIP64 field.', { name: entry.name });
      const localCrc = local.readUInt32LE(14), usesDescriptor = Boolean(entry.flags & 8);
      if (usesDescriptor) {
        if ((localCrc !== 0 && localCrc !== entry.crc32) || (localBytes !== 0 && localBytes !== entry.bytes) || (localCompressed !== 0 && localCompressed !== entry.compressedBytes)) invalid('local descriptor placeholders disagree.', { name: entry.name });
        const descriptorOffset = entry.dataOffset + entry.compressedBytes;
        const available = nextOffset - descriptorOffset;
        const descriptor = await readAt(descriptorOffset, Math.min(24, available));
        let descriptorLength = 0;
        for (const length of local64 ? [24, 20] : [16, 12, 24, 20]) {
          if (length > descriptor.length) continue;
          const signed = length === 16 || length === 24, wide = length === 20 || length === 24, base = signed ? 4 : 0;
          if (signed && descriptor.readUInt32LE(0) !== DESCRIPTOR) continue;
          const crc = descriptor.readUInt32LE(base);
          const compressed = wide ? descriptor.readBigUInt64LE(base + 4) : BigInt(descriptor.readUInt32LE(base + 4));
          const inflated = wide ? descriptor.readBigUInt64LE(base + 12) : BigInt(descriptor.readUInt32LE(base + 8));
          if (crc === entry.crc32 && compressed === BigInt(entry.compressedBytes) && inflated === BigInt(entry.bytes)) { descriptorLength = length; break; }
        }
        if (!descriptorLength) invalid('data descriptor disagrees with central metadata.', { name: entry.name });
        await checkPadding(descriptorOffset + descriptorLength, nextOffset, entry.name);
        expectedOffset = nextOffset;
      } else {
        if (localCrc !== entry.crc32 || localBytes !== entry.bytes || localCompressed !== entry.compressedBytes) invalid('central/local entry sizes or CRC disagree.', { name: entry.name });
        expectedOffset = entry.dataOffset + entry.compressedBytes;
        await checkPadding(expectedOffset, nextOffset, entry.name);
        expectedOffset = nextOffset;
      }
      delete entry.nameBytes;
      Object.freeze(entry);
    }
    if (expectedOffset !== cdOffset) invalid('local records do not reach the central directory.');

    let closed = false, actualTotal = 0;
    const progressByName = new Map(), activeStreams = new Set();
    const stream = (name, { maxBytes = limits.maxFileBytes, signal: readSignal = signal } = {}) => {
      if (closed) invalid('archive is closed.');
      const entry = records.get(name);
      if (!entry) fail('RESOURCE_MISSING', 'ZIP entry is missing.', { name });
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > limits.maxFileBytes) limited('invalid read byte limit.');
      if (entry.bytes > maxBytes) limited('entry exceeds the requested read limit.', { name });
      let actual = 0, crc = 0;
      const source = Readable.from((async function* () {
        for (let offset = 0; offset < entry.compressedBytes;) {
          checkWork(readSignal, startedAt, limits);
          checkWork(signal, startedAt, limits);
          const length = Math.min(CHUNK_BYTES, entry.compressedBytes - offset);
          yield await readAt(entry.dataOffset + offset, length);
          offset += length;
        }
      })());
      const inflater = entry.method === 8 ? createInflateRaw() : null;
      const validator = new Transform({
        transform(chunk, encoding, callback) {
          try {
            checkWork(readSignal, startedAt, limits); checkWork(signal, startedAt, limits);
            actual += chunk.length;
            if (actual > maxBytes || actual > limits.maxFileBytes) limited('actual inflated bytes exceed the read limit.', { name });
            if (actual > entry.compressedBytes * limits.maxExpansionRatio) limited('actual expansion ratio exceeded.', { name });
            if (actual > entry.bytes) fail('RESOURCE_SIZE_MISMATCH', 'ZIP entry inflated beyond its declared size.', { name });
            if (!entry.isDirectory && name !== 'manifest.json') {
              const previous = progressByName.get(name) ?? 0;
              if (actual > previous) { actualTotal += actual - previous; progressByName.set(name, actual); }
              if (actualTotal > limits.maxTotalResourceBytes) limited('actual total resource bytes exceeded.');
            }
            crc = updateCrc(chunk, crc);
            callback(null, chunk);
          } catch (error) { callback(error); }
        },
        flush(callback) {
          try {
            checkWork(readSignal, startedAt, limits); checkWork(signal, startedAt, limits);
            if (actual !== entry.bytes) fail('RESOURCE_SIZE_MISMATCH', 'ZIP entry actual size differs from its metadata.', { name });
            if (crc !== entry.crc32) fail('RESOURCE_HASH_MISMATCH', 'ZIP entry CRC-32 mismatch.', { name });
            if (inflater && inflater.bytesWritten !== entry.compressedBytes) invalid('trailing bytes in a deflate payload.', { name });
            callback();
          } catch (error) { callback(error); }
        },
      });
      activeStreams.add(validator);
      if (inflater) inflater.on('error', error => {
        if (!(error instanceof PackageError)) validator.destroy(new PackageError('INVALID_MANIFEST', 'ZIP decompression failed.', { name }));
      });
      validator.on('error', () => {});
      validator.on('close', () => activeStreams.delete(validator));
      const abortSignals = [...new Set([signal, readSignal].filter(Boolean))];
      const abort = () => validator.destroy(new PackageError('PACKAGE_ABORTED', 'ZIP read was aborted.'));
      for (const abortSignal of abortSignals) abortSignal.addEventListener('abort', abort, { once: true });
      validator.once('close', () => {
        for (const abortSignal of abortSignals) abortSignal.removeEventListener('abort', abort);
      });
      pipeline(...[source, inflater, validator].filter(Boolean), error => {
        if (error && !(error instanceof PackageError) && !validator.destroyed) validator.destroy(new PackageError('INVALID_MANIFEST', 'ZIP decompression failed.', { name }));
      });
      if (abortSignals.some(abortSignal => abortSignal.aborted)) queueMicrotask(abort);
      return validator;
    };
    const read = async (name, options = {}) => {
      const maxBytes = options.maxBytes ?? Math.min(limits.maxNestedBytes, limits.maxFileBytes);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of stream(name, { ...options, maxBytes })) { chunks.push(chunk); bytes += chunk.length; }
      return Buffer.concat(chunks, bytes);
    };
    const close = async () => {
      if (closed) return;
      closed = true;
      for (const active of activeStreams) active.destroy(new PackageError('PACKAGE_ABORTED', 'ZIP archive closed during a read.'));
      if (handle) { const owned = handle; handle = null; await owned.close(); }
    };
    // Directory metadata alone cannot prove emptiness: a deflate entry may lie
    // about bytes/CRC while carrying hidden content. Validate its actual stream
    // before exposing this archive, even to callers that only read file entries.
    for (const entry of records.values()) {
      if (!entry.isDirectory) continue;
      // Stored zero-byte directories have no encoded payload to validate.
      // Central/local bounds, bytes, compressedBytes and CRC are already proven
      // equal above; deflated directories still require actual decoder/CRC IO.
      if (entry.method === 0 && entry.bytes === 0 && entry.compressedBytes === 0 && entry.crc32 === 0) continue;
      await read(entry.name, { maxBytes: 0, signal });
    }
    return { entries: new Map(records), size, stream, read, close };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    throw error;
  }
}

/** Write stored entries without changing raw resource bytes or buffering files. */
export async function writeZip(target, entries, { limits: suppliedLimits, signal } = {}) {
  const limits = normalizedLimits(suppliedLimits), startedAt = Date.now();
  if (typeof target !== 'string' || !Array.isArray(entries)) invalid('writer requires a target path and entry array.');
  if (entries.length > 2 * limits.maxFiles + 1) limited('entry count limit exceeded.');
  assertNoCaseCollisions(entries.map(entry => entry.name));
  await assertLocalNoLinks(dirname(target), { directory: true });
  const metadata = [], folded = new Set();
  let file = null, created = false, offset = 0, totalBytes = 0, resourceFiles = 0, directories = 0;
  const put = async buffer => {
    checkWork(signal, startedAt, limits);
    if (offset + buffer.length > limits.maxArchiveBytes) limited('written archive byte limit exceeded.');
    for (let done = 0; done < buffer.length;) {
      checkWork(signal, startedAt, limits);
      const { bytesWritten } = await file.write(buffer, done, buffer.length - done, offset + done);
      if (!bytesWritten) invalid('writer made no progress.');
      done += bytesWritten;
    }
    offset += buffer.length;
  };
  try {
    file = await open(target, 'wx'); created = true;
    for (const input of entries) {
      checkWork(signal, startedAt, limits);
      const isDirectory = typeof input.name === 'string' && input.name.endsWith('/');
      const name = validateArchivePath(input.name, { allowDirectory: isDirectory });
      if (isDirectory) directories++;
      else if (name !== 'manifest.json') resourceFiles++;
      if (resourceFiles > limits.maxFiles || directories > limits.maxFiles) limited('writer file or directory count limit exceeded.');
      const lower = name.replace(/\/$/, '').toLowerCase();
      if (folded.has(lower)) fail('UNSAFE_PATH', 'ZIP writer received duplicate or case-colliding names.', { name });
      folded.add(lower);
      if ((input.path !== undefined) === (input.data !== undefined)) invalid('each writer entry requires exactly one path or Buffer.', { name });
      if (input.data !== undefined && !Buffer.isBuffer(input.data)) invalid('writer data must be a Buffer.', { name });
      let sourceHandle = null;
      try {
        let expectedBytes;
        if (input.path !== undefined) {
          await assertLocalNoLinks(input.path);
          sourceHandle = await open(input.path, 'r');
          const stat = await sourceHandle.stat();
          if (!stat.isFile()) fail('UNSAFE_PATH', 'ZIP writer input is not a regular file.');
          expectedBytes = stat.size;
        } else expectedBytes = input.data.length;
        if (expectedBytes > limits.maxFileBytes || (name === 'manifest.json' && expectedBytes > limits.maxManifestBytes)) limited('writer entry byte limit exceeded.', { name });
        if (isDirectory && expectedBytes !== 0) invalid('writer directory has content.');
        const headerOffset = offset;
        const nameBuffer = Buffer.from(name, 'ascii');
        const header = Buffer.alloc(30);
        header.writeUInt32LE(LOCAL, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0808, 6);
        header.writeUInt16LE(0x0021, 12); header.writeUInt16LE(nameBuffer.length, 26);
        await put(Buffer.concat([header, nameBuffer]));
        let bytes = 0, crc = 0;
        const consume = async chunk => {
          bytes += chunk.length;
          if (bytes > limits.maxFileBytes || bytes > expectedBytes) fail('RESOURCE_SIZE_MISMATCH', 'Writer input grew beyond its checked size.', { name });
          if (name !== 'manifest.json' && !isDirectory) totalBytes += chunk.length;
          if (totalBytes > limits.maxTotalResourceBytes) limited('writer total resource bytes exceeded.');
          crc = updateCrc(chunk, crc); await put(chunk);
        };
        if (sourceHandle) {
          for (let position = 0; position < expectedBytes;) {
            checkWork(signal, startedAt, limits);
            const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, expectedBytes - position));
            const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
            if (!bytesRead) fail('RESOURCE_SIZE_MISMATCH', 'Writer input was truncated.', { name });
            await consume(buffer.subarray(0, bytesRead)); position += bytesRead;
          }
          const finalStat = await sourceHandle.stat();
          if (finalStat.size !== expectedBytes) fail('RESOURCE_SIZE_MISMATCH', 'Writer input size changed.', { name });
        } else {
          for (let position = 0; position < input.data.length; position += CHUNK_BYTES) await consume(input.data.subarray(position, position + CHUNK_BYTES));
        }
        if (bytes !== expectedBytes) fail('RESOURCE_SIZE_MISMATCH', 'Writer input size differs from its checked size.', { name });
        const descriptor = Buffer.alloc(16);
        descriptor.writeUInt32LE(DESCRIPTOR, 0); descriptor.writeUInt32LE(crc, 4);
        descriptor.writeUInt32LE(bytes, 8); descriptor.writeUInt32LE(bytes, 12); await put(descriptor);
        metadata.push({ name, nameBuffer, bytes, crc, offset: headerOffset, isDirectory });
      } finally { if (sourceHandle) await sourceHandle.close(); }
    }
    const cdOffset = offset;
    for (const entry of metadata) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(CENTRAL, 0); header.writeUInt16LE((3 << 8) | 20, 4); header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0808, 8); header.writeUInt16LE(0x0021, 14);
      header.writeUInt32LE(entry.crc, 16); header.writeUInt32LE(entry.bytes, 20); header.writeUInt32LE(entry.bytes, 24);
      header.writeUInt16LE(entry.nameBuffer.length, 28);
      header.writeUInt32LE((((entry.isDirectory ? 0o040755 : 0o100644) << 16) | (entry.isDirectory ? 0x10 : 0x20)) >>> 0, 38);
      header.writeUInt32LE(entry.offset, 42); await put(Buffer.concat([header, entry.nameBuffer]));
      if (offset - cdOffset > MAX_CENTRAL_DIRECTORY_BYTES) limited('writer central directory exceeds 100 MiB.');
    }
    const cdBytes = offset - cdOffset;
    const useZip64 = metadata.length >= 0xffff;
    if (useZip64) {
      const zip64Offset = offset, end64 = Buffer.alloc(56);
      end64.writeUInt32LE(ZIP64_END, 0); end64.writeBigUInt64LE(44n, 4);
      end64.writeUInt16LE(45, 12); end64.writeUInt16LE(45, 14);
      end64.writeBigUInt64LE(BigInt(metadata.length), 24); end64.writeBigUInt64LE(BigInt(metadata.length), 32);
      end64.writeBigUInt64LE(BigInt(cdBytes), 40); end64.writeBigUInt64LE(BigInt(cdOffset), 48); await put(end64);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(ZIP64_LOCATOR, 0); locator.writeBigUInt64LE(BigInt(zip64Offset), 8); locator.writeUInt32LE(1, 16); await put(locator);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END, 0); end.writeUInt16LE(useZip64 ? 0xffff : metadata.length, 8); end.writeUInt16LE(useZip64 ? 0xffff : metadata.length, 10);
    end.writeUInt32LE(cdBytes, 12); end.writeUInt32LE(cdOffset, 16); await put(end);
    await file.sync(); await file.close(); file = null;
    return { entries: metadata.length, bytes: offset, totalResourceBytes: totalBytes, zip64: useZip64, centralDirectoryBytes: cdBytes };
  } catch (error) {
    if (file) await file.close().catch(() => {});
    if (created) await unlink(target).catch(() => {});
    throw error;
  }
}
