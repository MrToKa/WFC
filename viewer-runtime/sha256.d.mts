export function digestSha256(data: BufferSource, cryptoProvider?: { subtle?: Pick<SubtleCrypto, 'digest'> | null } | null): Promise<ArrayBuffer>;
