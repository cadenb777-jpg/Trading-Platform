/**
 * Flow → options walls: the strike above the price with the most calls held open (the "call wall") and the strike
 * below with the most puts (the "put wall"). Dealers who sold those options hedge around them, so price often stalls
 * near them into expiry: a tendency, not a rule. Pure and tested (walls.test.ts); the page draws them.
 */
export interface StrikeRow {
  strike: number;
  callOi: number;
  putOi: number;
}

export interface Walls {
  call: { strike: number; oi: number; distance: number } | null;
  put: { strike: number; oi: number; distance: number } | null;
}

/** The call wall (at or above the price) and the put wall (at or below), with their distance from the price. */
export function optionWalls(rows: StrikeRow[], spot: number): Walls {
  if (!(spot > 0)) return { call: null, put: null };
  let call: StrikeRow | null = null;
  let put: StrikeRow | null = null;
  for (const r of rows) {
    if (r.strike >= spot && r.callOi > 0 && (!call || r.callOi > call.callOi)) call = r;
    if (r.strike <= spot && r.putOi > 0 && (!put || r.putOi > put.putOi)) put = r;
  }
  return {
    call: call ? { strike: call.strike, oi: call.callOi, distance: call.strike / spot - 1 } : null,
    put: put ? { strike: put.strike, oi: put.putOi, distance: put.strike / spot - 1 } : null,
  };
}

/** What the walls mean, in plain words. */
export function wallWords(w: Walls, fmt: (v: number) => string): string {
  const pc = (v: number) => `${Math.abs(v * 100).toFixed(1)}%`;
  const parts: string[] = [];
  if (w.call) parts.push(`Call wall ${fmt(w.call.strike)} (${pc(w.call.distance)} above): the most calls held open above the price; it often acts as a ceiling into expiry.`);
  if (w.put) parts.push(`Put wall ${fmt(w.put.strike)} (${pc(w.put.distance)} below): the most puts held open below; it often acts as a floor.`);
  if (!parts.length) return 'No clear walls: open interest is thin around the price.';
  if (w.call && w.put) parts.push('A break through either wall can speed the move, as dealers unwind their hedges. A tendency, not a rule.');
  return parts.join(' ');
}
