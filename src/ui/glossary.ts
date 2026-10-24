/**
 * Plain-language explanations of trading and statistics terms, shown by a small "i" next to the term: hover (or
 * tap on a phone) to read what it means and how to use it.
 */
import { h } from './dom';

export const TERMS: Record<string, { title: string; text: string }> = {
  grade: { title: 'Grades', text: 'A = the rules say take it at your normal size. B = reasonable, use about half size. C = watch only: something important is against it. A needs the strategy to beat random entries after correcting for every strategy tested, to survive double costs and to work in both halves of its history; lab strategies also need 30 trades after they were first shown, and hourly setups 2 years of hourly history.' },
  zscore: { title: 'Z-score', text: 'How far the price is from its recent average, measured in "normal moves" (standard deviations). -2 means unusually far below average (stretched, often bounces); +2 unusually far above. The scanner compares it with this stock\'s own usual range, because calm and wild stocks stretch differently.' },
  cot: { title: 'COT (Commitments of Traders)', text: 'A weekly government report of who holds Nasdaq-100 futures. "Commercials" are big hedgers. The COT index puts their position on a 0-100 scale versus the last 3 years. It is shown as a reading; it only counts in the grade if the COT edge study on your own data shows it helps.' },
  rsi2: { title: 'RSI(2)', text: 'A very short-term overbought/oversold meter (0-100) over the last 2 bars. Very low readings often bounce within days.' },
  atr: { title: 'ATR (average true range)', text: 'How much the stock usually moves in one bar. Stops and targets are set in ATRs so they fit each stock: a jumpy stock gets a wider stop.' },
  rr: { title: 'Reward:risk', text: 'How much you stand to make at the target for each $1 you risk to the stop. 2x means risk $1 to make $2. Below 1x, you need to be right most of the time.' },
  trend: { title: 'Trend filter', text: 'One rule everywhere: buys only above the 200-day average, sells only below it (on hourly bars, as of the previous close; on weekly bars, the 40-week average). It replaced four different trend rules. The weekly rule tests on your data check whether it earns its place.' },
  trades: { title: 'Trades (backtest)', text: 'How many times the strategy\'s rules actually triggered in the price history of all Nasdaq-100 stocks. That is the real sample size. It is not 1,000: 1,000 is how many random simulations are used to test those trades.' },
  sims: { title: '1,000 simulations', text: 'Each test repeats a random experiment 1,000 times (random entry days, shuffled price histories, or reshuffled trade sequences) to see how often luck alone does as well. 1,000 is the standard in statistics for a reliable answer.' },
  winrate: { title: 'Win rate', text: 'The share of past trades that made money after costs.' },
  avg: { title: 'Average per trade', text: 'The average return of one trade after costs (0.1% per round trip). Positive means the strategy made money on average. Results in R (multiples of the risk) are after costs too.' },
  pf: { title: 'Profit factor', text: 'Money made on winners divided by money lost on losers. Above 1 makes money; 1.5+ is solid.' },
  tstat: { title: 't-statistic', text: 'How clearly the average trade differs from zero, given how much trades vary. Trades taken in the same week (the same day on hourly bars) count as ONE bet, because they share one market move. Around 2 or more is clear evidence; under 1 could easily be noise.' },
  needed: { title: 'Independent bets needed', text: 'How many independent weeks of trades an average this size needs to pass a one-sided test at p 0.10 with an 80% chance of spotting it (1.28 + 0.84 standard errors). Fewer than that, and the result may still be luck.' },
  randomentry: { title: 'Random-entry test', text: 'Takes the same stocks, direction and holding time but enters on random days, 1,000 times. Trades from the same date move together to one random date, so a sell-off that set off 30 signals counts as one draw, not 30. If the strategy beats almost all of those (low p), its timing adds something real. The p shown for grades is also corrected for how many strategies are tested.' },
  randomwalk: { title: 'Random-walk test', text: 'Shuffles this stock\'s daily moves into a random order 1,000 times (same volatility, no real patterns) and runs the strategy on each. If it does as well on fake histories, its record here could be luck.' },
  pvalue: { title: 'p-value', text: 'The chance that luck alone gives a result this good. Under 0.05 = strong evidence; 0.05-0.20 = maybe; above 0.20 = could easily be luck.' },
  qvalue: { title: 'q-value', text: 'A p-value corrected for testing many stocks at once (when you test 100 things, some look good by luck). Read it the same way as p.' },
  montecarlo: { title: 'Monte Carlo', text: 'Builds 1,000 possible futures from the strategy\'s past trades (keeping winning and losing streaks together) to show how the next 20 trades might go: the chance of ending ahead, a typical result and a bad case.' },
  outofsample: { title: 'Robust to costs and time', text: 'Two checks: the strategy still makes money with double trading costs plus extra slippage on every stop, and it made money in both the first and the second half of its history. An edge that fails either is fragile.' },
  edge: { title: 'COT edge study', text: 'Every past time a stock stretched beyond its usual range and turned back, split by what the big hedgers were doing, tested for a 26-week and a 3-year index at three thresholds. Whole weeks are shuffled (COT is one reading per week), and the 6 versions are corrected for being tried together. If none passes, COT stays a reading only.' },
  darkpool: { title: 'Dark pool short volume', text: 'FINRA\'s daily short-sale share of off-exchange trading. Market makers short to fill customer buy orders, so an unusually high share often comes with heavy buying. A supporting clue, not a signal on its own.' },
  entryzone: { title: 'Entry zone', text: 'Live status from the current price: Waiting (not at the entry yet), Getting close (within a third of a normal move), Entry zone now (confirmed and still a fair price), Too far to chase (more than a quarter of the planned risk past the entry), or failed/expired.' },
  stop: { title: 'Stop', text: 'The price where the idea is proven wrong. Put a stop order there when you enter and never move it further away.' },
  forming: { title: 'Forming', text: 'The signal appeared on a bar that hasn\'t closed yet (this hour, today or this week). It only counts once that bar closes.' },
  lab: { title: 'Strategy lab', text: 'Once a week the helper tries about 800 combinations of rules from 11 trading theories and 8 filters. Each is chosen on older data and judged on later windows it never saw. Survivors are saved and then judged ONLY on trades after the day they were first shown; they can\'t be better than B until 30 such trades, and they leave if that forward record fails.' },
  sides: { title: 'Buys and sells separately', text: 'Stocks drift upward over time, so short trades fight the tide while long trades ride it. Each strategy is therefore judged separately for buys and for sells, and a setup is graded on its own side.' },
  pbo: { title: 'Probability of backtest overfitting', text: 'In each walk-forward window: did the combination that looked best on older data end up in the bottom half on the new data? The share of windows where it did. Above 50% means the search is mostly finding luck, and nothing is allowed through.' },
  efftrials: { title: 'Independent ideas tried', text: 'Many combinations are near copies (the same trigger with a different filter), so the lab counts each trigger-and-side family once when judging how much luck to expect from searching.' },
  dsr: { title: 'Deflated Sharpe ratio', text: 'Bailey & Lopez de Prado: the chance the strategy\'s Sharpe ratio is really above zero after allowing for how many ideas were tried and for fat tails. Shown for information; the decisive test is the unseen-data one.' },
  graveyard: { title: 'Graveyard', text: 'Every rule combination the lab tested and rejected, with the reason, kept on your computer. It is the honest record of what didn\'t work, so the same idea isn\'t mistaken for new later.' },
  holm: { title: 'Corrected for many tests', text: 'Tier A tests about 15 strategy records at once. Test enough and one passes by luck, so each p-value is raised (Holm method) for the number of tests before it can earn an A.' },
  forward: { title: 'Forward record', text: 'A lab strategy\'s trades signalled after the day it was first shown. The windows that chose it are not evidence; only these new trades are.' },
  rules: { title: 'Rule tests', text: 'Each "which version of this rule?" question (turn signal, trend filter, exits, stretch measure, breakout type) re-tested once a week on your own price history. The simplest version that beats random entries wins; the page shows whether your data agrees with the rules in use.' },
  sector: { title: 'Open risk per sector', text: 'How much of your account is at risk in each sector if every listed trade is on at your chosen risk per trade. The Nasdaq-100 is mostly tech, so several setups can be one sector bet. Display only.' },
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
