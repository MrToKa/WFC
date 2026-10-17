import { fail } from './errors.mjs';

// A small RFC8259 parser keeps every key occurrence visible. Parsing first
// with JSON.parse would lose duplicate-key evidence, including escaped keys.
export function parseJson(text, { allowDuplicate, maxDepth = 16 } = {}) {
  if (typeof text !== 'string' || !Number.isSafeInteger(maxDepth) || maxDepth < 1) {
    fail('INVALID_MANIFEST', 'JSON text and a positive maximum depth are required.');
  }
  let at = 0;
  const error = (message) => fail('INVALID_MANIFEST', message, { offset: at });
  const white = () => { while (at < text.length && /[\u0020\t\r\n]/.test(text[at])) at++; };
  const childPath = (parent, key) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;

  function string() {
    if (text[at++] !== '"') error('Expected JSON string.');
    let result = '';
    while (at < text.length) {
      const char = text[at++];
      if (char === '"') return result;
      if (char.charCodeAt(0) < 32) error('Unescaped control character in JSON string.');
      if (char !== '\\') { result += char; continue; }
      const escaped = text[at++];
      const translations = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (Object.hasOwn(translations, escaped)) { result += translations[escaped]; continue; }
      if (escaped === 'u') {
        const hex = text.slice(at, at + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) error('Invalid Unicode escape in JSON string.');
        result += String.fromCharCode(Number.parseInt(hex, 16));
        at += 4;
        continue;
      }
      error('Invalid escape in JSON string.');
    }
    error('Unterminated JSON string.');
  }

  function value(depth, location) {
    white();
    const start = text[at];
    if (start === '{' || start === '[') {
      if (depth >= maxDepth) fail('PACKAGE_LIMIT_EXCEEDED', 'JSON nesting exceeds the supported limit.', { path: location, maxDepth });
      at++;
      const object = start === '{';
      const result = object ? {} : [];
      const closing = object ? '}' : ']';
      white();
      if (text[at] === closing) { at++; return result; }
      let index = 0;
      while (true) {
        white();
        let key;
        if (object) {
          if (text[at] !== '"') error('Expected a quoted JSON object key.');
          key = string();
          white();
          if (text[at++] !== ':') error('Expected a colon after a JSON object key.');
        }
        const currentPath = object ? childPath(location, key) : `${location}[${index}]`;
        const parsed = value(depth + 1, currentPath);
        if (object) {
          if (Object.hasOwn(result, key)) {
            const previous = result[key];
            if (typeof allowDuplicate !== 'function' || allowDuplicate({ path: currentPath, key, previous, value: parsed }) !== true) {
              fail('INVALID_MANIFEST', 'Duplicate JSON object key.', { path: currentPath, key });
            }
          }
          // __proto__ must remain an ordinary own data key.
          Object.defineProperty(result, key, { value: parsed, enumerable: true, configurable: true, writable: true });
        } else {
          result.push(parsed);
          index++;
        }
        white();
        if (text[at] === closing) { at++; return result; }
        if (text[at++] !== ',') error('Expected a comma or closing JSON delimiter.');
      }
    }
    if (start === '"') return string();
    for (const [literal, parsed] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, at)) { at += literal.length; return parsed; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));
    if (number) {
      at += number[0].length;
      const parsed = Number(number[0]);
      if (!Number.isFinite(parsed)) error('Non-finite JSON numbers are unsupported.');
      return parsed;
    }
    error('Expected a valid JSON value.');
  }

  const result = value(0, '$');
  white();
  if (at !== text.length) error('Unexpected content after the JSON value.');
  return result;
}
