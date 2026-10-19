import { PathFinderError } from './errors.js';

export const POLICY_BODY_BYTES = 1024 * 1024;

/** Reject duplicate decoded members before JSON.parse can discard evidence. */
export function parsePolicyJson(bytes: Buffer, { maxBytes = POLICY_BODY_BYTES }: { maxBytes?: number } = {}): unknown {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 90 * 1024 * 1024) throw new PathFinderError('INVALID_JSON_LIMIT', 500);
  if (bytes.length > maxBytes) throw new PathFinderError('POLICY_BODY_TOO_LARGE', 413, 'The request exceeds the upload limit.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new PathFinderError('INVALID_POLICY_JSON', 400, 'Use valid UTF-8 JSON.'); }
  let at = 0;
  const invalid = (): never => { throw new PathFinderError('INVALID_POLICY_JSON', 400, 'Use valid JSON without duplicate members.'); };
  const space = () => { while (at < text.length && /[\x20\x09\x0a\x0d]/.test(text[at])) at++; };
  const string = (): string => {
    if (text[at] !== '"') return invalid();
    const start = at++;
    while (at < text.length) {
      const ch = text[at++];
      if (ch === '\\') at++;
      else if (ch === '"') {
        try { return JSON.parse(text.slice(start, at)) as string; } catch { return invalid(); }
      }
    }
    return invalid();
  };
  const value = (depth: number): void => {
    if (depth > 48) invalid();
    space();
    if (text[at] === '{') {
      at++; space(); const keys = new Set<string>();
      if (text[at] === '}') { at++; return; }
      while (at < text.length) {
        space(); const key = string();
        if (keys.has(key)) throw new PathFinderError('DUPLICATE_JSON_MEMBER', 400, 'JSON members must be unique.');
        keys.add(key); space(); if (text[at++] !== ':') invalid(); value(depth + 1); space();
        const next = text[at++]; if (next === '}') return; if (next !== ',') invalid();
      }
      invalid();
    } else if (text[at] === '[') {
      at++; space(); if (text[at] === ']') { at++; return; }
      while (at < text.length) { value(depth + 1); space(); const next = text[at++]; if (next === ']') return; if (next !== ',') invalid(); }
      invalid();
    } else if (text[at] === '"') { string(); }
    else {
      const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at))?.[0];
      if (!token) invalid(); at += token!.length;
    }
  };
  value(0); space(); if (at !== text.length) invalid();
  let result: unknown; try { result = JSON.parse(text); } catch { return invalid(); }
  const finite = (item: unknown): void => {
    if (typeof item === 'number' && !Number.isFinite(item)) invalid();
    if (item && typeof item === 'object') for (const child of Object.values(item)) finite(child);
  };
  finite(result); return result;
}
