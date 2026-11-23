// Conservative text-layer verification for tagged instrument rack layout sheets.
// A multi-rack sheet needs a spatial reading that this text-only verifier cannot provide.
export function rackPageProvesPair(page, tag, rack) {
  if (
    !/instrument\s+rack\s+layout/i.test(page) ||
    !/=UBA\d+(?:\.\d+)?$/i.test(rack) ||
    /\b(?:not (?:mounted|installed|on (?:this |the )?rack)|removed|obsolete)\b/i.test(page)
  )
    return false;
  const upper = page.toUpperCase();
  const tokens = new Set(
    (upper.match(/=[A-Z0-9]+(?:=[A-Z0-9.+_-]+)+/g) ?? []).map((t) => t.replace(/\.$/, '')),
  );
  const drawnRacks = [...tokens].filter((t) => /=UBA\d+(?:\.\d+)?$/.test(t));
  if (drawnRacks.length !== 1 || tag === rack) return false;
  const direct = (t, r) => tokens.has(t) && drawnRacks[0] === r;
  if (direct(tag, rack)) return true;
  // Preserve note order while excluding unrelated title-block columns on the same lines.
  const firstColumn = upper
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s{5,}/)[0])
    .filter((line) => line && !/^\d{2}$/.test(line))
    .join(' ');
  const note =
    /HAVE THE SAME LAYOUT\.\s*ONLY THE TAGS ARE CHANGE(?:D)? FROM (=[A-Z0-9=]+) TO ((?:=[A-Z0-9=]+(?:(?:,| AN(?:D)?)\s*)?)+)\./g;
  const matches = [...firstColumn.matchAll(note)];
  if (matches.length !== 1) return false;
  const [, from, to] = matches[0];
  return (to.match(/=[A-Z0-9]+(?:=[A-Z0-9]+)*/g) ?? []).some(
    (prefix) =>
      rack.startsWith(prefix + '=') &&
      tag.startsWith(prefix + '=') &&
      direct(from + tag.slice(prefix.length), from + rack.slice(prefix.length)),
  );
}
