/**
 * Home's "Edge today" card: the platform's verified market-edge readings in one place, each with its source, linking to
 * the full tool. Pure and tested in edge.test.ts. Readings come from helper futures.carry (index futures fair value)
 * and rates.box (SPX box-spread rates vs Treasury bills), and bonds.curvefit (yield-curve recession odds and the most
 * unusual maturity against the fitted curve); any that are missing are simply left out.
 */
import { benchmarkRow, months, rate } from '../futures/boxRates';
import type { BoxReply } from '../futures/boxRates';
import { level, signedPct, signedPts, signedUsd, type Carry } from '../futures/fairValue';
import { curveEdgeLine, type CurveFit } from '../invest/curveFit';

export interface EdgeLine {
  /** What it is, in plain words. */
  label: string;
  /** The figure. */
  value: string;
  tone: 'up' | 'down' | '';
  /** One line of context: the numbers behind it. */
  detail: string;
  /** Where the full tool lives. */
  href: string;
  /** Source and time, for the line's tooltip. */
  source: string;
}

const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const tone = (v: number | null | undefined): EdgeLine['tone'] => (!ok(v) || Math.abs(v) < 1e-9 ? '' : v > 0 ? 'up' : 'down');

export function edgeLines(carry: Carry | null, box: BoxReply | null, curve: CurveFit | null = null): EdgeLine[] {
  const out: EdgeLine[] = [];
  for (const root of ['ES', 'NQ']) {
    const r = carry?.rows.find((x) => x.root === root);
    if (!r) continue;
    if (!r.cashOpen && ok(r.impliedOpenChange) && ok(r.impliedOpen))
      out.push({
        label: `${r.indexName} set to open`,
        value: signedPct(r.impliedOpenChange),
        tone: tone(r.impliedOpenChange),
        detail: `${r.contract?.code ?? root} less its fair premium points to ${level(r.impliedOpen)}`,
        href: '#futures/fair',
        source: 'Schwab futures and index, FRED SOFR, Yahoo dividends',
      });
    else if (r.cashOpen && ok(r.mispricing))
      out.push({
        label: `${r.indexName} futures vs fair value`,
        value: signedPts(r.mispricing),
        tone: '',
        detail: `${signedUsd(r.mispricingUsd)} a contract${ok(r.spreadBp) ? ` · buyers pay ${Math.round(r.spreadBp)} bp over SOFR` : ''}`,
        href: '#futures/fair',
        source: 'Schwab futures and index, FRED SOFR, Yahoo dividends',
      });
  }
  const b = box && benchmarkRow(box.rows.filter((r) => ok(r.midRate) && ok(r.bill)));
  if (b && ok(b.midRate) && ok(b.bill)) {
    const bp = (b.midRate - b.bill) * 10000;
    out.push({
      label: `Lend via S&P 500 box spreads, ${months(b.days)}`,
      value: rate(b.midRate),
      tone: Math.abs(bp) < 1 ? '' : bp > 0 ? 'up' : 'down',
      detail: `T-bill ${rate(b.bill)} · ${bp >= 0 ? '+' : ''}${Math.round(bp)} bp${ok(b.extraPer100k) && Math.abs(bp) >= 1 ? ` · ${signedUsd(b.extraPer100k)} per $100,000` : ''} at the mid`,
      href: '#futures/rates',
      source: 'Schwab SPX options, FRED Treasury curve',
    });
  }
  const c = curveEdgeLine(curve);
  if (c) out.push(c);
  return out;
}
