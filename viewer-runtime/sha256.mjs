const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const rotateRight = (value, bits) => (value >>> bits) | (value << (32 - bits));

function inputBytes(data) {
  if (ArrayBuffer.isView(data)) {
    // BufferSource excludes shared memory, including views backed by it.
    arrayBufferByteLength.call(data.buffer);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  // Use the ArrayBuffer brand check so buffers from another realm also work.
  arrayBufferByteLength.call(data);
  return new Uint8Array(data);
}

function fallbackDigest(data) {
  const bytes = inputBytes(data);
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  const compress = (block, offset = 0) => {
    for (let i = 0; i < 16; i++) {
      const position = offset + i * 4;
      words[i] = (block[position] << 24) | (block[position + 1] << 16) | (block[position + 2] << 8) | block[position + 3];
    }
    for (let i = 16; i < 64; i++) {
      const first = words[i - 15], second = words[i - 2];
      const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
      const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
      words[i] = (words[i - 16] + sigma0 + words[i - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first = (h + sigma1 + choose + ROUND_CONSTANTS[i] + words[i]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0;
      d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  };

  const completeLength = bytes.byteLength - (bytes.byteLength % 64);
  for (let offset = 0; offset < completeLength; offset += 64) compress(bytes, offset);
  // Only the final block(s) need copying, even for a large geometry payload.
  const tail = new Uint8Array(64), remaining = bytes.byteLength - completeLength;
  tail.set(bytes.subarray(completeLength));
  tail[remaining] = 0x80;
  if (remaining >= 56) { compress(tail); tail.fill(0); }
  const tailView = new DataView(tail.buffer);
  tailView.setUint32(56, Math.floor(bytes.byteLength / 0x20000000), false);
  tailView.setUint32(60, (bytes.byteLength % 0x20000000) * 8, false);
  compress(tail);
  const result = new ArrayBuffer(32), output = new DataView(result);
  for (let i = 0; i < state.length; i++) output.setUint32(i * 4, state[i], false);
  return result;
}

/** SHA-256 also works on LAN HTTP, where browsers omit crypto.subtle. */
export async function digestSha256(data, cryptoProvider = globalThis.crypto) {
  const subtle = cryptoProvider?.subtle;
  if (typeof subtle?.digest === 'function') return subtle.digest('SHA-256', data);
  return fallbackDigest(data);
}
