import type { Finding } from '../../shared/projectAssistant.js';

// Older saved findings have one review flag for both document and 3D uncertainty.
// Recognize only an affirmative documented pair with an explicit model-only caveat.
// Other legacy wording stays reviewable even when the candidate looks plausible.
export function documentsRackPair(finding: Finding) {
  const text = finding.evidence.trim();
  const parts =
    /^(?:Стр\.|Page)\s*\d+(?:,\s*Instrument Rack Layout)?:\s*(.+?)\.\s*(?:Видимостта(?: му)?(?: в модела)? не е (?:документирана|установена|посочена|потвърдена)|Скритият статус(?: в модела)? не е указан|Model visibility is not documented)\.?$/iu.exec(
      text,
    );
  if (!parts) return false;
  const [relation, note, ...extra] = parts[1].split(';').map((s) => s.trim());
  if (extra.length) return false;
  const pair =
    /^(?:показан е |HPU 1 rack shows )?(=[A-Z0-9=.+_-]+)\s+(?:(?:е (?:показан |означен на чертежа )?)?на (?:instrument rack |рак(?:а)? |rack )?|(?:is shown )?on (?:instrument rack )?)(=[A-Z0-9=.+_-]+)$/iu.exec(
      relation,
    );
  if (!pair) return false;
  let [, tag, rack] = pair;
  if (note) {
    const substitution =
      /^(?:бележката (?:указва|посочва|предвижда) (?:същото разположение (?:за HPU \d+ )?съ?с? |същата подредба със )?(?:промяна|смяна|замяна) на |за HPU \d+ се сменя |the note says HPU \d+ has the same layout with )(=[A-Z]+\d+) (?:на|с|changed to) (=[A-Z]+\d+)$/iu.exec(
        note,
      );
    if (!substitution) return false;
    const [, from, to] = substitution;
    if (!tag.startsWith(from + '=') || !rack.startsWith(from + '=')) return false;
    tag = to + tag.slice(from.length);
    rack = to + rack.slice(from.length);
  }
  return (
    tag.toUpperCase() === finding.tag.toUpperCase() &&
    rack.toUpperCase() === finding.target.toUpperCase()
  );
}
