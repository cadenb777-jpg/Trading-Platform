/**
 * Today → Market mood: the fear gauge (the live VIX: what options traders pay for protection on the S&P 500 over the
 * next 30 days) beside a heat map of the 11 S&P 500 sectors (their SPDR ETFs' day change). Live from the same quote
 * feed as the ticker tape; tiles open the sector. The words come from the numbers by rules (tested).
 */
import { subscribeQuote, type MarketRef } from '../data/quotes';
import { runId } from '../ui/command';
import { h } from '../ui/dom';
import { gauge, heatGrid } from '../ui/viz';

export const SECTORS: { symbol: string; label: string }[] = [
  { symbol: 'XLK', label: 'Tech' },
  { symbol: 'XLC', label: 'Comms' },
  { symbol: 'XLY', label: 'Discretionary' },
  { symbol: 'XLF', label: 'Financials' },
  { symbol: 'XLI', label: 'Industrials' },
  { symbol: 'XLV', label: 'Health care' },
  { symbol: 'XLP', label: 'Staples' },
  { symbol: 'XLE', label: 'Energy' },
  { symbol: 'XLB', label: 'Materials' },
  { symbol: 'XLRE', label: 'Real estate' },
  { symbol: 'XLU', label: 'Utilities' },
];

/** What a VIX level means, in plain words (pure, tested). */
export function vixWords(vix: number | null): string {
  if (vix == null || !Number.isFinite(vix)) return 'Waiting for the VIX.';
  const move = (vix / Math.sqrt(12)).toFixed(1);
  const base = `Options price a typical S&P 500 move of about ±${move}% over the next month.`;
  if (vix < 13) return `Very calm: traders pay little for protection. ${base} Calm can mean complacency.`;
  if (vix < 18) return `Calm: normal, low worry. ${base}`;
  if (vix < 25) return `Nervous: protection is getting pricier. ${base}`;
  if (vix < 35) return `Fearful: traders are paying up for protection. ${base}`;
  return `Panic: extreme fear, historically near short-term lows. ${base}`;
}

/** One line on the sectors: how many are up and the leader and laggard (pure, tested). */
export function sectorWords(moves: { label: string; value: number | null }[]): string {
  const known = moves.filter((m): m is { label: string; value: number } => m.value != null);
  if (known.length < 3) return 'Waiting for sector prices.';
  const up = known.filter((m) => m.value > 0).length;
  const sorted = [...known].sort((a, b) => b.value - a.value);
  const fmt = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
  const breadth = up >= known.length * 0.75 ? 'broad buying' : up <= known.length * 0.25 ? 'broad selling' : 'a mixed tape';
  return `${up} of ${known.length} sectors up (${breadth}). Leading: ${sorted[0].label} ${fmt(sorted[0].value)}; lagging: ${sorted[sorted.length - 1].label} ${fmt(sorted[sorted.length - 1].value)}.`;
}

export function marketMood(): HTMLElement {
  let vix: number | null = null;
  const moves = new Map<string, number | null>(SECTORS.map((s) => [s.symbol, null]));
  const gaugeBox = h('div', { class: 'mood-gauge' });
  const heatBox = h('div', { class: 'mood-heat' });
  let frame = 0;
  const draw = () => {
    frame = 0;
    gaugeBox.replaceChildren(
      gauge({
        title: 'Fear gauge (VIX)',
        value: vix,
        min: 10,
        max: 40,
        zones: [
          { to: 13, tone: 'up' },
          { to: 18, tone: 'accent' },
          { to: 25, tone: 'warn' },
          { to: 40, tone: 'down' },
        ],
        valueText: vix == null ? '—' : vix.toFixed(1),
        caption: vixWords(vix),
      }),
    );
    const items = SECTORS.map((s) => ({ label: s.label, value: moves.get(s.symbol) ?? null, sub: s.symbol, title: `${s.label} (${s.symbol}): open it`, onClick: () => void runId(`tk:${s.symbol}`) }));
    heatBox.replaceChildren(heatGrid({ title: 'Sectors today', items, format: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`, caption: sectorWords(items) }));
  };
  const later = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  subscribeQuote({ provider: 'schwab', symbol: '$VIX' } as MarketRef, (q) => {
    if (q.last != null) {
      vix = q.last;
      later();
    }
  });
  for (const s of SECTORS)
    subscribeQuote({ provider: 'schwab', symbol: s.symbol } as MarketRef, (q) => {
      if (q.last != null && q.prevClose) {
        moves.set(s.symbol, (q.last / q.prevClose - 1) * 100);
        later();
      }
    });
  draw();
  return h('div', { class: 'mood' }, gaugeBox, heatBox);
}
