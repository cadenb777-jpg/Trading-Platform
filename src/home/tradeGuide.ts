/**
 * The trade guide (the Setups page's detail) explains the trade in plain language: whether
 * to take it, exactly where to get in, where you're wrong, where to take profit, when to leave anyway, how many
 * shares, why it got its grade, and what 1,000 simulations of its history say. Education, not advice.
 */
import type { MarketRef } from '../data/quotes';
import { pct as fmtPct } from '../ui/charts';
import { formatPrice, h, toast } from '../ui/dom';
import { infoTip, termLabel } from '../ui/glossary';
import { sideRecord, takeProfit, type Setup, type StrategyInfo } from './setupsPanel';
import { canTrade, ownerConflict, readTrade, tradeBlock } from './tradeRead';
import { CHASE_LIMIT } from './entryZone';

export { canTrade, tradeBlock };
import { readSize, saveSize } from '../trade/sizing';
import type { Portfolio } from '../portfolio/types';

const pct = (v: number | null | undefined, d = 1) => fmtPct(v, d);
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const usd = (v: number) => `$${formatPrice(v)}`;
/** The exit rule without the entry sentence some strategies start it with. */
const exitOnly = (rule: string) => rule.replace(/^Enter at the next [^.]*open\.\s*/, '');

/** The one-paragraph answer to "should I take it?" */
function verdict(s: Setup): { tone: 'good' | 'ok' | 'wait' | 'no'; title: string; text: string } {
  const why = s.why?.length ? ` The catch: ${s.why.map((w) => w.charAt(0).toLowerCase() + w.slice(1)).join('; ')}.` : '';
  if (s.status === 'forming')
    return { tone: 'wait', title: 'Not yet: wait for today\'s close', text: `The signal is still forming on today's bar and only counts once the market closes. Check again after 4:00 PM New York time.${why}` };
  if (s.earnings?.inWindow)
    return { tone: 'no', title: 'Careful: earnings during the trade', text: `${s.symbol} reports on ${s.earnings.date}, inside the holding period. Earnings can gap the price straight past your stop. Most swing traders skip this or use a much smaller position.` };
  if (s.conflict)
    return {
      tone: 'wait',
      title: 'Mixed signals: be careful',
      text: `${s.conflict.strategy} says ${s.conflict.direction > 0 ? 'BUY' : 'SELL'} on ${s.symbol} at the same time${s.conflict.tier ? ` (${s.conflict.tier}-grade)` : ''}. The strategies look at different time frames, so both can be "right", but they can't both work. Most traders wait, or take only the higher grade at a small size.${why}`,
    };
  if (s.tier === 'A')
    return { tone: 'good', title: 'Yes, this meets every rule', text: 'The strategy has beaten random entries across the Nasdaq-100 after costs and after correcting for every strategy tested, it survives double costs and worked in both halves of its history, this stock\'s own record isn\'t losing, no earnings get in the way and the target is worth the risk. Take it at your normal size if the entry triggers.' };
  if (s.tier === 'B')
    return { tone: 'ok', title: 'Reasonable, at a smaller size', text: `Nothing about this setup is against it and the strategy has made money overall, but it hasn't cleared every A-grade test.${why} A common approach is half your normal size.` };
  return { tone: 'no', title: 'Watch only: not a trade yet', text: `This is the closest candidate, not a trade.${why}` };
}

/** What each reading means, in one line. */
const READING_HELP: Record<string, string> = {
  cot: 'Williams COT index: where commercial hedgers sit in Nasdaq-100 futures versus the last 3 years (0-100). A reading only, unless the COT edge study on your data passed; then it counts in the grade.',
  z: 'Z-score: how far the price is from its 20-bar average, in standard deviations. Below -1 is stretched down, above +1 stretched up.',
  weekly: 'Trend: whether the price is above or below its 200-day average. Pullbacks and mean reversion trade only with it; breakouts buy only above it.',
  rsi2: 'RSI(2): a very short-term overbought/oversold gauge, shown for context (the strategies no longer use it).',
};

