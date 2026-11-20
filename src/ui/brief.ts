/**
 * Long text, shortened the clean way (owner: no text that runs down the page, no "…" cut mid-word, nothing that
 * expands on hover): whole sentences up to about `max` characters. A first sentence longer than that is kept whole
 * when it is under 1.6x the limit; otherwise it is cut at the last word that fits and closed with a full stop.
 */
export function brief(text: string | null | undefined, max = 360): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  // sentence ends: ". ", "! ", "? " not after a one-letter initial or a common abbreviation (Inc., Corp., U.S.)
  const ends: number[] = [];
  const re = /[.!?](?=\s+[A-Z0-9"“(])/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const before = t.slice(Math.max(0, m.index - 5), m.index + 1);
    if (/(\b[A-Z]\.|\b(Inc|Corp|Co|Ltd|Jr|Sr|St|No|vs|U\.S|e\.g|i\.e)\.)$/.test(before)) continue;
    ends.push(m.index + 1);
  }
  const fit = ends.filter((e) => e <= max);
  if (fit.length) return t.slice(0, fit[fit.length - 1]);
  if (ends.length && ends[0] <= max * 1.6) return t.slice(0, ends[0]);
  const cut = t.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:\s]+$/, '');
  return `${cut}.`;
}
