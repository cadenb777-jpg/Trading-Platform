/**
 * Flow → Positioning: off-exchange ("dark pool") share of a stock's weekly volume (helper engine/offexchange.py, FINRA
 * OTC Transparency) and, for funds, the price against the fund's own value (premium/discount to NAV).
 */
import { formatPrice, h } from '../ui/dom';
import { createLineChart, pct, pctU, statCards } from '../ui/charts';
import { THEME } from '../ui/theme';
import { edgePanel, sourceLine } from './panel';

export interface OffWeek {
  week: string;
  ats: number;
  otc: number;
  total: number;
  atsShare: number;
  offShare: number;
}
export interface OffExchange {
  symbol: string;
  weeks: OffWeek[];
  latest: OffWeek;
  avgAtsShare: number;
  avgOffShare: number;
  source: string;
}
export interface NavPremium {
  symbol: string;
  assetType: string;
  nav: number | null;
  navSource?: string;
  close?: number | null;
  last?: number | null;
  premium?: number | null;
  livePremium?: number | null;
  note: string;
}

/** Plain reading of the latest week against its own average (pure, tested). */
export function offRead(d: OffExchange): string {
  const diff = d.latest.atsShare - d.avgAtsShare;
  const move = Math.abs(diff) < 0.01 ? 'about its usual level' : diff > 0 ? `${(diff * 100).toFixed(1)} points above its ${d.weeks.length}-week average` : `${(-diff * 100).toFixed(1)} points below its ${d.weeks.length}-week average`;
  return `Week of ${d.latest.week}: ${pctU(d.latest.atsShare, 1)} of shares traded in dark pools, ${move}. It shows where trading happened, not whether it was buying or selling.`;
}

export function premiumRead(p: NavPremium): string {
  if (p.premium == null) return p.note;
  const size = Math.abs(p.premium);
  const word = p.premium >= 0 ? 'premium' : 'discount';
  const scale = size < 0.002 ? 'in line with its holdings (arbitrage keeps ETFs close)' : size < 0.01 ? `a small ${word}` : `a wide ${word} — check why before trading on it`;
  return `Closed at ${pctU(size, 2)} ${p.premium >= 0 ? 'above' : 'below'} its NAV: ${scale}.`;
}

export function offExchangePanel(symbol: string): HTMLElement {
  return edgePanel<OffExchange>({
    title: 'Dark-pool share',
    term: 'darkPool',
    sub: 'Off-exchange share of weekly volume (FINRA)',
    request: 'flow.offexchange',
    params: { symbol },
    timeout: 90000,
    render(d, body) {
      const box = h('div', { class: 'xe-chart' });
      body.append(
        statCards([
          { label: 'Dark pools (ATS)', value: pctU(d.latest.atsShare, 1), hint: `Week of ${d.latest.week} · ${d.weeks.length}-week average ${pctU(d.avgAtsShare, 1)}` },
          { label: 'All off-exchange', value: pctU(d.latest.offShare, 1), hint: `Dark pools plus internalisers · average ${pctU(d.avgOffShare, 1)}` },
        ]),
        h('p', { class: 'small' }, offRead(d)),
        box,
        sourceLine(`${d.source}. FINRA publishes 2–4 weeks late, so the newest week is that old.`),
      );
      requestAnimationFrame(() =>
        createLineChart(box, { height: 180, title: `${d.symbol} off-exchange share`, format: (v) => `${v.toFixed(0)}%` }).set([
          { name: 'Dark pools', color: THEME.viz1, data: d.weeks.map((w) => ({ time: w.week, value: w.atsShare * 100 })) },
          { name: 'All off-exchange', color: THEME.viz2, width: 1, data: d.weeks.map((w) => ({ time: w.week, value: w.offShare * 100 })) },
        ]),
      );
    },
  });
}

export function navPremiumPanel(symbol: string): HTMLElement {
  return edgePanel<NavPremium>({
    title: 'Price vs fund value',
    term: 'navPremium',
    sub: 'Premium or discount to NAV',
    request: 'invest.navpremium',
    params: { symbol },
    render(p, body) {
      if (p.nav == null) {
        body.append(h('p', { class: 'muted small' }, p.note));
        return;
      }
      body.append(
        statCards([
          { label: 'NAV (fund value per share)', value: formatPrice(p.nav), hint: p.navSource },
          { label: 'Last close', value: p.close != null ? formatPrice(p.close) : '—' },
          { label: 'Premium / discount', value: pct(p.premium ?? null, 2), hint: p.livePremium != null ? `Live (rough): ${pct(p.livePremium, 2)}` : '' },
        ]),
        h('p', { class: 'small' }, premiumRead(p)),
        sourceLine(p.note),
      );
    },
  });
}