/** A folded section: the basics stay visible, the detail opens on a click. */
function more(title: string, ...children: (Node | string)[]) {
  return h('details', { class: 'guide-more' }, h('summary', {}, title), h('div', { class: 'guide-more-body' }, ...children));
}

/** "The read": the holistic summary and one chip per factor. */
function readBox(r: ReturnType<typeof readTrade>, v: ReturnType<typeof verdict>) {
  const icon = { for: '✓', against: '✗', neutral: '•' } as const;
  return h(
    'div',
    { class: `guide-read ${v.tone}` },
    h('div', { class: 'guide-read-head' }, h('b', {}, v.title), infoTip('conviction')),
    h('div', { class: 'muted small' }, r.headline),
    h('div', { class: 'guide-factors' }, ...r.factors.map((f) => h('span', { class: `factor ${f.stance}`, title: f.text }, h('i', {}, icon[f.stance]), f.label, f.term ? infoTip(f.term) : ''))),
    h('p', { class: 'small' }, h('b', { class: 'up' }, 'For it: '), r.forText, '.'),
    h('p', { class: 'small' }, h('b', { class: 'down' }, 'Against it: '), r.againstText, '.'),
    h('p', { class: 'guide-action' }, h('b', {}, 'What to do: '), r.action),
    h('details', { class: 'guide-more inline' }, h('summary', {}, 'More on this verdict'), h('p', { class: 'small' }, v.text)),
  );
}

/** The owner's holdings (Account) and Webull open orders, for ownerConflict; whatever can't be read counts as none. */
async function ownerHas(symbol: string): Promise<string | null> {
  const [{ listDocs }, { combineHoldings, myPortfolios }, { loadSnapshot }] = await Promise.all([import('../data/store'), import('../portfolio/account'), import('../trade/webull')]);
  const timeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
  const [docs, snap] = await Promise.allSettled([timeout(listDocs<Portfolio>('portfolios'), 5000), timeout(loadSnapshot(), 8000)]);
  const holdings = docs.status === 'fulfilled' ? combineHoldings(myPortfolios(docs.value)) : [];
  const open = snap.status === 'fulfilled' && snap.value.ok ? (snap.value.open ?? []) : [];
  return ownerConflict(symbol, holdings, open);
}

/**
 * "Trade this": opens the Trade page's ticket filled from the setup (buy-stop at the trigger or a limit near the
 * price, the stop for sizing by risk, and the plan: target, the read, exit date). Pre-fills only: the owner still
 * previews and confirms in the confirm window, which is the only way an order is sent.
 */
export async function tradeSetup(s: Setup, strat?: StrategyInfo, marketTrend?: number | null, price: number = s.price) {
  const blocked = tradeBlock(s);
  if (blocked) return void toast(blocked);
  const owned = await ownerHas(s.symbol).catch(() => null);
  if (owned) return void toast(owned);
  const p = s.plan;
  // Once the trigger has traded (the strategy's signal triggered, or price is already through it), a buy-stop would be
  // below the market: use a limit near the current price instead.
  const through = !!s.trade || price >= p.trigger;
  // never a limit above a fair fill: at most a quarter of the planned risk past the entry (it then fills on a pullback)
  const entryAt = s.trade?.entry ?? p.trigger;
  const limit = p.entryType === 'stop' ? Math.min(price, entryAt + CHASE_LIMIT * Math.abs(entryAt - p.stop)) : price;
  const tp = takeProfit(s);
  const v = verdict(s);
  const read = readTrade(s, strat, marketTrend);
  (await import('../trade/webull')).openOrderTicket({
    symbol: s.symbol,
    side: 'BUY',
    guideStop: +p.stop.toFixed(2),
    ...(p.entryType === 'stop' && !through ? { orderType: 'STOP' as const, stopPrice: +p.trigger.toFixed(2) } : { orderType: 'LIMIT' as const, limitPrice: +limit.toFixed(2) }),
    plan: {
      target: +tp.price.toFixed(2),
      targetLabel: tp.tested ? tp.label : '2R guide',
      read: { title: v.title, action: read.action, tone: v.tone },
      setup: [s.strategyName.split(' (')[0], s.tier ? `${s.tier}-grade` : '', p.holdText ?? p.horizon].filter(Boolean).join(' · '),
      exitBy: p.exitBy,
    },
  });
}

