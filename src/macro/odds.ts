/**
 * Prediction-market odds (helper: predictions.markets) and matching them to economic-calendar events: the FOMC
 * decision gets the meeting's cut / hold / hike odds; CPI, jobs, unemployment, GDP and retail sales get the open
 * markets about that release that settle soon after it. Read only: the platform never bets or trades.
 */
import type { CalendarEvent } from '../data/schwab';

export type OddsCategory = 'fed' | 'macro' | 'politics';

export interface PredictionMarket {
  source: 'Polymarket' | 'Kalshi';
  id: string;
  question: string;
  event: string;
  outcome: string;
  category: OddsCategory;
  /** Price of the Yes side, 0-1 (read as the crowd's probability). */
  yes: number;
  volume: number;
  /** ISO times ('' when the source doesn't say). */
  updated: string;
  closes: string;
  url: string;
}

export interface FedGroup {
  source: 'Polymarket' | 'Kalshi';
  title: string;
  url: string;
  /** YYYY-MM-DD the markets settle (the decision day). */
  meeting: string;
  outcomes: { label: string; bucket: 'cut' | 'hold' | 'hike'; yes: number }[];
  /** Normalised to add up to 1. */
  odds: { cut: number; hold: number; hike: number };
  volume: number;
  updated: string;
}

export interface PredictionsReply {
  markets: PredictionMarket[];
  fed: FedGroup[];
  errors: Record<string, string>;
  fetched: number;
  total: number;
  stale?: boolean;
}

export type EventOdds = { kind: 'fed'; groups: FedGroup[] } | { kind: 'markets'; markets: PredictionMarket[] } | null;

const DAY = 86400;

/** Calendar titles -> words a matching market's question has. */
const RELEASES: [RegExp, RegExp][] = [
  [/\bcpi\b|consumer price/i, /\bcpi\b|inflation/i],
  [/non-?farm|payroll/i, /payroll|jobs report|jobs added|nonfarm/i],
  [/unemployment rate/i, /unemployment/i],
  [/\bgdp\b/i, /\bgdp\b|recession/i],
  [/retail sales/i, /retail sales/i],
  [/\bpce\b/i, /\bpce\b/i],
];

export const isFomc = (title: string) => /fomc|federal funds/i.test(title) && !/minutes|member|speaks|press/i.test(title);

const toUnix = (iso: string) => (iso ? Date.parse(iso) / 1000 : NaN);

/**
 * The prediction-market odds that belong next to a calendar event (US events only), or null.
 * FOMC: every Fed-decision group whose meeting is within 3 days of the event, biggest volume first.
 * Releases: up to 3 macro markets about that report that close between 1 day before and 10 days after it.
 */
export function matchOdds(e: CalendarEvent, data: Pick<PredictionsReply, 'markets' | 'fed'> | null): EventOdds {
  if (!data || e.country !== 'USD') return null;
  if (isFomc(e.title)) {
    const groups = data.fed.filter((g) => g.meeting && Math.abs(toUnix(`${g.meeting}T18:00:00Z`) - e.time) <= 3 * DAY).sort((a, b) => b.volume - a.volume);
    return groups.length ? { kind: 'fed', groups } : null;
  }
  const rule = RELEASES.find(([title]) => title.test(e.title));
  if (!rule) return null;
  const markets = data.markets
    .filter((m) => m.category === 'macro' && rule[1].test(`${m.question} ${m.event}`))
    .filter((m) => {
      const t = toUnix(m.closes);
      return Number.isFinite(t) && t >= e.time - DAY && t <= e.time + 10 * DAY;
    })
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 3);
  return markets.length ? { kind: 'markets', markets } : null;
}

/** '62%' (or '<1%' / '>99%'). */
export function pct(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p > 0 && p < 0.005) return '<1%';
  if (p < 1 && p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}

/** Short text for the calendar's Odds cell: 'Cut 64% · Hold 34%' or 'Above 3.0%: 42%'. */
export function oddsSummary(o: EventOdds): string {
  if (!o) return '';
  if (o.kind === 'fed') {
    const g = o.groups[0];
    return (['cut', 'hold', 'hike'] as const)
      .filter((k) => g.odds[k] >= 0.005)
      .sort((a, b) => g.odds[b] - g.odds[a])
      .map((k) => `${k[0].toUpperCase()}${k.slice(1)} ${pct(g.odds[k])}`)
      .join(' · ');
  }
  const m = o.markets[0];
  return `${m.outcome || m.question}: ${pct(m.yes)}`;
}

/** Polymarket volume is in dollars ('$1.2M'); Kalshi counts contracts ('150K contracts'). */
export function fmtVolume(v: number, source: PredictionMarket['source'] = 'Polymarket'): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  const n = v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : `${Math.round(v)}`;
  return source === 'Kalshi' ? `${n} contracts` : `$${n}`;
}

/** Filters for the Prediction Markets panel. */
export function filterMarkets(markets: PredictionMarket[], f: { category?: OddsCategory | 'all'; source?: string; query?: string }): PredictionMarket[] {
  const q = (f.query ?? '').trim().toLowerCase();
  return markets.filter(
    (m) =>
      (!f.category || f.category === 'all' || m.category === f.category) &&
      (!f.source || f.source === 'all' || m.source === f.source) &&
      (!q || m.question.toLowerCase().includes(q) || m.event.toLowerCase().includes(q)),
  );
}
