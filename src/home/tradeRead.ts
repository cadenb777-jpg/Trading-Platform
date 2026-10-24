/**
 * "The read": one plain summary of a setup that weighs every factor at once, the way a desk trader would talk
 * it through: what lines up for the trade, what is against it, how much conviction that adds up to (never more
 * than the grade allows) and what to do. Each factor is a simple for / against / neutral call. Only things the
 * tests support count (helper v21): COT counts only when the edge study on your data passed.
 */
import { sideRecord, type Setup, type StrategyInfo } from './setupsPanel';

export type Stance = 'for' | 'against' | 'neutral';

export interface Factor {
  key: string;
  label: string;
  stance: Stance;
  /** Short reason, e.g. "above the 200-day average". */
  text: string;
  /** Glossary term for the "i". */
  term?: string;
}

export interface TradeRead {
  headline: string;
  conviction: 'High' | 'Medium' | 'Low' | 'Watch only';
  factors: Factor[];
  forText: string;
  againstText: string;
  action: string;
}

export function readTrade(s: Setup, strat?: StrategyInfo, marketTrend?: number | null): TradeRead {
  const d = s.direction > 0 ? 1 : -1;
  const i = s.indicators;
  const f: Factor[] = [];
  const add = (key: string, label: string, stance: Stance, text: string, term?: string) => f.push({ key, label, stance, text, term });

  // Price structure
  if (i.weekly && i.trendRule && i.trendRule !== 'none') add('trend', 'Trend', i.weekly === d ? 'for' : 'against', `${i.weekly > 0 ? 'uptrend' : 'downtrend'} (${i.trendText ?? i.trendRule})`, 'trend');
  if (i.cotGate) {
    add('cot', 'Big hedgers (COT)', i.cotView === 'agree' ? 'for' : 'against', i.cotGate.value != null ? `commercials ${i.cotView === 'agree' ? 'confirm' : "don't confirm"} it (${i.cotGate.value.toFixed(0)}/100)` : 'no COT reading for this date', 'cot');
  } else if (i.cot != null) {
    add('cot', 'Big hedgers (COT)', 'neutral', `reading only: ${i.cot.toFixed(0)}/100 (no tested COT edge)`, 'cot');
  }
  if (i.z != null) {
    if (s.strategy === 'breakout') add('stretch', 'Stretch', Math.abs(i.z) < 2.5 ? 'for' : 'against', Math.abs(i.z) < 2.5 ? `not over-extended (z ${i.z.toFixed(1)})` : `already very stretched (z ${i.z.toFixed(1)})`, 'zscore');
    else if (!s.lab) {
      const stretched = d > 0 ? i.z <= -1 : i.z >= 1;
      add('stretch', 'Stretch', stretched || s.strategy === 'weekly_swing' ? 'for' : 'neutral', `${d > 0 ? 'below' : 'above'} its average (z ${i.z.toFixed(1)})`, 'zscore');
    }
  }

  // Evidence
  const rec = sideRecord(strat, d);
  const ps = rec?.stats;
  const sideWord = d > 0 ? 'buys' : 'sells';
  if (ps?.trades) {
    const re = rec?.randomEntry;
    const exp = ps.expectancy ?? 0;
    const p = re?.pAdjusted ?? re?.p ?? 1;
    const robust = !rec?.robust || (rec.robust.costs && rec.robust.halves);
    add('record', strat?.lab ? 'Forward record' : 'Strategy record', exp <= 0 ? 'against' : p <= 0.1 && robust ? 'for' : 'neutral',
      exp <= 0 ? `the strategy's ${sideWord} lost money after costs` : p <= 0.1 && robust ? `the strategy's ${sideWord} beat random entries, after costs and the correction for many tests` : `its ${sideWord} are profitable, but not proven better than random`, strat?.lab ? 'forward' : 'randomentry');
  }
  if (s.stock.trades) add('stock', `Record on ${s.symbol}`, s.stock.grade === 'failed' ? 'against' : s.stock.grade === 'proven' || s.stock.grade === 'mixed' ? 'for' : 'neutral', `${s.stock.trades} past trades, ${Math.round((s.stock.winRate ?? 0) * 100)}% winners`, 'winrate');
  if (s.plan.riskReward != null && s.strategy !== 'mean_reversion') add('rr', 'Reward:risk', s.plan.riskReward >= 1.5 ? 'for' : s.plan.riskReward < 1 ? 'against' : 'neutral', `${s.plan.riskReward.toFixed(1)}x to the target`, 'rr');

  // Context
  if (marketTrend != null && marketTrend !== 0) add('market', 'Market', marketTrend === d ? 'for' : 'against', `Nasdaq-100 ${marketTrend > 0 ? 'above' : 'below'} its 200-day average`, 'trend');
  if (s.earnings?.inWindow) add('earnings', 'Earnings', 'against', `reports ${s.earnings.date}, inside the trade`);
  if (s.conflict) add('mixed', 'Other strategies', 'against', `${s.conflict.strategy} says ${s.conflict.direction > 0 ? 'buy' : 'sell'}`);
  if (s.news && s.news.tone) add('news', 'News', s.news.tone * d > 0 ? 'for' : 'against', `${s.news.tone > 0 ? 'positive' : 'negative'} headlines`);

  const pro = f.filter((x) => x.stance === 'for');
  const con = f.filter((x) => x.stance === 'against');
  const score = pro.length - con.length;
  const conviction: TradeRead['conviction'] =
    s.tier === 'C' || !s.tier || s.status === 'forming' ? 'Watch only' : s.tier === 'A' && score >= 3 ? 'High' : score >= 2 ? 'Medium' : 'Low';
  const side = d > 0 ? 'buy' : 'sell';
  const list = (xs: Factor[]) => xs.map((x) => x.text).join('; ');
  const entry = s.trade?.entry ?? s.plan.trigger;
  const action =
    s.status === 'forming' ? 'Wait: the signal only counts once this bar closes.'
      : conviction === 'Watch only' ? `Don't trade it. Keep it on the watch list: ${con.length ? `it would need ${con.map((x) => x.label.toLowerCase()).join(', ')} to improve` : 'the evidence is too thin'}.`
        : s.trade ? `Already triggered at $${entry.toFixed(2)}: manage it with the stop and the exit date.`
          : `${side === 'buy' ? 'Buy' : 'Sell short'} only if price ${s.plan.entryType === 'stop' ? `trades ${d > 0 ? 'above' : 'below'} $${entry.toFixed(2)}` : 'is still near here at the next open'}, with the stop at $${s.plan.stop.toFixed(2)}, ${conviction === 'High' ? 'at your normal size' : 'at about half your normal size'}.`;
  return {
    headline: `${d > 0 ? 'Bullish' : 'Bearish'} setup · ${conviction === 'Watch only' ? 'watch only' : `${conviction.toLowerCase()} conviction`} · ${pro.length} for, ${con.length} against`,
    conviction,
    factors: f,
    forText: pro.length ? list(pro) : 'nothing stands out',
    againstText: con.length ? list(con) : 'nothing important',
    action,
  };
}
