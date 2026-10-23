/**
 * Plain-language explanations of trading and statistics terms, shown by a small "i" next to the term: hover (or
 * tap on a phone) to read what it means and how to use it.
 */
import { h } from './dom';

export const TERMS: Record<string, { title: string; text: string }> = {
  grade: { title: 'Grades', text: 'A = the rules say take it at your normal size. B = reasonable, use about half size. C = watch only: something important is against it. The grade comes from the strategy\'s tested record, the big hedgers (COT), earnings dates and the reward for the risk.' },
  zscore: { title: 'Z-score', text: 'How far the price is from its recent average, measured in "normal moves" (standard deviations). -2 means unusually far below average (stretched, often bounces); +2 unusually far above. The scanner compares it with this stock\'s own usual range, because calm and wild stocks stretch differently.' },
  cot: { title: 'COT (Commitments of Traders)', text: 'A weekly government report of who holds Nasdaq-100 futures. "Commercials" are big hedgers. The COT index puts their position on a 0-100 scale versus the last 6 months: 60+ leans bullish, 40 or less bearish. A and B setups never go against them.' },
  willr: { title: 'Williams %R', text: 'Where today\'s close sits in the last 14 bars\' range: -100 at the bottom, 0 at the top. Below -80 is oversold, above -20 overbought. The signal is when it turns back out of those zones.' },
  wad: { title: 'Williams Accumulation/Distribution', text: 'A running total of buying versus selling pressure. Rising (accumulation) means money is flowing in; falling (distribution) means it is flowing out.' },
  rsi2: { title: 'RSI(2)', text: 'A very short-term overbought/oversold meter (0-100) over the last 2 bars. Very low readings often bounce within days.' },
  adx: { title: 'ADX', text: 'Trend strength, not direction. Above 20-25 the stock is trending; below, it is drifting sideways.' },
  atr: { title: 'ATR (average true range)', text: 'How much the stock usually moves in one bar. Stops and targets are set in ATRs so they fit each stock: a jumpy stock gets a wider stop.' },
  rr: { title: 'Reward:risk', text: 'How much you stand to make at the target for each $1 you risk to the stop. 2x means risk $1 to make $2. Below 1x, you need to be right most of the time.' },
  trend: { title: 'Trend filter', text: 'The direction one step up in time (hourly trades use the daily trend, daily trades the weekly trend, weekly trades the monthly trend). Trades only go with it.' },
  trades: { title: 'Trades (backtest)', text: 'How many times the strategy\'s rules actually triggered in the price history of all Nasdaq-100 stocks. That is the real sample size. It is not 1,000: 1,000 is how many random simulations are used to test those trades.' },
  sims: { title: '1,000 simulations', text: 'Each test repeats a random experiment 1,000 times (random entry days, shuffled price histories, or reshuffled trade sequences) to see how often luck alone does as well. 1,000 is the standard in statistics for a reliable answer.' },
  winrate: { title: 'Win rate', text: 'The share of past trades that made money after costs.' },
  avg: { title: 'Average per trade', text: 'The average return of one trade after costs (0.1% per round trip). Positive means the strategy made money on average.' },
  pf: { title: 'Profit factor', text: 'Money made on winners divided by money lost on losers. Above 1 makes money; 1.5+ is solid.' },
  tstat: { title: 't-statistic', text: 'How clearly the average trade differs from zero, given how much trades vary. Around 2 or more is clear evidence; under 1 could easily be noise.' },
  needed: { title: 'Trades needed', text: 'How many trades it would take for an average this size to be statistically clear (t = 2). If the strategy has fewer, the result may still be luck.' },
  randomentry: { title: 'Random-entry test', text: 'Takes the same stocks, direction and holding time but enters on random days, 1,000 times. If the strategy beats almost all of those (low p), its timing adds something real.' },
  randomwalk: { title: 'Random-walk test', text: 'Shuffles this stock\'s daily moves into a random order 1,000 times (same volatility, no real patterns) and runs the strategy on each. If it does as well on fake histories, its record here could be luck.' },
  pvalue: { title: 'p-value', text: 'The chance that luck alone gives a result this good. Under 0.05 = strong evidence; 0.05-0.20 = maybe; above 0.20 = could easily be luck.' },
  qvalue: { title: 'q-value', text: 'A p-value corrected for testing many stocks at once (when you test 100 things, some look good by luck). Read it the same way as p.' },
  montecarlo: { title: 'Monte Carlo', text: 'Builds 1,000 possible futures from the strategy\'s past trades (keeping winning and losing streaks together) to show how the next 20 trades might go: the chance of ending ahead, a typical result and a bad case.' },
  outofsample: { title: 'Recent history check', text: 'The same rules tested on only the most recent 30% of history. If the full test makes money but the recent part doesn\'t, the edge may be fading.' },
  edge: { title: 'COT + z-score edge study', text: 'Every past time a stock stretched beyond its usual range and turned back in the trend\'s direction, split by what the big hedgers were doing. If "Agreed" did clearly better than "Against" (low p), COT adds an edge on this time frame.' },
  darkpool: { title: 'Dark pool short volume', text: 'FINRA\'s daily short-sale share of off-exchange trading. Market makers short to fill customer buy orders, so an unusually high share often comes with heavy buying. A supporting clue, not a signal on its own.' },
  entryzone: { title: 'Entry zone', text: 'Live status from the current price: Waiting (not at the entry yet), Getting close (within a third of a normal move), Entry zone now (confirmed and still a fair price), Too far to chase (more than a quarter of the planned risk past the entry), or failed/expired.' },
  stop: { title: 'Stop', text: 'The price where the idea is proven wrong. Put a stop order there when you enter and never move it further away.' },
  forming: { title: 'Forming', text: 'The signal appeared on a bar that hasn\'t closed yet (this hour, today or this week). It only counts once that bar closes.' },
  lab: { title: 'Strategy lab', text: 'Whenever new bars arrive, the helper tries about 1,500 combinations of rules from 11 trading theories (reversal, momentum, squeezes, gaps, 52-week highs, pullbacks...) and filters (trend, COT, money flow, volatility and market regimes). Each is chosen on older data and judged on later windows it never saw, with a 1,000-run random-entry test corrected for multiple tries. Only combinations that still work there become strategies, graded on that unseen record only.' },
  sides: { title: 'Buys and sells separately', text: 'Stocks drift upward over time, so short trades fight the tide while long trades ride it. Each strategy is therefore judged separately for buys and for sells, and a setup is graded on its own side.' },
  pbo: { title: 'Probability of backtest overfitting', text: 'In each walk-forward window: did the combination that looked best on older data end up in the bottom half on the new data? The share of windows where it did. Above 50% means the search is mostly finding luck, and nothing is allowed through.' },
  efftrials: { title: 'Independent ideas tried', text: 'Many combinations are near copies (the same trigger with a different filter), so the lab counts each trigger-and-side family once when judging how much luck to expect from searching.' },
  dsr: { title: 'Deflated Sharpe ratio', text: 'Bailey & Lopez de Prado: the chance the strategy\'s Sharpe ratio is really above zero after allowing for how many ideas were tried and for fat tails. Shown for information; the decisive test is the unseen-data one.' },
  graveyard: { title: 'Graveyard', text: 'Every rule combination the lab tested and rejected, with the reason, kept on your computer. It is the honest record of what didn\'t work, so the same idea isn\'t mistaken for new later.' },
  conviction: { title: 'Conviction', text: 'A summary of how many factors line up for the trade versus against it, capped by the grade. It tells you how much weight to give the setup, not a guarantee.' },
};

/** A small "i" that explains a term on hover, focus or tap. */
export function infoTip(term: keyof typeof TERMS | string) {
  const t = TERMS[term];
  if (!t) return '';
  const tip = h('span', { class: 'info-tip-text', role: 'tooltip' }, h('b', {}, t.title), ' ', t.text);
  const el = h('span', { class: 'info-tip', tabindex: 0, 'aria-label': `What is ${t.title}?`, onclick: (e: Event) => (e.stopPropagation(), el.classList.toggle('open')) }, 'i', tip);
  el.addEventListener('blur', () => el.classList.remove('open'));
  return el;
}

/** A label followed by its "i". */
export function termLabel(label: string, term: string) {
  return h('span', { class: 'term' }, label, infoTip(term));
}
