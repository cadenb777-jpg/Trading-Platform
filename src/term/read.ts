/**
 * "Why it's moving": a short read of the whole market, worked out from the numbers already on the Monitor by fixed
 * rules (not AI, never invented). Each line appears only when its inputs are there, and names the figures it rests on,
 * so it can be checked against the tables beside it. Sources talk to each other here: futures moves in standard
 * deviations, trader positioning (CFTC), the Treasury curve, Fed odds, sectors and world markets.
 */

export interface FutRow {
  root: string;
  name: string;
  sector: string;
  change: number | null;
  /** Today's move in daily standard deviations. */
  sigma?: number | null;
  w1?: number | null;
  m1?: number | null;
  positioning?: { specIndex?: number | null; date?: string } | null;
}

export interface CurvePoint {
  label: string;
  now: number | null;
  monthAgo?: number | null;
  yearAgo?: number | null;
}

export interface ReadInput {
  futures?: FutRow[];
  curve?: CurvePoint[];
  /** Expected change in the policy rate by the third meeting from now, in percentage points, and that meeting's date. */
  fed?: { change: number; by: string } | null;
  /** Sector ETF moves relative to the S&P 500 today (fraction), by sector name. */
  sectorsVsSpx?: { name: string; rel: number }[];
  /** Today's moves (fraction) of named markets. */
  markets?: Record<string, number | null | undefined>;
}

export interface ReadLine {
  label: string;
  text: string;
}

const p = (v: number, d = 1) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;
const s = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}σ`;

export function spread(curve: CurvePoint[] | undefined, a: string, b: string, when: 'now' | 'monthAgo' | 'yearAgo' = 'now'): number | null {
  const x = curve?.find((c) => c.label === a)?.[when];
  const y = curve?.find((c) => c.label === b)?.[when];
  return x != null && y != null ? Math.round((y - x) * 100) : null;
}

export function marketRead(i: ReadInput): ReadLine[] {
  const out: ReadLine[] = [];
  const fut = (root: string) => i.futures?.find((f) => f.root === root);
  const es = fut('ES')?.change;
  const vx = fut('VX')?.change;
  const zn = fut('ZN')?.change;

  // 1. Regime: stocks with volatility, and what bonds say about why
  if (es != null && vx != null) {
    const tone = es > 0 && vx < 0 ? 'Risk-on' : es < 0 && vx > 0 ? 'Risk-off' : 'Mixed';
    let why = '';
    if (zn != null && Math.abs(es) > 0.001) {
      // bond futures fall when yields rise
      if (es > 0 && zn < 0) why = ': stocks and yields both up, a growth read';
      else if (es < 0 && zn > 0) why = ': stocks down while bonds rally, a growth scare';
      else if (es < 0 && zn < 0) why = ': stocks and bonds both down, rates are the pressure';
      else if (es > 0 && zn > 0) why = ': stocks and bonds both up, easier rates are helping';
    }
    out.push({ label: 'Regime', text: `${tone}${why} (S&P futures ${p(es, 2)}, VIX futures ${p(vx, 1)}).` });
  }

  // 2. Curve: steepening or flattening over the month
  const now = spread(i.curve, '2Y', '10Y');
  const month = spread(i.curve, '2Y', '10Y', 'monthAgo');
  if (now != null && month != null && Math.abs(now - month) >= 5) {
    out.push({ label: 'Curve', text: `2s10s ${now > 0 ? '+' : ''}${now} bp, ${now > month ? 'steepening' : 'flattening'} ${Math.abs(now - month)} bp over the month.` });
  }

  // 3. Fed
  if (i.fed && Math.abs(i.fed.change) >= 0.05) {
    const moves = Math.abs(i.fed.change) / 0.25;
    out.push({ label: 'Fed', text: `Futures price ${moves.toFixed(1)} ${i.fed.change < 0 ? 'cuts' : 'hikes'} of 25 bp by ${i.fed.by}.` });
  }

  // 4. Unusual moves: two standard deviations or more today
  const big = (i.futures ?? []).filter((f) => f.sigma != null && Math.abs(f.sigma) >= 2 && !/^M[A-Z]/.test(f.root)).sort((a, b) => Math.abs(b.sigma!) - Math.abs(a.sigma!)).slice(0, 3);
  if (big.length) out.push({ label: 'Unusual', text: big.map((f) => `${f.name} ${s(f.sigma!)}${f.change != null ? ` (${p(f.change)})` : ''}`).join(' · ') + '.' });

  // 5. Positioning against price: crowded trades moving the wrong way (CFTC speculators, 3-year index)
  const crowd = (i.futures ?? [])
    .filter((f) => f.change != null && f.positioning?.specIndex != null && !/^M[A-Z]/.test(f.root))
    .filter((f) => (f.positioning!.specIndex! >= 85 && f.change! < -0.005) || (f.positioning!.specIndex! <= 15 && f.change! > 0.005))
    .slice(0, 2);
  for (const f of crowd) {
    const long = f.positioning!.specIndex! >= 85;
    out.push({ label: 'Positioning', text: `${f.name} ${p(f.change!)} while speculators are ${long ? 'near their most long' : 'near their most short'} in 3 years (index ${Math.round(f.positioning!.specIndex!)}): ${long ? 'a crowded long unwinding' : 'shorts being squeezed'}.` });
  }

  // 6. Leadership: sectors and size
  const secs = [...(i.sectorsVsSpx ?? [])].sort((a, b) => b.rel - a.rel);
  const m = i.markets ?? {};
  const parts: string[] = [];
  if (secs.length >= 2) parts.push(`${secs[0].name} leads (${p(secs[0].rel, 2)} vs S&P), ${secs.at(-1)!.name} lags (${p(secs.at(-1)!.rel, 2)})`);
  if (m.IWM != null && m.SPY != null && Math.abs(m.IWM - m.SPY) >= 0.004) parts.push(`small caps ${m.IWM > m.SPY ? 'beat' : 'trail'} large by ${(Math.abs(m.IWM - m.SPY) * 100).toFixed(1)} pts`);
  if (m.EWJ != null && m.FXI != null && Math.sign(m.EWJ) !== Math.sign(m.FXI) && Math.abs(m.EWJ - m.FXI) >= 0.01) parts.push(`Asia split: Japan ${p(m.EWJ)}, China ${p(m.FXI)}`);
  if (parts.length) out.push({ label: 'Leadership', text: parts.join('; ') + '.' });

  // 7. Dollar and gold together (usually opposite)
  const dx = fut('DX')?.change;
  const gc = fut('GC')?.change;
  if (dx != null && gc != null && dx > 0.002 && gc > 0.005) out.push({ label: 'Haven', text: `Dollar ${p(dx, 2)} and gold ${p(gc)} rising together: demand for safety.` });
  return out;
}