/** The guide itself (also shown inline on the Setups page). */
export function tradeGuideBody(s: Setup, strat: StrategyInfo | undefined, onOpenChart: (ref: MarketRef) => void, marketTrend?: number | null): HTMLElement {
  const long = s.direction > 0;
  const p = s.plan;
  const entry = s.trade?.entry ?? (p.entryType === 'stop' ? p.trigger : s.price);
  const riskPerShare = Math.abs(entry - p.stop);
  const v = verdict(s);
  const side = long ? 'buy' : 'sell short';

  // Position-size calculator: account size and % risked -> shares.
  const size = readSize();
  const account = h('input', { class: 'input', type: 'number', min: 100, step: 1000, value: size.account, 'aria-label': 'Account size ($)' }) as HTMLInputElement;
  const risk = h('input', { class: 'input', type: 'number', min: 0.1, max: 5, step: 0.25, value: size.risk, 'aria-label': 'Risk per trade (%)' }) as HTMLInputElement;
  const sizeOut = h('p', { class: 'guide-size-out' });
  const drawSize = () => {
    const a = Math.max(0, parseFloat(account.value) || 0);
    const r = Math.min(5, Math.max(0, parseFloat(risk.value) || 0));
    saveSize({ account: a || 10000, risk: r || 0.5 });
    const dollars = (a * r) / 100;
    const shares = riskPerShare > 0 ? Math.floor(dollars / riskPerShare) : 0;
    const cost = shares * entry;
    sizeOut.replaceChildren(
      shares > 0
        ? h('span', {}, h('b', {}, `${shares} share${shares === 1 ? '' : 's'}`), ` (about ${usd(cost)}). If the stop is hit you lose about ${usd(shares * riskPerShare)}, which is ${r}% of your account.`, cost > a ? h('span', { class: 'down' }, ' That costs more than the account, so buy fewer or skip it.') : '')
        : h('span', { class: 'muted' }, 'Enter your account size and how much you\'re willing to lose on one trade.'),
    );
  };
  account.addEventListener('input', drawSize);
  risk.addEventListener('input', drawSize);
  drawSize();

  const steps: [string, Node | string][] = [
    [
      'When to get in',
      s.trade
        ? `The strategy's signal triggered at ${usd(s.trade.entry)} on ${shortDate(s.trade.filled)}. The scanner follows it as a paper trade (it isn't a position of yours): ${pct(s.trade.pnl)} so far, ${s.unit ?? 'day'} ${s.trade.daysHeld} of ${p.maxHold}. To take it now, buy only while the price is within a fair fill of ${usd(s.trade.entry)} (the "Right now" box says so), with the same stop.`
        : p.entryType === 'stop'
          ? `Place a ${long ? 'buy-stop' : 'sell-stop'} order at ${usd(p.trigger)}, ${long ? 'just above' : 'just below'} the signal ${s.unit ?? 'day'}'s ${long ? 'high' : 'low'}. It only fills if the price ${long ? 'rises' : 'falls'} through that level, which shows ${long ? 'buyers' : 'sellers'} have taken over. It's good until ${shortDate(p.validUntil)}; if it hasn't filled by then, cancel it: the moment has passed.`
          : `${long ? 'Buy' : 'Sell short'} at the next ${s.unit === 'hour' ? 'hour\'s' : s.unit === 'week' ? 'week\'s (Monday\'s)' : 'day\'s'} open (around ${usd(s.price)}). This strategy doesn't wait for confirmation because snap-backs happen fast.`,
    ],
    [
      'Where you\'re wrong (the stop)',
      `Put a stop at ${usd(p.stop)}, ${((riskPerShare / entry) * 100).toFixed(1)}% ${long ? 'below' : 'above'} the entry. If the price gets there the idea has failed: get out and don't move the stop further away. That's ${usd(riskPerShare)} of risk per share.`,
    ],
    [
      'Where to take profit',
      p.target != null
        ? `Target ${usd(p.target)}: ${p.targetNote}.${p.riskReward != null ? ` You're risking $1 to make about $${p.riskReward.toFixed(1)}${p.riskReward < 1.5 ? ', which is thin: winners have to come often for this to pay' : ''}.` : ''}${s.strategy === 'weekly_swing' ? ' Once the trade is up as much as you risked, move the stop to your entry price so it can no longer lose.' : ''}`
        : `No fixed target: the stop trails behind the price. ${p.exitRule}`,
    ],
    ['How long to hold, and when to get out anyway', `Plan to hold ${p.holdText ?? `up to ${p.maxHold} ${s.unit ?? 'day'}s`}. ${exitOnly(p.exitRule)} At the latest, close it by ${shortDate(p.exitBy)}.`],
    [
      'How much to buy',
      h(
        'div',
        { class: 'guide-size' },
        h('label', {}, h('span', { class: 'muted tiny' }, 'Account size ($)'), account),
        h('label', {}, h('span', { class: 'muted tiny' }, 'Risk per trade (%)'), risk),
        sizeOut,
        h('p', { class: 'muted tiny' }, tradeBlock(s) ?? 'Trade this (top of the guide, or the t key) opens the order ticket sized from your real account at this risk %.'),
        h('p', { class: 'muted tiny' }, 'Default 0.5% of the account per trade (the research behind the scanner suggests 0.25-1%), so a losing streak can\'t do real damage.'),
      ),
    ],
  ];

  const checks = h(
    'ul',
    { class: 'guide-checks' },
    ...s.checks.map((c) => h('li', { class: c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'neutral' }, h('i', {}, c.ok === true ? '✓' : c.ok === false ? '✗' : '•'), h('div', {}, h('b', {}, c.label), h('div', { class: 'muted small' }, c.detail)))),
  );

  const st = s.stock;
  const mc = s.monteCarlo;
  const rec = sideRecord(strat, s.direction);
  const smc = rec?.monteCarlo;
  const re = rec?.randomEntry;
  const rw = s.randomWalk;
  const mcLine = (m: NonNullable<Setup['monteCarlo']>, who: string) =>
    h(
      'p',
      {},
      `${who}: in ${m.runs.toLocaleString()} simulations of the next ${m.horizon} trades, `,
      h('b', { class: m.profitable >= 0.6 ? 'up' : m.profitable >= 0.5 ? 'warn' : 'down' }, `${Math.round(m.profitable * 100)}% ended ahead`),
      `. Typical result ${pct(m.median)}, bad case ${pct(m.bad)}, good case ${pct(m.good)}; the deepest dip along the way was ${pct(m.worstDrop)} in the worst 1 of 20. (Returns add up per trade on the same amount each time.)`,
    );

  const i = s.indicators;
  const readings: [string, string, string][] = (
    [
      i.cot != null ? ['cot', 'COT commercials', `${i.cot.toFixed(0)}/100`] : null,
      i.z != null ? ['z', 'Z-score', i.z.toFixed(2)] : null,
      i.weekly != null ? ['weekly', 'Trend (200-day average)', i.weekly > 0 ? 'above' : i.weekly < 0 ? 'below' : 'flat'] : null,
      i.rsi2 != null ? ['rsi2', 'RSI(2)', i.rsi2.toFixed(0)] : null,
    ] as ([string, string, string] | null)[]
  ).filter((x): x is [string, string, string] => !!x);

  const body = h(
    'div',
    { class: 'trade-guide' },
    h(
      'div',
      { class: 'guide-top' },
      h('span', { class: `setup-side ${long ? 'bull' : 'bear'}` }, long ? '▲ BUY' : '▼ SELL'),
      s.tier ? h('i', { class: `tier tier-${s.tier}` }, `${s.tier}-grade`) : '',
      h('span', { class: 'strategy-chip' }, s.strategyName),
      h('span', { class: 'muted small' }, `${usd(s.price)} now · ${p.horizon}`),
    ),
    readBox(readTrade(s, strat, marketTrend), v),
    h(
      'div',
      { class: 'guide-levels' },
      h('div', {}, h('span', { class: 'muted tiny' }, s.trade ? 'Entered' : p.entryType === 'open' ? `${long ? 'Buy' : 'Sell'} at the open, about` : long ? 'Buy above' : 'Sell below'), h('b', {}, usd(entry))),
      h('div', {}, termLabel('Stop', 'stop'), h('b', { class: 'down' }, usd(p.stop))),
      ((tp) => h('div', { title: tp.note }, h('span', { class: 'muted tiny' }, tp.tested ? tp.label : 'Take profit (2R guide)'), h('b', { class: 'up' }, usd(tp.price))))(takeProfit(s)),
      h('div', {}, h('span', { class: 'muted tiny' }, 'Out by'), h('b', {}, shortDate(p.exitBy))),
    ),

    h('h3', {}, 'The trade, step by step'),
    h('ol', { class: 'guide-steps' }, ...steps.map(([t, d]) => h('li', {}, h('b', {}, t), typeof d === 'string' ? h('p', {}, d) : d))),

    more(
      `Why it's ${s.tier ? `a ${s.tier}-grade` : 'filtered out'}`,
      h('p', { class: 'small' }, termLabel('How grades work', 'grade'), ' ',
        s.tier === 'A' ? 'Every test passed.' : s.tier === 'B' ? 'B means the strategy makes money overall and none of this setup\'s own checks is against it. It isn\'t an A because:' : 'C means at least one important thing is against it:'),
      s.why?.length ? h('ul', { class: 'guide-why' }, ...s.why.map((w) => h('li', {}, w))) : '',
      checks,
      h('h4', {}, 'Why the scanner picked it'),
      h('ul', { class: 'small' }, ...s.reasons.map((r) => h('li', {}, r))),
    ),

    more(
      'The statistics behind it',
      st.trades
        ? h('p', {}, `On ${s.symbol}: ${st.trades} past trades in its backtest, ${Math.round((st.winRate ?? 0) * 100)}% winners, ${pct(st.expectancy, 2)} per trade after costs, held ${st.avgBars?.toFixed(1) ?? '—'} ${s.unit ?? 'day'}s on average (${st.grade}).`)
        : h('p', { class: 'muted' }, `No past trades on ${s.symbol} with this strategy, so the record below is for all Nasdaq-100 stocks.`),
      rec ? h('p', {}, termLabel(`Across the Nasdaq-100 (${long ? 'buys' : 'sells'} only${strat?.lab ? `, trades since ${strat.forward?.since ?? 'it was first shown'}` : ''})`, strat?.lab ? 'forward' : 'trades'), `: ${rec.stats.trades} trades, ${Math.round((rec.stats.winRate ?? 0) * 100)}% winners, ${pct(rec.stats.expectancy, 2)} per trade, profit factor ${rec.stats.profitFactor ?? '—'}.`) : '',
      re
        ? h('p', {}, termLabel('Random-entry test', 'randomentry'), ` (${re.runs?.toLocaleString() ?? '1,000'} runs): `, h('b', { class: re.verdict === 'edge' ? 'up' : re.verdict === 'maybe' ? 'warn' : 'down' }, re.verdict === 'edge' ? 'the strategy beat chance' : re.verdict === 'maybe' ? 'inconclusive' : 'not clearly better than chance'), ` (p = ${re.p.toFixed(2)}${re.pAdjusted != null ? `; ${re.pAdjusted.toFixed(2)} after correcting for ${re.family} tests` : ''}; trades in the same week count as one draw).`)
        : '',
      rw && 'pending' in rw
        ? h('p', { class: 'muted' }, termLabel('Random-walk test', 'randomwalk'), `: running ${rw.runs.toLocaleString()} shuffled histories in the background.`)
        : rw
          ? h('p', {}, termLabel('Random-walk test', 'randomwalk'), ` (${rw.runs.toLocaleString()} runs): `, h('b', { class: rw.verdict === 'edge' ? 'up' : rw.verdict === 'maybe' ? 'warn' : 'down' }, rw.verdict === 'edge' ? 'likely a real edge' : rw.verdict === 'maybe' ? 'inconclusive' : 'could be luck'), ` (p = ${rw.p.toFixed(3)}${(rw as { q?: number }).q != null ? `, q = ${(rw as { q?: number }).q!.toFixed(3)}` : ''}).`)
          : '',
      mc ? mcLine(mc, 'This stock') : '',
      smc ? mcLine(smc, 'The strategy on all stocks') : '',
      rec?.monteCarloR ? h('p', {}, `At ${readSize().risk}% risk per trade, the worst dip along the next ${rec.monteCarloR.horizon} trades in the bad 1 of 20 simulations is about ${(Math.abs(rec.monteCarloR.worstDrop) * readSize().risk).toFixed(1)}% of the account (${rec.monteCarloR.worstDrop.toFixed(1)} R, after costs).`) : '',
      rec?.robust ? h('p', {}, termLabel('Robust to costs and time', 'outofsample'), `: ${rec.robust.costs ? 'still profitable' : 'not profitable'} at double costs plus stop slippage; ${rec.robust.halves ? 'profitable in both halves of its history' : 'not profitable in both halves of its history'}.`) : '',
      s.gradeBasis ? h('p', { class: 'muted small' }, `Grade based on: ${s.gradeBasis}.`) : '',
      h('p', { class: 'muted tiny' }, termLabel('Reading p', 'pvalue'), ' Under 0.05 is strong evidence, 0.05-0.20 a maybe, above 0.20 could easily be luck.'),
    ),

    readings.length
      ? more('The indicator readings, explained', h('dl', { class: 'guide-readings' }, ...readings.flatMap(([k, label, val]) => [h('dt', {}, label, ' ', h('b', {}, val)), h('dd', { class: 'muted small' }, READING_HELP[k])])))
      : '',

    s.levels.supports.length || s.levels.resistances.length || s.smartMoney?.length || s.news || s.darkPool
      ? more(
          'Levels, news and big-money flow',
          s.levels.supports.length || s.levels.resistances.length
            ? h('div', {}, h('p', { class: 'muted small' }, 'Prices where the stock turned before. Resistance can cap a rally; support can stop a fall.'),
                h('div', { class: 'setup-sr small' }, h('div', {}, h('b', {}, 'Resistance'), ...s.levels.resistances.map((x) => h('div', {}, `${usd(x.price)} · ${x.label}`))), h('div', {}, h('b', {}, 'Support'), ...s.levels.supports.map((x) => h('div', {}, `${usd(x.price)} · ${x.label}`)))))
            : '',
          s.darkPool ? h('p', { class: 'small' }, termLabel('Dark pool short volume', 'darkpool'), `: ${Math.round(s.darkPool.avg5 * 100)}% over 5 days vs ${Math.round(s.darkPool.avg40 * 100)}% normally.`) : '',
          ...(s.smartMoney ?? []).map((t) => h('p', { class: 'small' }, t.text)),
          s.news ? h('p', { class: 'small' }, 'News: ', s.news.link ? h('a', { href: s.news.link, target: '_blank', rel: 'noopener' }, s.news.headline) : s.news.headline, h('span', { class: 'muted' }, ` · ${s.news.source ?? ''}`)) : '',
        )
      : '',

    h(
      'div',
      { class: 'guide-actions' },
      h('button', { class: 'btn primary', disabled: !canTrade(s), title: tradeBlock(s) ?? 'Opens the order ticket filled from this plan, sized by your risk %. You still preview and confirm.', onclick: () => tradeSetup(s, strat, marketTrend) }, `Trade ${s.symbol}`),
      h('button', { class: 'btn', onclick: () => onOpenChart({ provider: 'schwab', symbol: s.symbol }) }, `Open ${s.symbol} chart`),
    ),
    h('p', { class: 'muted tiny' }, `Education, not advice. Past results and simulations don't guarantee the future. Plan to ${side} only what you can afford to lose.`),
  );
  return body;
}
