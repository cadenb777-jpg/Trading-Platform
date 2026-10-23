/**
 * "The read": one plain summary of a setup that weighs every factor at once, the way a desk trader would talk
 * it through: what lines up for the trade, what is against it, how much conviction that adds up to (never more
 * than the grade allows) and what to do. Each factor is a simple for / against / neutral call.
 */
import { sideRecord, type Setup, type StrategyInfo } from './setupsPanel';

export type Stance = 'for' | 'against' | 'neutral';

export interface Factor {
  key: string;
  label: string;
  stance: Stance;
  /** Short reason, e.g. "weekly trend up". */
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

const HIGHER: Record<string, string> = { hour: 'daily', day: 'weekly', week: 'monthly' };

export function readTrade(s: Setup, strat?: StrategyInfo, marketTrend?: number | null): TradeRead {
  const d = s.direction > 0 ? 1 : -1;
  const i = s.indicators;
  const unit = s.unit ?? 'day';
  const f: Factor[] = [];
  const add = (key: string, label: string, stance: Stance, text: string, term?: string) => f.push({ key, label, stance, text, term });

  // Price structure
  if (i.weekly != null) add('trend', 'Trend', i.weekly === d ? 'for' : i.weekly === -d ? 'against' : 'neutral', `${HIGHER[unit] ?? 'higher'} trend ${i.weekly > 0 ? 'up' : i.weekly < 0 ? 'down' : 'flat'}`, 'trend');
  if (i.cotView) add('cot', 'Big hedgers (COT)', i.cotView === 'agree' ? 'for' : i.cotView === 'against' ? 'against' : 'neutral', `commercials ${i.cotView === 'agree' ? 'on the same side' : i.cotView === 'against' ? 'on the other side' : 'neutral'}${i.cot != null ? ` (${i.cot.toFixed(0)}/100)` : ''}`, 'cot');
  if (i.z != null) {
    if (s.strategy === 'breakout') add('stretch', 'Stretch', Math.abs(i.z) < 2.5 ? 'for' : 'against', Math.abs(i.z) < 2.5 ? `not over-extended (z ${i.z.toFixed(1)})` : `already very stretched (z ${i.z.toFixed(1)})`, 'zscore');
    else {
      const stretched = d > 0 ? i.z <= -1 : i.z >= 1;
      const turning = s.strategy === 'weekly_swing'; // the pullback signal only fires once z turns back
      add('stretch', 'Stretch', stretched || turning ? 'for' : 'neutral', `${d > 0 ? 'below' : 'above'} its average (z ${i.z.toFixed(1)})${turning ? ' and turning back' : ''}`, 'zscore');
    }
  }
  if (s.strategy === 'weekly_swing' && i.willr != null) add('momentum', 'Momentum', 'for', `Williams %R turned ${d > 0 ? 'up out of oversold' : 'down out of overbought'} (${i.willr.toFixed(0)})`, 'willr');
  else if (s.strategy === 'mean_reversion' && i.rsi2 != null) add('momentum', 'Momentum', (d > 0 ? i.rsi2 <= 15 : i.rsi2 >= 85) ? 'for' : 'neutral', `RSI(2) ${i.rsi2.toFixed(0)}: ${d > 0 ? 'deeply oversold' : 'deeply overbought'}`, 'rsi2');
  else if (s.strategy === 'breakout' && i.adx != null) add('momentum', 'Momentum', i.adx >= 20 ? 'for' : 'neutral', `ADX ${i.adx.toFixed(0)}: ${i.adx >= 20 ? 'trending' : 'weak trend'}`, 'adx');
  if (i.wadRising != null) add('flow', 'Money flow', i.wadRising === d > 0 ? 'for' : 'against', i.wadRising ? 'money flowing in' : 'money flowing out', 'wad');

  // Evidence
  const rec = sideRecord(strat, d);
  const ps = rec?.stats;
  const sideWord = d > 0 ? 'buys' : 'sells';
  if (ps?.trades) {
    const re = rec?.randomEntry;
    const exp = ps.expectancy ?? 0;
    add('record', 'Strategy record', exp <= 0 ? 'against' : re?.verdict === 'edge' ? 'for' : 'neutral',
      exp <= 0 ? `the strategy's ${sideWord} lost money in its backtest` : re?.verdict === 'edge' ? `the strategy's ${sideWord} beat random entries` : `its ${sideWord} are profitable, but not proven better than random`, 'randomentry');
  }
  if (s.stock.trades) add('stock', `Record on ${s.symbol}`, s.stock.grade === 'failed' ? 'against' : s.stock.grade === 'proven' || s.stock.grade === 'mixed' ? 'for' : 'neutral', `${s.stock.trades} past trades, ${Math.round((s.stock.winRate ?? 0) * 100)}% winners`, 'winrate');
  if (s.plan.riskReward != null && s.strategy !== 'mean_reversion') add('rr', 'Reward:risk', s.plan.riskReward >= 1.5 ? 'for' : s.plan.riskReward < 1 ? 'against' : 'neutral', `${s.plan.riskReward.toFixed(1)}x to the target`, 'rr');

  // Context
  if (marketTrend != null && marketTrend !== 0) add('market', 'Market', marketTrend === d ? 'for' : 'against', `Nasdaq-100 in a weekly ${marketTrend > 0 ? 'uptrend' : 'downtrend'}`, 'trend');
  if (s.earnings?.inWindow) add('earnings', 'Earnings', 'against', `reports ${s.earnings.date}, inside the trade`);
  if (s.conflict) add('mixed', 'Other strategies', 'against', `${s.conflict.strategy} says ${s.conflict.direction > 0 ? 'buy' : 'sell'}`);
  if (s.news && s.news.tone) add('news', 'News', s.news.tone * d > 0 ? 'for' : 'against', `${s.news.tone > 0 ? 'positive' : 'negative'} headlines`);

  const pro = f.filter((x) => x.stance === 'for');
  const con = f.filter((x) => x.stance === 'against');
  const score = pro.length - con.length;
  const conviction: TradeRead['conviction'] =
    s.tier === 'C' || !s.tier || s.status === 'forming' ? 'Watch only' : s.tier === 'A' && score >= 4 ? 'High' : score >= 2 ? 'Medium' : 'Low';
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
